import {lstatSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {binding,enrollment,recording,atomic,nativeId} from './io.mjs';
import {collect,handoff,handoffCodex,flush,observe,antigravityPrompt} from './capture.mjs';
import {boardHook,waitAfterExit} from './board.mjs';
import {start,search,suggest,notePrompt} from './lifecycle.mjs';
import {invoked,sessionIdentity,privateSession,markPrivate,retryErasure,boardSend} from './privacy.mjs';
export async function invoke(root,action,event,output=process.stdout){
  // Git marketplace installs can use MCP before the user enrolls a profile.
  if(!lstatSync(join(root,'.opencrawl-binding.json'),{throwIfNoEntry:false}))return;
  const b=binding(root);enrollment(b);
  if(!event||typeof event!=='object'||Array.isArray(event))throw Error('Invalid hook input');
  if(action==='wait'){
    const offer=await waitAfterExit(b,event.sessionId,event.windowMs,event.previous);
    if(offer)output.write(JSON.stringify(offer)+'\n');
    return;
  }
  if(b.client==='codex'&&event.hook_event_name==='UserPromptSubmit')event={...event,prompt_id:event.turn_id};
  if(b.client==='cursor'){
    const names={sessionStart:'SessionStart',beforeSubmitPrompt:'UserPromptSubmit',preToolUse:'PreToolUse'};
    const session=event.conversation_id??event.session_id,parent=event.parent_conversation_id;
    event={...event,nativeHookName:event.hook_event_name,hook_event_name:names[event.hook_event_name]??event.hook_event_name,session_id:session,cwd:event.cwd??event.workspace_roots?.[0],prompt_id:event.generation_id,parentSessionId:nativeId(parent)&&parent!==session?parent:undefined};
  }
  if(b.client==='antigravity'){
    event={...event,session_id:event.conversationId,transcript_path:event.transcriptPath,cwd:event.cwd??event.workspacePaths?.[0],hook_event_name:event.hookEventName,tool_name:event.toolCall?.name,tool_input:event.toolCall?.args};
    if(event.hookEventName==='PreInvocation'){
      const prompt=antigravityPrompt(b,event);
      if(prompt)event={...event,...prompt,hook_event_name:'UserPromptSubmit'};
      else if(['observe','suggest'].includes(action))return;
    }
  }
  const format=value=>b.client==='cursor'?(action==='search'?{permission:value?.hookSpecificOutput?.permissionDecision==='deny'?'deny':'allow',...(value?.hookSpecificOutput?.permissionDecisionReason?{agent_message:value.hookSpecificOutput.permissionDecisionReason}:{})}:{...(event.nativeHookName==='beforeSubmitPrompt'?{continue:true}:{}),...(value?.hookSpecificOutput?.additionalContext?{additional_context:value.hookSpecificOutput.additionalContext}:{})}):b.client!=='antigravity'?value:action==='search'?{decision:value?.hookSpecificOutput?.permissionDecision==='deny'?'deny':'allow',...(value?.hookSpecificOutput?.permissionDecisionReason?{reason:value.hookSpecificOutput.permissionDecisionReason}:{})}:value?.hookSpecificOutput?.additionalContext?{injectSteps:[{ephemeralMessage:value.hookSpecificOutput.additionalContext}]}:value;
  const session=sessionIdentity(b,event),activate=session&&invoked(b,event);
  if(activate&&b.replicasWorkspace){
    const reason='OpenCrawl incognito is unavailable on Replicas. This command cannot pause capture or erase this chat.';
    if(action==='observe')output.write(JSON.stringify({decision:'block',reason})+'\n');
    if(action==='privacy')output.write(JSON.stringify({hookSpecificOutput:{hookEventName:'PreToolUse',permissionDecision:'deny',permissionDecisionReason:reason}})+'\n');
    return;
  }
  if(activate)markPrivate(b,session);
  if(!b.replicasWorkspace&&(action==='capture'||action==='privacy')){
    // Keep the synchronous observe hook local. Retry from later capture hooks even after this chat closes.
    try{await retryErasure(b);}catch{process.stderr.write('OpenCrawl incognito erasure is pending.\n');}
  }
  if(session&&privateSession(b,session.sessionId)){
    let reply;
    if(action==='search'&&boardSend(event))reply={hookSpecificOutput:{hookEventName:'PreToolUse',permissionDecision:'deny',permissionDecisionReason:b.replicasWorkspace?'Board messages are disabled for this previously paused chat.':'This session is incognito and cannot send board messages.'}};
    else if(action==='start'||activate&&action==='observe')reply={hookSpecificOutput:{hookEventName:event.hook_event_name,additionalContext:b.replicasWorkspace?'An earlier OpenCrawl hook paused capture for this chat. Previously uploaded records may still exist.':'OpenCrawl incognito is active locally. You MUST NOT communicate with other agents. Confirm remote erasure through the incognito skill.'}};
    if(reply||b.client==='cursor')output.write(JSON.stringify(format(reply))+'\n');
    return;
  }
  if(action==='privacy')return;
  if(action==='cloud-inbox'){
    if(b.client!=='cursor')return;
    if(event.hook_event_name==='UserPromptSubmit')await start(b,event).catch(()=>undefined);
    const notice=await boardHook(b,event,{cursorCloud:true}).catch(()=>undefined);
    output.write(JSON.stringify(event.nativeHookName==='stop'?notice??{}:format(notice))+'\n');
    return;
  }
  if(action==='inbox'){
    // Board availability cannot block a tool, prompt, or normal stop.
    const notice=await boardHook(b,event).catch(()=>undefined);
    if(notice?.wake){process.stderr.write(notice.wake+'\n');return 2;}
    if(notice||b.client==='cursor')output.write(JSON.stringify(notice??{})+'\n');
    return;
  }
  let result;
  if(action==='observe'){if(!['antigravity','cursor'].includes(b.client))await observe(b,event);await notePrompt(b,event);if(b.client==='cursor')output.write(JSON.stringify(format())+'\n');return;}
  else if(action==='start')result=await start(b,event);
  else if(action==='search')result=search(b,event);
  else if(action==='suggest'){
    const suggestion=await suggest(b,event);
    if(suggestion?.output){suggestion.guard();await new Promise((resolve,reject)=>output.write(JSON.stringify(format(suggestion.output))+'\n',error=>error?reject(error):resolve()));suggestion.handoff();}
    else if(b.client==='cursor')output.write(JSON.stringify(format())+'\n');
    await suggestion?.flush();return;
  }else if(action==='capture'){
    let notice;
    if(b.client==='cursor' && ['UserPromptSubmit','sessionEnd'].includes(event.hook_event_name)){
      if(event.hook_event_name==='UserPromptSubmit')await start(b,event).catch(()=>undefined);
      notice=await boardHook(b,event).catch(()=>undefined);
    }
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
    atomic(join(b.profile,'plugin-state',b.key,'status.json'),{at:new Date().toISOString(),harness:b.client,...result});
    if(b.client==='cursor'){
      if(event.nativeHookName==='postToolUse')notice=await boardHook(b,event).catch(()=>undefined);
      output.write(JSON.stringify(format(notice))+'\n');
    }
    return;
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
    clearTimeout(timer);process.exitCode=await invoke(root,action,JSON.parse(bytes.toString('utf8')))??0;
  }catch(error){
    // Report only an error class, never a response body, credential or content.
    process.stderr.write('OpenCrawl lifecycle hook unavailable: '+(error?.name??'Error')+'\n');process.exitCode=args[3]==='search'?1:0;
  }
}
