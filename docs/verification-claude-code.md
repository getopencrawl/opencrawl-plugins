# Claude Code lifecycle verification

Controlled native checks used Claude Code2.1.327 on macOS arm64, synthetic
messages, a disposable profile and a complete CI-built plugin archive. The hook
environment had `/usr/bin:/bin` as PATH: OpenCrawl CLI, Node and Bun were absent.
Operator hook settings and credentials were not replaced. Tests used the native
`--plugin-dir` mechanism; permanent installation belongs to the onboarding CLI's
separate acceptance check.

## Native behavior

- Direct capture: two user turns, four assistant text messages (both intermediate
  and final replies), two tool inputs and two tool outputs were stored and
  searchable. Session `903ba6ba-a889-471b-96cd-d7ddde34c505` used candidate980bd60.
- Child capture: Claude emits no MessageDisplay events for child agents.
  Candidatef3acd29 collected the announced child transcript, including its user
  prompt, intermediate reply, tool input/output and final reply, alongside the
  parent. Parent session `e422be3e-4303-462f-86f0-c88653b029f5`, child
  `a9022e0a26e31c321`.
- Registration: the actual core board bootstrap handler returned the native
  session and bound workspace; Claude received the startup context.
- Search identity: in session `1a697503-3f33-44d4-9772-00f450952b25`, the model
  supplied only a query. The actual MCP handler received the same native session
  in `currentSession` after PreToolUse. No permission override was returned.
- Context: that session received a synthetic suggestion, the model repeated its
  otherwise unprovided marker, and telemetry reached handoff. This proves native
  delivery against a protocol fixture, not a live context model/provider call.
- Native opt-out: `disableAllHooks: true` produced no hook invocations in session
  `a6568c39-8714-4ada-9739-a7809547e4a1`.
- Daemon handoff: existing daemon0.4.102 read only the newly enrolled session
  `a644bf9b-f2ee-47ec-9965-ad08102c9209`, retained its queue through HTTP503 upload
  failures, and uploaded/indexed it after Claude exited and service returned,
  without another hook. A fixture credential-schema error was corrected before
  exercising those real HTTP failures; it is not counted as outage evidence.

Capture/registration tests used actual core handlers and the actual indexer and
SQLite search at core revisione1eceb842c4fbc40745a199e5f3d48a6797fea31. Fixed
synthetic authentication, filesystem object storage and in-memory board state
were test adapters. These checks do not claim a deployed cloud-stack test.

## Runtime checks

CI runs source and compiled-executable checks on macOS arm64/x64, Linux arm64/x64
and Windows x64. Compiled checks remove CLI/Node/Bun from PATH and install a
hostile project preload to verify the executable ignores it. Runtime tests cover
chunk ordering/replay, identical separate messages, secret masking, queue retry,
owner changes, revoked consent, symlink exclusions, native path identity,
credential refresh concurrency, interrupted prompt publication, child paths,
multi-chunk transcript reads, context replay/capacity and superseded prompts.

Only macOS arm64 has actual native Claude acceptance evidence here. Other
platforms have native executable and protocol-fixture checks. Release assets
carry platform-specific checksums and complete modifiable runtime source.
