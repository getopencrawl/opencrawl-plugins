import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const check = process.argv.includes('--check');
const root = resolve(import.meta.dirname, '..');
const scratch = mkdtempSync(join(tmpdir(), 'devin-hook-build-'));
try {
  for (const GOARCH of ['amd64', 'arm64']) {
    const file = 'context-linux-' + GOARCH;
    const bundled = join(root, 'plugins/devin/bin', file);
    const target = check ? join(scratch, file) : bundled;
    execFileSync('go', ['build', '-trimpath', '-buildvcs=false', '-ldflags=-s -w -buildid=', '-o', target, './runtime/devin/main.go'], {
      cwd: root, stdio: 'inherit', env: {...process.env, GOOS: 'linux', GOARCH, CGO_ENABLED: '0', GOTOOLCHAIN: 'go1.26.5'},
    });
    if (check && !readFileSync(target).equals(readFileSync(bundled))) {
      throw Error(file + ' differs from the checked-in Go source');
    }
  }
} finally {
  rmSync(scratch, {recursive: true, force: true});
}
