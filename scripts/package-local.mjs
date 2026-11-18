#!/usr/bin/env node
/** Build the standalone public hook runtime, then package a fixed allowlist. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {archive} from './package.mts';

const root=resolve(import.meta.dirname,'..');
const platform=process.platform+'-'+process.arch;
const targets={'darwin-arm64':'bun-darwin-arm64','darwin-x64':'bun-darwin-x64','linux-arm64':'bun-linux-arm64','linux-x64':'bun-linux-x64-baseline','win32-x64':'bun-windows-x64-baseline'};
assert(targets[platform],'Unsupported runtime platform');
const out=join(root,'dist','local',platform);mkdirSync(out,{recursive:true});
const executable='opencrawl-hook'+(process.platform==='win32'?'.exe':'');
const binary=join(out,executable);
const bun=process.env.BUN_EXECUTABLE||'bun';
assert.equal(execFileSync(bun,['--version'],{encoding:'utf8'}).trim(),'1.3.14','Use the pinned Bun version');
execFileSync(bun,['build',join(root,'local/runtime/main.mjs'),'--compile','--target='+targets[platform],'--external','node:sqlite','--outfile='+binary],{stdio:'inherit'});
const source=['auth.mjs','capture.mjs','io.mjs','lifecycle.mjs','main.mjs','redact.mjs','THIRD_PARTY_NOTICES.txt'];
const base=['.claude-plugin/plugin.json','.mcp.json','mcp.json','LICENSE','README.md','capabilities.json','skills/opencrawl/SKILL.md'];
const directory=join(root,'local','claude-code');
const manifest=JSON.parse(readFileSync(join(directory,'.claude-plugin/plugin.json')));
const hooks=JSON.parse(readFileSync(join(directory,'hooks/hooks.json')));
if(process.platform==='win32')for(const groups of Object.values(hooks.hooks))for(const group of groups)for(const hook of group.hooks){
  const action=hook.command.match(/--action ([a-z]+)$/)[1];
  hook.command='& "$env:CLAUDE_PLUGIN_ROOT\\bin\\opencrawl-hook.exe" --root "$env:CLAUDE_PLUGIN_ROOT" --action '+action;
  hook.shell='powershell';
}
const entries=[...base.map(name=>({name,bytes:readFileSync(join(directory,name))})),
  ...source.map(name=>({name:'runtime/'+name,bytes:readFileSync(join(root,'local/runtime',name))})),
  {name:'hooks/hooks.json',bytes:Buffer.from(JSON.stringify(hooks,null,2)+'\n')},
  {name:'bin/'+executable,bytes:readFileSync(binary),executable:true}].sort((a,b)=>a.name.localeCompare(b.name));
const filename=manifest.name+'-'+manifest.version+'-'+platform+'.zip';
const bytes=archive(entries),sha256=createHash('sha256').update(bytes).digest('hex');
writeFileSync(join(out,filename),bytes);
writeFileSync(join(out,'SHA256SUMS'),sha256+'  '+filename+'\n');
writeFileSync(join(out,'artifact.json'),JSON.stringify({schemaVersion:1,harness:'claude-code',name:manifest.name,version:manifest.version,platform,filename,sha256,executable:'bin/'+executable,source:source.map(n=>'runtime/'+n)},null,2)+'\n');
console.log(filename+': '+sha256);
