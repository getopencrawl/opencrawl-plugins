# Local lifecycle plugins

The native local packages are independent of the OpenCrawl CLI at hook execution
time. The CLI remains an installer and sign-in/configuration interface. A package
is not capture-ready merely because its files were installed: use its capability
manifest and a fresh native capture receipt.

## Installer contract (version 1)

`catalog.json` lists the native package names, paths, versions and capability
files. Pin a reviewed repository commit or release checksum. Install the complete
package through the harness's supported plugin mechanism. Do not generate a
second set of user hooks or change native hook-trust policy.

Before activation, write `.opencrawl-binding.json` privately in the installed
package root. Its fields are:

```json
{
  "schemaVersion": 1,
  "client": "claude-code",
  "api": "https://your-opencrawl.example",
  "configHome": "/absolute/profile/base",
  "installationId": "the-existing-capture-installation-id",
  "owner": {"tenantId": "configured-tenant", "userId": "configured-owner"},
  "captureMode": "hook"
}
```

`configHome` has the same meaning as `OPENCRAWL_CONFIG_HOME`: existing enrollment
is in `configHome/opencrawl/capture/config.json`, and saved authentication is in
the same profile's origin-hashed session file. No credential belongs in the
plugin source, release archive, manifest or nonsecret binding. Hooks ignore
ambient OpenCrawl tokens and never fall back to a default account or cloud origin.
The enrollment must match the binding's origin, installation and owner on every
invocation, and must still select that harness. Saved exclusions and recording
opt-outs remain authoritative. Changing binding cannot redirect an old queue.

`captureMode` is `hook` for bounded collection/upload during hooks, or `daemon`
for durable local handoff to an already configured existing worker. Selecting
daemon mode does not install or start a daemon. The installer owns host
eligibility, daemon installation and the user's selection. A handoff receipt is
not an upload receipt; an upload receipt is not proof of search indexing.
Cursor converts native content in the standalone hook in both modes and hands
its immutable queue to the worker for durable upload. It does not enroll Cursor
child transcripts into the older worker's independent transcript reader.

In Replicas, the server-issued workspace owner selects workspace authentication
for both Claude Code and Codex. No extra binding setting is needed. At enrollment, get
a token from `/usr/local/bin/replicas identity token --audience <api-origin>`
and use the tenant and workload user returned by that origin's
`/api/sessions/identity` for both the binding and capture configuration.
Keep that token in memory. Each hook that needs a credential can mint a fresh
one. Queued batches remain bound to the original installation and workload.
The receiving API verifies the token and workspace connection on upload.
Human attribution, when available, is separate event metadata.

Configure native MCP to the same explicit origin's `/mcp`, using the harness's
normal authorization flow. Git installs include the hosted OAuth endpoint. A bound installation replaces it with the selected origin, including for self-host.
The shared skill must be included in the installed package.

## Platform archives

Local packages with a native runtime are distributed as complete platform ZIPs,
not installed from a source-text file allowlist. `scripts/package.mjs`
builds a dedicated executable from `runtime/` with Bun1.3.14. It does not
import or dispatch any OpenCrawl CLI code. Runtime project configuration and
preloads are disabled. The archive includes the complete modifiable application
source and upstream runtime license notices.

The platform receipt is `artifact.json`:

```json
{"schemaVersion":1,"harness":"claude-code","name":"opencrawl",
 "version":"0.3.0","platform":"darwin-arm64",
 "filename":"opencrawl-claude-code-0.3.0-darwin-arm64.zip",
 "sha256":"<archive SHA-256>","executable":"bin/opencrawl-hook",
 "source":["runtime/main.mjs"]}
```

Windows uses platform `win32-x64` and `bin/opencrawl-hook.exe`. Its archive
contains the native PowerShell hook commands; POSIX archives contain direct
executable commands. Preserve executable mode when extracting POSIX ZIPs. Reject
traversal, symlinks, duplicate paths, unlisted files and checksum mismatches.
No archive contains a binding or credentials. Release manifests must pin the
artifact URL/checksum and source commit; a moving branch or CI artifact is not a
production release. Do not install a development package over working capture.

