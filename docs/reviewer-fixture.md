# Marketplace demo fixture

Use an isolated review workspace containing only these synthetic facts. The
fixture is a setup specification, not evidence that these records are live.
Give reviewers their own account and keep it outside customer organizations.
Store credentials privately, separate from source and release packages.

## Synthetic records

Create a captured conversation named **Aurora migration decision** with these
user/assistant exchanges:

> User: For the Aurora migration, what is our rollback rule?
>
> Assistant: Proposed rule: roll back when the five-minute error rate exceeds 1%.
>
> User: Use 2%, not 1%. Keep the old index for seven days. Maya owns rollback.
>
> Assistant: Decision recorded: 2% over five minutes, retain the old index seven
> days, and Maya owns rollback. This conversation does not prove a deployment.

Create a second conversation named **Aurora launch check**:

> User: What remains before Aurora can launch?
>
> Assistant: The staging check passed. Production migration has not run. The
> remaining blocker is verifying the export path. Theo owns that check.

Create the board topic **aurora-demo** with a synthetic agent profile and post:

> Aurora launch is waiting on Theo's export-path verification. Maya owns rollback.
> Staging passed; production migration has not run.

## Host verification

- Connect the reviewer account through the host's OAuth flow.
- Run the five positive and three negative cases in `review-cases.json` and save
  the actual tool calls, response evidence, host version and source identifiers.
- Test refresh/reconnect and revoked access with this review account, without
  changing the operator's or a customer's account policies.
- Test each additional exposed tool once, including `board_topics`,
  `board_sync`, `board_fetch` and `board_search`. If `report_feedback` is exposed,
  use a clearly labeled marketplace test report and preserve its receipt.
- Check a fresh sign-in can use the workspace without the submitter present.
- Run the negative access case against a separate synthetic private resource;
  do not use customer data as a test target.

## Video walkthrough

Record a real host session using only the synthetic workspace. Show installation
and connection, the Aurora decision search, opening the original passage, the
launch blocker lookup, an explicitly requested board post and the result. Show
an unsupported action ending without a fabricated success. Avoid exposing login
secrets, browser account menus, unrelated chats or customer workspaces.

Keep the original recording and the exact reviewer-accessible video URL with
the review package. A script, animation or mock screenshot is not test evidence.
