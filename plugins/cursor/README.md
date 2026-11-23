# OpenCrawl for Cursor

CLI-free lifecycle plugin for Cursor. Actual Cursor CLI 2026.11.17-f532c45 on
macOS arm64 passed native capture and MCP checks. Other packaged platforms pass
compiled protocol checks; IDE and other operating systems lack native acceptance.
Installation alone does not complete capture setup.

The bundled executable reads only the exact session JSONL announced by native
hooks and reconciles it with user/assistant callbacks. Exact child transcripts
under that parent's `subagents/` directory are drained at parent boundaries,
because native children can omit their own sessionEnd. Occurrence counts retain
separate identical replies. postToolUse callbacks supply tool inputs and outputs
that Cursor transcripts can omit. Referenced files and private model reasoning
are outside this collector. Callback replay is deduplicated when Cursor supplies
a stable prompt generation or tool ID; unidentified duplicate callbacks cannot
be distinguished from separate identical messages.

The installer binds an explicit API, profile, owner and capture mode. Existing
Cursor consent watermarks and the session lock remain compatible with the CLI
and daemon. If an old transcript has no verified boundary, the collector starts
at its current end. A replaced pre-consent prefix is never replayed. An 8MiB
record or state bound fails closed and leaves pending local evidence. Each pass
visits at most 64 direct children; attachment bytes and nested child trees are
outside this release's coverage.

SessionStart provides native identity for original MCP arguments. The search
guard covers only the two OpenCrawl search aliases because Cursor preToolUse
omits the MCP server namespace. It does not rewrite arguments or intercept
unrelated generic board names. Native workspace trust and tool approval remain
authoritative. SessionStart context reaches the first model invocation.

With suggestions enabled, the native beforeSubmitPrompt hook checks redacted
human prompts for relevant workspace history. Cursor Desktop 3.18.9 and newer
and interactive CLI builds dated 2026.11.22 or later can receive context before
the first response. On older hosts the plugin waits for a tool completion or
failure in the same generation. That fallback skips tool-free turns.

Some CLI modes omit the submit hook. The 2026.11.22 interactive CLI skips it
with only plugin hooks installed. A user or project submit hook already present
lets that CLI dispatch the plugin hook too. A missing submit event skips the
automatic check. Manual search remains available. Existing suggestion opt-outs
apply on every path.

Direct capture retains failed uploads for another hook. Optional daemon mode
uses the same plugin converter and hands the immutable queue to the existing
worker for durable upload. This preserves child capture without depending on the
older daemon's child-path parser. It does not install or start a daemon, or enroll
Cursor transcripts into continuous daemon tailing. Native plugin selection and
recording exclusions remain authoritative.

Build with Node24 and Bun1.3.14 using `node scripts/package.mjs cursor`.
Use the versioned release archive. The installer must configure the private
binding and mcp.json for the selected
server. The OpenCrawl CLI, Node and Bun are not runtime dependencies.
