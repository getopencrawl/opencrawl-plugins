// Print project hooks for an already bound installation in a managed Linux VM.
import {existsSync,readFileSync} from 'node:fs';
import {isAbsolute,join} from 'node:path';

const [root, ...extra] = process.argv.slice(2);
if (!root || !isAbsolute(root) || extra.length) throw Error('Expected an absolute, bound Cursor plugin directory');
const binding = JSON.parse(readFileSync(join(root,'.opencrawl-binding.json'),'utf8'));
if (binding.client !== 'cursor') throw Error('Expected a bound Cursor installation');
const binary = join(root,'bin','opencrawl-hook');
const runner = existsSync(binary) ? [binary] : [process.execPath,join(root,'bin','opencrawl-hook.mjs')];
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
const command = [...runner,'--root',root,'--action','cloud-inbox'].map(quote).join(' ');
const hooks = {};
for (const event of ['beforeSubmitPrompt','postToolUse','stop']) {
  hooks[event] = [{command,timeout:7,failClosed:false,...(event === 'stop' ? {loop_limit:1} : {})}];
}
console.log(JSON.stringify({version:1,hooks},null,2));
