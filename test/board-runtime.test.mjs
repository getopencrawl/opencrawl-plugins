import test from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {fixture} from './fixture.mjs';
import {invoke} from '../runtime/main.mjs';
import {boardHook,waitAfterExit} from '../runtime/board.mjs';
import {atomic,hash,readJson} from '../runtime/io.mjs';
import {markPrivate} from '../runtime/privacy.mjs';

const page = {cursor: 'c'.repeat(64), more: false, messages: [{id: 9, text: 'Fixture mail'}]};
const empty = {cursor: null, more: false, messages: []};
async function session(t, harness = 'claude-code', enabled = true) {
  const f = await fixture(t, harness);
  f.behavior.registration = {session: f.event.session_id, workspace: f.b.owner.tenantId, agent: 'b'.repeat(64),
    boardProtocol: 2, boardInbox: enabled, pollAfterMs: 1000};
  f.behavior.page = empty;
  async function call(action, kind, fields = {}) {
    let text = '';
    await invoke(f.root, action, {...f.event, hook_event_name: kind, ...fields}, {write: part => { text += part; }});
    return text ? JSON.parse(text) : undefined;
  }
  const start = () => call('start', 'SessionStart');
  const registration = await start();
  assert.equal(registration.hookSpecificOutput.additionalContext.includes('will confirm automatic delivery'), enabled);
  assert(!registration.hookSpecificOutput.additionalContext.includes('automatic at active hooks'));
  const file = join(f.b.profile, 'plugin-state', f.b.key, 'board', hash(f.event.session_id) + '.json');
  const set = fields => atomic(file, {...readJson(file), ...fields});
  const inbox = (kind = 'PostToolUse', fields) => call('inbox', kind, fields);
  const stop = windowMs => boardHook(f.b, {...f.event, hook_event_name: 'Stop'}, {windowMs});
  const requests = () => f.received.filter(r => r.path === '/api/board/v2/inbox');
  return {...f, inbox, call, start, set, stop, requests, file};
}

test('parallel active hooks offer a complete page once, leave it pending and retry a lost handoff', async t => {
  const f = await session(t);
  f.behavior.page = page;
  const notices = (await Promise.all(Array.from({length: 12}, () => f.inbox()))).filter(Boolean);
  assert.equal(notices.filter(n => n.hookSpecificOutput.additionalContext.includes('automatic at active hooks')).length, 1);
  const pages = notices.filter(n => n.hookSpecificOutput.additionalContext.includes('Fixture mail'));
  assert.equal(pages.length, 1);
  const output = pages[0].hookSpecificOutput;
  assert.equal(output.hookEventName, 'PostToolUse');
  assert.deepEqual(JSON.parse(output.additionalContext.split('\n').at(-1)), page);
  assert.equal(f.requests().length, 1);
  assert.deepEqual(f.requests()[0].body, {workspace: f.b.owner.tenantId, currentSession: {harness: f.b.client, sessionId: f.event.session_id}});
  assert(!JSON.stringify(readJson(f.file)).includes('Fixture mail'));
  f.set({next: 0});
  assert.equal(await f.inbox(), undefined);
  f.set({next: 0, offeredAt: Date.now() - 61_000});
  assert(await f.inbox('PostToolUseFailure'));
  await f.start();
  assert(await f.inbox('UserPromptSubmit'));
});

test('old servers and child sessions make zero inbox requests and empty steps stay silent', async t => {
  const f = await session(t, 'codex', false);
  assert.equal(await f.inbox(), undefined);
  assert.equal(f.requests().length, 0);
  f.behavior.registration.boardInbox = true;
  await f.start();
  assert.equal(await f.inbox('PostToolUse', {agent_id: 'other-session'}), undefined);
  assert.equal(f.requests().length, 0);
  assert.match((await f.inbox()).hookSpecificOutput.additionalContext, /automatic at active hooks/);
  for (let step = 0; step < 20; step++) assert.equal(await f.inbox(), undefined);
  assert.equal(f.requests().length, 1);
});

