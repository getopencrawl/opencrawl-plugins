import {readFileSync} from 'node:fs';
import {isAbsolute, join} from 'node:path';

// Render only this package's managed Codex hook groups. The environment
// installer owns the system policy and the immutable executable it names.
const [bundle, executable, bindingRoot] = process.argv.slice(2);
if (![bundle, executable, bindingRoot].every(path => path && isAbsolute(path) && !/[\r\n\0]/.test(path))) {
  throw Error('Expected absolute paths to the unpacked Codex package, managed executable, and private binding root');
}
const definition = JSON.parse(readFileSync(join(bundle, 'hooks/hooks.json'), 'utf8'));
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
for (const groups of Object.values(definition.hooks)) {
  for (const group of groups) {
    for (const handler of group.hooks) {
      const match = /^"\$\{PLUGIN_ROOT\}\/bin\/opencrawl-hook" --root "\$\{PLUGIN_ROOT\}" --action (capture|start|observe|search|suggest|inbox)$/.exec(handler.command);
      if (handler.type !== 'command' || !match) throw Error('Unrecognized Codex hook definition');
      handler.command = [quote(executable), '--root', quote(bindingRoot), '--action', match[1]].join(' ');
    }
  }
}
process.stdout.write(JSON.stringify(definition, null, 2) + '\n');
