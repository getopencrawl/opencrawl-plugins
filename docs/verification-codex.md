# Codex lifecycle verification

Controlled native checks used Codex CLI 0.166.0 on macOS arm64. The complete
CI-built archive was installed through `codex plugin marketplace add` and
`codex plugin add` in a disposable SSD profile. Native hooks/list discovered
12 plugin hooks, all initially untrusted. An untrusted run captured nothing.
Execution tests used Codex's documented one-invocation option for already-vetted
hook sources; no operator config or persisted hook-trust setting was changed.
Native hook processes had only `/usr/bin:/bin` on PATH, without OpenCrawl CLI,
Node or Bun.

## Native evidence

- A real-provider preliminary probe confirmed Codex exposes user, intermediate,
  final and tool records through hook-readable transcripts. Session:
  `01a1ec3e-6187-78a1-88fc-e9330f6192e6`.
- The installed archive captured one user message, both assistant replies and
  actual shell input/output in `01a1ec46-3dca-72f2-86f8-8d62e7357dad`. All five
  became searchable through actual core ingestion, indexing and SQLite search.
- An earlier candidate injected `currentSession` in native MCP search session
  `01a1ec48-4a40-7c31-9a20-950cc70ab893`. The final contract instead requires the
  identity in original arguments, validates it, and leaves reviewed calls
  unchanged. Legacy board schemas pass through without an undeclared field.
- An opt-in context fixture marker reached the next native model request and
  its telemetry reached handoff. This checks delivery, not provider quality.
- Parent `01a1ec49-eb34-7111-a84d-5b4b5fe2da61` and native child
  `01a1ec49-eeec-7333-bffe-8330caf9f1e8` captured the child's user prompt,
  intermediate and final replies, plus tool input/output. The collector verified
  the native parent relation and stored the child under its own native ID.

Installed-plugin executions used a disposable model-protocol fixture, which
emitted predetermined messages and tool calls; Codex executed the real tools,
plugins and hooks. This avoided copying operator credentials or changing active
profiles. Core revision e1eceb842c4fbc40745a199e5f3d48a6797fea31 supplied actual
capture/board/MCP/index/search handlers with synthetic authentication, filesystem
object storage and in-memory board adapters. This is not a deployed cloud-stack
or live model-provider acceptance claim.

- Existing daemon 0.4.103 recovered session
  `01a1ec4a-cde8-7da1-ba53-958619fb99e1` after real HTTP 503 upload failures.
  Its queue remained durable after Codex exited; restoring the disposable service
  produced a stored receipt and searchable user, intermediate/final, tool input
  and output content without another hook. The queue emptied afterward.

## Runtime coverage

Source and compiled-executable tests run on macOS arm64/x64, Linux arm64/x64 and
Windows x64. They cover native session/header/parent validation, null transcript
paths resolved by announced ID only, repeated identical messages, partial lines,
queue retry, identity changes, revoked consent, project and parent exclusions,
credential refresh concurrency, native automation attribution, context replay
and superseded prompts. Compiled checks remove CLI/Node/Bun from PATH and reject
project preload injection.

Only macOS arm64 has native Codex acceptance here. The transcript JSONL format is
not a stable API: unknown storage or header formats fail closed and retain
checkpoints. Release notes identify the final exact archive and checksums.