test('a large page exposes IDs only and supplies no cursor to acknowledge incomplete content', async t => {
  const f = await session(t);
  f.behavior.page = {...page, messages: [{id: 9, text: 'x'.repeat(8000)}]};
  const text = (await f.inbox()).hookSpecificOutput.additionalContext;
  assert.match(text, /Message IDs: 9/);
  assert(!text.includes(page.cursor));
  assert(!text.includes('x'.repeat(50)));
});

test('account changes, incognito and expired foreground credentials cannot expose mail', async t => {
  const f = await session(t);
  await f.inbox();
  f.received.length = 0;
  f.set({next: 0});
  f.behavior.owner = {...f.b.owner, userId: 'another-account'};
  assert.equal(await f.inbox(), undefined);
  assert.equal(f.requests().length, 0);
  f.behavior.owner = f.b.owner;
  f.behavior.page = page;
  const saved = join(f.b.profile, hash(f.b.api) + '.json'), credential = readJson(saved);
  atomic(saved, {...credential, expiresAt: 0});
  f.set({next: 0});
  assert.equal(await f.inbox(), undefined);
  assert.equal(f.behavior.refreshes, 0);
  assert.equal(f.requests().length, 0);
  atomic(saved, credential);
  f.set({next: 0});
  f.behavior.beforeInbox = () => markPrivate(f.b, {harness: f.b.client, sessionId: f.event.session_id});
  assert.equal(await f.inbox(), undefined);
  assert.equal(f.requests().length, 1);
  assert.equal(await f.inbox(), undefined);
  assert.equal(f.requests().length, 1);
});

test('Codex checks once at Stop even after an empty prompt, then lets the same page stop normally', async t => {
  const f = await session(t, 'codex');
  assert.match((await f.inbox('UserPromptSubmit')).hookSpecificOutput.additionalContext, /automatic at active hooks/);
  f.behavior.page = page;
  const decision = await f.inbox('Stop');
  assert.equal(decision.decision, 'block');
  assert.match(decision.reason, /Fixture mail/);
  assert.equal(await f.inbox('Stop'), undefined);
  f.behavior.page = empty;
  assert.equal(await f.inbox('Stop'), undefined);
  assert(f.requests().every(r => !('acknowledge' in r.body)));
  const wrong = await f.call('search', 'PreToolUse', {tool_name: 'mcp__opencrawl__board_inbox', tool_input: {acknowledge: page.cursor}});
  assert.equal(wrong.hookSpecificOutput.permissionDecision, 'deny');
  assert.equal(await f.call('search', 'PreToolUse', {tool_name: 'mcp__opencrawl__board_inbox',
    tool_input: {currentSession: {harness: 'codex', sessionId: f.event.session_id}, acknowledge: page.cursor}}), undefined);
});

test('Claude drops a late fetch on session end, can resume and wakes only once per unacknowledged page', async t => {
  const f = await session(t);
  f.behavior.page = page;
  let release, entered;
  const blocked = new Promise(resolve => {release = resolve;});
  const fetching = new Promise(resolve => {entered = resolve;});
  f.behavior.beforeInbox = async () => {entered(); await blocked;};
  const old = f.stop(400);
  await fetching;
  await f.inbox('SessionEnd');
  release();
  assert.equal(await old, undefined);
  await f.start();
  f.behavior.beforeInbox = undefined;
  assert.match((await f.stop(300)).wake, /Fixture mail/);
  f.set({next: 0});
  assert.equal(await f.stop(80), undefined);
  assert(f.requests().every(r => !('acknowledge' in r.body)));
});

test('idle expiry and unavailable board leave pending mail available for the next active step', async t => {
  const f = await session(t);
  f.behavior.page = page;
  await f.inbox();
  await f.start();
  f.set({confirmed: true});
  f.behavior.beforeInbox = () => delay(150);
  assert.equal(await f.stop(70), undefined);
  f.behavior.beforeInbox = undefined;
  f.set({next: 0});
  f.behavior.fail = true;
  assert.equal(await f.inbox(), undefined);
  f.behavior.fail = false;
  f.set({next: 0});
  assert.match((await f.inbox()).hookSpecificOutput.additionalContext, /Fixture mail/);
});

