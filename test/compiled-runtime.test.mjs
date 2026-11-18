import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fixture} from './runtime.test.mjs';

const root=resolve(import.meta.dirname,'..');
const executable=join(root,'dist/local',process.platform+'-'+process.arch,'opencrawl-hook'+(process.platform==='win32'?'.exe':''));
test('packaged executable captures and uploads with CLI, Node and Bun absent from PATH',{skip:!existsSync(executable)},async t=>{
  const harness=JSON.parse(readFileSync(join(root,'dist/local',process.platform+'-'+process.arch,'artifact.json'))).harness;
  const f=await fixture(t,harness);
  writeFileSync(join(f.root,'bunfig.toml'),'preload = ["./untrusted.mjs"]\n');
  writeFileSync(join(f.root,'untrusted.mjs'),'throw new Error("UNTRUSTED_PROJECT_PRELOAD");\n');
  const invoke=(action,event)=>new Promise((resolve,reject)=>{
    const child=execFile(executable,['--root',f.root,'--action',action],{cwd:f.root,env:{...process.env,PATH:join(f.root,'empty-path')},timeout:20000},(error,stdout,stderr)=>{
      if(error||stderr.includes('unavailable'))reject(error??Error(stderr));else resolve(stdout);
    });child.stdin.end(JSON.stringify(harness==='antigravity'?{...event,conversationId:event.session_id,transcriptPath:event.transcript_path,hookEventName:event.hook_event_name}:event));
  });
  if(harness==='codex'){
    const rows=[{type:'session_meta',payload:{id:f.event.session_id}},...['user','assistant'].map(role=>({timestamp:new Date().toISOString(),type:'response_item',payload:{type:'message',id:role,role,content:[{type:role==='user'?'input_text':'output_text',text:'COMPILED '+role}]}}))];
    writeFileSync(f.event.transcript_path,rows.map(r=>JSON.stringify(r)).join('\n')+'\n');
  }else if(harness==='antigravity'){
    const rows=['USER_INPUT','PLANNER_RESPONSE'].map((type,i)=>({step_index:i,type,status:'DONE',source:i?'MODEL':'USER_EXPLICIT',content:'COMPILED '+type,created_at:new Date().toISOString()}));
    writeFileSync(f.event.transcript_path,rows.map(r=>JSON.stringify(r)).join('\n')+'\n');
  }else{
    await invoke('observe',{...f.event,hook_event_name:'UserPromptSubmit',prompt_id:'prompt-native',prompt:'COMPILED USER'});
    await invoke('observe',{...f.event,hook_event_name:'MessageDisplay',message_id:'message-native',turn_id:'turn-native',index:0,delta:'COMPILED ASSISTANT',final:true});
  }
  await invoke('capture',{...f.event,hook_event_name:'Stop'});
  const sent=f.received.filter(r=>r.path==='/api/sessions/batches').flatMap(r=>r.body.events);
  assert.equal(sent.length,2);assert.equal(f.queued().length,0);
  assert.equal(JSON.parse(readFileSync(join(f.b.profile,'plugin-state',f.b.key,'status.json'))).uploaded,harness==='claude-code'?2:1);
});
