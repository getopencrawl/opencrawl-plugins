# Cursor lifecycle verification

Actual Cursor CLI 2026.11.13-eacade1 and 2026.11.17-f532c45 ran on macOS arm64
in a disposable workspace with the standalone plugin, live GPT-5.4 Mini None,
normal sandboxing and `/usr/bin:/bin` as PATH. No OpenCrawl CLI, Node or Bun was
needed by the hooks. Cursor's own bundled runtime remains a harness dependency.
The supported minimum is the later version used for child and durability checks.

- Clean parent session `5bb99972-5eff-4f14-b6fa-4edf7299b23e` indexed all five
  expected records: user, intermediate/final assistant, tool input and output.
  An earlier Composer2.5 run encountered native reconnect errors; it is not
  counted as a successful native run. Its repeated visible replies were retained.
- Parent `d84816d0-e828-4f24-89d8-ce7a1e5eb83e` spawned child
  `e267fd44-4063-4c2c-9038-2521afba0c84`. The child's delegated prompt, both
  assistant replies and shell input/output were indexed under its native ID.
  Child tool callbacks supplied a parent-relative transcript path; the parent's
  next boundary recovered the final reply after the child's last tool callback.
  The delegated prompt is an agent task, not evidence of human authorship.
- Session `efffb8e3-8b33-4c08-9a01-f47465d827bd` used the original native
  `currentSession` supplied by SessionStart in an MCP search. Cursor's normal
  interactive Run once approval allowed that specific call. An earlier print
  run was denied by native permission policy; no broad approval flag was used.
- Session `03533248-9fa1-4637-943a-d0df5dd2ee61` repeated distinct synthetic
  hook-only markers: sessionStart context in its first assistant message, and
  postToolUse context in the next assistant reply after shell completion.
  Neither marker appeared in the user prompt or shell output. These diagnostic
  hooks established the delivery point used by the 0.3.6 plugin.
  The beforeSubmitPrompt probe `43ef38ba-2b97-4a34-86f3-44181ca0fc14` returned
  NO_CONTEXT and triggered no suggestion request on that older build. The plugin
  uses the post-tool delivery point there. See [Cursor hooks](https://cursor.com/docs/hooks).
- Interactive CLI 2026.11.22-e9042b2 skipped plugin-only beforeSubmitPrompt
  in two turns of session `4d2cfa62-ebbe-46e4-bfb3-c4b0786be58d`. Both ran a
  read tool and native postToolUse fired. With a project submit hook already
  present, session `213c50bb-1fac-4314-9dff-646586e77f4e` dispatched the
  0.3.6 plugin's submit hook. The compiled plugin sent the human prompt to a
  local fixture and returned its random reference in additional_context.
  The model repeated the reference before any tool call. The project hook only
  checked for nonempty input. Personal setup does not install a global hook
  to change the CLI's dispatch behavior. The Desktop 3.18.9 composer handles
  submit-time additional_context in its source. The native run above used CLI.
- Existing daemon 0.4.103 retained five events for session
  `4ea54789-abe2-4578-b829-bd3736c1defb` through actual fixture HTTP503 responses.
  After native exit, endpoint recovery drained the queue and made all five
  records searchable with no further hook. Cursor conversion stays in the
  plugin in both modes; the worker supplies durable upload. This exercised a
  manually started worker, not an installed launchd service.

Untrusted native execution initially stopped before any fixture request. The
operator then explicitly trusted this disposable workspace. Omitting the native
plugin produced zero fixture requests. Explicit recording opt-out suppressed
capture with the plugin loaded. Operator global hooks and credentials were kept.

Capture, indexing, SQLite search, board bootstrap and MCP used actual core
handlers at revision e1eceb842c4fbc40745a199e5f3d48a6797fea31, with synthetic
authentication, filesystem storage and board adapters. MCP read the actual test
index; its fixture search adapter did not implement automatic current-session
exclusion. These are not deployed cloud-stack acceptance claims.

All five platforms receive source and compiled-executable protocol checks.
Only macOS arm64 has native Cursor CLI acceptance. Consent boundaries, repeated
identical messages, partial records, exact paths, child exclusions, symlink
rejection, owner binding and immutable queue behavior have regression coverage.
Private reasoning, attachment bytes and nested child trees are outside coverage.
At most 64 direct child transcripts are drained per pass; 8MiB record/state
bounds retain pending local evidence rather than silently advancing the cursor.
