import {readFileSync,openSync,closeSync,fstatSync,readSync,realpathSync,readdirSync,unlinkSync,existsSync,lstatSync,constants} from 'node:fs';
import {join,resolve,relative,isAbsolute,sep,dirname,toNamespacedPath} from 'node:path';
import {hostname} from 'node:os';
import {randomUUID} from 'node:crypto';
import {hash,atomic,once,readJson,locked,recording,enrollment,nativeId,excluded} from './io.mjs';
import {request} from './auth.mjs';
import {redact} from './redact.mjs';
const canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
export function wire(event){const e=JSON.parse(JSON.stringify(redact(event)));return {...e,id:'wire1:'+hash('opencrawl-wire-event-v1\n'+canonical(e))};}
function pathFor(b,c,event,{mustExist=true}={}){
  if(!isAbsolute(c.roots?.[b.client]??'')||!isAbsolute(event.transcript_path??''))throw Error('Missing native transcript path');
  const base=mustExist?realpathSync(c.roots[b.client]):resolve(c.roots[b.client]),file=mustExist?realpathSync(event.transcript_path):resolve(event.transcript_path),parts=relative(base,file).split(sep);
  if(b.client==='codex'){
    const name=parts.at(-1),location=parts.length===5&&parts[0]==='sessions'&&/^\d{4}$/.test(parts[1])&&/^\d{2}$/.test(parts[2])&&/^\d{2}$/.test(parts[3])||parts.length===2&&parts[0]==='archived_sessions';
    if(!location||!name.startsWith('rollout-')||!name.endsWith('-'+event.session_id+'.jsonl'))throw Error('Transcript is outside the selected native session');
    return file;
  }
  if(b.client!=='claude-code')throw Error('Harness collector is not implemented');
  const allowed=event.parentSessionId
    ? parts.length===5&&parts[0]==='projects'&&parts[2]===event.parentSessionId&&parts[3]==='subagents'&&parts[4]==='agent-'+event.agent_id+'.jsonl'&&event.session_id===event.parentSessionId+':'+event.agent_id
    : parts.length===3&&parts[0]==='projects'&&parts[2]===event.session_id+'.jsonl';
  if(!allowed)throw Error('Transcript is outside the selected native session');
  return file;
}
function sourceEvent(b,record,offset){
  let kind,data;
  if(b.client==='codex'){
    const r=record.payload;
    if(record.type==='response_item'&&r){
      if(r.type==='message'&&['user','assistant'].includes(r.role)){
        kind='message';data=r;
        const meta=r.internal_chat_message_metadata_passthrough,kinds=meta?.content_item_kinds,items=meta?.content_item_metadata;
        if(r.role==='user'&&Array.isArray(r.content)&&Array.isArray(kinds)&&Array.isArray(items)&&kinds.length===r.content.length&&items.length===r.content.length){
          // Filter only native provenance, never text that resembles setup.
          const keep=r.content.map((_,i)=>i).filter(i=>!(kinds[i]==='agents_md.instructions'&&items[i]?.provenance?.type==='agents_md')&&!(kinds[i]==='environments.environment_context'&&items[i]?.provenance?.type==='harness'));
          if(!keep.length)return;
          data={...r,content:keep.map(i=>r.content[i]),internal_chat_message_metadata_passthrough:{...meta,content_item_kinds:keep.map(i=>kinds[i]),content_item_metadata:keep.map(i=>items[i])}};
          if(keep.every(i=>kinds[i]==='multi_agent.subagent_notification'&&items[i]?.provenance?.type==='tool'))kind='automation_message';
        }
      }else if(/call|tool/.test(r.type??'')){kind=/output|result/.test(r.type)?'tool_result':'tool_call';data=r;}
    }else if(record.type==='event_msg'&&r?.type==='item_completed'&&r.item?.type==='McpToolCall'){kind='mcp_tool_call_end';data=r;}
    else if(record.type==='event_msg'&&['exec_command_end','mcp_tool_call_end'].includes(r?.type)){kind=r.type;data=r;}
    if(!kind)return;
    return {id:hash(b.client+':'+offset+':'+JSON.stringify(record)),kind,sequence:offset,timestamp:record.timestamp??null,nativeId:r.id??null,parentId:null,turnId:r.turn_id??r.internal_chat_message_metadata_passthrough?.turn_id??null,agentId:null,data};
  }
  if(['user','assistant'].includes(record.type)&&record.isMeta!==true){kind=record.type==='user'&&record.origin?.kind==='task-notification'?'automation_message':'message';data=record.message;}
  else if(record.type==='attachment'&&record.attachment?.type==='queued_command'&&record.attachment.commandMode==='prompt'){kind='message';data={role:'user',content:record.attachment.prompt};}
  else if(['custom-title','ai-title'].includes(record.type)){kind='session_title';data={title:record.customTitle??record.aiTitle,titleType:record.type==='custom-title'?'custom':'auto'};}
  if(!kind||!data)return;
  return {id:hash(b.client+':'+offset+':'+JSON.stringify(record)),kind,sequence:offset,timestamp:record.timestamp??null,nativeId:record.uuid??null,parentId:record.parentUuid??null,turnId:record.turnId??null,agentId:record.agentId??null,data};
}
const observations=(b,session)=>join(b.profile,'plugin-state',b.key,'observed',hash(session));
/** Fast local receipt: no authentication, network, transcript reads or CLI. */
export async function observe(b,event){
  const c=recording(b,event);if(b.captureMode!=='hook'||!c)return;
  if(b.client==='codex')return; // The native transcript supplies stable message IDs.
  pathFor(b,c,event,{mustExist:false});
  const dir=observations(b,event.session_id);
  if(event.hook_event_name==='UserPromptSubmit'){
    if(!nativeId(event.prompt_id)||typeof event.prompt!=='string')throw Error('Missing native prompt identity');
    const file=join(dir,'users',event.prompt_id+'.json');
    const receipt=once(file,{at:new Date().toISOString(),prompt:redact(event.prompt)});
    if((receipt.promptHash??hash(receipt.prompt))!==hash(redact(event.prompt)))throw Error('Native prompt identity reused');
    finishPrompt(b,event,event.prompt_id,receipt);
    return;
  }
  if(event.hook_event_name!=='MessageDisplay')return;
  if(!nativeId(event.message_id)||!nativeId(event.turn_id)||!Number.isSafeInteger(event.index)||event.index<0||event.index>100000||typeof event.delta!=='string'||typeof event.final!=='boolean')throw Error('Invalid native message chunk');
  const messageDir=join(dir,'messages',event.message_id);
  const receipt=once(join(messageDir,event.index+'.json'),{at:new Date().toISOString(),turn:event.turn_id,delta:redact(event.delta),final:event.final});
  if(receipt.turn!==event.turn_id||receipt.delta!==redact(event.delta)||receipt.final!==event.final)throw Error('Native message chunk conflict');
  finishMessage(b,event,event.message_id);
}
function finishPrompt(b,event,id,receipt){
  if(receipt.queued)return;
  const batch=queue(b,event,[{id:'claude-prompt:'+id,kind:'message',nativeId:id,timestamp:receipt.at,sequence:Date.parse(receipt.at)*1000,data:{role:'user',content:receipt.prompt,captureSource:'native-prompt'}}]);
  // The immutable queue now owns the content. Keep only replay metadata here.
  atomic(join(observations(b,event.session_id),'users',id+'.json'),{at:receipt.at,promptHash:hash(receipt.prompt),queued:true,batch});
}
function finishMessage(b,event,id){
  const dir=join(observations(b,event.session_id),'messages',id);
  if(existsSync(join(dir,'queued.json')))return;
  const parts=readdirSync(dir).filter(n=>/^\d+\.json$/.test(n)).sort((a,b)=>parseInt(a)-parseInt(b));
  let text='',first,last;
  for(let i=0;i<parts.length;i++){
    if(parts[i]!==i+'.json')return;
    const chunk=readJson(join(dir,parts[i]),8*1024*1024);
    first??=chunk;if(chunk.turn!==first.turn||last?.final)throw Error('Native message chunk conflict');
    text+=chunk.delta;last=chunk;if(Buffer.byteLength(text)>8*1024*1024)throw Error('Native message exceeds limit');
  }
  if(!last?.final)return;
  // Every chunk is durable before assembly, including an empty final chunk.
  const batch=queue(b,event,[{id:'claude-display:'+id,kind:'message',nativeId:id,turnId:first.turn,timestamp:first.at,sequence:Date.parse(first.at)*1000,data:{role:'assistant',content:[{type:'text',text}],captureSource:'native-display'}}]);
  atomic(join(dir,'queued.json'),{batch});
}
function queue(b,event,events){
  if(!events.length)return;
  if(!recording(b,event))throw Error('Recording no longer selected');
  const batch=redact({schemaVersion:1,owner:b.owner,installationId:b.installationId,host:hostname(),harness:b.client,origin:event.parentSessionId?'subagent':'cli',...(event.parentSessionId?{parentSessionId:event.parentSessionId}:{}),sessionId:event.session_id,cwd:event.cwd,captureMode:'live',events:events.map(wire),attachments:[]});
  // Scope fields are not secret-shaped free text and must remain exact.
  batch.owner=b.owner;batch.installationId=b.installationId;batch.sessionId=event.session_id;batch.cwd=event.cwd;
  const bytes=JSON.stringify(batch);if(Buffer.byteLength(bytes)>16*1024*1024)throw Error('Capture batch exceeds limit');
  const id=hash(bytes);atomic(join(b.capture,'queue',id+'.json'),bytes);
  return id;
}
export async function collect(b,event){
  if(b.client==='codex')return collectCodex(b,event);
  // Child agents do not emit MessageDisplay. Only the exact native parent's
  // subtree (or the explicit matching SubagentStop path) can enroll a child.
  const c=recording(b,event);if(!c)return {selected:false};
  const parent=event.session_id;
  const child=(id,file)=>({...event,session_id:parent+':'+id,parentSessionId:parent,agent_id:id,transcript_path:file});
  if(event.hook_event_name==='SubagentStop'){
    if(!nativeId(event.agent_id)||!isAbsolute(event.agent_transcript_path??''))throw Error('Missing native child transcript identity');
    const parentFile=pathFor(b,c,event,{mustExist:false});
    if(resolve(event.agent_transcript_path)!==join(dirname(parentFile),parent,'subagents','agent-'+event.agent_id+'.jsonl'))throw Error('Child transcript does not belong to the native parent');
    return collectOne(b,child(event.agent_id,event.agent_transcript_path));
  }
  const result=await collectOne(b,event);
  let parentFile;try{parentFile=pathFor(b,c,event);}catch(error){if(error.code!=='ENOENT')throw error;}
  if(parentFile){
    const directory=join(dirname(parentFile),parent,'subagents');
    if(existsSync(directory)&&!lstatSync(directory).isSymbolicLink()){
      const files=readdirSync(directory).filter(n=>n.startsWith('agent-')&&n.endsWith('.jsonl')&&nativeId(n.slice(6,-6))).slice(0,64);
      for(const name of files)await collectOne(b,child(name.slice(6,-6),join(directory,name)));
    }
  }
  return result;
}
async function codexEvent(b,event){
  const c=recording(b,event);if(!c)return;
  let value={...event};
  if(event.agent_id){
    if(!nativeId(event.agent_id))throw Error('Invalid child session identity');
    value={...event,parentSessionId:event.session_id,session_id:event.agent_id,transcript_path:event.agent_transcript_path??event.transcript_path};
  }
  if(!value.transcript_path){
    // Resolve only the announced ID through the native primary-key index.
    // Never enumerate native conversations or infer a fallback account/root.
    const root=c.roots?.codex;if(!isAbsolute(root??''))throw Error('Missing Codex root');
    const name=readdirSync(root).filter(n=>/^state_\d+\.sqlite$/.test(n)).sort((a,b)=>Number(b.match(/\d+/)[0])-Number(a.match(/\d+/)[0]))[0];
    if(!name)throw Error('Native session index is unavailable');
    const file=join(root,name);if(lstatSync(file).isSymbolicLink())throw Error('Invalid native session index');
    const db=process.versions.bun?new (await import('bun:sqlite')).Database(toNamespacedPath(file),{readonly:true}):new (await import('node:sqlite')).DatabaseSync(toNamespacedPath(file),{readOnly:true});
    try{
      const sql='SELECT rollout_path FROM threads WHERE id = ?';
      const row=process.versions.bun?db.query(sql).get(value.session_id):db.prepare(sql).get(value.session_id);
      if(typeof row?.rollout_path!=='string')throw Error('Native session not found');
      value.transcript_path=row.rollout_path;
    }finally{db.close();}
  }
  pathFor(b,c,value,{mustExist:false});return value;
}
async function collectCodex(b,event){
  const native=await codexEvent(b,event);if(!native)return {selected:false};
  const result=await collectOne(b,native);
  if(native.parentSessionId){
    atomic(join(b.profile,'plugin-state',b.key,'children',hash(native.parentSessionId),native.session_id+'.json'),native);
  }else{
    // Retry only children previously announced by this parent's native hooks.
    const dir=join(b.profile,'plugin-state',b.key,'children',hash(native.session_id));
    if(existsSync(dir))for(const name of readdirSync(dir).filter(n=>n.endsWith('.json')&&nativeId(n.slice(0,-5))).slice(0,64)){
      const child=readJson(join(dir,name),16384);
      if(child.parentSessionId!==native.session_id||child.session_id!==name.slice(0,-5))throw Error('Child session receipt mismatch');
      await collectOne(b,child);
    }
  }
  return result;
}
async function collectOne(b,event){
  const c=recording(b,event);if(!c)return {selected:false};
  const users=join(observations(b,event.session_id),'users');
  if(existsSync(users))for(const name of readdirSync(users).filter(n=>n.endsWith('.json')&&nativeId(n.slice(0,-5))))finishPrompt(b,event,name.slice(0,-5),readJson(join(users,name),8*1024*1024));
  const messages=join(observations(b,event.session_id),'messages');
  if(existsSync(messages))for(const id of readdirSync(messages).filter(nativeId))finishMessage(b,event,id);
  const dir=join(b.profile,'plugin-state',b.key),stateFile=join(dir,hash(event.session_id)+'.json');
  return locked(stateFile+'.lock',async()=>{
    if(!recording(b,event))return {selected:false};
    let state=readJson(stateFile,1024*1024,{missing:true})??{offset:0};
    let file;try{file=pathFor(b,c,event);}catch(error){if(error.code!=='ENOENT')throw error;}
    let events=[],offset=state.offset;
    if(file){
      const fd=openSync(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
      try{
        const stat=fstatSync(fd),identity=String(stat.dev)+':'+String(stat.ino);
        if(!stat.isFile()||stat.size<offset||state.fileIdentity&&state.fileIdentity!==identity)throw Error('Native transcript replaced; checkpoint retained');
        if(b.client==='codex'){
          const header=Buffer.alloc(Math.min(stat.size,1024*1024));readSync(fd,header,0,header.length,0);
          const end=header.indexOf(10);if(end<0)throw Error('Native session header is incomplete');
          const record=JSON.parse(header.subarray(0,end).toString('utf8'));
          if(record.type!=='session_meta'||record.payload?.id!==event.session_id)throw Error('Transcript session mismatch');
          if(event.parentSessionId&&record.payload.source?.subagent?.thread_spawn?.parent_thread_id!==event.parentSessionId)throw Error('Child transcript parent mismatch');
        }
        state.fileIdentity=identity;
        const deadline=Date.now()+3000;
        while(offset<stat.size&&Date.now()<deadline){
        const prior=offset,length=Math.min(stat.size-offset,8*1024*1024),bytes=Buffer.alloc(length);readSync(fd,bytes,0,length,offset);
        let start=0;
        while(start<bytes.length){
          const end=bytes.indexOf(10,start);if(end<0)break;
          const line=bytes.subarray(start,end).toString('utf8'),record=JSON.parse(line);
          if(record.sessionId&&record.sessionId!==(event.parentSessionId??event.session_id)||event.parentSessionId&&record.agentId&&record.agentId!==event.agent_id)throw Error('Transcript session mismatch');
          let parsed=sourceEvent(b,record,offset);
          if(b.client==='claude-code'&&parsed?.kind==='message'&&!event.parentSessionId){
            const content=parsed.data.content;
            // Visible assistant text comes from MessageDisplay, with a native
            // message identity and complete chunk sequence. Tool blocks still
            // come from the transcript, including commands with no text reply.
            if(parsed.data.role==='assistant'){
              const tools=Array.isArray(content)?content.filter(x=>x.type==='tool_use'):[];
              parsed=tools.length?{...parsed,kind:'tool_call',data:{role:'assistant',content:tools}}:undefined;
            }else if(record.promptId&&existsSync(join(observations(b,event.session_id),'users',record.promptId+'.json'))){
              const tools=Array.isArray(content)?content.filter(x=>x.type==='tool_result'):[];
              parsed=tools.length?{...parsed,kind:'tool_result',data:{role:'user',content:tools}}:undefined;
            }
          }
          if(parsed&&(!parsed.timestamp||Date.parse(parsed.timestamp)>=Date.parse(c.installedAt))){
            if(parsed.timestamp)parsed.sequence=Date.parse(parsed.timestamp)*1000;
            events.push(parsed);
          }
          offset+=end-start+1;start=end+1;
          if(events.length>=100){queue(b,event,events);events=[];}
        }
        queue(b,event,events);events=[];state.offset=offset;atomic(stateFile,state);
        if(offset===prior){if(length===8*1024*1024)throw Error('Native transcript record exceeds limit');break;}
        }
      }finally{closeSync(fd);}
    }
    queue(b,event,events);state.offset=offset;atomic(stateFile,state);
    return {selected:true,queued:true,offset};
  },1200);
}
export function handoff(b,event){
  const c=recording(b,event);if(!c)return {selected:false};
  if(c.captureWorker!=='daemon-v1'&&c.claudeCapture!=='daemon-v1')throw Error('Daemon mode is not configured');
  if(!['SessionStart','UserPromptSubmit','SessionEnd'].includes(event.hook_event_name))return {selected:true,handoff:false};
  pathFor(b,c,event,{mustExist:false});
  const id=randomUUID(),at=Date.now(),sequence=Math.round((performance.timeOrigin+performance.now())*1000);
  const payload={session_id:event.session_id,cwd:event.cwd,transcript_path:event.transcript_path,hook_event_name:event.hook_event_name};
  if(!recording(b,event))return {selected:false};
  atomic(join(b.capture,'daemon','inbox',sequence+'-'+id+'.json'),{kind:'capture',id,at,api:b.api,installationId:b.installationId,owner:b.owner,pid:process.ppid,record:{id,at:new Date(at).toISOString(),sequence,harness:b.client,event:payload}});
  return {selected:true,handoff:true};
}
export async function handoffCodex(b,event){
  const native=await codexEvent(b,event);if(!native)return {selected:false};
  return handoff(b,native);
}
export async function flush(b){
  return locked(join(b.profile,hash('capture:flush')+'.json.lock'),async()=>{
    await request(b,'/api/sessions/identity',{identity:true,refresh:true});
    const directory=join(b.capture,'queue');if(!existsSync(directory))return 0;
    let count=0;
    for(const name of readdirSync(directory).filter(n=>/^[a-f0-9]{64}\.json$/.test(n)).slice(0,64)){
      const c=enrollment(b);if(c.disabled||!c.harnesses?.includes(b.client))break;
      const file=join(directory,name),batch=readJson(file,16*1024*1024);
      if(batch.harness!==b.client||batch.installationId!==b.installationId||batch.owner?.tenantId!==b.owner.tenantId||batch.owner?.userId!==b.owner.userId||excluded(c,batch.sessionId,batch.cwd)||batch.parentSessionId&&excluded(c,batch.parentSessionId,batch.cwd))continue;
      if(batch.attachments?.some(a=>a.status==='captured'))continue;
      // Only immutable, already-redacted batches are eligible for direct send.
      const bytes=JSON.stringify(batch);if(hash(bytes)+'.json'!==name||JSON.stringify(redact(batch.events))!==JSON.stringify(batch.events))throw Error('Queue integrity check failed');
      const guard=()=>{const now=enrollment(b);if(now.disabled||!now.harnesses?.includes(b.client)||excluded(now,batch.sessionId,batch.cwd)||batch.parentSessionId&&excluded(now,batch.parentSessionId,batch.cwd))throw Error('Recording selection changed');};
      const receipt=await request(b,'/api/sessions/batches',{method:'POST',body:bytes,timeout:8000,refresh:true,guard});
      if(receipt.stored!==true||receipt.batchId!==hash(bytes))throw Error('Invalid capture receipt');
      const savedReceipt={at:new Date().toISOString(),...receipt,harness:b.client,installationId:b.installationId,sessionId:batch.sessionId};
      atomic(join(b.profile,'plugin-state',b.key,'last-upload.json'),savedReceipt);
      atomic(join(b.capture,'last-upload.json'),savedReceipt);
      unlinkSync(file);count++;if(count===8)break;
    }
    return count;
  },500);
}
