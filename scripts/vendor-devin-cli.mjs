// Refresh the unmodified upstream CLI payload committed to the Devin plugin.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const version = process.argv[2];
assert.match(version ?? '', /^\d+\.\d+\.\d+$/, 'Usage: node scripts/vendor-devin-cli.mjs VERSION');
const target = fileURLToPath(new URL('../opencrawl-devin/cli/', import.meta.url));
const release = 'https://github.com/getopencrawl/opencrawl-core/releases/download/cli-v' + version;
async function read(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error('HTTP ' + response.status + ' fetching ' + url);
  return Buffer.from(await response.arrayBuffer());
}
const metadata = JSON.parse(await read('https://registry.npmjs.org/@getopencrawl%2fcli/' + version));
assert.equal(metadata.name, '@getopencrawl/cli');
assert.equal(metadata.version, version);
const archiveUrl = 'https://registry.npmjs.org/@getopencrawl/cli/-/cli-' + version + '.tgz';
assert.equal(metadata.dist.tarball, archiveUrl);
const [archive, unix, windows, releaseMetadata] = await Promise.all([
  read(archiveUrl), read(release + '/install.sh'), read(release + '/install.ps1'),
  read('https://api.github.com/repos/getopencrawl/opencrawl-core/releases/tags/cli-v' + version),
]);
assert.equal('sha512-' + createHash('sha512').update(archive).digest('base64'), metadata.dist.integrity);
const assets = JSON.parse(releaseMetadata).assets;
for (const [name, bytes] of [['install.sh', unix], ['install.ps1', windows]]) {
  assert.equal('sha256:' + createHash('sha256').update(bytes).digest('hex'), assets.find(a => a.name === name)?.digest);
}
const temp = mkdtempSync(join(tmpdir(), 'opencrawl-devin-vendor-'));
try {
  const tgz = join(temp, 'cli.tgz');
  writeFileSync(tgz, archive);
  const files = ['runtime/opencrawl.js', 'LICENSE', 'THIRD_PARTY_NOTICES.txt'];
  execFileSync('tar', ['-xzf', tgz, '-C', temp, ...files.map(file => 'package/' + file)]);
  for (const file of files) copyFileSync(join(temp, 'package', file), join(target, file.split('/').pop()));
  writeFileSync(join(target, 'install.sh'), unix);
  writeFileSync(join(target, 'install.ps1'), windows);
  writeFileSync(join(target, 'VERSION'), version + '\n');
} finally {
  rmSync(temp, {recursive:true, force:true});
}
