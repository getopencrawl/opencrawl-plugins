import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFileSync,appendFileSync,readFileSync,readdirSync,statSync,unlinkSync,mkdirSync,symlinkSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {fixture} from './fixture.mjs';
import {collect} from '../runtime/capture.mjs';
import {atomic,hash,binding} from '../runtime/io.mjs';
import {invoke} from '../runtime/main.mjs';
const row=(role,text)=>JSON.stringify({role,message:{content:[{type:'text',text}]}})+'\n';
const hook=(f,name,extra={})=>({...f.event,hook_event_name:name,nativeHookName:name,conversation_id:f.event.session_id,...extra});
const events=f=>f.queued().flatMap(b=>b.events);
test('Cursor reconciles omitted content callbacks and repeated identical replies with complete tool content',async t=>{
 const f=await fixture(t,'cursor'),file=f.event.transcript_path;
 writeFileSync(file,row('user','<timestamp>now</timestamp>\n<user_query>\nUSER\n</user_query>')+row('assistant','SAME'));
 const prompt=hook(f,'beforeSubmitPrompt',{generation_id:'generation-1',prompt:'USER'});
 await collect(f.b,prompt);await collect(f.b,prompt);
 await collect(f.b,hook(f,'afterAgentResponse',{text:'SAME'}));
 appendFileSync(file,row('assistant','SAME'));
 await collect(f.b,hook(f,'afterAgentResponse',{text:'SAME'}));
 const tool=hook(f,'postToolUse',{tool_use_id:'tool-1',tool_name:'Shell',tool_input:'{"command":"printf TOOL"}',tool_output:'{"stdout":"TOOL"}'});
 await collect(f.b,tool);await collect(f.b,tool);
 await collect(f.b,hook(f,'stop'));
 assert.equal(events(f).filter(e=>e.kind==='message'&&e.data.role==='user').length,1);
 assert.equal(events(f).filter(e=>e.kind==='message'&&e.data.role==='assistant').length,2);
 assert.equal(events(f).filter(e=>e.kind==='tool_call').length,1);assert.equal(events(f).filter(e=>e.kind==='tool_result').length,1);
 assert.equal(events(f).find(e=>e.kind==='tool_result').data.output.stdout,'TOOL');
});
test('Cursor imports the existing forward-only watermark and never replays a replaced pre-consent prefix',async t=>{
 const f=await fixture(t,'cursor'),file=f.event.transcript_path,old=row('user','PRIVATE OLD');writeFileSync(file,old);
 const stat=statSync(file,{bigint:true});const state=join(f.b.capture,'state','cursor-'+hash(f.event.session_id)+'.json');
 atomic(state,{offset:Buffer.byteLength(old),identity:stat.dev+':'+stat.ino,checkpoint:hash(Buffer.from(old)),forwardBoundary:true,hooks:{},transcript:{},emitted:{}});
 appendFileSync(file,row('assistant','NEW'));await collect(f.b,hook(f,'stop'));
 assert.equal(events(f).length,1);assert.equal(events(f)[0].data.content[0].text,'NEW');
 unlinkSync(file);writeFileSync(file,row('user','OTHER OLD')+row('assistant','REWRITTEN OLD'));
 await collect(f.b,hook(f,'stop'));assert.equal(events(f).length,1);
 appendFileSync(file,row('assistant','APPENDED'));await collect(f.b,hook(f,'stop'));assert.equal(events(f).length,2);
 assert(!JSON.stringify(events(f)).includes('OLD'));
});
test('Cursor retries partial records and keeps native callbacks usable with no JSONL',async t=>{
 const f=await fixture(t,'cursor'),file=f.event.transcript_path;
 const line=row('assistant','COMPLETE');writeFileSync(file,line.slice(0,-1));
 await collect(f.b,hook(f,'stop'));appendFileSync(file,'\n');await collect(f.b,hook(f,'stop'));
 await collect(f.b,hook(f,'afterAgentResponse',{transcript_path:null,text:'CALLBACK'}));
 assert.equal(events(f).length,2);
 await assert.rejects(collect(f.b,hook(f,'stop',{session_id:'other'})),/outside/);
 atomic(join(f.b.capture,'config.json'),{...f.config,disabled:true});assert.equal((await collect(f.b,hook(f,'stop'))).selected,false);
});
test('Cursor original MCP identity is validated without mutating inputs or intercepting generic board tools',async t=>{
 const f=await fixture(t,'cursor');
 const run=async extra=>{let text='';await invoke(f.root,'search',hook(f,'preToolUse',{tool_name:'MCP:opencrawl_search_v1',tool_input:{query:'Q'},...extra}),{write:s=>{text+=s;}});return JSON.parse(text);};
 const denied=await run({});assert.equal(denied.permission,'deny');assert(!denied.updated_input);
 assert.equal((await run({tool_input:{query:'Q',currentSession:{harness:'cursor',sessionId:f.event.session_id}}})).permission,'allow');
 assert.equal((await run({tool_name:'MCP:board_sync'})).permission,'allow');
});
test('Cursor daemon mode queues converted content without network or duplicate legacy callback conversion',async t=>{
 const f=await fixture(t,'cursor');atomic(join(f.root,'.opencrawl-binding.json'),{...JSON.parse(readFileSync(join(f.root,'.opencrawl-binding.json'))),captureMode:'daemon'});
 atomic(join(f.b.capture,'config.json'),{...f.config,captureWorker:'daemon-v1'});
 await invoke(f.root,'capture',hook(f,'postToolUse',{tool_name:'Shell',tool_input:'{"command":"printf TEST"}',tool_output:'TEST'}),{write:()=>{}});
 assert.equal(events(f).find(e=>e.kind==='tool_result').data.output,'TEST');
 assert.equal(f.received.length,0);
});
test('Cursor captures children only under the selected parent and drains final replies at the parent boundary',async t=>{
 const f=await fixture(t,'cursor'),dir=join(dirname(f.event.transcript_path),'subagents');mkdirSync(dir);
 writeFileSync(f.event.transcript_path,row('user','PARENT'));
 const child=join(dir,'child-1.jsonl');writeFileSync(child,row('user','DELEGATED')+row('assistant','INTERMEDIATE'));
 await collect(f.b,hook(f,'postToolUse',{session_id:'child-1',transcript_path:child,tool_use_id:'child-tool',tool_name:'Shell',tool_input:'{"command":"printf CHILD"}',tool_output:'CHILD'}));
 appendFileSync(child,row('assistant','FINAL'));
 await collect(f.b,hook(f,'sessionEnd'));await collect(f.b,hook(f,'sessionEnd'));
 const batches=f.queued().filter(b=>b.sessionId==='child-1');
 assert(batches.every(b=>b.parentSessionId===f.event.session_id&&b.origin==='subagent'));
 const records=batches.flatMap(b=>b.events);assert.equal(records.filter(e=>e.data.role==='assistant').length,2);
 assert.equal(records.filter(e=>e.kind==='tool_result').length,1);
 await assert.rejects(collect(f.b,hook(f,'postToolUse',{session_id:'child-1',transcript_path:child,parentSessionId:'other'})),/parent mismatch/);
 if(process.platform!=='win32'){
   symlinkSync(child,join(dir,'alias.jsonl'));
   await assert.rejects(collect(f.b,hook(f,'postToolUse',{session_id:'alias',transcript_path:join(dir,'alias.jsonl')})),/outside/);
   unlinkSync(join(dir,'alias.jsonl'));
 }
 atomic(join(f.b.capture,'config.json'),{...f.config,exclusions:{sessions:[f.event.session_id]}});
 appendFileSync(child,row('assistant','EXCLUDED'));
 assert.equal((await collect(f.b,hook(f,'postToolUse',{session_id:'child-1',transcript_path:child}))).selected,false);
 assert(!JSON.stringify(events(f)).includes('EXCLUDED'));
});
