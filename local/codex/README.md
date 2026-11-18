# OpenCrawl local lifecycle for Codex

This complete local plugin runs its own fixed executable. OpenCrawl CLI, Node,
Bun and a daemon are not required in the hook environment. The CLI installs the
package, signs in and writes its explicit private binding. See the repository's
`docs/local-lifecycle.md` for the binding and archive contract.

Requires Codex 0.166.0 or later. Review and trust the installed hooks in Codex's
native hook settings. Installation does not grant trust. Native disabling and
managed-only policy remain authoritative; no installer should change them.

Direct mode reads only the native hook's announced transcript and children.
It queues all native user and assistant message records, including intermediate
replies, plus tool calls and results. Native system/developer instructions and
user-role setup blocks with explicit harness provenance are omitted. The native
JSONL transcript format is not a stable Codex API: incompatible storage/schema
fails closed with retained checkpoints. No global history scan is performed.

Each callback performs bounded work. Interrupted or offline uploads remain in
the private profile queue for a later hook, or the existing optional daemon.
The daemon is useful when a laptop loses connectivity after its last hook.
Selecting daemon mode does not install or start it. Exclusions and recording
consent are checked before capture and again before upload.

Context suggestions are separately opt-in. Search hooks only add the native
session identity to this installation's own same-origin MCP calls. Codex requires
`permissionDecision: allow` to rewrite arguments; ordinary tool permission checks
still apply. No PermissionRequest approval hook is installed.

This source folder is not a complete install until built. Run
`node scripts/package-local.mjs codex` with Node 24 and pinned Bun 1.3.14, or use
an official platform release archive. Source and runtime notices are included.