## Capability and verification

`capabilities.json` describes implemented callbacks and capture coverage.
`status: "stub"` means the package is only an installer coordination point:
no capture, registration or context delivery is promised. Keep setup incomplete
for any requested capability that the package does not implement.

Acceptance requires a real installed plugin in the native harness, with the
OpenCrawl CLI unavailable to its hook process. Compare all user and visible
assistant messages, including intermediate and final replies, with native
evidence. Tool inputs and outputs are separate coverage tiers. Exercise native
trust/disable behavior, binding isolation, retries, duplicate invocations and the
selected daemon/direct mode before marking that harness supported. Cloud agent
probes do not count toward this local acceptance.

### Verifying ongoing capture in Replicas

Use the same Linux x64 Claude Code and Codex ZIPs as desktop setup. Verify the archive
and metadata digests, then unpack each package in the workspace-local marketplace.
Remove the oc-incognito, oc-private, opencrawl-private and oc-readonly skills
from the workspace copy. Clear its hosted MCP entry so Replicas retains its own
workspace-authenticated connection. The runtime enforces the workspace policy
from the enrolled owner. Use the enrolled owner and installation ID in
each private binding, with captureMode set to hook. Create that binding
after the workspace starts so each workspace uses its own identity.

Claude loads the packaged hooks directly. For a headless, admin-managed Codex
environment, render the same packaged definitions with absolute command paths:

```sh
node scripts/replicas-codex-policy.mjs "$UNPACKED_CODEX_PACKAGE" "$MANAGED_EXECUTABLE" "$BOUND_PLUGIN_ROOT" > managed-hooks.json
```

Install the verified executable at the root-owned managed path. Keep the private
binding and package metadata at the binding root. Add the rendered groups to
system Codex hooks. On an empty Linux workspace, the system file is
`/etc/codex/hooks.json`, owned by root. In the workspace-specific copy installed
as a skills and MCP plugin, set `hooks/hooks.json` to `{"hooks":{}}` after
rendering the managed definitions. This gives each callback one registration.
Preserve existing system groups and the original archive. Start a new managed
chat after setup.

For each of two successive turns in the same chat, ask for a visible sentence,
one shell `printf` call with a distinct marker, and a final sentence. Save
`replicas read WORKSPACE --chat CHAT --json` after each turn. Query
`opencrawl_search_v1` with the returned `thread_id` as `sessionId`, source
`sessions`, an empty query, oldest order, `groupBy: "none"`, `dedupe: false`
and `includeToolOutputs: true`. Save complete excerpts. Codex also needs the
matching native rollout for the tool wrapper and complete returned output.
Compare before sending the next turn.

```sh
node scripts/verify-replicas-chat.mjs claude.json indexed-claude.json "$WORKLOAD_USER_ID" "$INSTALLATION_ID"
node scripts/verify-replicas-chat.mjs codex.json indexed-codex.json "$WORKLOAD_USER_ID" "$INSTALLATION_ID" rollout.jsonl
```

#### Branch verification, November 18, 2026

A clean Replicas environment ran Claude Code 2.1.327 and Codex 0.167.0 against
the same workspace identity. With runtime source `f2ef1f6`, both matched five
content records after the first turn and ten after the second: two user
messages, four assistant messages including both pre-tool replies, two tool
inputs and two outputs per harness. The Linux x64 executable SHA-256 was
`07d006dd258963c77fa5e4fdc0e21818e3083d39514ae273631315e8b1e60347`.
A process-scoped connection outage in each packaged hook retained a single test
batch, and a later invocation received the matching upload receipt. Each queue
drained. Both managed chats ran without an OpenCrawl CLI or daemon.

At that revision, incognito could pause local capture while the receiver
rejected workspace erasure with HTTP 403. The current branch disables new
incognito requests on Replicas and respects pauses recorded by that earlier
revision. The verified content scope covers messages
and tool I/O. The test included a native Claude title and no provider sender
IDs or uploaded files. Codex platform titles, per-sender enrichment and stored
attachment bytes remain outside this proof.
