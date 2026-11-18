import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,readdirSync,symlinkSync,rmSync,appendFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {binding,atomic,hash,excluded} from '../local/runtime/io.mjs';
import {observe,collect,flush,handoff} from '../local/runtime/capture.mjs';
import {request} from '../local/runtime/auth.mjs';
import {search,suggest,notePrompt} from '../local/runtime/lifecycle.mjs';

export async function fixture(t){
  const root=mkdtempSync(join(tmpdir(),'opencrawl-hooks-test-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const received=[],owner={tenantId:'tenant-test',userId:'user-test'};
  let behavior={owner,fail:false,afterIdentity:undefined,beforeSuggestion:undefined,refreshes:0};
  const server=createServer(async(req,res)=>{
    let raw='';for await(const c of req)raw+=c;
    const body=raw?(req.headers['content-type']==='application/x-www-form-urlencoded'?Object.fromEntries(new URLSearchParams(raw)):JSON.parse(raw)):undefined;
    received.push({path:req.url,auth:req.headers.authorization,body,raw});
    res.setHeader('content-type','application/json');
    if(req.url==='/token'){
      behavior.refreshes++;res.end(JSON.stringify({access_token:'fixture-refreshed',refresh_token:'fixture-rotated',expires_in:3600}));
    }else if(req.url==='/api/sessions/identity'){
      res.end(JSON.stringify({data:{principal:behavior.owner}}));behavior.afterIdentity?.();
    }else if(behavior.fail){res.statusCode=503;res.end('{}');}
    else if(req.url==='/api/sessions/batches')res.end(JSON.stringify({data:{stored:true,batchId:hash(raw),eventCount:body.events.length}}));
    else if(req.url==='/api/context/suggestions'){await behavior.beforeSuggestion?.();res.end(JSON.stringify({data:{results:[{id:'source1',title:'Evidence',text:'A prior result',offset:0}],outputTokens:10,checkId:'12345678-1234-1234-1234-123456789abc'}}));}
    else if(req.url==='/api/context/suggestions/events')res.end(JSON.stringify({data:{accepted:body.events.map(e=>e.id)}}));
    else{res.statusCode=404;res.end('{}');}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const api='http://127.0.0.1:'+server.address().port;
  const profile=join(root,'profile'),native=join(root,'native'),session='session-1';
  const value={schemaVersion:1,client:'claude-code',api,configHome:profile,installationId:'installation-test',owner,captureMode:'hook'};
  atomic(join(root,'.opencrawl-binding.json'),value);
  atomic(join(root,'.claude-plugin','plugin.json'),{name:'opencrawl-local-claude-code'});
  atomic(join(root,'.mcp.json'),{mcpServers:{opencrawl:{type:'http',url:api+'/mcp'}}});
  const b=binding(root),config={schemaVersion:1,api,installationId:value.installationId,owner,installedAt:new Date(Date.now()-60000).toISOString(),harnesses:['claude-code'],roots:{'claude-code':native}};
  atomic(join(b.capture,'config.json'),config);
  atomic(join(b.profile,hash(api)+'.json'),{accessToken:'fixture-credential',expiresAt:Date.now()+3600000});
  const path=join(native,'projects','project',session+'.jsonl');
  mkdirSync(join(native,'projects','project'),{recursive:true});
  const event={session_id:session,cwd:root,transcript_path:path};
  const queued=()=>readdirSync(join(b.capture,'queue')).filter(x=>x.endsWith('.json')).map(x=>JSON.parse(readFileSync(join(b.capture,'queue',x))));
  return {root,b,event,config,queued,received,behavior,server};
}

test('native prompt, every assistant message and transcript tools survive retry without duplicate identities',async t=>{
  const f=await fixture(t),{b,event}=f;
  const user={...event,hook_event_name:'UserPromptSubmit',prompt_id:'prompt-1',prompt:'Please test'};
  await observe(b,user);await observe(b,user);
  const chunk=(id,index,delta,final)=>({...event,hook_event_name:'MessageDisplay',message_id:id,turn_id:'turn-1',index,delta,final});
  // Out-of-order native chunks, repeated delivery, identical separate messages.
  await observe(b,chunk('display-1',1,'',true));
  await observe(b,chunk('display-1',0,'Same reply\n',false));
  await observe(b,chunk('display-1',0,'Same reply\n',false));
  await observe(b,chunk('display-2',0,'Same reply\n',true));
  const now=new Date().toISOString();
  const rows=[
    {type:'user',uuid:'user-native',sessionId:event.session_id,promptId:'prompt-1',timestamp:now,message:{role:'user',content:'Please test'}},
    {type:'assistant',uuid:'assistant-native',sessionId:event.session_id,timestamp:now,message:{role:'assistant',content:[{type:'text',text:'Same reply\n'},{type:'tool_use',id:'tool-1',name:'Bash',input:{command:'printf TEST'}}]}},
    {type:'user',uuid:'tool-native',sessionId:event.session_id,promptId:'prompt-1',timestamp:now,message:{role:'user',content:[{type:'tool_result',tool_use_id:'tool-1',content:'TEST'}]}},
  ];
  appendFileSync(event.transcript_path,rows.map(x=>JSON.stringify(x)).join('\n')+'\n');
  await collect(b,event);await collect(b,event);
  const events=f.queued().flatMap(x=>x.events);
  assert.equal(events.filter(x=>x.kind==='message'&&x.data.role==='user').length,1);
  assert.equal(events.filter(x=>x.kind==='message'&&x.data.role==='assistant').length,2);
  assert.equal(events.filter(x=>x.kind==='tool_call').length,1);
  assert.equal(events.filter(x=>x.kind==='tool_result').length,1);
  assert.equal(new Set(events.map(x=>x.id)).size,5);
  f.behavior.fail=true;await assert.rejects(flush(b));assert.equal(f.queued().flatMap(x=>x.events).length,5);
  f.behavior.fail=false;assert.equal(await flush(b),4);assert.equal(f.queued().length,0);
  assert.equal(await flush(b),0);
});

test('account changes and revoked consent prevent content egress; queued bytes remain',async t=>{
  const f=await fixture(t),{b,event}=f;
  await observe(b,{...event,hook_event_name:'UserPromptSubmit',prompt_id:'prompt-1',prompt:'PRIVATE CONTENT'});
  f.behavior.owner={tenantId:'other',userId:'other'};
  await assert.rejects(flush(b),/owner changed/);
  assert(!f.received.some(r=>r.path==='/api/sessions/batches'));
  f.behavior.owner=b.owner;
  f.behavior.afterIdentity=()=>atomic(join(b.capture,'config.json'),{...f.config,disabled:true});
  assert.equal(await flush(b),0);
  assert(!f.received.some(r=>r.path==='/api/sessions/batches'));
  assert.equal(f.queued().length,1);
});

test('a concurrent sign-in cannot change the credential between identity and content',async t=>{
  const f=await fixture(t);
  f.behavior.afterIdentity=()=>atomic(join(f.b.profile,hash(f.b.api)+'.json'),{accessToken:'changed-credential',expiresAt:Date.now()+3600000});
  await assert.rejects(request(f.b,'/api/sessions/batches',{method:'POST',body:{secretContent:'kept local'}}),/credential changed/);
  assert.equal(f.received.length,1);
});

test('symlink project exclusions, mismatched bindings and changed transcripts fail closed',async t=>{
  const f=await fixture(t);
  const project=join(f.root,'secret'),alias=join(f.root,'alias');mkdirSync(project);symlinkSync(project,alias,'dir');
  assert(excluded({exclusions:{projects:[project]}},'session-1',alias));
  atomic(join(f.b.capture,'config.json'),{...f.config,owner:{tenantId:'other',userId:'other'}});
  await assert.rejects(observe(f.b,{...f.event,hook_event_name:'UserPromptSubmit',prompt_id:'p',prompt:'NO'}));
  atomic(join(f.b.capture,'config.json'),f.config);
  appendFileSync(f.event.transcript_path,JSON.stringify({type:'user',sessionId:'different',message:{role:'user',content:'NO'}})+'\n');
  await assert.rejects(collect(f.b,f.event),/session mismatch/);
});

test('native chunks mask split secrets and preserve a durable conflicting-chunk diagnostic',async t=>{
  const f=await fixture(t),e={...f.event,hook_event_name:'MessageDisplay',message_id:'display',turn_id:'turn'};
  await observe(f.b,{...e,index:0,delta:'password=',final:false});
  await observe(f.b,{...e,index:1,delta:'actual-secret',final:true});
  assert(!JSON.stringify(f.queued()).includes('actual-secret'));
  await assert.rejects(observe(f.b,{...e,index:0,delta:'different',final:false}),/conflict/);
});

test('context is opt-in and a duplicate prompt cannot start another billable check',async t=>{
  const f=await fixture(t),event={...f.event,hook_event_name:'UserPromptSubmit',prompt_id:'prompt-1',prompt:'A question'};
  assert.equal(await suggest(f.b,event),undefined);assert.equal(f.received.length,0);
  atomic(join(f.b.profile,'context-checks',hash(f.b.api)+'.json'),{...f.config,revision:'revision-1'});
  const first=await suggest(f.b,event);assert(first.output,JSON.stringify(first.diagnostic));first.handoff();await first.flush();
  const second=await suggest(f.b,event);assert(!second.output);
  assert.equal(f.received.filter(x=>x.path==='/api/context/suggestions').length,1);
});

test('daemon mode hands off before transcript creation without authentication or upload',async t=>{
  const f=await fixture(t);
  atomic(join(f.root,'.opencrawl-binding.json'),{...f.b,captureMode:'daemon'});
  atomic(join(f.b.capture,'config.json'),{...f.config,captureWorker:'daemon-v1'});
  const b=binding(f.root);
  assert.equal(handoff(b,{...f.event,hook_event_name:'SessionStart'}).handoff,true);
  const files=readdirSync(join(b.capture,'daemon/inbox'));
  const notice=JSON.parse(readFileSync(join(b.capture,'daemon/inbox',files[0])));
  assert.equal(notice.record.event.transcript_path,f.event.transcript_path);
  assert.deepEqual(notice.owner,b.owner);assert.equal(f.received.length,0);
  await observe(b,{...f.event,hook_event_name:'UserPromptSubmit',prompt_id:'p',prompt:'not copied into daemon notices'});
  assert(!JSON.stringify(notice).includes('not copied'));
});

test('Claude validates declared session identity without mutating or approving reviewed calls',async t=>{
  const f=await fixture(t),input={query:'a query',includeCurrentSession:true};
  atomic(join(f.root,'.claude-plugin/plugin.json'),{name:'opencrawl-deployment'});
  atomic(join(f.root,'.mcp.json'),{mcpServers:{'oc-local':{url:f.b.api+'/mcp'}}});
  const event={...f.event,hook_event_name:'PreToolUse',tool_input:input,tool_name:'mcp__plugin_opencrawl-deployment_oc-local__opencrawl_search_v1'};
  const result=search(f.b,event);
  assert.equal(result.hookSpecificOutput.permissionDecision,'deny');
  assert(!result.hookSpecificOutput.updatedInput);
  const currentSession={harness:'claude-code',sessionId:f.event.session_id};
  assert(result.hookSpecificOutput.permissionDecisionReason.includes(JSON.stringify(currentSession)));
  const declared={...input,currentSession};
  const before=JSON.stringify(declared);
  assert.equal(search(f.b,{...event,tool_input:declared}),undefined);
  assert.equal(JSON.stringify(declared),before);
  assert.equal(search(f.b,{...event,tool_input:{...declared,currentSession:{...currentSession,sessionId:'different'}}}).hookSpecificOutput.permissionDecision,'deny');
  for(const tool of ['board_post','board_sync','board_presence','board_follow']){
    const board={...event,tool_name:'mcp__plugin_opencrawl-deployment_oc-local__'+tool};
    assert.equal(search(f.b,board).hookSpecificOutput.permissionDecision,'deny');
    assert.equal(search(f.b,{...board,tool_input:declared}),undefined);
  }
  assert.equal(search(f.b,{...event,agent_id:'child',tool_input:declared}).hookSpecificOutput.permissionDecision,'deny');
  assert.equal(search(f.b,{...event,agent_id:'child',tool_input:{...input,currentSession:{...currentSession,sessionId:f.event.session_id+':child'}}}),undefined);
  assert.equal(search(f.b,{...event,tool_name:'mcp__plugin_different_oc-local__opencrawl_search_v1'}),undefined);
});

test('a newer native prompt prevents stale context delivery and carries bounded prior user context',async t=>{
  const f=await fixture(t),one={...f.event,hook_event_name:'UserPromptSubmit',prompt_id:'one',prompt:'Original task'};
  atomic(join(f.b.profile,'context-checks',hash(f.b.api)+'.json'),{...f.config,revision:'revision-1'});
  const two={...one,prompt_id:'two',prompt:'New follow-up'};
  f.behavior.beforeSuggestion=async()=>{await notePrompt(f.b,two);};
  const old=await suggest(f.b,one);assert(!old.output);
  f.behavior.beforeSuggestion=undefined;
  const next=await suggest(f.b,two);assert(next.output);
  const inputs=f.received.filter(r=>r.path==='/api/context/suggestions').map(r=>r.body);
  assert.equal(inputs.length,2);assert.equal(inputs[1].task,'Original task');
  assert.deepEqual(inputs[1].context,[{role:'user',text:'Original task'}]);
});

test('context admission caps concurrent checks and never turns skipped replay into a charge',async t=>{
  const f=await fixture(t),e={...f.event,hook_event_name:'UserPromptSubmit',prompt:'Task'};
  atomic(join(f.b.profile,'context-checks',hash(f.b.api)+'.json'),{...f.config,revision:'revision-1'});
  await notePrompt(f.b,{...e,prompt_id:'one'});await notePrompt(f.b,{...e,prompt_id:'two'});
  const three={...e,prompt_id:'three'};await notePrompt(f.b,three);
  assert(!(await suggest(f.b,three)).output);assert(!(await suggest(f.b,three)).output);
  assert.equal(f.received.filter(r=>r.path==='/api/context/suggestions').length,0);
});

test('child assistant messages come from the exact parent subtree without MessageDisplay',async t=>{
  const f=await fixture(t),{b,event}=f;
  appendFileSync(event.transcript_path,'');
  const childDirectory=join(event.transcript_path.slice(0,-6),'subagents');mkdirSync(childDirectory,{recursive:true});
  const child=join(childDirectory,'agent-child1.jsonl');
  const rows=['CHILD INTERMEDIATE','CHILD FINAL'].map((text,i)=>({type:'assistant',uuid:'child-message-'+i,sessionId:event.session_id,agentId:'child1',isSidechain:true,timestamp:new Date().toISOString(),message:{role:'assistant',content:[{type:'text',text}]}}));
  appendFileSync(child,rows.map(r=>JSON.stringify(r)).join('\n')+'\n');
  await collect(b,{...event,hook_event_name:'SubagentStop',agent_id:'child1',agent_transcript_path:child});
  await collect(b,{...event,hook_event_name:'Stop'});
  const batches=f.queued();assert.equal(batches.length,1);
  assert.equal(batches[0].origin,'subagent');assert.equal(batches[0].parentSessionId,event.session_id);
  assert.equal(batches[0].sessionId,event.session_id+':child1');assert.equal(batches[0].events.length,2);
  await assert.rejects(collect(b,{...event,hook_event_name:'SubagentStop',agent_id:'child1',agent_transcript_path:child.replace('session-1','other-session')}),/native parent/);
});

test('simultaneous hooks rotate a saved credential only once under the shared lock',async t=>{
  const f=await fixture(t),file=join(f.b.profile,hash(f.b.api)+'.json');
  atomic(file,{accessToken:'fixture-expired',expiresAt:0,refreshToken:'fixture-refresh',auth:{clientId:'fixture-client',tokenEndpoint:f.b.api+'/token'}});
  const [one,two]=await Promise.all([request(f.b,'/api/sessions/identity',{refresh:true}),request(f.b,'/api/sessions/identity',{refresh:true})]);
  assert.deepEqual(one.principal,f.b.owner);assert.deepEqual(two.principal,f.b.owner);
  assert.equal(f.behavior.refreshes,1);
  const saved=JSON.parse(readFileSync(file));assert.equal(saved.refreshToken,'fixture-rotated');
  assert(f.received.filter(r=>r.path==='/api/sessions/identity').every(r=>r.auth==='Bearer fixture-refreshed'));
});

test('a prompt receipt survives a process exit before queue publication',async t=>{
  const f=await fixture(t),id='pending-prompt';
  const at=new Date().toISOString();
  atomic(join(f.b.profile,'plugin-state',f.b.key,'observed',hash(f.event.session_id),'users',id+'.json'),{at,prompt:'DURABLE USER'});
  await collect(f.b,f.event);
  await observe(f.b,{...f.event,hook_event_name:'UserPromptSubmit',prompt_id:id,prompt:'DURABLE USER'});
  const events=f.queued().flatMap(b=>b.events);assert.equal(events.length,1);assert.equal(events[0].data.content,'DURABLE USER');
});

test('a single final callback drains multiple bounded transcript chunks',async t=>{
  const f=await fixture(t),payload='x'.repeat(65536);
  const rows=Array.from({length:140},(_,i)=>({type:'assistant',uuid:'tool-'+i,sessionId:f.event.session_id,timestamp:new Date().toISOString(),message:{role:'assistant',content:[{type:'tool_use',id:'tool-'+i,name:'Example',input:{value:payload}}]}}));
  appendFileSync(f.event.transcript_path,rows.map(r=>JSON.stringify(r)).join('\n')+'\n');
  await collect(f.b,{...f.event,hook_event_name:'Stop'});
  assert.equal(f.queued().flatMap(b=>b.events).length,140);
});
