# PanelReply / Ringkeep

PanelReply is a software platform for electrical contractors. It combines customer-request management and panel-component review in one local, authenticated workspace. The existing intake and recovery work is preserved. The dual-product platform is being prepared in draft PR8 and has not been merged or deployed.

[Repository](https://github.com/panelreply-business/panelreply-demo) · [Draft platform PR8](https://github.com/panelreply-business/panelreply-demo/pull/8) · [Platform guide](docs/PLATFORM_DEVELOPMENT.md) · [Platform verification](docs/PLATFORM_VERIFICATION.md) · [Private workspace setup](docs/PRIVATE_WORKSPACE.md) · [Backup and recovery](docs/RECOVERY.md) · [Recovery verification](docs/RECOVERY_VERIFICATION.md)

## Current status

The required public state is suspended. The 2026-11-19 pre-launch audit found both Render services reporting active, contrary to that requirement. Auto-deploy and PR previews remain off. This configuration is a release blocker and needs owner-approved correction. No Render state was changed by this development session. Do not resume, deploy, republish or create a replacement public preview without separate owner approval.

Current pre-launch work and evidence: [Development progress](docs/DEVELOPMENT_PROGRESS.md) · [Release acceptance](docs/RELEASE_ACCEPTANCE.md) · [Operations and business proposal](docs/PRELAUNCH_OPERATIONS.md). The current application/test source at [17223d6](https://github.com/panelreply-business/panelreply-demo/commit/17223d6b972cc4bd3e58e9412964d237cbc0eeb9) passed 1,096 application checks with zero application failures in [run66](https://github.com/panelreply-business/panelreply-demo/actions/runs/44634698683): 645 Node/HTTP, 186 Chromium, 121 Firefox, 121 WebKit, 14 native OCR/resource and nine independent workbook-reader cases. The overall workflow remains FAIL because both suspension guards fail. The separate 310-image OCR benchmark has 57 nonexact cases. No real-model quality claim or release approval follows from these counts.

- Public static URL: https://panelreply-demo.onrender.com/
- Public server URL: https://panelreply-ai.onrender.com/
- The new workspace runs locally at `http://127.0.0.1:10001` after setup. It has no public URL.
- The private workspace has no active AI, calling, SMS or calendar integration.
- A customer pilot remains NO-GO until the remaining operational and integration gates are verified.

[Offline instruction and suspension evidence](docs/OFFLINE_MODE.md)

## Current development branch

Continue on `feature/interactive-dual-product-site`, the existing draft [PR8](https://github.com/panelreply-business/panelreply-demo/pull/8). Main remains the verified recovery release until the owner approves a merge.

The branch adds:

- A navy and blue marketing website in `design-preview/` with both products, a shared SVG identity and interactive synthetic demonstrations.
- A guided sample-label-to-parts walkthrough with Skip, reduced motion and preserved edits. It displays predetermined data and makes no live OCR claim.
- Product, feature, pricing-preparation, login-information, pilot-preparation and legal-review views without external submission or invented claims.
- A shared dashboard and navigation for requests, panel scanning, saved projects, exports, settings and account details.
- Authenticated panel projects with editable parts, quantities, source images, review status and saved CSV and XLSX exports.
- Private source-image storage in the existing SQLite database, with schema 1-to-schema 2 migration and recovery compatibility.
- Optional local Tesseract 5 text extraction with bounded native resources. All candidates require review. Missing values stay blank. The expanded synthetic benchmark still has nonexact cases.
- Provider-independent conversational assistance with strict field grounding, cancellation, error handling and synthetic integration tests. The concrete external transport remains disabled.
- Independent spreadsheet readback, concurrent database workers and a bounded backup/restore workload. See the current pre-launch evidence for limits.
- Browser checks at 360, 390, 430, 768, 1024 and 1440 px, plus failure, isolation and export regressions.

The earlier platform and redesign milestone passed 590 checks with zero failures in [run 61](https://github.com/panelreply-business/panelreply-demo/actions/runs/44535177854): 406 Node/HTTP, 175 Chromium and 9 native OCR cases. Three public application checks remain intentionally BLOCKED. [Full verification, corrected defects and reviewed screenshots](docs/PLATFORM_VERIFICATION.md). This completes the first development milestone on the draft branch, not commercial readiness. [Design system and interaction decisions](docs/DESIGN_SYSTEM.md). [Architecture, local setup, limits and remaining gates](docs/PLATFORM_DEVELOPMENT.md) · [OCR options and fixture measurements](docs/OCR_OPTIONS.md)

## Private workspace

The standalone workspace adds:

- Owner sign-in and session expiry, with no public signup or default account.
- Separate business profiles and requests. One business cannot read or edit another business's data.
- An inbox with search, status filters, request details, notes, conversation history and change records.
- SQLite records that survive reload and server restart when the same data directory is used.
- Eleven categories of business answers. Each answer must be confirmed before the preview uses it.
- A separate customer preview with structured review before Save request.
- Name, US callback number, electrical work, five-digit job ZIP, callback window and requested work date.
- Persistent phone opt-outs and safety holds that reset, START and status changes cannot remove.
- Duplicate prevention for save retries and version checks for conflicting edits.
- A JSON download of the signed-in business's saved profile, requests, conversations and change records.
- Encrypted local backups and restore into a new directory, with no active sessions or usable passwords restored.
- Operator password reset for an existing owner, with session revocation and protection against in-flight sign-in races.

[Current desktop inbox](docs/evidence/platform-intake-desktop.jpg) · [Current mobile inbox](docs/evidence/platform-intake-mobile.jpg) · [Panel workspace with CSV/XLSX](docs/evidence/prelaunch-panels-desktop.jpg) · [Dashboard](docs/evidence/platform-dashboard-1440.jpg) · [Historical recovery evidence](docs/RECOVERY_VERIFICATION.md)

The callback window describes when a customer wants a call. The requested work date describes when they want the work done. Neither reserves an appointment. Contact permission is recorded separately. Saving a request sends no message.

The default preview uses explicit field parsing and saved answers. The new provider-independent orchestrator and disabled Responses transport are tested with synthetic adapters. No real-provider call occurs in normal startup. See [AI boundary and quality limits](docs/AI_PRELAUNCH.md). Questions about hours, coverage or pricing must not overwrite the supplied job details. Unknown business facts stay unknown.

[Setup, behavior, limits and failure handling](docs/PRIVATE_WORKSPACE.md)

Record exports contain customer information and are separate from encrypted backup archives. A restored workspace requires an operator to reset each owner's password before sign-in. The source workspace remains unchanged. See the [recovery guide](docs/RECOVERY.md) for commands, failure cases and the restore drill.

## Run locally

Use Node.js 22.18 or later. No application packages or API keys are required for the private workspace.

Create a local owner using the stdin-only setup described in [Private workspace setup](docs/PRIVATE_WORKSPACE.md#local-setup). Keep its database outside the repository in an owner-only directory. No real account is bundled with the source.

Then start it:

```bash
WORKSPACE_DATA_DIR="$HOME/.local/share/panelreply" node workspace-server.cjs
```

Open http://127.0.0.1:10001/login. The entry point binds only to the loopback interface. It rejects a public origin.

The earlier static demo remains in `index.html`. The separate optional AI server remains in `server.cjs`. They are historical demo surfaces and do not use the private workspace database. Their required public state is suspended. The current configuration discrepancy is recorded above and in the progress report.

## Prior recovery verification

The recovery candidate passed 396 checks with zero failures in [CI run 44516705029](https://github.com/panelreply-business/panelreply-demo/actions/runs/44516705029): 291 Node/HTTP checks and 105 Chromium cases. This adds 83 test cases to the previous workspace baseline. Three public application checks remain BLOCKED by intentional suspension and are excluded from the pass count. The desktop and 360-pixel inbox/export captures were inspected from the passing run.

The CI workflow checks the generated demo and CSP, pure intake and answer logic, private authentication and SQLite storage, real HTTP routes, existing demo browser behavior and the private workspace through Chromium. It also exercises export downloads, encrypted restore into a fresh directory and password recovery. Synthetic fixtures are isolated from real customers. No provider calls or outbound messages are used.

The recurring audit continues to review code and CI, safe external GET checks and accessible Render state. Three application checks are intentionally BLOCKED under the offline policy. Separate GET-only guards check the required suspended responses and report FAIL if a service is active. They must never resume a service or silently treat an active service as acceptable.

[Recovery results and remaining gates](docs/RECOVERY_VERIFICATION.md) · [Prior workspace evidence](docs/PRIVATE_WORKSPACE_VERIFICATION.md)

## Next gates

- A hosted private-access plan with approved persistent storage, offsite backup and restore objectives, self-service account recovery and retention/deletion controls.
- Secure API-key choice and approved provider usage before live AI tests.
- A verified calendar integration before appointment confirmations.
- Approved contact and messaging integration before any live call, SMS, email or notification test.
- Owner approval before either public demo reopens or a new public preview is created.

No deployment or live integration is implied by merging code.

## Project history

Historical release records describe their status at the time. Both public demos were suspended afterward.

| Stage | Evidence |
| --- | --- |
| Dual-product platform development | [Draft PR8](https://github.com/panelreply-business/panelreply-demo/pull/8), [platform guide](docs/PLATFORM_DEVELOPMENT.md), [verification record](docs/PLATFORM_VERIFICATION.md) |
| Record export and local recovery | [PR7](https://github.com/panelreply-business/panelreply-demo/pull/7), [396-check run](https://github.com/panelreply-business/panelreply-demo/actions/runs/44516705029), [recovery record](docs/RECOVERY_VERIFICATION.md) |
| Local private workspace | [PR6](https://github.com/panelreply-business/panelreply-demo/pull/6), [313-check run](https://github.com/panelreply-business/panelreply-demo/actions/runs/44460885413), [workspace record](docs/PRIVATE_WORKSPACE_VERIFICATION.md) |
| Question answering | [PR4](https://github.com/panelreply-business/panelreply-demo/pull/4), [209-check run](https://github.com/panelreply-business/panelreply-demo/actions/runs/44452485870), [release record](docs/QUESTION_ANSWERS.md) |
| Public demos taken offline | [PR5](https://github.com/panelreply-business/panelreply-demo/pull/5), [offline CI](https://github.com/panelreply-business/panelreply-demo/actions/runs/44454520969), [offline record](docs/OFFLINE_MODE.md) |
| Optional AI server preparation | [PR3](https://github.com/panelreply-business/panelreply-demo/pull/3), [activation boundaries](docs/LIVE_AI_SETUP.md) |
| Static workspace redesign | [PR2](https://github.com/panelreply-business/panelreply-demo/pull/2), [release record](docs/WORKSPACE_REDESIGN.md) |

Other design records: [AI intake and appointment boundaries](docs/AI_INTAKE.md).
