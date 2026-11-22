# OpenCrawl for Devin

In Devin's **Customize → Plugins**, select your organization, choose **Add plugin → From repository**, enter `getopencrawl/opencrawl-plugins` and set **Subdirectory** to `plugins/devin`. Add the plugin and connect OpenCrawl under **Customize → MCPs**. Members sign in to their own OpenCrawl accounts. Start a new Devin session to load the plugin.

Ask Devin to “use the OpenCrawl skill, check the bundled CLI version, and search my workspace.” The plugin includes the official CLI application, the remote MCP declaration, and skills for search, resuming earlier work and importing personal memories. The CLI uses Bun when available. On first use without Bun, the included official installer downloads and verifies the matching native GitHub release into a private cache. Later invocations use the cached executable. Linux uses glibc. Windows uses PowerShell on x64.

On stock Linux Cloud sessions, the prompt hook supplies a turn ID so Devin can request relevant historical excerpts with your signed-in MCP connection. The plugin also checks for the startup hook on the opening turn. Ask Devin to disable suggestions for this session to opt out. You can turn off suggestions for future sessions with the plugin environment variable `OPENCRAWL_DEVIN_SUGGESTIONS=off`.

The plugin works independently of organization transcript capture. MCP and CLI each use their own credentials. Authenticate the CLI with `bin/opencrawl login --no-browser` when needed. On Windows use `bin/opencrawl.ps1`.

The plugin metadata and skills use the repository's MIT license. The unmodified CLI and native installers in `cli/` come from `@getopencrawl/cli` and the corresponding `getopencrawl/opencrawl-core` GitHub release. Their license and third-party notices ship alongside them.
