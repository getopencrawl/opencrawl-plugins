import test,{after,before} from 'node:test';
import assert from 'node:assert/strict';
import {execFile,execFileSync} from 'node:child_process';
import {existsSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fixture} from './fixture.mjs';
import {hash} from '../runtime/io.mjs';

const root=resolve(import.meta.dirname,'..');
const platform=process.platform+'-'+process.arch;
const output=join(root,'dist/native',platform);
const selected=process.env.OC_TEST_NATIVE_HARNESS;
const version=selected&&JSON.parse(readFileSync(join(root,'plugins',selected,'capabilities.json'))).version;
const metadata=join(output,selected?'opencrawl-'+selected+'-'+version+'-'+platform+'.json':'artifact.json');
const skip=!selected&&!existsSync(metadata);
let executable,harness,directory;
before(()=>{
  if(skip)return;
  const artifact=JSON.parse(readFileSync(metadata));
  directory=mkdtempSync(join(tmpdir(),'opencrawl-archive-'));
  const archive=join(output,artifact.filename);
  if(process.platform==='win32')execFileSync('tar.exe',['-xf',archive,'-C',directory]);
  else execFileSync('unzip',['-q',archive,'-d',directory]);
  harness=artifact.harness;
  executable=join(directory,artifact.executable);
  assert(existsSync(executable));
});
after(()=>{if(directory)rmSync(directory,{recursive:true,force:true,maxRetries:3})});
test('packaged executable captures and uploads with CLI, Node and Bun absent from PATH',{skip},async t=>{
  const f=await fixture(t,harness);
  writeFileSync(join(f.root,'bunfig.toml'),'preload = ["./untrusted.mjs"]\n');
  writeFileSync(join(f.root,'untrusted.mjs'),'throw new Error("UNTRUSTED_PROJECT_PRELOAD");\n');
  const invoke=(action,event,override={})=>new Promise((resolve,reject)=>{
    const child=execFile(executable,['--root',f.root,'--action',action],{cwd:f.root,env:{...process.env,PATH:join(f.root,'empty-path')},timeout:20000},(error,stdout,stderr)=>{
      if(error||stderr.includes('unavailable'))reject(error??Error(stderr));else resolve(stdout);
    });child.stdin.end(JSON.stringify({...harness==='antigravity'?{...event,conversationId:event.session_id,transcriptPath:event.transcript_path,hookEventName:event.hook_event_name}:harness==='cursor'?{...event,conversation_id:event.session_id,hook_event_name:'stop'}:event,...override}));
  });
  if(harness==='cursor'){
    writeFileSync(f.event.transcript_path,['user','assistant'].map(role=>JSON.stringify({role,message:{content:[{type:'text',text:'COMPILED '+role}]}})).join('\n')+'\n');
  }else if(harness==='codex'){
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
  if(harness==='cursor'){
    const ids={generation_id:'compiled-turn'};
    const observed=await invoke('suggest',f.event,{...ids,hook_event_name:'beforeSubmitPrompt',prompt:'Find earlier work'});
    assert.deepEqual(JSON.parse(observed),{continue:true});
    const reply=await invoke('suggest',f.event,{...ids,hook_event_name:'postToolUse'});
    assert.match(JSON.parse(reply).additional_context,/A prior result/);
    assert.equal(f.received.filter(r=>r.path==='/api/context/suggestions').length,1);
  }
  const prompt='/oc-incognito';
  const event={...f.event,hook_event_name:'UserPromptSubmit',prompt,turn_id:'private-turn',prompt_id:'private-prompt'};
  if(harness==='antigravity')writeFileSync(f.event.transcript_path,JSON.stringify({step_index:9,type:'USER_INPUT',source:'USER_EXPLICIT',status:'DONE',content:prompt,created_at:new Date().toISOString()})+'\n');
  const native=harness==='antigravity'?{hookEventName:'PreInvocation',lastUserInput:prompt}:harness==='cursor'?{hook_event_name:'beforeSubmitPrompt',generation_id:'private-turn'}:{};
  await invoke('capture',event,native);
  assert(f.received.some(r=>r.path==='/api/board/incognito'&&r.body.currentSession.sessionId===event.session_id));
  await invoke('capture',{...f.event,hook_event_name:'Stop'});
  assert.equal(f.received.filter(r=>r.path==='/api/sessions/batches').flatMap(r=>r.body.events).length,2);

});

test('packaged inbox offers one scoped page and checkpoints its confirmed read',{skip},async t=>{
  const f=await fixture(t,harness),id=f.event.session_id,proof='c'.repeat(64);
  const currentSession={harness,sessionId:id};
  f.behavior.registration={workspace:f.b.owner.tenantId,session:id,agent:'a'.repeat(64),name:'receiver',
    boardProtocol:2,boardInbox:true,boardDirect:true,boardReadReceipt:true};
  f.behavior.sync=body=>({messages:body.delivery==='direct'&&(body.after??0)<8?[{id:8}]:[],next:8,notificationReceipt:proof});
  function invoke(action,name,fields={}){
    const event=harness==='cursor'?{...f.event,conversation_id:id,generation_id:'turn-1',cursor_version:'3.18.9',hook_event_name:name}
      :harness==='antigravity'?{...f.event,conversationId:id,hookEventName:name}:{...f.event,hook_event_name:name};
    return new Promise((resolve,reject)=>{
      const child=execFile(executable,['--root',f.root,'--action',action],{cwd:f.root,env:{...process.env,PATH:join(f.root,'empty-path')},timeout:10000},
        (err,out)=>err?reject(err):resolve(out?JSON.parse(out):{}));
      child.stdin.end(JSON.stringify({...event,...fields}));
    });
  }
  let notice=await invoke('start',harness==='cursor'?'sessionStart':'SessionStart');
  if(harness!=='cursor')notice=await invoke('inbox',harness==='antigravity'?'PreInvocation':'UserPromptSubmit');
  const text=notice.additional_context??notice.hookSpecificOutput?.additionalContext??notice.injectSteps?.[0]?.ephemeralMessage;
  assert.match(text,/"through":8/);
  const file=join(f.b.profile,'plugin-state',f.b.key,'board',hash(id)+'.json');
  const direct=()=>JSON.parse(readFileSync(file)).feeds.direct;
  const {readId}=direct().pending,args={currentSession,delivery:'direct',after:7,through:8,...(readId?{readId}:{})};
  const page={next:8,messages:[{id:8,text:'Fixture mail'}],notificationReceipt:proof};
  if(harness==='antigravity'){
    f.behavior.page={served:{readId,proof,first:8,after:7,through:8,next:8}};
    await invoke('inbox','PostToolUse',{toolCall:{name:'mcp_opencrawl-local-antigravity_opencrawl_board_inbox',args},error:''});
  }else if(harness==='cursor'){
    await invoke('capture','postToolUse',{tool_name:'MCP:board_inbox',tool_input:args,tool_output:page});
  }else{
    await invoke('inbox','PostToolUse',{tool_name:'mcp__opencrawl__board_inbox',tool_input:args,tool_response:page});
  }
  assert.equal(direct().pending,null);
  assert.equal(direct().after,8);
});
