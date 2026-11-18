# opencrawl-local-cursor

Candidate CLI-free lifecycle plugin for Cursor. Not yet released or accepted in
a signed-in native Cursor run; capabilities.json deliberately reports capture
unverified. Source/protocol checks do not complete capture setup.

The bundled executable reads only the exact session JSONL announced by native
hooks and reconciles it with user/assistant callbacks. Occurrence counts retain
separate identical replies. postToolUse callbacks supply tool inputs and outputs
that Cursor transcripts can omit. Referenced files and private model reasoning
are outside this collector. Callback replay is deduplicated when Cursor supplies
a stable prompt generation or tool ID; unidentified duplicate callbacks cannot
be distinguished from separate identical messages.

The installer binds an explicit API, profile, owner and capture mode. Existing
Cursor consent watermarks and the session lock remain compatible with the CLI
and daemon. If an old transcript has no verified boundary, the collector starts
at its current end. A replaced pre-consent prefix is never replayed. An 8MiB
record or state bound fails closed and leaves pending local evidence.

SessionStart provides native identity for original MCP arguments. The search
guard covers only the two OpenCrawl search aliases because Cursor preToolUse
omits the MCP server namespace. It does not rewrite arguments or intercept
unrelated generic board names. Native permission behavior still requires actual
harness acceptance. Optional context uses beforeSubmitPrompt and also requires
native verification before being advertised as supported.

Direct capture retains failed uploads for another hook. Optional daemon mode
hands the bounded native callback to the existing worker, because some Cursor
content exists only in that callback. It does not install or start a daemon.
Native plugin and hook disablement must remain authoritative.

Build with Node24 and Bun1.3.14 using `node scripts/package-local.mjs cursor`.
Use release archives only once this candidate receives native acceptance. The
installer must configure the private binding and mcp.json for the selected
server. The OpenCrawl CLI, Node and Bun are not runtime dependencies.
