import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {binding,enrollment,recording,atomic,nativeId} from './io.mjs';
import {collect,handoff,handoffCodex,flush,observe,antigravityPrompt} from './capture.mjs';
import {start,search,suggest,notePrompt} from './lifecycle.mjs';
export async function invoke(root,action,event,output=process.stdout){
  const b=binding(root);enrollment(b);
  if(!event||typeof event!=='object'||Array.isArray(event))throw Error('Invalid hook input');
  if(b.client==='codex'&&event.hook_event_name==='UserPromptSubmit')event={...event,prompt_id:event.turn_id};
  if(b.client==='cursor'){
    const names={sessionStart:'SessionStart',beforeSubmitPrompt:'UserPromptSubmit',preToolUse:'PreToolUse'};
    const session=event.conversation_id??event.session_id,parent=event.parent_conversation_id;
    event={...event,nativeHookName:event.hook_event_name,hook_event_name:names[event.hook_event_name]??event.hook_event_name,session_id:session,cwd:event.cwd??event.workspace_roots?.[0],prompt_id:event.generation_id,parentSessionId:nativeId(parent)&&parent!==session?parent:undefined};
  }
  if(b.client==='antigravity'){
    event={...event,session_id:event.conversationId,transcript_path:event.transcriptPath,cwd:event.cwd??event.workspacePaths?.[0],hook_event_name:event.hookEventName,tool_name:event.toolCall?.name,tool_input:event.toolCall?.args};
    if(['observe','suggest'].includes(action)&&event.hookEventName==='PreInvocation'){
      const prompt=antigravityPrompt(b,event);if(!prompt)return;
      event={...event,...prompt,hook_event_name:'UserPromptSubmit'};
    }
  }
  const format=value=>b.client==='cursor'?(action==='search'?{permission:value?.hookSpecificOutput?.permissionDecision==='deny'?'deny':'allow',...(value?.hookSpecificOutput?.permissionDecisionReason?{agent_message:value.hookSpecificOutput.permissionDecisionReason}:{})}:{...(event.nativeHookName==='beforeSubmitPrompt'?{continue:true}:{}),...(value?.hookSpecificOutput?.additionalContext?{additional_context:value.hookSpecificOutput.additionalContext}:{})}):b.client!=='antigravity'?value:action==='search'?{decision:value?.hookSpecificOutput?.permissionDecision==='deny'?'deny':'allow',...(value?.hookSpecificOutput?.permissionDecisionReason?{reason:value.hookSpecificOutput.permissionDecisionReason}:{})}:value?.hookSpecificOutput?.additionalContext?{injectSteps:[{ephemeralMessage:value.hookSpecificOutput.additionalContext}]}:value;
  let result;
  if(action==='observe'){if(!['antigravity','cursor'].includes(b.client))await observe(b,event);await notePrompt(b,event);if(b.client==='cursor')output.write(JSON.stringify(format())+'\n');return;}
  else if(action==='start')result=await start(b,event);
  else if(action==='search')result=search(b,event);
  else if(action==='suggest'){
    const suggestion=await suggest(b,event);
    if(suggestion?.output){suggestion.guard();await new Promise((resolve,reject)=>output.write(JSON.stringify(format(suggestion.output))+'\n',error=>error?reject(error):resolve()));suggestion.handoff();}
    await suggestion?.flush();return;
  }else if(action==='capture'){
    // Cursor child paths are newer than the legacy daemon reader. The plugin
    // owns conversion in both modes; the existing worker durably uploads its
    // compatible immutable queue without a second callback conversion.
    if(b.captureMode==='daemon')result=b.client==='cursor'?await collect(b,event):b.client==='codex'?await handoffCodex(b,event):handoff(b,event);
    else{
      if(!recording(b,event))result={selected:false};
      else{
        // Native display/prompt receipts remain uploadable if a tool transcript
        // is temporarily missing, malformed or larger than the read bound.
        try{result=await collect(b,event);}catch(error){result={selected:true,pendingRead:true,errorCode:error.code??'TRANSCRIPT_UNAVAILABLE'};}
        try{result.uploaded=await flush(b);}catch{result.pendingUpload=true;}
      }
    }
    atomic(join(b.profile,'plugin-state',b.key,'status.json'),{at:new Date().toISOString(),harness:b.client,...result});if(b.client==='cursor')output.write(JSON.stringify(format())+'\n');return;
  }else throw Error('Unsupported lifecycle action');
  if(result||['antigravity','cursor'].includes(b.client)&&action==='search')output.write(JSON.stringify(format(result))+'\n');
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]||process.versions.bun&&import.meta.main){
  const args=process.argv.slice(2);
  try{
    if(args.length!==4||args[0]!=='--root'||args[2]!=='--action')throw Error('Explicit root and action required');
    const root=resolve(args[1]),action=args[3];
    let bytes=Buffer.alloc(0);
    const timer=setTimeout(()=>{process.stderr.write('OpenCrawl hook input timed out\n');process.exit(0);},1000);timer.unref();
    for await(const chunk of process.stdin){bytes=Buffer.concat([bytes,Buffer.from(chunk)]);if(bytes.length>8*1024*1024)throw Error('Hook input exceeds limit');}
    clearTimeout(timer);await invoke(root,action,JSON.parse(bytes.toString('utf8')));
  }catch(error){
    // Report only an error class, never a response body, credential or content.
    process.stderr.write('OpenCrawl lifecycle hook unavailable: '+(error?.name??'Error')+'\n');process.exitCode=args[3]==='search'?1:0;
  }
}
