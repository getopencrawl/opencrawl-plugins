# opencrawl-local-antigravity

CLI-free lifecycle capture for Antigravity 1.5.9 or later. Native hooks execute
`bin/opencrawl-hook` from the plugin root; the OpenCrawl CLI, Node and Bun are
not runtime dependencies. The CLI can install, bind and authenticate the plugin.

The collector reads only the exact native session path announced by a hook.
It captures complete user and visible assistant steps, separate tool inputs and
tool outputs from the native transcript. Stable step identities survive native
snapshot replacement and compaction. Incomplete steps retry at a later hook;
private model reasoning and attachment file bytes are not collected.

The private installer binding selects an explicit server, profile, owner and
capture mode. Recording consent and exclusions are checked before reading and
uploading. Existing sessions are forward-only from consent time. The configured
root can be the common `.gemini` root or a selected Antigravity surface root.
Configure this plugin's native MCP server in `mcp_config.json` to the same `/mcp`.

SessionStart supplies native identity to declare in original MCP arguments.
Hooks validate without rewriting or granting permission. Legacy board schemas
use their declared agent field. Unrelated MCP calls retain normal native policy.
Context suggestions default on for clients recording new sessions and delivered through PreInvocation.

Direct capture keeps failed uploads in the existing private queue for a later
hook. Optional daemon mode sends only native path/session notices to an existing
worker, which can keep uploading after the agent exits. This package does not
install or start a daemon. Native plugin/hook disablement remains authoritative.

Build with `node scripts/package-local.mjs antigravity` using Node24 and pinned
Bun1.3.14, or install a verified release archive. Development capabilities must
not complete capture setup. See capabilities.json for the verified platform
scope. Native snapshots above 64MiB or individual records above 8MiB are retained
locally and reported as pending reads rather than partially claimed complete.
