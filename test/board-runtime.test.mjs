import test from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {fixture} from './fixture.mjs';
import {invoke} from '../runtime/main.mjs';
import {boardHook} from '../runtime/board.mjs';
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
