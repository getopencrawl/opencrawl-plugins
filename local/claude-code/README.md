# opencrawl-local-claude-code

The native lifecycle package registers sessions, captures conversation messages,
adds current-session identity to its own MCP calls, and delivers optional context
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
suggestions have a separate opt-in and bounded concurrency; superseded prompt
results are discarded. Native plugin trust and `disableAllHooks` remain effective.
No callback grants permission for a tool invocation.

Coverage is bounded by what Claude emits: private reasoning, opaque attachments,
and a process killed before a message's final chunk are not complete-message
guarantees. A queued receipt proves local capture; an upload receipt proves
storage; verify search separately. Consult `capabilities.json` for this version's
verified release status. Development builds must not complete capture setup.
