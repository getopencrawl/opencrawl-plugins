import {createHash,randomUUID} from 'node:crypto';
import {mkdirSync,openSync,closeSync,writeFileSync,fsyncSync,renameSync,unlinkSync,lstatSync,readFileSync,chmodSync,linkSync,realpathSync,fstatSync,constants} from 'node:fs';
import {dirname,join,isAbsolute,resolve,relative,sep,toNamespacedPath} from 'node:path';
export const hash=value=>createHash('sha256').update(value).digest('hex');
export const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
export const nativeId=value=>typeof value==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,199}$/.test(value);
export function origin(value){
  const url=new URL(value);
  if(url.username||url.password||url.hash||url.search||url.pathname!=='/'||!(url.protocol==='https:'||url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)))throw Error('Invalid configured origin');
  return url.origin;
}
export function readJson(file,max=1024*1024,{missing=false,privateFile=false}={}){
  let fd;try{fd=openSync(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);}catch(error){if(missing&&error.code==='ENOENT')return;throw error;}
  try{
    const stat=fstatSync(fd);
    if(!stat.isFile()||stat.size>max)throw Error('Invalid state file');
    if(privateFile&&process.platform!=='win32'&&(stat.mode&0o077))throw Error('State file must be private');
    const bytes=readFileSync(fd);if(bytes.length>max)throw Error('State file exceeds limit');
    return JSON.parse(bytes.toString('utf8'));
  }finally{closeSync(fd);}
}
export function atomic(file,value){
  mkdirSync(dirname(file),{recursive:true,mode:0o700});
  const tmp=join(dirname(file),'.tmp-'+randomUUID()),fd=openSync(tmp,'wx',0o600);
  try{writeFileSync(fd,typeof value==='string'?value:JSON.stringify(value)+'\n');fsyncSync(fd);}finally{closeSync(fd);}
  try{renameSync(tmp,file);if(process.platform!=='win32'){const dir=openSync(dirname(file),'r');try{fsyncSync(dir);}finally{closeSync(dir);}}}finally{try{unlinkSync(tmp);}catch{}}
}
/** Publish an immutable receipt once. Readers never observe a partial write. */
export function once(file,value){
  mkdirSync(dirname(file),{recursive:true,mode:0o700});
  const tmp=join(dirname(file),'.tmp-'+randomUUID()),fd=openSync(tmp,'wx',0o600);
  try{writeFileSync(fd,JSON.stringify(value)+'\n');fsyncSync(fd);}finally{closeSync(fd);}
  try{linkSync(tmp,file);}
  catch(error){if(error.code!=='EEXIST')throw error;}
  finally{unlinkSync(tmp);}
  return readJson(file,16*1024*1024);
}
export function binding(root){
  if(!isAbsolute(root))throw Error('Explicit plugin root required');
  root=resolve(root);
  const b=readJson(join(root,'.opencrawl-binding.json'),16384,{privateFile:true});
  if(!object(b)||b.schemaVersion!==1||!['claude-code','codex','cursor','antigravity'].includes(b.client)||!isAbsolute(b.configHome??'')||!nativeId(b.installationId)||!object(b.owner)||!nativeId(b.owner.tenantId)||!nativeId(b.owner.userId)||!['hook','daemon'].includes(b.captureMode))throw Error('Invalid plugin binding');
  if(origin(b.api)!==b.api)throw Error('Origin must be normalized');
  const profile=join(b.configHome,'opencrawl'),capture=join(profile,'capture');
  return {...b,root,profile,capture,key:hash(JSON.stringify([b.api,b.installationId,b.owner,b.client]))};
}
export function enrollment(b){
  const current=binding(b.root);
  if(current.key!==b.key||current.configHome!==b.configHome||current.captureMode!==b.captureMode)throw Error('Plugin binding changed');
  const c=readJson(join(b.capture,'config.json'),65536,{privateFile:true});
  if(c.schemaVersion!==1||c.authPending||c.api!==b.api||c.installationId!==b.installationId||c.owner?.tenantId!==b.owner.tenantId||c.owner?.userId!==b.owner.userId)throw Error('Enrollment does not match plugin');
  return c;
}
export function excluded(c,session,cwd){
  if(c.exclusions?.sessions?.some(id=>id===session||session.startsWith(id+':')))return true;
  const projects=c.exclusions?.projects??[];
  if(!projects.length)return false;
  if(!isAbsolute(cwd??''))return true;
  const within=(base,file)=>{const r=relative(base,file);return r===''||r!=='..'&&!r.startsWith('..'+sep)&&!isAbsolute(r);};
  try{return projects.some(p=>!isAbsolute(p)||within(resolve(p),resolve(cwd))||within(realpathSync(p),realpathSync(cwd)));}
  catch{return true;}
}
import {privateSession} from './privacy.mjs';
export function recording(b,event){
  const c=enrollment(b),id=event.session_id;
  if(!nativeId(id)||privateSession(b,id)||c.disabled||!c.harnesses?.includes(b.client)||excluded(c,id,event.cwd)||event.parentSessionId&&excluded(c,event.parentSessionId,event.cwd))return;
  return c;
}
export async function locked(file,operation,timeout=5000){
  // Same kernel-backed SQLite lock as the existing CLI/daemon. Never replace
  // or unlink a lock database: a crashed process releases its transaction.
  mkdirSync(dirname(file),{recursive:true,mode:0o700});
  closeSync(openSync(file+'.sqlite','a',0o600));chmodSync(file+'.sqlite',0o600);
  // SQLite's Windows VFS also opens a journal beside this file. Pass the
  // extended path explicitly so a normal profile plus hashed state names does
  // not hit MAX_PATH when the journal suffix is appended.
  const database=toNamespacedPath(resolve(file+'.sqlite'));
  const db=process.versions.bun?new (await import('bun:sqlite')).Database(database):new (await import('node:sqlite')).DatabaseSync(database);
  db.exec('PRAGMA busy_timeout=0');let acquired=false,published;
  const deadline=Date.now()+timeout;
  try{
    while(!acquired){try{db.exec('BEGIN IMMEDIATE');acquired=true;}catch(error){if(!/locked|busy/i.test(error.message))throw error;if(Date.now()>=deadline)throw Error('State busy');await new Promise(r=>setTimeout(r,30));}}
    // Older CLI versions additionally use this PID marker. Never displace a
    // live owner. Current CLI versions hold the same SQLite transaction.
    for(;;){
      const tmp=join(dirname(file),'.pid-'+randomUUID());
      try{
        writeFileSync(tmp,String(process.pid),{flag:'wx',mode:0o600});linkSync(tmp,file);published=lstatSync(file,{bigint:true});break;
      }catch(error){
        if(error.code!=='EEXIST')throw error;
        const before=lstatSync(file,{bigint:true}),pid=Number(readFileSync(file,'utf8'));
        if(!Number.isSafeInteger(pid)||pid<=0)throw Error('State busy');
        try{process.kill(pid,0);throw Error('State busy');}catch(check){if(check.code!=='ESRCH')throw check;}
        const after=lstatSync(file,{bigint:true});if(before.ino!==after.ino||before.dev!==after.dev||before.birthtimeNs!==after.birthtimeNs)throw Error('State busy');
        unlinkSync(file);
      }finally{try{unlinkSync(tmp);}catch{}}
    }
    return await operation();
  }finally{
    try{if(published){try{const now=lstatSync(file,{bigint:true});if(now.ino===published.ino&&now.dev===published.dev&&now.birthtimeNs===published.birthtimeNs&&readFileSync(file,'utf8')===String(process.pid))unlinkSync(file);}catch(error){if(error.code!=='ENOENT')throw error;}}}
    finally{try{if(acquired)db.exec('ROLLBACK');}finally{db.close();}}
  }
}
