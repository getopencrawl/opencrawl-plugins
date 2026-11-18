import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFileSync,readFileSync,readdirSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {fixture} from './runtime.test.mjs';
import {collect,antigravityPrompt,handoff} from '../local/runtime/capture.mjs';
import {atomic,binding} from '../local/runtime/io.mjs';
import {invoke} from '../local/runtime/main.mjs';

const row=(step_index,type,content,extra={})=>({step_index,type,content,status:'DONE',source:type==='USER_INPUT'?'USER_EXPLICIT':'MODEL',created_at:new Date().toISOString(),...extra});
const save=(f,rows)=>writeFileSync(f.event.transcript_path,rows.map(r=>JSON.stringify(r)).join('\n')+'\n');
test('Antigravity complete native steps survive replaced snapshots without duplicate or partial replies',async t=>{
 const f=await fixture(t,'antigravity');
 const rows=[row(0,'USER_INPUT','<USER_REQUEST>\nUSER\n</USER_REQUEST>'),row(1,'PLANNER_RESPONSE','SAME',{tool_calls:[{name:'run_command',args:{CommandLine:'printf TOOL'}}]}),row(2,'GENERIC','TOOL'),row(3,'PLANNER_RESPONSE','PARTIAL',{status:'ACTIVE'})];
 save(f,rows);await collect(f.b,f.event);
 unlinkSync(f.event.transcript_path);rows[3]=row(3,'PLANNER_RESPONSE','SAME');save(f,rows);await collect(f.b,f.event);await collect(f.b,f.event);
 const events=f.queued().flatMap(b=>b.events);
 assert.equal(events.length,5);assert.equal(events.filter(e=>e.kind==='message'&&e.data.role==='assistant').length,2);
 assert(!JSON.stringify(events).includes('PARTIAL'));assert.equal(events.filter(e=>e.kind==='tool_call').length,1);assert.equal(events.filter(e=>e.kind==='tool_result').length,1);
});
test('Antigravity consent, exact paths, and explicit prompt identity remain bounded',async t=>{
 const f=await fixture(t,'antigravity');
 const rows=[row(0,'USER_INPUT','OLD',{created_at:'2000-01-01T00:00:00Z'}),row(1,'USER_INPUT','SAME'),row(2,'PLANNER_RESPONSE','REPLY')];save(f,rows);
 await collect(f.b,f.event);assert.equal(f.queued().flatMap(b=>b.events).length,2);
 const hook={...f.event,hookEventName:'PreInvocation',lastUserInput:'SAME'};
 assert.equal(antigravityPrompt(f.b,hook).prompt_id,'agy-step-1');
 rows.push(row(3,'USER_INPUT','SAME'));save(f,rows);assert.equal(antigravityPrompt(f.b,hook).prompt_id,'agy-step-3');
 rows.push(row(4,'USER_INPUT','SAME',{source:'AUTOMATION'}));save(f,rows);assert.equal(antigravityPrompt(f.b,hook),undefined);
 await assert.rejects(collect(f.b,{...f.event,session_id:'other'}),/outside/);
 atomic(join(f.b.capture,'config.json'),{...f.config,disabled:true});assert.equal((await collect(f.b,f.event)).selected,false);
});
test('Antigravity MCP validation delegates normal permissions and never overwrites reviewed args',async t=>{
 const f=await fixture(t,'antigravity'),values=[];
 const output={write:value=>values.push(JSON.parse(value))};
 const event={conversationId:f.event.session_id,transcriptPath:f.event.transcript_path,cwd:f.event.cwd,hookEventName:'PreToolUse',toolCall:{name:'call_mcp_tool',args:{ServerName:'opencrawl-local-antigravity_opencrawl',ToolName:'opencrawl_search_v1',Arguments:{query:'x'}}}};
 await invoke(f.root,'search',event,output);assert.equal(values.pop().decision,'deny');
 event.toolCall.args.Arguments.currentSession={harness:'antigravity',sessionId:f.event.session_id};
 await invoke(f.root,'search',event,output);assert.deepEqual(values.pop(),{decision:'allow'});
 event.toolCall.args.ServerName='unrelated';await invoke(f.root,'search',event,output);assert.deepEqual(values.pop(),{decision:'allow'});
});
test('Antigravity daemon notices retain native camelCase identity without copying prompt content',async t=>{
 const f=await fixture(t,'antigravity');
 atomic(join(f.root,'.opencrawl-binding.json'),{...f.b,captureMode:'daemon'});atomic(join(f.b.capture,'config.json'),{...f.config,captureWorker:'daemon-v1'});
 const b=binding(f.root);handoff(b,{...f.event,hookEventName:'Stop',hook_event_name:'Stop',lastUserInput:'PRIVATE'});
 const dir=join(b.capture,'daemon/inbox'),n=JSON.parse(readFileSync(join(dir,readdirSync(dir)[0])));
 assert.equal(n.record.event.conversationId,f.event.session_id);assert.equal(n.record.event.transcriptPath,f.event.transcript_path);assert(!JSON.stringify(n).includes('PRIVATE'));
});
