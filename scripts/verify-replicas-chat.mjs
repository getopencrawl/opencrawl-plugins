import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// Compare a controlled text + Bash conversation from "replicas read --json"
// with a complete chronological OpenCrawl search of the same native session.
// Exclude harness housekeeping. Preserve event multiplicity and ordering.
const [nativeFile, searchFile, ownerId, installationId, rolloutPath] = process.argv.slice(2);
assert(nativeFile && searchFile && ownerId && installationId, 'Expected native JSON, search JSON, enrolled workload user ID and installation ID');
assert.match(ownerId, /^workload_replicas_[0-9a-f]{64}$/);
const load = file => JSON.parse(readFileSync(file, 'utf8'));
const chat = load(nativeFile);
assert.equal(chat.has_more, false, 'Page the complete native chat before comparing');
function claudeEvents(chat) {
  const expected = [];
  for (const event of chat.events) {
    if (!['claude-user', 'claude-assistant'].includes(event.type)) continue;
    const {role, content} = event.payload.message;
    for (const part of content) {
      if (part.type === 'thinking' || part.type === 'redacted_thinking') continue;
      if (part.type === 'text') {
        expected.push({kind: 'message', role, text: part.text});
      } else if (part.type === 'tool_use') {
        assert.equal(part.name, 'Bash', 'This proof uses controlled Bash calls');
        assert.deepEqual(Object.keys(part.input).sort(), ['command', 'description']);
        expected.push({kind: 'tool_call', role, text: [part.input.command, part.input.description, part.name].join('\n')});
      } else {
        assert.equal(part.type, 'tool_result', 'Unrecognized native content in controlled chat');
        assert.equal(typeof part.content, 'string');
        expected.push({kind: 'tool_result', role, text: part.content});
      }
    }
  }
  return expected;
}

function codexEvents(chat, rolloutPath) {
  assert(rolloutPath, 'Supply the Codex rollout JSONL for exact tool I/O');
  const rows = readFileSync(rolloutPath, 'utf8').trimEnd().split('\n').map(line => JSON.parse(line));
  assert.equal(rows[0].type, 'session_meta');
  assert.equal(rows[0].payload.id, chat.thread_id);
  // Replicas displays the executed shell command. The native rollout retains
  // the original tool wrapper, arguments, and result seen by the model.
  const calls = rows.filter(row => row.type === 'response_item' && ['custom_tool_call','function_call'].includes(row.payload.type)).map(row => row.payload);
  const outputs = rows.filter(row => row.type === 'response_item' && ['custom_tool_call_output','function_call_output'].includes(row.payload.type)).map(row => row.payload);
  const expected = [];
  let commands = 0;
  for (const event of chat.events) {
    if (event.type !== 'codex-item') continue;
    const item = event.payload.item;
    if (item.type === 'userMessage') {
      expected.push({kind:'message', role:'user', text:item.content});
    } else if (item.type === 'agentMessage') {
      expected.push({kind:'message', role:'assistant', text:item.text});
    } else if (item.type === 'commandExecution') {
      const call = calls[commands], result = outputs[commands++];
      assert(call && result && call.call_id === result.call_id, 'Native call/result pair missing');
      assert.equal(item.exitCode, 0);
      assert.equal(item.status, 'completed');
      const text = Array.isArray(result.output) ? result.output.map(part => {assert.equal(part.type,'input_text'); return part.text;}).join('\n') : result.output;
      assert(item.output && text.includes(item.output), 'Native output differs from the visible command output');
      expected.push({kind:'tool_call', role:null, text:[call.input ?? call.arguments, call.name].join('\n')},
                    {kind:'tool_result', role:null, text});
    } else {
      assert.fail('Unexpected managed item in the controlled Codex chat: ' + item.type);
    }
  }
  assert.equal(commands, calls.length);
  assert.equal(commands, outputs.length);
  return expected;
}

const isCodex = chat.coding_agent === 'codex';
assert(isCodex || chat.coding_agent === 'claude' || chat.coding_agent === undefined);
const expected = isCodex ? codexEvents(chat, rolloutPath) : claudeEvents(chat);
const search = load(searchFile);
assert.equal(search.next, null, 'Page the complete indexed session before comparing');
assert.equal(search.partial, false);
assert.equal(search.truncated, false);
assert.equal(search.searchContext.toolOutputsIncluded, true);
const indexed = search.results.filter(row => row.provenance.kind !== 'session_title');
const actual = indexed.map(row => {
  const {sessionId, userId, harness, origin, kind, role} = row.provenance;
  assert.equal(sessionId, chat.thread_id);
  assert.equal(userId, ownerId);
  assert.equal(row.provenance.installationId, installationId);
  assert.equal(harness, isCodex ? 'codex' : 'claude-code');
  assert.equal(origin, 'cloud');
  assert.equal(row.passage.count, 1, 'Use short markers that fit in one passage');
  assert.equal(row.excerpt.totalChars, row.text.length, 'Increase excerptChars for this proof');
  return {kind, role, text: row.text};
});
assert.deepEqual(actual, expected, 'Native and indexed content differ');
const count = (kind, role) => actual.filter(row => row.kind === kind && (!role || row.role === role)).length;
const counts = {user: count('message', 'user'), assistant: count('message', 'assistant'), toolInputs: count('tool_call'), toolOutputs: count('tool_result')};
assert(counts.user >= 1 && counts.assistant >= 2 * counts.user && counts.toolInputs >= counts.user && counts.toolOutputs === counts.toolInputs, 'The controlled turns must exercise intermediate text and tools');
console.log(JSON.stringify({sessionId: chat.thread_id, workloadUserId: ownerId, installationId, matched: actual.length, ...counts}));
