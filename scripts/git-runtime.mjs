// A marketplace copies only the selected plugin directory into its cache.
// Bundle the shared modules there for Git installs. Release ZIPs use the same
// entry point compiled for their target platform.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';

const root = resolve(import.meta.dirname, '..');
const catalog = JSON.parse(readFileSync(join(root, 'catalog.json')));
const bun = process.env.BUN_EXECUTABLE || 'bun';
assert.equal(execFileSync(bun, ['--version'], {encoding:'utf8'}).trim(), '1.3.14');
const bytes = execFileSync(bun, ['build', 'runtime/main.mjs', '--target=node', '--format=esm', '--external=bun:sqlite'], {cwd:root});
for (const item of catalog.packages) {
  const dir = join(root, item.path, 'bin');
  const file = join(dir, 'opencrawl-hook.mjs');
  if (process.argv.includes('--check')) {
    assert(readFileSync(file).equals(bytes), 'Rebuild the Git hook for ' + item.harness);
  } else {
    mkdirSync(dir, {recursive:true});
    writeFileSync(file, bytes);
  }
}
