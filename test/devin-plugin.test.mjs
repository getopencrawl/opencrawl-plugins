import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const plugin = fileURLToPath(new URL('../opencrawl-devin/', import.meta.url));
const version = readFileSync(join(plugin, 'cli/VERSION'), 'utf8').trim();
const json = file => JSON.parse(readFileSync(join(plugin, file), 'utf8'));
test('Devin installs CLI, skills and member-scoped hosted MCP from one directory', () => {
  assert.equal(json('.devin-plugin/plugin.json').name, 'opencrawl');
  assert.deepEqual(json('.mcp.json').mcpServers.opencrawl, {
    url: 'https://app.getopencrawl.com/mcp', tokenScope: 'user',
  });
  assert.match(version, /^\d+\.\d+\.\d+$/);
  for (const skill of ['opencrawl', 'oc-continue', 'oc-import-memories']) {
    assert.ok(readFileSync(join(plugin, 'skills', skill, 'SKILL.md'), 'utf8').includes('name: ' + skill));
  }
});
test('bundled CLI executes outside a checkout using an empty user profile', t => {
  const home = mkdtempSync(join(tmpdir(), 'opencrawl devin '));
  t.after(() => rmSync(home, {recursive:true, force:true}));
  const windows = process.platform === 'win32';
  // Native fallback is exercised in the platform verification job. Offline
  // unit runs exercise the very same payload when Bun is on PATH.
  if (!process.env.OC_DEVIN_CHECK_NATIVE && spawnSync('bun', ['--version']).status !== 0) {
    t.skip('Bun absent; run the platform verification job for the native path'); return;
  }
  const native = process.env.OC_DEVIN_CHECK_NATIVE === '1';
  const toolPath = native ? (windows ? process.env.PATH.split(delimiter).filter(dir => !existsSync(join(dir,'bun.exe'))).join(delimiter) : '/usr/bin:/bin') : process.env.PATH;
  const env = {HOME:home, USERPROFILE:home, XDG_CONFIG_HOME:join(home,'config'), XDG_CACHE_HOME:join(home,'cache'),
    LOCALAPPDATA:join(home,'local'), PATH:toolPath, SystemRoot:process.env.SystemRoot,
    PATHEXT:process.env.PATHEXT, ComSpec:process.env.ComSpec, WINDIR:process.env.WINDIR, TMPDIR:home,
    TMP:home, TEMP:home, OPENCRAWL_NO_UPDATE:'1'};
  const invoke = args => windows
    ? execFileSync('pwsh', ['-NoProfile', '-File', join(plugin,'bin/opencrawl.ps1'), ...args], {env, cwd:home, encoding:'utf8'})
    : execFileSync(join(plugin,'bin/opencrawl'), args, {env, cwd:home, encoding:'utf8'});
  assert.equal(invoke(['--version']).trim(), version);
  assert.match(invoke(['--help']), /search/i);
  if (native) {
    const cache = windows ? join(home,'local','OpenCrawl-Devin','cli') : join(home,'cache','opencrawl-devin','cli');
    assert.ok(existsSync(join(cache,'data','opencrawl','versions',version,windows ? 'opencrawl.exe' : 'opencrawl')));
  }
  assert.equal(JSON.parse(invoke(['status','--json'])).data.authenticated, false);
});
