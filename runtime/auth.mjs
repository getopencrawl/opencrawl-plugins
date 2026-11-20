import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {hash,readJson,atomic,locked,enrollment,origin} from './io.mjs';
const sessionFile=b=>join(b.profile,hash(b.api)+'.json');
function saved(b){
  const s=readJson(sessionFile(b),65536,{privateFile:true});
  if(!s.accessToken||!Number.isFinite(s.expiresAt)||s.pendingOrganization)throw Error('Sign-in needs attention');
  return s;
}
async function json(response,limit=4*1024*1024){
  if(!response.ok){await response.body?.cancel();throw Error('API request failed: '+response.status);}
  const chunks=[];let size=0;
  for await(const chunk of response.body){size+=chunk.length;if(size>limit)throw Error('API response exceeds limit');chunks.push(chunk);}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
function owner(b,data){
  if(data?.principal?.tenantId!==b.owner.tenantId||data?.principal?.userId!==b.owner.userId)throw Error('Authenticated owner changed');
}
const execute=promisify(execFile);
async function mintWorkspaceToken(api){
  try{
    const {stdout}=await execute('/usr/local/bin/replicas',['identity','token','--audience',api],{timeout:6000,maxBuffer:32768,encoding:'utf8'});
    return stdout.trim();
  }catch{throw Error('Replicas workspace identity unavailable');}
}

// Cache only in this hook process. The API verifies the signature, organization
// connection and capture permission. Local checks catch a mismatched workspace
// before a queued transcript leaves the machine.
export function replicasCredentials(mint=mintWorkspaceToken){
  const cache=new WeakMap();
  return async function credential(b,rejected){
    const previous=cache.get(b);
    if(previous&&previous.refreshAt>Date.now()&&previous.value!==rejected)return previous.value;
    const value=await mint(b.api);
    try{
      const parts=value.split('.');
      if(parts.length!==3||value.length>16384)throw Error();
      const claims=JSON.parse(Buffer.from(parts[1],'base64url').toString('utf8'));
      const issuer='https://api.replicas.dev';
      if(claims.iss!==issuer||claims.aud!==b.api||!Number.isFinite(claims.exp)||claims.exp*1000<=Date.now())throw Error();
      const subject='org:'+claims.organization_id+':env:'+claims.environment_id+':workspace:'+claims.workspace_id;
      if(claims.sub!==subject||b.owner.userId!=='workload_replicas_'+hash(issuer+'\n'+subject))throw Error();
      cache.set(b,{value,refreshAt:claims.exp*1000-5000});
      return value;
    }catch{throw Error('Invalid Replicas workspace credential');}
  };
}
const workspaceToken=replicasCredentials();
export async function token(b,{rejected,refresh=false}={}){
  enrollment(b);
  if(b.replicasWorkspace)return workspaceToken(b,rejected);
  const usable=s=>s.expiresAt>Date.now()+30000&&s.accessToken!==rejected;
  let s=saved(b);if(usable(s))return s.accessToken;
  if(!refresh)throw Error('Sign-in needs attention');
  return locked(sessionFile(b)+'.lock',async()=>{
    enrollment(b);s=saved(b);if(usable(s))return s.accessToken;
    if(!s.refreshToken||!s.auth?.clientId)throw Error('Sign-in needs attention');
    const endpoint=new URL(s.auth.tokenEndpoint);
    // Token endpoint may be the configured auth provider, never an ambient URL.
    origin(endpoint.origin);if(endpoint.username||endpoint.password||endpoint.hash)throw Error('Invalid token endpoint');
    const response=await fetch(endpoint,{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:s.auth.clientId,grant_type:'refresh_token',refresh_token:s.refreshToken})});
    const data=await json(response,65536);
    if(typeof data.access_token!=='string'||!data.access_token||typeof data.refresh_token!=='string'||!data.refresh_token)throw Error('Sign-in refresh failed');
    // As in the CLI, JWT expiry schedules renewal. The API verifies identity.
    let exp;
    try{exp=JSON.parse(Buffer.from(data.access_token.split('.')[1],'base64url').toString()).exp;}catch{}
    const lifetime=Number.isFinite(data.expires_in)&&data.expires_in>0?data.expires_in:60;
    const expiresAt=Number.isFinite(exp)?exp*1000:Date.now()+lifetime*1000;
    const next={...s,accessToken:data.access_token,refreshToken:data.refresh_token,expiresAt};
    // Finish persisting rotating credentials before checking cancellation/binding.
    atomic(sessionFile(b),next);enrollment(b);return next.accessToken;
  },18000);
}
export async function request(b,path,{method='GET',body,refresh=false,timeout=6000,identity=false,guard=()=>{}}={}){
  if(!path.startsWith('/api/'))throw Error('Invalid API path');
  enrollment(b);let credential=await token(b,{refresh});
  const check=()=>{enrollment(b);guard();if(!b.replicasWorkspace&&saved(b).accessToken!==credential)throw Error('Configured credential changed');};
  const send=(url,options={})=>{check();return fetch(b.api+url,{redirect:'error',signal:AbortSignal.timeout(timeout),...options,headers:{authorization:'Bearer '+credential,...options.headers}});};
  for(let attempt=0;attempt<2;attempt++){
    // Authorize the exact credential used for content egress. A refresh or
    // concurrent sign-in must never redirect old content to a different owner.
    let response;
    if(!b.replicasWorkspace||path!=='/api/sessions/batches'){
      response=await send('/api/sessions/identity');
      if(response.status===401&&refresh&&attempt===0){await response.body?.cancel();credential=await token(b,{rejected:credential,refresh:true});continue;}
      const identification=await json(response);owner(b,identification.data);check();
      if(path==='/api/sessions/identity')return identification.data;
    }
    response=await send(path,{method,...(body===undefined?{}:{headers:{'content-type':'application/json'},body:typeof body==='string'?body:JSON.stringify(body)})});
    if(response.status===401&&refresh&&attempt===0){await response.body?.cancel();credential=await token(b,{rejected:credential,refresh:true});continue;}
    const result=await json(response);check();
    if(!result?.data)throw Error('Invalid API response');
    if(identity)owner(b,result.data);
    return result.data;
  }
  throw Error('Sign-in needs attention');
}
