# PanelReply / Ringkeep

PanelReply is preparing two local programs for electrical contractors: callback request management and panel-component review with spreadsheet exports. Each program has its own entrypoint, data directory, session cookie and release decision. They share authentication, storage and recovery code in this repository. The work remains in draft PR8 and has not been merged or deployed. The combined workspace remains an internal integration harness.

[Repository](https://github.com/panelreply-business/panelreply-demo) · [Draft platform PR8](https://github.com/panelreply-business/panelreply-demo/pull/8) · [Platform guide](docs/PLATFORM_DEVELOPMENT.md) · [Platform verification](docs/PLATFORM_VERIFICATION.md) · [Private workspace setup](docs/PRIVATE_WORKSPACE.md) · [Backup and recovery](docs/RECOVERY.md) · [Recovery verification](docs/RECOVERY_VERIFICATION.md)

[Separate program setup](docs/PRODUCT_SEPARATION.md) · [Callback acceptance](docs/CALLBACK_RELEASE_ACCEPTANCE.md) · [Spreadsheet acceptance](docs/SPREADSHEET_RELEASE_ACCEPTANCE.md) · [Daily checklist](docs/DAILY_QUALITY_CHECKLIST.md) · [Test milestones](docs/TEST_MILESTONES.md)

Run daily checks through December 20, 2026, then review each program for real-world testing. December 31 is the first release target. The owner has not chosen which program releases first or the second release date. Test totals do not replace each program's quality and operating gates.

## November 23 development candidate

The current candidate adds callback scheduling and follow-up, schema-4 recovery, JSON record export v2, small-text OCR normalization and expanded Mac/Apple Silicon verification. [Scheduling workflow](docs/CALLBACK_SCHEDULING.md) · [Persistent continuation record](docs/AUTONOMOUS_CONTINUATION.md) · [Platform expansion](docs/PLATFORM_EXPANSION.md).

The local OCR corpus improved from 277/310 to 285/310 with small-text normalization, then to 289/310 with bounded pixel-based deskew. All prior exact images and expected blank fields remain intact. Twenty-one images remain nonexact. [Small-text evidence](docs/OCR_SMALL_TEXT_2026_11_23.md) · [Deskew evidence](docs/OCR_DESKEW_2026_11_23.md). Run81 verified 9,072 Linux Node/API/HTTP cases but retained browser failures and an unassigned ARM job. [Recorded failures and corrections](docs/evidence/callback-scheduling-run81.json). The repaired source requires fresh CI. Local results do not close physical devices, actual Safari/Excel, native isolation, real-model or operating requirements.

## Prior independent program checkpoint

The separate callback and spreadsheet programs passed [run76](https://github.com/panelreply-business/panelreply-demo/actions/runs/44788287151) on source `ca5f0cb`. All 30 automated platform requirements pass. The ledger records 24,372 product case/platform passes across 9,114 distinct cases, with no product failures or unresolved outcomes. It excludes harness checks and duplicate observations. [Final verification](docs/evidence/independent-products-verification.json) preserves source hashes, platform versions, per-product counts and artifact digests.

[Development progress](docs/DEVELOPMENT_PROGRESS.md) and the two product acceptance records contain the current decision. Seven platform scopes remain untested, so the full 10,000-test goal and conditional increase to 20,000 remain open. That historical checkpoint measured OCR quality at 277/310 and FAIL. Current measurements appear above. Required OCR isolation, actual-model, representative-photo, Excel and hosted-operation requirements remain open. Each program has its own release decision. Earlier failures remain in the [defect register](docs/PRELAUNCH_DEFECTS.md).

## Historical engineering remediation checkpoint

The earlier remediation preserves the website and existing private workspace. It adds 334 synthetic conversation scenarios, durable assistant usage accounting, safe record deletion, schema-3 recovery, measured OCR improvements and integration checks. [Remediation verification](docs/REMEDIATION_VERIFICATION.md) preserves that earlier source's evidence. [Usage and configuration](docs/ASSISTANT_USAGE.md) · [Deletion and retention](docs/DATA_LIFECYCLE.md).

The historical run66 results below remain preserved. They do not verify the newly changed code. Actual AI model quality, real-photograph accuracy and hosted operations remain separate gates.

## Current status

Both public Render services are suspended. After the November 19 audit found them active, the owner explicitly approved restoring suspension. Render confirmed the AI service suspended at 7:28:44 PM EST and the static service at 7:29:45 PM EST. The GET-only checks passed at 7:30 PM EST with HTTP 503, Render's owner-suspension message and no application markup from either URL. Auto-deploy and PR previews remain off. [Suspension evidence](docs/evidence/public-suspension-2026-11-19.json). Do not resume, deploy, republish or create a replacement public preview without separate owner approval.

Current evidence: [Development progress](docs/DEVELOPMENT_PROGRESS.md) · [Release acceptance](docs/RELEASE_ACCEPTANCE.md) · [Remediation verification](docs/REMEDIATION_VERIFICATION.md). Historical source [17223d6](https://github.com/panelreply-business/panelreply-demo/commit/17223d6b972cc4bd3e58e9412964d237cbc0eeb9) passed 1,096 application checks in [run66](https://github.com/panelreply-business/panelreply-demo/actions/runs/44634698683). Attempt 1 failed the two suspension guards. After separately approved suspension, attempt 2 reran only that job: two PASS, zero FAIL and three policy-BLOCKED checks. Its 1,096 application results carried forward without re-execution. That checkpoint measured 253/310 exact synthetic OCR images. Current remediation measurements and code verification are recorded separately above. No real-model quality claim or release approval follows from these counts.

- Public static URL: https://panelreply-demo.onrender.com/
- Public server URL: https://panelreply-ai.onrender.com/
- Callback runs locally at `http://127.0.0.1:10001`. Spreadsheet runs at `http://127.0.0.1:10002` after separate setup. Neither has a public URL.
- The private workspace has no active AI, calling, SMS or calendar integration.
- A customer pilot remains NO-GO until the remaining operational and integration gates are verified.

[Offline instruction and suspension evidence](docs/OFFLINE_MODE.md)

## Current development branch

Continue on `feature/interactive-dual-product-site`, the existing draft [PR8](https://github.com/panelreply-business/panelreply-demo/pull/8). Main remains the verified recovery release until the owner approves a merge.

The branch adds:

- A navy and blue marketing website in `design-preview/` with both products, a shared SVG identity and interactive synthetic demonstrations.
- A guided sample-label-to-parts walkthrough with Skip, reduced motion and preserved edits. It displays predetermined data and makes no live OCR claim.
- Product, feature, pricing-preparation, login-information, pilot-preparation and legal-review views without external submission or invented claims.
- Separate callback and spreadsheet navigation, with the historical shared dashboard retained only in the internal integration harness.
- Authenticated panel projects with editable parts, quantities, source images, review status and saved CSV and XLSX exports.
- Private source-image storage in the existing SQLite database, with transactional schema-1/2/3-to-4 startup migration and older-archive recovery compatibility.
- A callback queue with task scheduling, rescheduling, recorded outcomes, cancellation and follow-up. Contact restrictions and request/task versions are checked before changes.
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
- A version-2 JSON download of the signed-in business's saved profile, requests, callback tasks, conversations and change records.
- Encrypted local backups and restore into a new directory, with no active sessions or usable passwords restored.
- Operator password reset for an existing owner, with session revocation and protection against in-flight sign-in races.

[Current desktop inbox](docs/evidence/platform-intake-desktop.jpg) · [Current mobile inbox](docs/evidence/platform-intake-mobile.jpg) · [Panel workspace with CSV/XLSX](docs/evidence/prelaunch-panels-desktop.jpg) · [Dashboard](docs/evidence/platform-dashboard-1440.jpg) · [Historical recovery evidence](docs/RECOVERY_VERIFICATION.md)

The callback window describes when a customer wants a call. The requested work date describes when they want the work done. Neither reserves an appointment. Contact permission is recorded separately. Saving a request sends no message.

The default preview uses explicit field parsing and saved answers. The new provider-independent orchestrator and disabled Responses transport are tested with synthetic adapters. No real-provider call occurs in normal startup. See [AI boundary and quality limits](docs/AI_PRELAUNCH.md). Questions about hours, coverage or pricing must not overwrite the supplied job details. Unknown business facts stay unknown.

[Setup, behavior, limits and failure handling](docs/PRIVATE_WORKSPACE.md)

Record exports contain customer information and are separate from encrypted backup archives. A restored workspace requires an operator to reset each owner's password before sign-in. The source workspace remains unchanged. See the [recovery guide](docs/RECOVERY.md) for commands, failure cases and the restore drill.

## Run the separate programs locally

Use Node 24 for current release evidence. Private storage retains its Linux/POSIX permission requirements. No API key is needed for normal startup. Native OCR has its own local dependencies and acceptance gates.

Initialize fresh directories before creating accounts:

```bash
CALLBACK_DATA_DIR="$HOME/.local/share/panelreply-callback" node callback-server.cjs --init
SPREADSHEET_DATA_DIR="$HOME/.local/share/panelreply-spreadsheet" node spreadsheet-server.cjs --init
```

Create a separate owner in each initialized directory using the [stdin-only owner commands](docs/PRODUCT_SEPARATION.md#initialize-two-local-owners). No default account exists. Keep both directories outside the repository. Existing unmarked or other-product data is refused. Initialization does not migrate it.

Start each program in a separate terminal:

```bash
CALLBACK_DATA_DIR="$HOME/.local/share/panelreply-callback" node callback-server.cjs
```

```bash
SPREADSHEET_DATA_DIR="$HOME/.local/share/panelreply-spreadsheet" node spreadsheet-server.cjs
```

Open `http://127.0.0.1:10001/login` for callback and `http://127.0.0.1:10002/login` for spreadsheet. Both bind only to loopback. Configure another port with that program's `CALLBACK_PORT`/`CALLBACK_ORIGIN` or `SPREADSHEET_PORT`/`SPREADSHEET_ORIGIN`. Generic `PORT` and `WORKSPACE_*` variables do not configure the separated entrypoints.

Each server denies the other program's pages, scripts and APIs. Their cookies and data bindings remain distinct. Product backup/restore commands require matching `--product callback` or `--product spreadsheet`. See [product recovery](docs/PRODUCT_SEPARATION.md#data-binding-and-recovery).

### Internal combined integration harness

`workspace-server.cjs` is retained for historical combined tests, with a separate unbound synthetic database. It is not a product release entrypoint and refuses product-bound directories. Its legacy configuration remains:

```bash
WORKSPACE_DATA_DIR="$HOME/.local/share/panelreply-integration" node workspace-server.cjs
```

The historical [private workspace guide](docs/PRIVATE_WORKSPACE.md#local-setup) documents owner setup and `PORT`/`WORKSPACE_ORIGIN` for this harness. Its combined browser results do not substitute for the separate product journeys.

The earlier static demo remains in `index.html`. The separate optional AI server remains in `server.cjs`. They are historical demo surfaces and do not use the private workspace database. Their public state is suspended. The owner-approved correction and verification are recorded above and in the progress report.

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
