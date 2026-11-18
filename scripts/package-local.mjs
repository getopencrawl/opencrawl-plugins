#!/usr/bin/env node
/** Build the standalone public hook runtime, then package a fixed allowlist. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {archive} from './package.mts';

const root=resolve(import.meta.dirname,'..');
const harness=process.argv[2]??'claude-code';
assert(['claude-code','codex','antigravity'].includes(harness),'Unsupported local package');
const platform=process.platform+'-'+process.arch;
const targets={'darwin-arm64':'bun-darwin-arm64','darwin-x64':'bun-darwin-x64','linux-arm64':'bun-linux-arm64','linux-x64':'bun-linux-x64-baseline','win32-x64':'bun-windows-x64-baseline'};
assert(targets[platform],'Unsupported runtime platform');
const out=join(root,'dist','local',platform);mkdirSync(out,{recursive:true});
const executable='opencrawl-hook'+(process.platform==='win32'?'.exe':'');
const binary=join(out,executable);
const bun=process.env.BUN_EXECUTABLE||'bun';
assert.equal(execFileSync(bun,['--version'],{encoding:'utf8'}).trim(),'1.3.14','Use the pinned Bun version');
const arguments_=['build',join(root,'local/runtime/main.mjs'),'--compile','--target='+targets[platform],
  '--no-compile-autoload-dotenv','--no-compile-autoload-bunfig','--no-compile-autoload-tsconfig','--no-compile-autoload-package-json',
  '--external','node:sqlite','--outfile='+binary];
const runtimeZip=join(out,'bun-build-runtime.zip'),runtimeDir=join(out,'bun-build-runtime');
try{
  if(process.platform==='win32'){
    // Bun 1.3.14's automatic cross-runtime ZIP extraction fails on Windows.
    // Supply the exact upstream baseline executable through the supported flag.
    const response=await fetch('https://github.com/oven-sh/bun/releases/download/bun-v1.3.14/bun-windows-x64-baseline.zip');
    assert(response.ok,'Bun runtime download failed');
    const bytes=Buffer.from(await response.arrayBuffer());
    assert.equal(createHash('sha256').update(bytes).digest('hex'),'538f9c846355d9e847b2671bc00c47da4229a0befb24df3282b739770f3b475f');
    writeFileSync(runtimeZip,bytes);
    execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command','Expand-Archive -LiteralPath $env:OC_BUILD_ZIP -DestinationPath $env:OC_BUILD_DIR -Force'],{env:{...process.env,OC_BUILD_ZIP:runtimeZip,OC_BUILD_DIR:runtimeDir},stdio:'inherit'});
    arguments_.push('--compile-executable-path='+join(runtimeDir,'bun-windows-x64-baseline','bun.exe'));
  }
  execFileSync(bun,arguments_,{stdio:'inherit'});
}finally{rmSync(runtimeZip,{force:true});rmSync(runtimeDir,{recursive:true,force:true});}
const source=['auth.mjs','capture.mjs','io.mjs','lifecycle.mjs','main.mjs','redact.mjs','THIRD_PARTY_NOTICES.txt'];
const manifestPath=(harness==='antigravity'?'.antigravity-plugin':harness==='codex'?'.codex-plugin':'.claude-plugin')+'/plugin.json';
const base=[manifestPath,'.mcp.json','mcp.json',...(harness==='antigravity'?['mcp_config.json']:[]),'LICENSE','README.md','capabilities.json','skills/opencrawl/SKILL.md'];
const directory=join(root,'local',harness);
const manifest=JSON.parse(readFileSync(join(directory,manifestPath)));
const hooksPath=harness==='antigravity'?'hooks.json':'hooks/hooks.json';
const hooks=JSON.parse(readFileSync(join(directory,hooksPath)));
const handlers=harness==='antigravity'?Object.values(hooks).flatMap(group=>Object.values(group).flatMap(list=>Array.isArray(list)?list.flatMap(item=>item.hooks??[item]):[])):Object.values(hooks.hooks).flatMap(groups=>groups.flatMap(group=>group.hooks));
if(process.platform==='win32')for(const hook of handlers){
  const action=hook.command.match(/--action ([a-z]+)$/)[1];
  if(harness==='antigravity'){hook.command='".\\bin\\opencrawl-hook.exe" --root "." --action '+action;continue;}
  const variable=harness==='codex'?'PLUGIN_ROOT':'CLAUDE_PLUGIN_ROOT';
  hook.command='& "$env:'+variable+'\\bin\\opencrawl-hook.exe" --root "$env:'+variable+'" --action '+action;
  hook.shell='powershell';
}
const entries=[...base.map(name=>({name,bytes:readFileSync(join(directory,name))})),
  ...source.map(name=>({name:'runtime/'+name,bytes:readFileSync(join(root,'local/runtime',name))})),
  {name:hooksPath,bytes:Buffer.from(JSON.stringify(hooks,null,2)+'\n')},
  {name:'bin/'+executable,bytes:readFileSync(binary),executable:true}].sort((a,b)=>a.name.localeCompare(b.name));
const filename=manifest.name+'-'+manifest.version+'-'+platform+'.zip';
const bytes=archive(entries),sha256=createHash('sha256').update(bytes).digest('hex');
writeFileSync(join(out,filename),bytes);
writeFileSync(join(out,'SHA256SUMS'),sha256+'  '+filename+'\n');
writeFileSync(join(out,'artifact.json'),JSON.stringify({schemaVersion:1,harness,name:manifest.name,version:manifest.version,platform,filename,sha256,executable:'bin/'+executable,source:source.map(n=>'runtime/'+n)},null,2)+'\n');
console.log(filename+': '+sha256);
