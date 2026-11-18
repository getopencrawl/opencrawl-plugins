# Antigravity lifecycle verification

Actual Antigravity CLI 1.5.9/1.5.10 checks ran on macOS arm64 in a disposable
workspace, using the CI-built standalone plugin at `.agents/plugins/` and
`/usr/bin:/bin` as PATH. Operator global plugins, capture hooks and credentials
were preserved. Only the disposable workspace plugin was bound to the fixture.

- Session `f0f81ff4-c8e5-438e-a617-05283838a3e0` captured and indexed all five
  expected records: user, intermediate/final assistant replies, tool input and
  tool output. Native snapshots use `transcript_full.jsonl`, not only the compact
  path illustrated in vendor documentation.
- Session `a0f0a8d7-82c3-47aa-8c6b-d149da77bb1a` called native MCP with its original
  `currentSession`. The normal interactive prompt granted this one read-only
  fixture call; no persistent permission or approval override was configured.
  An earlier unattended call was denied by native policy and is not counted as
  successful MCP acceptance. An initial interactive run selected the wrong
  project and was stopped; acceptance used the explicitly selected test project.
- Session `29861834-69e2-4418-a30a-bd8910a59d2e` repeated the otherwise unprovided
  context marker on the immediately following model invocation. Ephemeral
  suggestions are not guaranteed to remain available after an intervening tool.
- Parent `6c52725e-3ab0-4f6b-a98a-119e3670afce` spawned child
  `22a1bbcb-d3bc-4168-a33d-54377a1afa46`. The child's own native hooks captured its
  final visible assistant reply and tool inputs/outputs under its native ID.
  Its intermediate marker was a native messaging tool call, not a separate
  assistant text record. No filesystem enumeration enrolled unrelated sessions.
- Existing daemon 0.4.103 retained the complete marker set for session
  `b9feb04a-e088-4e03-87f6-4eb48764de0d` through actual fixture HTTP503 failures.
  After native exit, restoring the endpoint drained the queue and made the
  session searchable without another hook. The daemon used a separate disposable
  profile and was stopped after recovery.
- Native `enabled:false` on this plugin's hook group suppressed capture and
  indexing for completed session `bf926257-6ca0-4f99-99e7-71b3ab009792`.

Capture, indexing, SQLite search, board bootstrap and MCP used actual core
handlers at revision e1eceb842c4fbc40745a199e5f3d48a6797fea31, with synthetic
authentication, filesystem storage and board adapters. Context was a fixed
protocol fixture. This is not a deployed cloud-stack or provider-quality claim.

All five release platforms pass source and compiled-executable protocol checks.
Only macOS arm64 has actual native Antigravity CLI acceptance. App/IDE surfaces
and other operating systems have not received equivalent native acceptance.
Snapshot replacement, stable step identity, incomplete steps, forward consent,
repeated identical prompts, exact paths, MCP validation and daemon notice shape
have regression coverage. Private reasoning and attachment file bytes are outside
this release's capture coverage.