test('a newer Claude Stop owns delivery and a new prompt cancels a sleeping waiter', async t => {
  const f = await session(t);
  let release, entered;
  const blocked = new Promise(resolve => {release = resolve;});
  const fetching = new Promise(resolve => {entered = resolve;});
  f.behavior.beforeInbox = async () => {entered(); await blocked;};
  const old = f.stop(350);
  await fetching;
  const newer = f.stop(100);
  // The new owner is waiting for the reserved poll interval.
  await delay(25);
  f.behavior.page = page;
  release();
  assert.deepEqual(await Promise.all([old, newer]), [undefined, undefined]);
  f.behavior.beforeInbox = undefined;
  f.set({next: Date.now() + 1000});
  const idle = f.stop(200);
  await delay(20);
  const active = await f.inbox('UserPromptSubmit');
  assert.match(active.hookSpecificOutput.additionalContext, /Fixture mail/);
  assert.equal(await idle, undefined);
});

test('explicit leave stops the waiter; a later rejoin can receive messages', async t => {
  const f = await session(t);
  f.behavior.page = {...empty, left: true};
  assert.equal(await f.stop(80), undefined);
  assert.equal(readJson(f.file).waiter, null);
  f.behavior.page = page;
  f.set({next: 0});
  assert.match((await f.inbox()).hookSpecificOutput.additionalContext, /Fixture mail/);
});

test('Cursor startup signals pending IDs for its own registered chat and leaves acknowledgement to the model', async t => {
  const f = await fixture(t, 'cursor');
  const session = f.event.session_id;
  const registration = {session, workspace: f.b.owner.tenantId, agent: 'b'.repeat(64),
    boardProtocol: 2, boardInbox: true, name: 'cursor-reader'};
  f.behavior.registration = registration;
  async function start(fields = {}) {
    let stdout = '';
    await invoke(f.root, 'start', {hook_event_name: 'sessionStart', conversation_id: session, ...fields},
      {write: s => {stdout += s;}});
    return JSON.parse(stdout).additional_context;
  }
  const reads = () => f.received.filter(r => r.path === '/api/board/v2/inbox');
  f.behavior.page = {ids: [9], cursor: page.cursor, messages: page.messages};
  const context = await start();
  assert.match(context, /OpenCrawl board mail is waiting/);
  assert(!context.includes('Fixture mail') && !context.includes(page.cursor));
  assert.deepEqual(reads()[0].body, {workspace: f.b.owner.tenantId, currentSession: {harness:'cursor',sessionId:session},noticeOnly:true});
  for (const absent of [{ids: []}, {ids: [9], left: true}, {ids: ['invalid']}]) {
    f.behavior.page = absent;
    assert.doesNotMatch(await start(), /board mail is waiting/);
  }
  assert.doesNotMatch(await start({cursor_version:'3.18.9'}), /Set your name and task/);
  const count = reads().length;
  await start({parent_conversation_id: 'other-chat'});
  f.behavior.registration = {...registration, name:null};
  await start();
  f.behavior.registration = {...registration, boardInbox:false};
  await start();
  assert.equal(reads().length,count);
  f.behavior.registration = registration;
  f.behavior.page = {ids:[9]};
  f.behavior.beforeInbox = () => markPrivate(f.b,{harness:'cursor',sessionId:session});
  assert.doesNotMatch(await start(), /board mail is waiting/);
  assert.doesNotMatch(await start(), /board mail is waiting/);
  assert.equal(reads().length,count+1);
});

