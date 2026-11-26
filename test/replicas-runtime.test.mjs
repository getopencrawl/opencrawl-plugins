import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile, execFileSync} from 'node:child_process';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fixture} from './fixture.mjs';
import {invoke} from '../runtime/main.mjs';
import {atomic, binding, hash} from '../runtime/io.mjs';
import {privateSession} from '../runtime/privacy.mjs';
import {inboxNotice} from '../runtime/board.mjs';
import {search} from '../runtime/lifecycle.mjs';

const privateSkills=['oc-incognito','oc-private','oc-readonly','opencrawl-private'];
const testArchives=process.env.OC_TEST_REPLICAS_PACKAGES==='1';

test('Replicas offers a page through the configured workspace MCP and guards its native calls',async t=>{
  for(const harness of ['claude-code','codex']){
    const f=await fixture(t,harness),file=join(f.root,'.opencrawl-binding.json');
    const original=JSON.parse(readFileSync(file));
    const workspaceMcp={name:'workspace_board',url:f.b.api+'/mcp'};
    atomic(file,{...original,workspaceMcp});
    assert.throws(()=>binding(f.root),/workspace MCP/);
    const owner={...original.owner,userId:'workload_replicas_'+'b'.repeat(64)};
    atomic(file,{...original,owner,workspaceMcp:{...workspaceMcp,url:'https://another.example/mcp'}});
    assert.throws(()=>binding(f.root),/workspace MCP/);
    atomic(file,{...original,owner,workspaceMcp});
    atomic(join(f.root,'.mcp.json'),{mcpServers:{}});
    const b=binding(f.root),id=f.event.session_id;
    assert.match(inboxNotice(b,id,{delivery:'direct',after:1,through:2}),/workspace_board/);
    atomic(join(b.profile,'board',hash(b.api)+'.capabilities.json'),{board:2});
    const event={session_id:id,hook_event_name:'PreToolUse',tool_name:'mcp__workspace_board__board_inbox',tool_input:{}};
    assert.equal(search(b,event)?.hookSpecificOutput.permissionDecision,'deny');
    assert.equal(search(b,{...event,tool_input:{currentSession:{harness,sessionId:id}}}),undefined);
    assert.equal(search(b,{...event,tool_name:'mcp__other__board_inbox'}),undefined);
  }
});

for(const harness of ['claude-code','codex']){
  test(harness+' rejects incognito on Replicas and continues ordinary capture',async t=>{
    const f=await fixture(t,harness);
    const owner={...f.b.owner,userId:'workload_replicas_'+'a'.repeat(64)};
    const bindingFile=join(f.root,'.opencrawl-binding.json');
    atomic(bindingFile,{...JSON.parse(readFileSync(bindingFile)),owner});
    atomic(join(f.b.capture,'config.json'),{...f.config,owner});
    const b=binding(f.root);
    const run=async(action,event)=>{
      let out='';
      await invoke(f.root,action,event,{write:value=>{out+=value;}});
      return out?JSON.parse(out):undefined;
    };

    let hook=run;
    if(testArchives){
      const platform=process.platform+'-'+process.arch;
      const dir=join(import.meta.dirname,'../dist/native',platform);
      const version=JSON.parse(readFileSync(join(import.meta.dirname,'../plugins',harness,'capabilities.json'))).version;
      const zip=join(dir,'opencrawl-'+harness+'-'+version+'-'+platform+'.zip');
      const unpack=join(f.root,'package');
      mkdirSync(unpack);execFileSync('unzip',['-q',zip,'-d',unpack]);
      hook=(action,event)=>new Promise((resolve,reject)=>{
        const child=execFile(join(unpack,'bin/opencrawl-hook'),['--root',f.root,'--action',action],(err,out,stderr)=>{
          if(err||stderr)reject(err??Error(stderr));
          else resolve(out?JSON.parse(out):undefined);
        });
        child.stdin.end(JSON.stringify(event));
      });
    }

    const prompt={...f.event,hook_event_name:'UserPromptSubmit',prompt_id:'p1',turn_id:'t1'};
    for(const skill of privateSkills){
      for(const text of ['/'+skill,'$opencrawl:'+skill,'/opencrawl-local-'+harness+':'+skill,'[$'+skill+'](/skills/'+skill+'/SKILL.md)']){
        const event={...prompt,prompt:text};
        const reply=await hook('observe',event);
        assert.equal(reply.decision,'block');
        assert.match(reply.reason,/incognito is unavailable on Replicas/);
      }
      if(harness==='claude-code'){
        const skillCall={...f.event,hook_event_name:'PreToolUse',tool_name:'Skill',tool_input:{skill:'opencrawl-local-claude-code:'+skill}};
        const reply=await hook('privacy',skillCall);
        assert.equal(reply.hookSpecificOutput.permissionDecision,'deny');
      }
    }
    await hook('capture',{...prompt,prompt:'/oc-incognito'});
    assert.equal(privateSession(b,f.event.session_id),false);
    assert.equal(f.received.length,0);

    const text='Ordinary turn after the rejected command';
    await hook('observe',{...prompt,prompt:text});
    if(harness==='codex'){
      const rows=[{type:'session_meta',payload:{id:f.event.session_id}},{timestamp:new Date().toISOString(),type:'response_item',payload:{type:'message',id:'p1',role:'user',content:[{type:'input_text',text}]}}];
      writeFileSync(f.event.transcript_path,rows.map(row=>JSON.stringify(row)).join('\n')+'\n');
      await hook('capture',{...f.event,hook_event_name:'Stop'});
    }
    const messages=f.queued().flatMap(batch=>batch.events).filter(event=>event.kind==='message');
    assert.equal(messages.length,1);
    assert.deepEqual(messages[0].data.content,harness==='codex'?[{type:'input_text',text}]:text);
    assert(!f.received.some(req=>req.path==='/api/board/incognito'));

    // Earlier branch builds could already have promised to pause this session.
    const id={harness,sessionId:f.event.session_id};
    atomic(join(b.capture,'incognito',hash(JSON.stringify([b.api,owner.tenantId,owner.userId])),'pending',hash(JSON.stringify([harness,id.sessionId]))+'.json'),id);
    const before=f.queued();
    await hook('capture',{...f.event,hook_event_name:'Stop'});
    assert(privateSession(b,id.sessionId));
    assert.deepEqual(f.queued(),before);
    assert(!f.received.some(req=>req.path==='/api/board/incognito'));
  });
}
