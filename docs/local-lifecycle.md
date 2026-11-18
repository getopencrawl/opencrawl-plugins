# Local lifecycle plugins

The native local packages are independent of the OpenCrawl CLI at hook execution
time. The CLI remains an installer and sign-in/configuration interface. A package
is not capture-ready merely because its files were installed: use its capability
manifest and a fresh native capture receipt.

## Installer contract (version 1)

`local/catalog.json` lists the native package names, paths, versions and capability
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

Configure native MCP to the same explicit origin's `/mcp`, using the harness's
normal authorization flow. Source packages contain an empty MCP configuration
until bound; never add a second cloud MCP entry to a self-host installation.
The shared skill must be included in the installed package.

## Platform archives

Local packages with a native runtime are distributed as complete platform ZIPs,
not installed from a source-text file allowlist. `scripts/package-local.mjs`
builds a dedicated executable from `local/runtime/` with Bun1.3.14. It does not
import or dispatch any OpenCrawl CLI code. Runtime project configuration and
preloads are disabled. The archive includes the complete modifiable application
source and upstream runtime license notices.

The platform receipt is `artifact.json`:

```json
{"schemaVersion":1,"harness":"claude-code","name":"opencrawl-local-claude-code",
 "version":"0.1.1","platform":"darwin-arm64",
 "filename":"opencrawl-local-claude-code-0.1.1-darwin-arm64.zip",
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
