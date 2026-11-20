import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {join, relative, resolve, sep} from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = file => readFileSync(join(root, file), 'utf8');
const json = file => JSON.parse(read(file));
const hosts = {
  'claude-code': ['.claude-plugin', '.claude-plugin'],
  codex: ['.codex-plugin', '.agents/plugins'],
  cursor: ['.cursor-plugin', '.cursor-plugin'],
  antigravity: ['.antigravity-plugin']
};
const catalog = json('catalog.json');

test('catalog, marketplace and installed package agree for every harness', () => {
  const expected = Object.keys(hosts).sort();
  assert.deepEqual(readdirSync(join(root, 'plugins')).sort(), expected);
  assert.deepEqual(catalog.packages.map(p => p.harness).sort(), expected);
  assert.equal(catalog.schemaVersion, 1);
  assert.equal(catalog.bindingSchemaVersion, 1);
  assert.equal(new Set(catalog.packages.map(p => p.version)).size, 1);
  const skills = new Map();
  const skillNames = ['oc-continue','oc-import-memories','oc-incognito','oc-private','oc-readonly','opencrawl','opencrawl-private'];
  for (const {harness, name, path, version, capabilities} of catalog.packages) {
    const [format, market] = hosts[harness];
    assert.equal(path, 'plugins/' + harness);
    const manifest = json(path + '/' + format + '/plugin.json');
    const caps = json(path + '/' + capabilities);
    assert.equal(name, 'opencrawl');
    assert.equal(manifest.name, name);
    assert.equal(manifest.version, version);
    assert.equal(caps.harness, harness);
    assert.equal(caps.version, version);
    assert.equal(caps.cliRequired, false);
    assert(caps.callbacks.length > 0);
    const listing = harness === 'codex' ? manifest.interface : manifest;
    assert.match(read(path + '/' + (listing.icon ?? listing.logo)), /<svg\b/);
    if (market) {
      const {plugins} = json(market + '/marketplace.json');
      assert.equal(plugins.length, 1);
      assert.equal(plugins[0].name, name);
      assert.equal(plugins[0].source.path ?? plugins[0].source, './' + path);
      if (harness !== 'codex') assert.equal(plugins[0].version, version);
    }
    const hooksPath = harness === 'antigravity' ? 'hooks.json' : 'hooks/hooks.json';
    const hooks = read(path + '/' + hooksPath);
    assert.match(hooks, /--action capture/);
    assert.match(hooks, /--action start/);
    assert.match(hooks, /bin\/opencrawl-hook\.mjs/);
    assert(read(path + '/bin/opencrawl-hook.mjs').length > 0);
    for (const file of readdirSync(join(root,path)).filter(f => /^\.?mcp(?:_config)?\.json$/.test(f))) {
      const {mcpServers} = json(path+'/'+file);
      assert.deepEqual(mcpServers, {opencrawl:{...(['claude-code','codex'].includes(harness) ? {type:'http'} : {}),url:'https://app.getopencrawl.com/mcp'}});
    }
    assert.equal(read(path + '/LICENSE'), read('LICENSE'));
    const files = readdirSync(join(root,path), {recursive:true, withFileTypes:true})
      .filter(entry => !entry.isDirectory()).map(entry => {
        assert(entry.isFile(), 'Unexpected link or special file in ' + path);
        return relative(join(root,path),join(entry.parentPath,entry.name)).split(sep).join('/');
      });
    const expectedFiles = [format+'/plugin.json','LICENSE','README.md','assets/icon.svg',
      '.mcp.json','mcp.json', 'capabilities.json', hooksPath,'bin/opencrawl-hook.mjs',
      ...skillNames.map(skill=>'skills/'+skill+'/SKILL.md')];
    if (harness === 'antigravity') expectedFiles.push('mcp_config.json');
    if (harness === 'codex') for (const skill of ['oc-incognito','oc-private','oc-readonly','opencrawl-private']) {
      expectedFiles.push('skills/'+skill+'/agents/openai.yaml');
    }
    assert.deepEqual(files.sort(), expectedFiles.sort());
    for (const skill of skillNames) {
      const body = read(path + '/skills/' + skill + '/SKILL.md');
      if (skills.has(skill)) assert.equal(body, skills.get(skill));
      skills.set(skill, body);
    }
  }
});
