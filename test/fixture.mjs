import {mkdtempSync,mkdirSync,readFileSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {binding,atomic,hash} from '../runtime/io.mjs';

export async function fixture(t,harness='claude-code'){
  const root=mkdtempSync(join(tmpdir(),'opencrawl-hooks-test-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const received=[],owner={tenantId:'tenant-test',userId:'user-test'};
  let behavior={owner,fail:false,afterIdentity:undefined,beforeSuggestion:undefined,refreshes:0};
  const server=createServer(async(req,res)=>{
    let raw='';for await(const c of req)raw+=c;
    const body=raw?(req.headers['content-type']==='application/x-www-form-urlencoded'?Object.fromEntries(new URLSearchParams(raw)):JSON.parse(raw)):undefined;
    received.push({path:req.url,auth:req.headers.authorization,body,raw});
    res.setHeader('content-type','application/json');
    if(req.url==='/token'){
      behavior.refreshes++;res.end(JSON.stringify(behavior.refreshResponse??{access_token:'fixture-refreshed',refresh_token:'fixture-rotated',expires_in:3600}));
    }else if(req.url==='/api/sessions/identity'){
      res.end(JSON.stringify({data:{principal:behavior.owner}}));behavior.afterIdentity?.();
    }else if(behavior.fail){res.statusCode=503;res.end('{}');}
    else if(req.url==='/api/board/bootstrap')res.end(JSON.stringify({data:{session:body.session,workspace:owner.tenantId,agent:hash(body.session),boardProtocol:2,sharedFiles:behavior.sharedFiles}}));
    else if(req.url==='/api/board/incognito')res.end(JSON.stringify({data:{session:body.currentSession,boardBlocked:true,deleted:false,pending:true}}));
    else if(req.url==='/api/sessions/batches')res.end(JSON.stringify({data:{stored:true,batchId:hash(raw),eventCount:body.events.length}}));
    else if(req.url==='/api/context/suggestions'){await behavior.beforeSuggestion?.();res.end(JSON.stringify({data:{results:[{id:'source1',title:'Evidence',text:'A prior result',offset:0}],outputTokens:10,checkId:'12345678-1234-1234-1234-123456789abc'}}));}
    else if(req.url==='/api/context/suggestions/events')res.end(JSON.stringify({data:{accepted:body.events.map(e=>e.id)}}));
    else{res.statusCode=404;res.end('{}');}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const api='http://127.0.0.1:'+server.address().port;
  const profile=join(root,'profile'),native=join(root,'native'),session='session-1';
  const value={schemaVersion:1,client:harness,api,configHome:profile,installationId:'installation-test',owner,captureMode:'hook'};
  atomic(join(root,'.opencrawl-binding.json'),value);
  atomic(join(root,'.claude-plugin','plugin.json'),{name:'opencrawl-local-claude-code'});
  atomic(join(root,'.cursor-plugin','plugin.json'),{name:'opencrawl-local-cursor'});
  atomic(join(root,'.codex-plugin','plugin.json'),{name:'opencrawl-local-codex'});
  atomic(join(root,'.antigravity-plugin','plugin.json'),{name:'opencrawl-local-antigravity'});
  atomic(join(root,'.mcp.json'),{mcpServers:{opencrawl:{type:'http',url:api+'/mcp'}}});
  atomic(join(root,'mcp_config.json'),{mcpServers:{opencrawl:{url:api+'/mcp'}}});
  const b=binding(root),config={schemaVersion:1,api,installationId:value.installationId,owner,installedAt:new Date(Date.now()-60000).toISOString(),harnesses:[harness],roots:{[harness]:native}};
  atomic(join(b.capture,'config.json'),config);
  atomic(join(b.profile,hash(api)+'.json'),{accessToken:'fixture-credential',expiresAt:Date.now()+3600000});
  const path=harness==='cursor'?join(native,'projects','project','agent-transcripts',session,session+'.jsonl'):harness==='antigravity'?join(native,'antigravity-cli','brain',session,'.system_generated','logs','transcript_full.jsonl'):harness==='codex'?join(native,'sessions','2026','11','17','rollout-2026-11-17T00-00-00-'+session+'.jsonl'):join(native,'projects','project',session+'.jsonl');
  if(harness==='cursor')mkdirSync(join(native,'projects','project','agent-transcripts',session),{recursive:true});
  if(harness==='antigravity')mkdirSync(join(native,'antigravity-cli','brain',session,'.system_generated','logs'),{recursive:true});
  if(harness==='codex')mkdirSync(join(native,'sessions','2026','11','17'),{recursive:true});
  mkdirSync(join(native,'projects','project'),{recursive:true});
  const event={session_id:session,cwd:root,transcript_path:path};
  const queued=()=>readdirSync(join(b.capture,'queue')).filter(x=>x.endsWith('.json')).map(x=>JSON.parse(readFileSync(join(b.capture,'queue',x))));
  return {root,b,event,config,queued,received,behavior,server};
}