test('Cursor stop waits for pending IDs, returns a fixed follow-up once and never acknowledges for the model', {timeout:8000}, async t => {
  const f = await fixture(t, 'cursor');
  const session = f.event.session_id;
  f.behavior.registration = {session, workspace: f.b.owner.tenantId, agent:'b'.repeat(64),
    boardProtocol:2, boardInbox:true, pollAfterMs:1000};
  f.behavior.page = {ids:[]};
  const event = (name, fields = {}) => ({hook_event_name:name, conversation_id:session, ...fields});
  const sink = {write() {}};
  await invoke(f.root, 'start', event('sessionStart'), sink);
  const stop = {session_id:session, hook_event_name:'stop', status:'completed', loop_count:0};
  const reads = () => f.received.filter(r=>r.path==='/api/board/v2/inbox');
  for (const fields of [{status:'aborted'}, {status:'error'}, {loop_count:1}, {parentSessionId:'parent'}]) {
    assert.equal(await boardHook(f.b,{...stop,...fields},{windowMs:20}),undefined);
  }
  assert.equal(reads().length,0);
  const waited = boardHook(f.b,stop,{windowMs:2200});
  while (!reads().length) await delay(10);
  f.behavior.page = {ids:[9],cursor:page.cursor,messages:page.messages};
  const output = await waited;
  assert.match(output.followup_message,/board_inbox/);
  assert(!JSON.stringify(output).includes(page.cursor) && !JSON.stringify(output).includes('Fixture mail'));
  assert(reads().every(r=>r.body.noticeOnly===true && r.body.currentSession.sessionId===session && !r.body.acknowledge));
  assert.equal(await boardHook(f.b,stop,{windowMs:50}),undefined);
  f.behavior.page = {ids:[10]};
  await invoke(f.root,'start',event('sessionStart'),sink);
  let json = '';
  await invoke(f.root,'inbox',event('stop',{status:'completed',loop_count:0}),{write:chunk=>{json+=chunk;}});
  assert.deepEqual(JSON.parse(json),output);
});

test('Cursor drops stale stop output on new input, session end, privacy or loss of board access', {timeout:8000}, async t => {
  const f=await fixture(t,'cursor'), session=f.event.session_id;
  f.behavior.registration={session,workspace:f.b.owner.tenantId,agent:'b'.repeat(64),boardProtocol:2,boardInbox:true};
  f.behavior.page={ids:[1]};
  const call=(action,name,extra={})=>invoke(f.root,action,{hook_event_name:name,conversation_id:session,...extra},{write(){}});
  const stop=()=>boardHook(f.b,{hook_event_name:'stop',session_id:session,status:'completed',loop_count:0},{windowMs:900});
  await call('start','sessionStart');
  await call('capture','beforeSubmitPrompt',{generation_id:'new-turn'});
  const count=f.received.length;
  assert.equal(await stop(),undefined);
  assert.equal(f.received.length,count);
  await call('start','sessionStart');
  f.behavior.fail=true;
  assert.equal(await stop(),undefined);
  f.behavior.fail=false;
  for(const boundary of ['beforeSubmitPrompt','sessionEnd','privacy']){
    await call('start','sessionStart');
    let release,started;
    const active=new Promise(resolve=>{started=resolve;});
    const response=new Promise(resolve=>{release=resolve;});
    f.behavior.beforeInbox=()=>{started();return response;};
    const pending=stop();
    await active;
    if(boundary==='privacy')markPrivate(f.b,{harness:'cursor',sessionId:session});
    else await call('capture',boundary);
    release();
    assert.equal(await pending,undefined);
  }
});

test('the first Cursor prompt recovers a missed sessionStart and addresses the configured inbox', async t => {
  const f = await fixture(t, 'cursor'), session = f.event.session_id;
  f.behavior.registration = {session, workspace:f.b.owner.tenantId, agent:'b'.repeat(64), boardInbox:true, boardProtocol:2};
  f.behavior.page = {ids:[19]};
  atomic(join(f.root,'mcp.json'),{mcpServers:{other:{url:'https://another.invalid/mcp'},local_board:{url:f.b.api+'/mcp'}}});
  async function call(action, name, extra={}) {
    let stdout='';
    await invoke(f.root,action,{hook_event_name:name,conversation_id:session,generation_id:'manual-turn',...extra},
      {write:part=>{stdout+=part;}});
    return JSON.parse(stdout);
  }
  await call('capture','beforeSubmitPrompt',{parent_conversation_id:'parent'});
  assert.equal(f.received.filter(r=>r.path.startsWith('/api/board/')).length,0);
  await call('capture','beforeSubmitPrompt');
  await call('capture','beforeSubmitPrompt');
  assert.equal(f.received.filter(r=>r.path==='/api/board/bootstrap').length,1);
  const result=await call('inbox','stop',{status:'completed',loop_count:0});
  assert.match(result.followup_message,/local_board MCP server/);
  assert(result.followup_message.includes(JSON.stringify({harness:'cursor',sessionId:session})));
  assert(!result.followup_message.includes('another.invalid'));
});

