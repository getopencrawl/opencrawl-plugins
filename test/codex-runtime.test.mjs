import test from 'node:test';
import assert from 'node:assert/strict';
import {appendFileSync,writeFileSync,readFileSync,mkdirSync,readdirSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {fixture} from './fixture.mjs';
import {atomic,binding} from '../local/runtime/io.mjs';
import {collect,flush,handoffCodex} from '../local/runtime/capture.mjs';
import {search} from '../local/runtime/lifecycle.mjs';

const row=payload=>({timestamp:new Date().toISOString(),type:'response_item',payload});
const message=(id,role,text)=>row({type:'message',id,role,content:[{type:role==='user'?'input_text':'output_text',text}]});
const append=(file,rows)=>appendFileSync(file,rows.map(r=>JSON.stringify(r)).join('\n')+'\n');
const header=(id,parent)=>({type:'session_meta',payload:{id,source:parent?{subagent:{thread_spawn:{parent_thread_id:parent}}}:'exec'}});

test('Codex captures every published message and tools, excludes provenance-marked setup, and retries a partial line',async t=>{
  const f=await fixture(t,'codex'),file=f.event.transcript_path;
  const setup=message('setup','user','operator setup');
  setup.payload.internal_chat_message_metadata_passthrough={content_item_kinds:['agents_md.instructions'],content_item_metadata:[{provenance:{type:'agents_md'}}]};
  append(file,[header(f.event.session_id),setup,message('u1','user','A request'),message('a1','assistant','Same reply'),row({type:'function_call',id:'t1',name:'exec',arguments:'{"command":"printf TEST"}'}),row({type:'function_call_output',call_id:'t1',output:'TEST'}),message('a2','assistant','Same reply')]);
  const last=JSON.stringify(message('u2','user','A request'));appendFileSync(file,last.slice(0,20));
  await collect(f.b,f.event);await collect(f.b,f.event);
  assert.equal(f.queued().flatMap(b=>b.events).length,5);
  appendFileSync(file,last.slice(20)+'\n');await collect(f.b,f.event);
  const events=f.queued().flatMap(b=>b.events);
  assert.equal(events.filter(e=>e.kind==='message'&&e.data.role==='user').length,2);
  assert.equal(events.filter(e=>e.kind==='message'&&e.data.role==='assistant').length,2);
  assert.equal(events.filter(e=>e.kind==='tool_call').length,1);assert.equal(events.filter(e=>e.kind==='tool_result').length,1);
  assert(!JSON.stringify(events).includes('operator setup'));assert.equal(new Set(events.map(e=>e.id)).size,6);
  f.behavior.fail=true;await assert.rejects(flush(f.b));assert.equal(f.queued().length,2);
  f.behavior.fail=false;await flush(f.b);assert.equal(f.queued().length,0);
});

test('Codex child notifications keep their native automation attribution',async t=>{
  const f=await fixture(t,'codex'),automated=message('n','user','Child finished');
  automated.payload.internal_chat_message_metadata_passthrough={content_item_kinds:['multi_agent.subagent_notification'],content_item_metadata:[{provenance:{type:'tool',namespace:'multi_agent_v1'}}]};
  append(f.event.transcript_path,[header(f.event.session_id),automated,message('u','user','<subagent_notification>This is user text</subagent_notification>')]);
  await collect(f.b,f.event);const events=f.queued()[0].events;
  assert.equal(events[0].kind,'automation_message');assert.equal(events[1].kind,'message');
});

test('Codex native header and child parent must match before reading message content',async t=>{
  const f=await fixture(t,'codex');
  append(f.event.transcript_path,[header('different'),message('u','user','PRIVATE')]);
  await assert.rejects(collect(f.b,f.event),/session mismatch/);
  writeFileSync(f.event.transcript_path,JSON.stringify(header(f.event.session_id))+'\n');
  const child=join(dirname(f.event.transcript_path),'rollout-2026-11-17T00-00-00-child-1.jsonl');
  append(child,[header('child-1','other-parent'),message('c','assistant','PRIVATE CHILD')]);
  const e={...f.event,hook_event_name:'SubagentStop',agent_id:'child-1',agent_transcript_path:child};
  await assert.rejects(collect(f.b,e),/parent mismatch/);
  writeFileSync(child,[header('child-1',f.event.session_id),message('c','assistant','CHILD INTERMEDIATE'),message('c2','assistant','CHILD FINAL')].map(r=>JSON.stringify(r)).join('\n')+'\n');
  await collect(f.b,e);await collect(f.b,f.event);
  assert.equal(f.queued().length,1);assert.equal(f.queued()[0].sessionId,'child-1');assert.equal(f.queued()[0].parentSessionId,f.event.session_id);
  atomic(join(f.b.capture,'config.json'),{...f.config,exclusions:{sessions:[f.event.session_id]}});
  assert.equal(await flush(f.b),0);assert(!f.received.some(r=>r.path==='/api/sessions/batches'));
});

test('Codex resolves only an explicitly announced ID when transcript_path is null',async t=>{
  const f=await fixture(t,'codex');
  append(f.event.transcript_path,[header(f.event.session_id),message('u','user','INDEXED SESSION')]);
  const db=new DatabaseSync(join(f.config.roots.codex,'state_5.sqlite'));
  db.exec('CREATE TABLE threads(id TEXT PRIMARY KEY,rollout_path TEXT)');
  db.prepare('INSERT INTO threads VALUES(?,?)').run(f.event.session_id,f.event.transcript_path);db.close();
  await collect(f.b,{...f.event,transcript_path:null});assert.equal(f.queued()[0].events.length,1);
  await assert.rejects(collect(f.b,{...f.event,session_id:'unknown',transcript_path:null}),/not found/);
});

test('Codex handoff keeps content out of the notice and identity validation uses the native child ID',async t=>{
  const f=await fixture(t,'codex');
  atomic(join(f.root,'.opencrawl-binding.json'),{...f.b,captureMode:'daemon'});
  atomic(join(f.b.capture,'config.json'),{...f.config,captureWorker:'daemon-v1'});
  const b=binding(f.root);
  assert.equal((await handoffCodex(b,{...f.event,hook_event_name:'SessionStart'})).handoff,true);
  const dir=join(b.capture,'daemon/inbox'),notice=JSON.parse(readFileSync(join(dir,readdirSync(dir)[0])));
  assert.equal(notice.record.harness,'codex');assert.equal(notice.record.event.transcript_path,f.event.transcript_path);assert.equal(f.received.length,0);
  const e={...f.event,agent_id:'child-1',hook_event_name:'PreToolUse',tool_name:'mcp__opencrawl__opencrawl_search_v1',tool_input:{query:'x',includeCurrentSession:true}};
  const output=search(b,e).hookSpecificOutput;
  assert.equal(output.updatedInput,undefined);assert.equal(output.permissionDecision,'deny');
  assert(output.permissionDecisionReason.includes('child-1'));
  assert.equal(search(b,{...e,tool_input:{...e.tool_input,currentSession:{harness:'codex',sessionId:'child-1'}}}),undefined);
  assert.equal(search(b,{...e,tool_name:'mcp__opencrawl__board_sync'}),undefined);
  assert.equal(search(b,{...e,tool_name:'mcp__unrelated__opencrawl_search_v1'}),undefined);
});
