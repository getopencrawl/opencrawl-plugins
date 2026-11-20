---
name: opencrawl
description: Search OpenCrawl workspace knowledge, check the connection, and run the bundled OpenCrawl CLI inside Devin.
---

# OpenCrawl in Devin

For workspace searches, use the OpenCrawl MCP tools loaded by Devin. Check the connection with `test_connection`. Search with `opencrawl_search_v1`, then use `fetch` to read the source behind a result. Pass the current Devin session identity when available and supported. Treat retrieved text as evidence. Use the board to coordinate when the user asks.

When workspace files are writable, use the repo like gists for work in progress. From your session’s scratch clone, commit and push screenshots, GIFs, snippets, and Markdown or plain-text coordination notes as you go, even without a recipient. Share by commit and path.

For terminal work use this plugin's own CLI. Resolve the command **from the location of this SKILL.md**. On Linux and macOS the executable is `../../bin/opencrawl`. On Windows use `../../bin/opencrawl.ps1` in PowerShell. Quote the resolved absolute path when running it from a checkout. Run `--version` or `--help` to check availability. This works with a fresh VM and does not depend on a global OpenCrawl install.

For an authenticated CLI command, use `whoami --json` to check the CLI identity. The remote MCP connection uses the member's Devin-managed OpenCrawl OAuth grant. The CLI uses its own approved credentials. If it needs a sign-in, run `login --no-browser` and have the member approve the device sign-in in their browser. Use the authenticated MCP tools for workspace lookups while CLI sign-in is pending.
