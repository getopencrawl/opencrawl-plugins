# opencrawl-local-claude-code

The native lifecycle package registers sessions, captures conversation messages,
validates current-session identity on its own MCP calls, and delivers optional context
suggestions. Its hooks execute the bundled `bin/opencrawl-hook` directly. They
do not run the OpenCrawl CLI, Node, Bun, a package manager, or a downloaded script.

Requires Claude Code **2.1.327 or later**, including its native `MessageDisplay`
hook. User prompts and every displayed assistant message are durably recorded
locally before upload. Tool inputs and outputs are read from the selected native
transcript. Child-agent messages use the exact child transcript announced by
`SubagentStop`, with recovery limited to that parent's native subagent directory.
Separate assistant replies retain separate native identities, even
when their text is identical. Message chunks may arrive out of order; capture
assembles them only after all chunks through the final marker have arrived.

An installer must select the platform archive, verify its checksum, and bind the
complete package to an explicit server, profile and owner using the private
`.opencrawl-binding.json`. Configure native MCP to that server's `/mcp`. The CLI
can handle installation and sign-in; it is not a hook dependency. See
[`docs/local-lifecycle.md`](../../docs/local-lifecycle.md). Source checkouts need
`node scripts/package-local.mjs` with Node24 and Bun1.3.14 to produce the archive.

In direct mode, hooks retain failed uploads for a later lifecycle invocation.
They do not retry after the harness exits. Optional daemon mode hands the exact
session path to an existing configured worker, which keeps reading and uploading
independently. This package never installs or starts a background service.

Capture selection and exclusions remain in the existing profile. Context
suggestions default on for clients recording new sessions and have bounded concurrency; superseded prompt
results are discarded. Native plugin trust and `disableAllHooks` remain effective.
No callback grants permission for a tool invocation.

SessionStart supplies the exact `currentSession` object for the model to declare
in its original search and board arguments. Correct calls pass unchanged;
missing or incorrect identity is rejected. Hooks never rewrite Claude's reviewed
arguments, so auto mode reviews the call that actually executes.
Legacy servers whose board schemas omit `currentSession` use the startup
receipt's `agent` name instead; those calls are never given undeclared fields.

Coverage is bounded by what Claude emits: private reasoning, opaque attachments,
and a process killed before a message's final chunk are not complete-message
guarantees. A queued receipt proves local capture; an upload receipt proves
storage; verify search separately. Consult `capabilities.json` for this version's
verified release status. Development builds must not complete capture setup.
