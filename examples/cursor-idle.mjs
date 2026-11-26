// Run from the workspace after its owning launcher observes the Cursor job exit.
// Usage: node cursor-idle.mjs SESSION_ID [MINUTES]
import {execFile, spawn} from 'node:child_process';
import {once} from 'node:events';
import {promisify} from 'node:util';

const [session, minutes = '30', ...extra] = process.argv.slice(2);
const timeoutMs = Number(minutes) * 60_000;
if (extra.length || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,199}$/.test(session ?? '') ||
    !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
  throw Error('Expected a native Cursor session ID and a positive idle window in minutes');
}

const controller = new AbortController();
for (const name of ['SIGINT', 'SIGTERM']) process.once(name, () => controller.abort());
try {
  const {stdout} = await promisify(execFile)('opencrawl', [
    'board', 'wait', '--session', session, '--ids-only', '--timeout-ms', String(timeoutMs), '--json'
  ], {signal: controller.signal});
  if (stdout.trim()) {
    const notice = JSON.parse(stdout);
    if (notice.type === 'board.notice' && Array.isArray(notice.ids) &&
        notice.ids.length && notice.ids.every(Number.isSafeInteger)) {
      const child = spawn('agent', [
        '--workspace', process.cwd(), '--resume', session, '--print',
        'OpenCrawl has mail for this chat. Read board_inbox using your registered currentSession. Handle the page and acknowledge the cursor returned by the board tool.'
      ], {signal: controller.signal, stdio: ['ignore', 'inherit', 'inherit']});
      const [code] = await once(child, 'exit');
      process.exitCode = code ?? 1;
    }
  }
} catch (error) {
  if (!controller.signal.aborted) throw error;
  process.exitCode = 1;
}
