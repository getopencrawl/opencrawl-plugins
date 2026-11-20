# Authentication

Git marketplace packages connect to the hosted MCP endpoint at `https://app.getopencrawl.com/mcp`. Authorize it in the host's connection UI. Web clients can add the same URL directly. Authorization and credential persistence belong to each host.

Guided setup binds the installed package and its native MCP configuration to the selected API origin. Self-host installations use that origin's advertised authentication. The binding contains the profile and owner identifiers. Credentials stay in the enrolled profile. See [lifecycle configuration](lifecycle.md).

Use `node scripts/check-endpoint.mjs` for the hosted OAuth discovery check. To verify authorization, complete consent in the target client and call `test_connection`.
