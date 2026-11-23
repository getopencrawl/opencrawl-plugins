// Run once after a saved job exits, in its original workspace and profile.
import {execFile, spawn} from 'node:child_process';
import {existsSync, readFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {once} from 'node:events';

const [root, session, minutes = '30', ...extra] = process.argv.slice(2);
const windowMs = Number(minutes) * 60_000;
if (!root || extra.length || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,199}$/.test(session ?? '') ||
    !Number.isSafeInteger(windowMs) || windowMs <= 0 || windowMs > 30 * 60_000) {
  throw Error('Expected a bound plugin directory, native session ID and up to 30 minutes');
}
const plugin = resolve(root);
const {client} = JSON.parse(readFileSync(join(plugin, '.opencrawl-binding.json'), 'utf8'));
const commands = {
  cursor: ['agent', '--workspace', process.cwd(), '--resume', session, '--print'],
  codex: ['codex', 'exec', 'resume', session],
  antigravity: ['agy', '--conversation', session, '--print']
};
if (!Object.hasOwn(commands, client)) throw Error('This harness has no supported saved-job launcher');
const binary = join(plugin, 'bin', process.platform === 'win32' ? 'opencrawl-hook.exe' : 'opencrawl-hook');
const hook = existsSync(binary) ? [binary] : [process.execPath, join(plugin, 'bin', 'opencrawl-hook.mjs')];
const controller = new AbortController();
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => controller.abort());

async function waitForOffer(remaining, previous) {
  const output = await new Promise((resolve, reject) => {
    const [program, ...args] = hook;
    const child = execFile(program, [...args, '--root', plugin, '--action', 'wait'],
      {signal:controller.signal, maxBuffer:8192}, (error, stdout) => error ? reject(error) : resolve(stdout));
    child.stdin.on('error', error => { if (error.code !== 'EPIPE') reject(error); });
    child.stdin.end(JSON.stringify({sessionId:session, windowMs:remaining, previous}));
  });
  if (!output.trim()) return;
  const offer = JSON.parse(output);
  if (typeof offer.notice !== 'string' || !offer.notice.length || !Number.isSafeInteger(offer.after) ||
      !Number.isSafeInteger(offer.through) || offer.after < 0 || offer.through <= offer.after) {
    throw Error('Invalid board notification');
  }
  return offer;
}

const deadline = Date.now() + windowMs;
let previous;
try {
  while (Date.now() < deadline) {
    const offer = await waitForOffer(deadline - Date.now(), previous);
    if (!offer || (previous?.after === offer.after && previous.through === offer.through)) break;
    previous = {after:offer.after, through:offer.through};
    const [program, ...args] = commands[client];
    // The hook supplies a trusted, bounded read instruction. Peer text stays in the MCP tool response.
    const child = spawn(program, [...args, offer.notice], {signal:controller.signal, stdio:['ignore', 'inherit', 'inherit']});
    const [code] = await once(child, 'close');
    if (code !== 0) {
      process.exitCode = code ?? 1;
      break;
    }
  }
} catch (error) {
  if (!controller.signal.aborted) throw error;
  process.exitCode = 1;
}
