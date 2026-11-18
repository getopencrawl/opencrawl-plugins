import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'..');
const json=file=>JSON.parse(readFileSync(resolve(root,file),'utf8'));
const formats={'claude-code':'.claude-plugin/plugin.json',codex:'.codex-plugin/plugin.json',cursor:'.cursor-plugin/plugin.json',antigravity:'.antigravity-plugin/plugin.json'};
test('native installer catalog never represents a stub as capture-ready',()=>{
  const catalog=json('local/catalog.json');
  assert.equal(catalog.schemaVersion,1);assert.equal(catalog.bindingSchemaVersion,1);
  assert.deepEqual(catalog.packages.map(p=>p.harness).sort(),Object.keys(formats).sort());
  for(const item of catalog.packages){
    assert.equal(item.path,`local/${item.harness}`);
    const manifest=json(`${item.path}/${formats[item.harness]}`),caps=json(`${item.path}/${item.capabilities}`);
    assert.equal(manifest.name,item.name);assert.equal(manifest.version,item.version);
    assert.equal(caps.harness,item.harness);assert.equal(caps.version,item.version);
    assert.equal(caps.cliRequired,false);
    if(caps.status==='stub'){
      assert.deepEqual(caps.callbacks,[]);assert.equal(caps.daemonHandoff,false);
      assert.deepEqual(caps.capture,{minimum:false,toolInputs:false,toolOutputs:false});
      assert(!readdirSync(resolve(root,item.path)).includes('hooks'));
    }
    assert.deepEqual(json(`${item.path}/.mcp.json`),{mcpServers:{}});
    assert.equal(readFileSync(resolve(root,item.path,'LICENSE'),'utf8'),readFileSync(resolve(root,'LICENSE'),'utf8'));
    assert.equal(readFileSync(resolve(root,item.path,'skills/opencrawl/SKILL.md'),'utf8'),readFileSync(resolve(root,caps.status==='stub'?'opencrawl/skills/opencrawl/SKILL.md':'local/SKILL.md'),'utf8'));
  }
});
