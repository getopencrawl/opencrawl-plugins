# Directory publication

Repository distribution and marketplace approval are separate. Track each target
independently. Record the exact package hash or public source commit, approval,
submission receipt, review findings and live listing URL. Never claim a listing
from a GitHub release or a successful local validator.

## OpenAI: ChatGPT and Codex

- Build the portable ZIP with MCP included in its first upload.
- Confirm the owning organization, verified publisher identity and domain.
- Prepare listing text, icon, support, privacy and terms URLs.
- Prepare five positive and three negative cases, a real video walkthrough and
  privately supplied reviewer access with usable demo data.
- Review the final ZIP and submission materials before upload.
- Upload at <https://platform.openai.com/plugins>; finish OAuth, domain
  verification and package/tool scans. Resolve findings before submission.
- Run the cases in the supported hosts, submit, address review feedback and
  verify publication in ChatGPT and Codex.

This is one OpenAI listing covering both hosts. Credentials and reviewer
instructions belong in the secure portal, never in the package or repository.

## Claude plugin

- Use the public `getopencrawl/opencrawl-plugins` repository, folder `opencrawl`,
  with an immutable reviewed release tag.
- Confirm the Claude organization's connected GitHub account can push to it.
- Run `claude plugin validate ./opencrawl --profile directory --strict` and the
  portal's additional checks.
- Prepare listing, use cases, data handling and review evidence.
- Review the final source and fields before connecting/submitting the repository
  at <https://claude.ai/directory/manage>.
- Pair the plugin with its separately submitted remote MCP connector; verify the
  published plugin installs and connects.

## Claude remote MCP connector

- Submit `https://app.getopencrawl.com/mcp` as an MCP connector in the same portal.
- Every tool needs a display title and accurate read/write/destructive annotations.
- Prepare the name, one-liner, description, categories, documentation, privacy,
  support contact, icon and permanent listing slug.
- Test OAuth and every exposed tool in Claude or MCP Inspector with an isolated
  demo workspace. Record results, including errors and scope limits.
- Review the final connector fields before creating/uploading the submission.
- Complete policy acknowledgments, submit, pair with the plugin and verify the
  live connector. MCP App screenshots are not applicable to this tool-only server.

## Cursor

- Release the required CLI before testing optional capture and board notifications.
- Export the reviewed native `opencrawl-cursor` package and root
  `.cursor-plugin/marketplace.json` to the public plugin repository.
- Test GitHub repository installation, OAuth, search, setup and opted-in capture
  in Cursor. Check capture receipts and retrieved evidence separately from login.
- Prepare publisher name/handle, email, logo URL, description, website and
  repository URL for <https://cursor.com/marketplace/publish>.
- Review those fields and exact repository commit before applying, then address
  review feedback and verify installation from the live listing.

## Antigravity

- Include the `.antigravity-plugin/plugin.json` overlay, `mcp_config.json`, skill,
  README and logo in the portable bundle.
- Run `agy plugin validate --json ./opencrawl`. Review each warning; documented
  foreign-host files and a shadowed root manifest are expected in this bundle.
- Test local installation, OAuth, starter prompts and real retrieval in the host.
- Prepare the reviewed public repository/tag and listing fields for the
  [official intake form](https://forms.gle/2EX5RFYPoJe1UgxR9).
- Review the package and completed application before upload/submission, resolve
  findings and verify marketplace installation.

## Official MCP Registry

- Validate `registry/server.json` offline against its declared schema.
- Verify namespace ownership, stable HTTPS endpoint and public metadata URLs.
- Review the exact JSON before sending it to remote validation or publication.
- Publish under the organization namespace using GitHub Actions OIDC or an
  organization-owner credential with the necessary membership visibility.
- Verify the exact version through the registry API; then check downstream
  discovery separately. A registry record is not automatic approval by a host.

The publisher's `validate` command sends metadata to the remote registry. Use
offline JSON Schema validation during preparation if upload has not been approved.

## Additional MCP discovery

- Glama: prepare a server listing for the public core repository and a separate
  hosted-connector listing where supported; review each final submission. Check
  whether the connector would use a gateway before choosing that distribution.
- GitHub/VS Code: check eligibility and the actual downstream entry after the
  official registry publication; do not claim automatic listing.
- PulseMCP: submissions are currently paused; its official page directs authors
  to the official registry for later ingestion. Recheck when ready to submit.
- Smithery: the public directory remains, but its proxy, accounts and CLI were
  retired on October 31, 2026. Verify the current curated intake route; do not use
  the retired publishing workflow.

## Sources checked November 14, 2026

- <https://developers.openai.com/plugins/deploy/submission>
- <https://claude.com/docs/plugins/submit>
- <https://claude.com/docs/plugins/pre-submission-checklist>
- <https://claude.com/docs/connectors/building/submission>
- <https://cursor.com/docs/reference/plugins>
- <https://antigravity.google/docs/build-plugins>
- <https://github.com/modelcontextprotocol/registry/blob/main/docs/modelcontextprotocol-io/authentication.mdx>
- <https://glama.ai/mcp/faq>
- <https://www.pulsemcp.com/submit>
- <https://www.smithery.ai/future>