test('only Cursor Desktop offers mail after a tool, quietly throttles and retries an unacknowledged offer at stop', async t => {
  const f = await fixture(t, 'cursor'), id = f.event.session_id;
  f.behavior.registration = {session:id, workspace:f.b.owner.tenantId, agent:'b'.repeat(64), boardProtocol:2, boardInbox:true};
  const file = join(f.b.profile,'plugin-state',f.b.key,'board',hash(id)+'.json');
  const reads = () => f.received.filter(r => r.path === '/api/board/v2/inbox');
  async function callback(action, name, fields = {}) {
    let output = '';
    await invoke(f.root,action,{hook_event_name:name,conversation_id:id,cursor_version:'3.18.9',generation_id:'turn',...fields},
      {write:part=>{output+=part;}});
    return JSON.parse(output);
  }
  await callback('capture','beforeSubmitPrompt',{generation_id:'turn'});
  f.behavior.page = {ids:[9], messages:page.messages, cursor:page.cursor};
  for(const fields of [{cursor_version:'2026.11.22-e9042b2'}, {cursor_version:undefined}, {parent_conversation_id:'parent'},
      {generation_id:'old-turn'}, {generation_id:undefined}])
    assert.deepEqual(await callback('capture','postToolUse',fields),{});
  assert.equal(reads().length,0);
  f.behavior.page = {ids:[]};
  assert.deepEqual(await callback('capture','postToolUse'),{});
  f.behavior.page = {ids:[9], messages:page.messages, cursor:page.cursor};
  assert.deepEqual(await callback('capture','postToolUse'),{});
  assert.equal(reads().length,1);
  const allowPoll = () => atomic(file,{...readJson(file),next:0});
  allowPoll();
  const offers = await Promise.all([callback('capture','postToolUse'),callback('capture','postToolUse')]);
  const messages = offers.map(o=>o.additional_context).filter(Boolean);
  assert.equal(messages.length,1);
  assert.match(messages[0],/only the opencrawl MCP server's board_inbox/);
  assert(!messages[0].includes(page.cursor) && !messages[0].includes('Fixture mail'));
  allowPoll();
  assert.deepEqual(await callback('capture','postToolUse'),{});
  allowPoll();
  const wake = await callback('inbox','stop',{status:'completed',loop_count:0,generation_id:'turn'});
  assert.equal(wake.followup_message,messages[0]);
  assert(reads().every(r=>r.body.noticeOnly===true && !r.body.acknowledge));
  markPrivate(f.b,{harness:'cursor',sessionId:id});
  const count = reads().length;
  assert.deepEqual(await callback('capture','postToolUse'),{});
  assert.equal(reads().length,count);
});

test('Desktop prioritizes direct notices, batches routine mail only during work and checkpoints successful tool reads',async t=>{
  const f=await fixture(t,'cursor'),id=f.event.session_id,currentSession={harness:'cursor',sessionId:id};
  const file=join(f.b.profile,'plugin-state',f.b.key,'board',hash(id)+'.json');
  const messages={direct:[],routine:[1,2]};
  const requests=[];
  f.behavior.registration={session:id,workspace:f.b.owner.tenantId,name:'reader',agent:'c'.repeat(64),boardInbox:true,boardDirect:true,boardProtocol:2};
  f.behavior.sync=async args=>{
    requests.push(args);
    const ids=messages[args.delivery].filter(n=>n>(args.after??0));
    return {messages:ids.map(id=>({id})),next:Math.max(args.after??0,...ids),more:false,notificationReceipt:'f'.repeat(64)};
  };
  async function call(action,name,extra={}){
    let out='';
    await invoke(f.root,action,{hook_event_name:name,conversation_id:id,generation_id:'turn',cursor_version:'3.18.9',...extra},{write:x=>{out+=x;}});
    return JSON.parse(out);
  }
  const after=extra=>call('capture','postToolUse',extra);
  const callback=()=>({hook_event_name:'stop',session_id:id,generation_id:'turn',loop_count:0,status:'completed'});
  await call('start','sessionStart');
  await call('capture','beforeSubmitPrompt');
  assert.deepEqual(await after(),{});
  assert(requests.every(x=>x.delivery==='direct'));
  const due=()=>{const s=readJson(file);s.feeds.routine.next=0;atomic(file,s);};
  due();messages.direct.push(3);
  assert.match((await after()).additional_context,/"delivery":"direct"/);
  const urgent=readJson(file).feeds.direct.pending;
  const digest=(await after()).additional_context;
  assert.match(digest,/"delivery":"routine"/);
  assert.match(digest,/"after":0,"through":2/);
  const input={currentSession,delivery:'direct',after:urgent.after,through:urgent.through};
  const output=token=>JSON.stringify({content:[{type:'text',text:JSON.stringify({messages:[{id:3,text:'real mail'}],next:3,notificationReceipt:token})}]});
  await after({tool_name:'MCP:board_inbox',tool_input:input,tool_output:output('bad')});
  assert(readJson(file).feeds.direct.pending);
  await after({tool_name:'MCP:board_inbox',tool_input:input,tool_output:output('f'.repeat(64))});
  assert.equal(readJson(file).feeds.direct.after,3);
  assert.equal(readJson(file).feeds.direct.pending,null);
  due();const count=requests.length;
  assert.equal(await boardHook(f.b,callback(),{windowMs:40}),undefined);
  assert(requests.slice(count).every(x=>x.delivery==='direct'));
  assert(readJson(file).feeds.routine.pending);
});

test('an active Claude prompt takes delivery back from its idle waiter', async t => {
  const f = await session(t);
  f.behavior.registration.boardDirect = true;
  await f.start();
  const started = Promise.withResolvers(), finish = Promise.withResolvers();
  const page = {messages:[{id:1}], next:1, notificationReceipt:'a'.repeat(64)};
  f.behavior.sync = async args => {
    if (args.waitMs) { started.resolve(); await finish.promise; }
    return page;
  };
  const idle = f.stop(2000);
  await started.promise;
  try {
    const active = await f.inbox('UserPromptSubmit');
    assert.match(active.hookSpecificOutput.additionalContext, /"delivery":"direct"/);
  } finally { finish.resolve(); }
  assert.equal(await idle, undefined);
});

test('a priority Codex stop checks once, skips routine mail and leaves the next tool eligible', async t => {
  const f = await session(t, 'codex'), seen = [];
  f.behavior.registration.boardDirect = true;
  await f.start();
  f.behavior.sync = args => {
    seen.push(args);
    return {messages:[], next:0};
  };
  assert.equal(await f.stop(10_000), undefined);
  assert.equal(readJson(f.file).waiter, null);
  await f.inbox('PostToolUse');
  assert.deepEqual(seen.map(x => [x.delivery, x.waitMs]), [['direct', undefined], ['direct', undefined]]);
});

test('one service outage does not disarm a Claude direct-mail wait', async t => {
  const f = await session(t);
  f.behavior.registration.boardDirect = true;
  await f.start();
  f.behavior.sync = () => ({messages:[{id:1}], next:1, notificationReceipt:'d'.repeat(64)});
  f.behavior.fail = true;
  const waiting = f.stop(3500);
  while (!f.received.some(r => r.path === '/api/board/v2/sync')) await delay(8);
  f.behavior.fail = false;
  assert.match((await waiting).wake, /"delivery":"direct"/);
});

test('resuming a chat immediately reoffers the unconfirmed direct page', async t => {
  const f = await session(t);
  f.behavior.registration.boardDirect = true;
  f.behavior.sync = args => (args.after ?? 0) < 3
    ? {messages:[{id:3}], next:3, notificationReceipt:'c'.repeat(64)}
    : {messages:[], next:3};
  await f.start();
  const first = (await f.stop(500)).wake;
  await f.inbox('SessionEnd');
  await f.start();
  assert.equal((await f.stop(500)).wake, first);
});

test('registration-backed transports must match their bound owner, installation, server and profile',async t=>{
 const {boardServers}=await import('../runtime/board.mjs'),f=await fixture(t,'codex');
 const b={...f.b,owner:{...f.b.owner,userId:'agent_reg_owned'}};
 const args=['mcp','--api',b.api,'--installation-id',b.installationId,'--registration',b.owner.userId];
 const valid={command:process.execPath,args,env:{OPENCRAWL_CONFIG_HOME:b.configHome}};
 const servers={work:valid,foreign:{...valid,args:[...args.slice(0,-1),'agent_reg_other']},moved:{...valid,env:{OPENCRAWL_CONFIG_HOME:'/somewhere-else'}},relative:{...valid,command:'node'}};
 atomic(join(f.root,'.mcp.json'),{mcpServers:servers});
 assert.deepEqual(boardServers(b),['work']);assert.deepEqual(boardServers(f.b),[]);
});

test('a saved job waits only for direct mail and retries an interrupted dispatch on launcher restart', async t => {
  const f = await session(t, 'codex'), id = f.event.session_id;
  const wait = (ms, previous) => waitAfterExit(f.b, id, ms, previous);
  assert.equal(await wait(100), undefined);
  f.behavior.registration.boardDirect = true;
  await f.start();
  const seen = [];
  f.behavior.sync = args => {
    seen.push(args);
    const messages = (args.after ?? 0) < 7 ? [{id:7}] : [];
    return {messages, next:7, notificationReceipt:'a'.repeat(64)};
  };
  for (const ms of [-1, 0, 30 * 60_000 + 1]) assert.equal(await wait(ms), undefined);
  const offer = await wait(1500);
  assert.equal(offer.after, 6);
  assert.equal(offer.through, 7);
  assert.match(offer.notice, /board_inbox/);
  assert.equal(await wait(65, offer), undefined);
  assert.equal(readJson(f.file).waiter, null);
  assert.deepEqual(await wait(1500), offer);
  assert(seen.every(args => args.delivery === 'direct'));
  markPrivate(f.b,{harness:'codex',sessionId:id});
  const before = seen.length;
  assert.equal(await wait(1500), undefined);
  assert.equal(seen.length, before);
});

test('a replaced launcher cannot dispatch an older outstanding response', async t => {
  const f = await session(t,'codex'), id = f.event.session_id;
  f.behavior.registration.boardDirect = true;
  await f.start();
  const started = Promise.withResolvers(), release = Promise.withResolvers();
  let requests = 0;
  f.behavior.sync = async () => {
    if (++requests === 1) {
      started.resolve();
      await release.promise;
    }
    return {messages:[{id:1}],next:1,notificationReceipt:'d'.repeat(64)};
  };
  const old = waitAfterExit(f.b,id,1500);
  await started.promise;
  try {
    assert.equal((await waitAfterExit(f.b,id,1500)).through, 1);
  } finally { release.resolve(); }
  assert.equal(await old, undefined);
});

test('Cursor Cloud accepts different native generations and checks only direct mail at stop', async t => {
  const f = await fixture(t,'cursor'), id = f.event.session_id, calls = [];
  f.behavior.registration = {session:id,workspace:f.b.owner.tenantId,name:'fixture',agent:'c'.repeat(64),boardInbox:true,boardDirect:true,boardProtocol:2};
  let available = 0;
  f.behavior.sync = args => {
    calls.push(args);
    const messages = args.delivery === 'direct' && available > (args.after ?? 0) ? [{id:available}] : [];
    return {messages,next:Math.max(available,args.after ?? 0),notificationReceipt:'f'.repeat(64)};
  };
  async function cloud(name,generation,extra = {}) {
    let raw = '';
    await invoke(f.root,'cloud-inbox',{hook_event_name:name,conversation_id:id,generation_id:generation,cursor_version:'1.0.0',...extra},{write:part=>{raw+=part;}});
    return JSON.parse(raw);
  }
  assert.deepEqual(await cloud('beforeSubmitPrompt','prompt-generation'),{continue:true});
  available = 4;
  assert.match((await cloud('postToolUse','different-tool-generation')).additional_context,/"delivery":"direct"/);
  const stop = await cloud('stop','run-different-generation',{status:'completed',loop_count:0});
  assert.match(stop.followup_message,/"through":4/);
  assert.deepEqual(await cloud('stop','run-different-generation',{status:'completed',loop_count:1}),{});
  assert(calls.every(args=>args.delivery==='direct'&&!args.waitMs));
});
