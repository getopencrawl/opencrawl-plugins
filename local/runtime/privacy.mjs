import {mkdirSync,readdirSync,renameSync,rmSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {hash,readJson,once,enrollment,nativeId,locked} from './io.mjs';
import {request} from './auth.mjs';

const names='(?:oc-incognito|oc-private|opencrawl-private|oc-readonly)';
const qualified='(?:opencrawl(?:-[a-f0-9]{12})?:)?'+names;
const command=new RegExp('^(?:(?:please )?(?:use|activate|enable) )?[/$]'+qualified+'(?=\\s|$)');
const link=new RegExp('^\\[\\$'+qualified+'\\]\\([^\\r\\n)]*/SKILL\\.md\\)(?=\\s|$)');
const selected=new RegExp('^'+qualified+'$');
const root=b=>join(b.capture,'incognito',hash(JSON.stringify([b.api,b.owner.tenantId,b.owner.userId])));
const key=s=>hash(JSON.stringify([s.harness,s.sessionId]))+'.json';
const files=dir=>{try{return readdirSync(dir);}catch(e){if(e.code==='ENOENT')return [];throw e;}};

export function sessionIdentity(b,event){
  const id=event.session_id,child=event.agent_id;
  if(!nativeId(id))return;
  if(child==null)return {harness:b.client,sessionId:id};
  if(!nativeId(child)||!['codex','claude-code'].includes(b.client))return;
  const sessionId=b.client==='codex'?child:id+':'+child;
  if(nativeId(sessionId))return {harness:b.client,sessionId};
}

export function invoked(b,e){
  const scoped=text=>{
    const match=/opencrawl-([a-f0-9]{12}):/.exec(text);
    return !match||hash(b.api).slice(0,12)===match[1];
  };
  const normalize=text=>b.replicasWorkspace?text.replace('opencrawl-local-'+b.client+':','opencrawl:'):text;
  if(b.client==='claude-code'&&e.hook_event_name==='PreToolUse'&&e.tool_name==='Skill')
    return typeof e.tool_input?.skill==='string'&&selected.test(normalize(e.tool_input.skill))&&scoped(e.tool_input.skill);
  const text=e.hook_event_name==='UserPromptSubmit'?e.prompt:null;
  return typeof text==='string'&&[command,link].some(pattern=>{const match=pattern.exec(normalize(text.trimStart()));return match!==null&&scoped(match[0]);});
}

export function privateSession(b,id){
  if(!nativeId(id))return false;
  const file=key({harness:b.client,sessionId:id});
  return ['pending','accepted'].some(state=>readJson(join(root(b),state,file),4096,{missing:true})!==undefined);
}
export function markPrivate(b,s){
  enrollment(b);
  if(!privateSession(b,s.sessionId))once(join(root(b),'pending',key(s)),s);
}
export function boardSend(e){
  const tool=e.tool_name==='call_mcp_tool'?e.tool_input?.ToolName:e.tool_name;
  return typeof tool==='string'&&/(?:^|_|:)board_(post|publish|presence|follow)$/.test(tool);
}

export async function retryErasure(b){
  const base=root(b),pending=join(base,'pending');
  for(const file of files(pending).filter(n=>/^[0-9a-f]{64}\.json$/.test(n))){
    const s=readJson(join(pending,file),4096,{missing:true});
    if(!s||s.harness!==b.client)continue;
    if(!nativeId(s.sessionId)||key(s)!==file)throw Error('Invalid incognito intent');
    const [remote,local]=await Promise.allSettled([request(b,'/api/board/incognito',{method:'POST',body:{currentSession:s,workspace:b.owner.tenantId},refresh:true}),purgeLocal(b,s)]);
    if(local.status==='rejected')throw local.reason;
    if(remote.status==='rejected')throw remote.reason;
    const r=remote.value;
    if(r.boardBlocked!==true||r.session?.sessionId!==s.sessionId||r.session?.harness!==s.harness||!(r.pending===true&&r.deleted===false||r.pending===false&&r.deleted===true))throw Error('Invalid incognito receipt');
    mkdirSync(join(base,'accepted'),{recursive:true,mode:0o700});
    try{renameSync(join(pending,file),join(base,'accepted',file));}catch(e){if(e.code!=='ENOENT')throw e;}
  }
}

export async function purgeLocal(b,s){
  // Limit cleanup to OpenCrawl-owned files. The native transcript belongs to the harness.
  const state=join(b.profile,'plugin-state',b.key);
  for(const path of [join(state,'observed',hash(s.sessionId)),join(state,'cursor-notices',hash(s.sessionId)),join(state,hash(s.sessionId)+'.json')])rmSync(path,{recursive:true,force:true});
  const suggestions=join(state,'suggestions'),sessionHash=hash(JSON.stringify([b.client,s.sessionId]));
  rmSync(join(suggestions,'latest',sessionHash+'.json'),{force:true});
  for(const name of files(join(suggestions,'tasks')).filter(n=>/^[a-f0-9]{64}\.json$/.test(n))){
    const path=join(suggestions,'tasks',name);if(readJson(path,32768,{missing:true})?.session===sessionHash)rmSync(path,{force:true});
  }
  const lock=(name,fn)=>locked(join(b.profile,hash('capture:'+name)+'.json.lock'),fn,5000);
  await lock('notices',()=>lock('spool',()=>lock('flush',async()=>{
    const matches=r=>r?.harness===s.harness&&r.sessionId===s.sessionId;
    const owned=r=>r?.tenantId===b.owner.tenantId&&r.userId===b.owner.userId;
    enrollment(b);
    const seals=join(b.capture,'seals');
    for(const file of files(seals).filter(n=>/^[a-f0-9]{64}\.json$/.test(n))){
      const path=join(seals,file),plan=readJson(path,40*1024*1024,{missing:true});
      if(!plan)continue;
      const batch=JSON.parse(plan.serialized);
      if(matches(batch)&&owned(batch.owner))rmSync(path,{force:true});
    }
    const dir=join(b.capture,'queue'),erased=new Set(),retained=new Set();
    for(const file of files(dir).filter(n=>/^[a-f0-9]{64}\.json$/.test(n))){
      const path=join(dir,file),batch=readJson(path,17*1024*1024,{missing:true});
      if(!batch)continue;
      const erase=matches(batch)&&owned(batch.owner);
      for(const a of batch.attachments??[])if(/^[a-f0-9]{64}$/.test(a.sha256??''))(erase?erased:retained).add(a.sha256);
      if(erase){
        unlinkSync(path);
        for(const part of ['live','rejected'])rmSync(join(b.capture,part,file),{force:true});
      }
    }
    for(const sha of erased)if(!retained.has(sha))rmSync(join(b.capture,'blobs',sha),{force:true});
    for(const part of ['notices','sources','state','daemon/inbox','daemon/sessions']){
      const directory=join(b.capture,part);
      for(const name of files(directory).filter(n=>/\.json(?:\.held)?$/.test(n))){
        const path=join(directory,name),r=readJson(path,50*1024*1024,{missing:true});
        if(!r||r.owner&&!owned(r.owner)||r.api&&r.api!==b.api)continue;
        const notice=r.record??r,e=notice.event;
        const id=e&&typeof e==='object'?(notice.harness==='cursor'?e.conversation_id??e.session_id:notice.harness==='antigravity'?e.conversationId:e.session_id):undefined;
        const identity=id?sessionIdentity({client:notice.harness},{...e,session_id:id}):r.meta??r;
        if(matches(identity)||part==='state'&&s.harness==='cursor'&&name==='cursor-'+hash(s.sessionId)+'.json')rmSync(path,{force:true});
      }
    }
  })));
}
