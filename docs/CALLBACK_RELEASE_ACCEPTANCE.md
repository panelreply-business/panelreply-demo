# Callback release acceptance

## November 23 reflow and mobile verification

Final run86 on `13b8741` passes all six selected callback suites, 15/15 each, including Linux/Intel Mac WebKit at 320px with doubled text, request-control bounds, unsaved-task discard and native keyboard focus. Both emulated mobile engines pass the shared 40-method and fixed-callback 12-method suites. This verifies the scoped reflow/focus and completed-save/reopen repairs without browser-error suppression. It does not establish physical-device acceptance. [Final evidence](evidence/callback-scheduling-run86.json).

Native Safari passes intake/status/persistence/sign-out but fails both scheduling methods on empty datetime control values. The next repair uses observed native segmented keyboard entry, trusted input/change events and exact value checks while retaining local/UTC/timezone, persistence, contact-hold and follow-up assertions. Its nine harness checks are not native execution. [Repair](NATIVE_SAFARI_INPUT_REPAIR_2026_11_23.md).

The shared next-manifest local run passes 9,233 checks, including 9,086 product and 147 excluded harness cases. These are not callback-only totals. Native Safari, private Windows, remaining platforms and applicable provider/host/operating requirements remain open. CB-12 and the independent release decision remain incomplete. [Local record](evidence/native-boundaries-local-2026-11-23.json).

## November 23 first native Safari callback execution

Run86 on `13b8741` starts the installed Safari session with verified browser/driver/host identity. Intake, status persistence and sign-out pass. Both scheduling-related methods fail because the test's native ISO typing leaves the datetime-local field empty. Native keyboard/control behavior requires investigation while exact local/UTC/timezone and persistence requirements remain. [Source-bound native evidence](evidence/native-safari-run86.json).

The Windows component remains outside the callback product. Eight local component-evidence checks do not establish native storage, SQLite sidecars, callback journeys or private Windows support. [Component scope](WINDOWS_NATIVE_COMPONENT_2026_11_23.md). CB-12 and the independent release decision remain open.

## November 23 request snapshot and browser correction

Eight new regressions verify one read snapshot for request state and conversation history under real concurrent update, delete, STOP and safety-hold commits. List reads stay coherent across requests. Existing caller transactions remain open. Fresh task writes still reject stale versions and current contact restrictions. [Callback evidence](CALLBACK_READ_SNAPSHOT_2026_11_23.md). The shared final local regression passes 9,217 checks, including 9,071 product cases and 146 excluded harness checks. This is not callback-only credit. [Local record](evidence/snapshot-layout-local-2026-11-23.json).

Run85 preserves six selected-callback failures: five focus probes on intentionally disabled fields and genuine Linux WebKit 521px overflow. One shared mobile callback journey also records a task-read page error. Three installed-Safari callback methods never start because the desktop request includes an iOS-only capability. [Final verified evidence](evidence/callback-scheduling-run85.json).

The next candidate corrects the closed-control layout and keyboard outline, performs focus checks after draft discard, synchronizes the completed save/reopen view and submits an exact native desktop Safari request. Every original browser/error and native-identity requirement remains. CB-12, native/physical platforms, provider/host/operating requirements and the separate callback release decision remain incomplete until their own evidence passes.

## November 23 native-browser candidate

Run84 on `7a0a93a` passes private WebKit recovery (132/132 methods) but retains both selected callback WebKit enlarged-text failures (14/15 each). New geometry identifies the permission control's own overflowing contents and an off-screen Refresh button. The candidate repairs those boundaries while retaining 200% text, 320px width, keyboard and unsaved-draft requirements. Actual browser acceptance is pending. [Evidence and repair](CALLBACK_REFLOW_2026_11_23.md).

Three new fixed-callback journeys target installed Safari with observed native identity and source-bound results. No Safari product execution has run locally and the manual Safari gate remains. The shared local regression passes 9,202 checks, including 9,056 product cases and 146 excluded harness checks. [Native scope](NATIVE_SAFARI_SCOPE.md) and [local evidence](evidence/safari-reflow-local-2026-11-23.json).

CB-12, the full platform goal and the separate callback trial/release decision remain incomplete. ARM assignment, native Windows, physical devices, applicable provider and operating gates remain open.

## November 23 current callback checkpoint

[Run83](evidence/callback-scheduling-run83.json) verifies all 24 fixed callback touch executions on source `1b35490`. Chromium and Firefox selected callback suites pass 15/15 on Linux and Intel Mac. Both selected WebKit suites pass 14/15 and fail the 320px doubled-text reflow requirement. The final callback ledger is 10,623 PASS and two FAIL across 3,460 distinct cases; shared cases remain counted once separately. One shared private WebKit recovery navigation error also remains recorded. Touch emulation does not establish physical devices.

The next candidate rejects malformed text before storage, preflights request/restriction clocks and revisions, preserves atomic STOP/safety writes and migration preflight, and corrects shared session/profile invariants. The complete integrated local run passes 9,192 cases, of which 9,056 are product executions and 136 are excluded harness checks. This is a shared local total, not callback-only credit. [Integrity evidence](evidence/integrity-local-2026-11-23.json) and [request contract](CALLBACK_REQUEST_INTEGRITY.md).

A native-control/grid sizing correction retains actual 200% root/body/control font and overflow assertions. Recovery now synchronizes the real UI logout before credential rejection. These browser repairs still need committed-source CI. CB-12 and the automated-platform gate remain incomplete on the changed source. The historical PASS rows below apply only to their named checkpoints.

Actual-provider, actual/physical-platform, native Windows, selected-host/offsite recovery and operating gates remain open. No trial or release is approved. [Persistent next steps](AUTONOMOUS_CONTINUATION.md).

## November 23 touch and accounting checkpoint

Callback scheduling remains implemented in its fixed product. The next candidate adds 24 prospective engine/profile touch executions, with separate product-bound reports and trusted touch evidence. Local collection executes none of them. The complete integrated Node/API/HTTP candidate passes 9,123 checks, with 8,987 product executions after excluding 136 evidence-tooling checks. The historical 9,000 product figure included 13 helper checks now excluded. [Local record](evidence/mobile-metadata-local-2026-11-23.json) and [touch scope](CALLBACK_MOBILE_VERIFICATION.md).

Run82 verifies the committed sidebar/sign-out correction and both existing 40-method mobile suites. Completed selected callback suites pass 14/15 with the same font-scaling helper assertion. The candidate fixes the calculation while retaining 200% root/body and reflow requirements; its actual browser result remains pending. [CI snapshot](evidence/callback-scheduling-run82.json). Other-platform, actual-provider, host/offsite recovery and operating gates remain open. No trial or release is approved.

A subsequent audit reproduced silent replacement of malformed UTF-16 in business names and request transcripts. A shared-validator repair with store/API/recovery regressions is in progress and is not included in this candidate.


## November 23 continued verification

Run81 executes the new scheduling source and passes the full Linux Node/API/HTTP scope. The selected callback suites run all 15 methods on Linux and Intel Mac Chromium/Firefox/WebKit. They retain failures from the inline 200% font injection and WebKit optional capture under strict CSP. The mobile Chromium suite also reproduces a real tablet sign-out reachability defect. The next candidate repairs those issues without relaxing CSP, console checks, keyboard or geometry assertions. It also aligns named-zone validation between the form and server. Fresh corrected-source browser evidence is required before CB-12 passes. [Run81 record](evidence/callback-scheduling-run81.json).

The resource candidate preserves queue contact/tenant checks and encrypted recovery at 2,000 tasks/20,000 operations while removing repeated history reads and ledger scans. [Measured scope](CALLBACK_RESOURCE_VERIFICATION.md). These synthetic observations do not establish selected-host capacity.

The queued Apple Silicon job has no runner or executed tests. Real-provider, actual/physical-platform and operating gates remain separate. This source is not ready for a customer trial or release.

## November 23 scheduling candidate

The active development candidate adds operator-controlled scheduling, a due/overdue queue, recorded outcomes, cancellation and follow-ups. It includes schema-4 persistence/recovery and JSON export v2. [Workflow, boundaries and verification contract](CALLBACK_SCHEDULING.md). The existing requested callback/work dates remain preferences. No call, message or work appointment is initiated.

New requirement CB-12: the complete schedule → reschedule → outcome → follow-up → restart workflow must pass on the claimed product platforms. Contact restrictions, UTC/clock-change handling, version conflicts, unknown-response retries, accessibility, export, deletion and encrypted recovery are part of that gate. Local backend/API and client-state cases pass their named scopes. Committed browser/expanded-platform verification is pending. Historical run76 passes below do not verify this changed source.

The real-model, physical/actual-platform, chosen-host, recovery and operating requirements remain open. The program remains NO-GO for a customer trial or release. [Persistent continuation and exact next steps](AUTONOMOUS_CONTINUATION.md).

## November 23 daily check

Callback entrypoint, dedicated cookie/store marker, other-product route denial and product-bound encrypted recovery remain implemented with no code changes since tested `ca5f0cb`. Last full [PR8 run76](https://github.com/panelreply-business/panelreply-demo/actions/runs/44788287151): 3,321 distinct callback cases and 10,351 passing case/platform executions, plus shared cases counted once; selected Linux Chromium, Firefox and WebKit journeys passed 21/21. No fresh PR run today (**BLOCKED**). [Main run79](https://github.com/panelreply-business/panelreply-demo/actions/runs/45194906999) does not test this application. Actual-model evaluation remains BLOCKED (zero real calls), seven platform scopes NOT TESTED, and selected-host/offsite recovery and operational decisions remain open. **GO for isolated synthetic review; NO-GO for customer trial or release.** [Daily evidence](evidence/daily-audit-2026-11-23.json).


## November 22 daily check

Current callback program source remains tested `ca5f0cb` (docs-only branch head `bc86e8e1`). The last exact-source evidence is [run76](https://github.com/panelreply-business/panelreply-demo/actions/runs/44788287151): **3,321 distinct callback cases, 10,351 passing case/platform executions**, and 21/21 selected callback browser journeys on Linux Chromium, Firefox and WebKit. Another 1,675 distinct shared cases (2,185 passes) are counted once in portfolio totals. Separate fixed entrypoint, data/session/product-route boundary and bound backup/restore were inspected in unchanged code. No fresh callback execution today: **BLOCKED** by runtime/checkout/full-dispatch limits. Today's [main run78](https://github.com/panelreply-business/panelreply-demo/actions/runs/45030730688) does not test this PR. Real-model quality, actual/physical platforms, chosen host/offsite recovery and operating approvals remain **BLOCKED or NOT TESTED**. **NO-GO for human trial/release**. [November 22 daily evidence](evidence/daily-audit-2026-11-22.json).

## November 21 daily check

The fixed callback entrypoint, product-only routes, separate cookie/data binding and encrypted product restore remain implemented in the unchanged tested source `ca5f0cb`. Last verified product ledger: 3,321 distinct callback cases, 10,351 case/platform passes, plus 1,675 distinct shared cases counted once (2,185 shared executions). Seven selected callback journeys per Linux Chromium, Firefox and WebKit passed in run76. No fresh callback regression executed today (environment and full-matrix dispatch BLOCKED). The November 21 scheduled main run77 does not test callback's unmerged source. Real-model quality, seven manual platform scopes, selected-host/offsite recovery and operating approvals remain open. NO-GO for human trial/release. [Daily audit](evidence/daily-audit-2026-11-21.json).


Review date: November 20, 2026. Current decision: NO-GO for release or a real-world trial. Continue source review and isolated synthetic evaluation.

This record covers `callback-server.cjs` and its own bound data directory. It covers authenticated request intake, business answers, review/save/reopen, notes and statuses, JSON record export, contact restrictions and usage controls. Saving a request sends no message and books no appointment. Calling, SMS, calendar integration and delivery of a human handoff are not implemented release capabilities.

[Program setup and boundaries](PRODUCT_SEPARATION.md) · [Daily checklist](DAILY_QUALITY_CHECKLIST.md) · [Test milestones](TEST_MILESTONES.md) · [Detailed shared acceptance history](RELEASE_ACCEPTANCE.md)

## Evidence and open gates

PASS applies only to the named executed scope. [Run76](https://github.com/panelreply-business/panelreply-demo/actions/runs/44788287151) is a verified checkpoint, not completed platform or release acceptance:

- Branch head: `ca5f0cbfbf0d23cc20e007018c13cc630fb8f42a`.
- Tested merge: `7a9b95ac3d36ff238ef49b036457e4d00e77a972`.
- Source/test manifest SHA-256: `823418de33d6f2d166d6aae9013f6b3baf2ca43ecd1286bed76b5e81bb218e81`.

The [Linux Node/API/HTTP job](https://github.com/panelreply-business/panelreply-demo/actions/runs/44788287151/job/136468890829) passed 8,942 cases with no failures, skips, cancellations or infrastructure errors and `sourceChanged:false`. Excluding 79 evidence-harness cases leaves 8,863 product executions. These shared totals are not a callback-only count. The standalone 334-scenario evaluation overlaps Node coverage.

Selected callback journeys passed seven cases in each of Linux [Chromium](https://github.com/panelreply-business/panelreply-demo/actions/runs/44788287151/job/136468891217), [Firefox](https://github.com/panelreply-business/panelreply-demo/actions/runs/44788287151/job/136468891125) and [WebKit](https://github.com/panelreply-business/panelreply-demo/actions/runs/44788287151/job/136468890861): 21/21 executions, zero failures or skips. The two selected products together passed 42/42. [Windows WebKit static coverage](https://github.com/panelreply-business/panelreply-demo/actions/runs/44788287151/job/136468891533) passed 92/92. These results do not establish private Windows/macOS product workflows or actual Safari support.

[Run75 Mac WebKit](https://github.com/panelreply-business/panelreply-demo/actions/runs/44786004194/job/136460919199) had 90 passes and two failures: native Tab did not focus the root demo's `#call` (Simulate missed call) button, and marketing-preview selects measured below 44 px. [Run76 Mac WebKit](https://github.com/panelreply-business/panelreply-demo/actions/runs/44788287151/job/136468891138) passes 92/92 with the root-page Tab-order and select-size corrections. The keyboard and geometry requirements remain. [Defect history](PRELAUNCH_DEFECTS.md) preserves run73/run74/run75 results.

Seven required platform scopes remain NOT TESTED under the [milestone policy](test-milestones.json): actual macOS Safari, physical iPhone Safari, physical iPad Safari, physical Android Chrome, private product workflows on Windows, private product workflows on macOS, and Apple silicon macOS. Automated passes do not close these scopes.

| ID | Gate | Result | Evidence and remaining requirement |
| --- | --- | --- | --- |
| CB-01 | Linux product boundary and configuration | PASS | Run76 includes the [boundary](../tests/product-boundaries.test.cjs) and [configuration](../tests/product-config.test.cjs) suites. Callback-only routes, fixed identity, distinct cookies, directory binding and no OCR-service startup are exercised on the committed checkpoint. |
| CB-02 | Synthetic parsing and conversation contracts | PASS | Run76 passes the 334 synthetic scenarios and the matrix and [name-grounding regressions](../tests/release-name-grounding.test.cjs). Apostrophes, field roles, clarification and rejection are exercised. Zero real-provider calls occurred. |
| CB-03 | Session, tenant, CSRF, version and retry behavior | PASS | Shared API and [release API matrix](../tests/release-api-matrix.test.cjs) pass in run76. Rejected operations preserve records. Delayed work rechecks authority. Selected-host behavior remains unverified. |
| CB-04 | Consent, STOP, safety holds and reviewed persistence | PASS | Run76 store/API/corpus and selected callback journeys pass. Restrictions survive the tested reset, retry, deletion and recovery paths. No unrestricted safety-language detection claim follows. |
| CB-05 | Controlled bound backup, restore and restart | PASS | Run76 includes [product recovery](../tests/product-backup.test.cjs), matching-product restore, fixed-entrypoint startup and the selected browser restart case. Source data remains intact. Restore strips sessions and disables copied passwords. Operator recovery sets a new password. This is controlled synthetic recovery, not hosted restart or offsite acceptance. |
| CB-06 | Complete required platform acceptance | NOT TESTED | Seven required platform scopes above lack executed evidence. Browser emulation, bundled WebKit and Intel Mac passes do not establish those scopes. |
| CB-06A | Automated platform matrix | PASS | All 30 automated requirements pass in [run76 accounting](https://github.com/panelreply-business/panelreply-demo/actions/runs/44788287151/job/136478385752), with clean reports tied to the tested source. This includes the Mac corrections and all six selected-product jobs. The seven untested platform scopes remain separate. |
| CB-06S | Selected callback UI on Linux | PASS | Seven cases per Chromium, Firefox and WebKit, 21/21 executions. The callback title/navigation correction, isolated routes, persistence, STOP and sign-out are exercised. |
| CB-06D | Actual Safari, physical devices and full assistive-technology use | NOT TESTED | Bundled WebKit and emulated viewports do not establish these behaviors. Physical keyboard, touch and device integration need their own evidence. |
| CB-07 | Actual provider/model compatibility | BLOCKED | Zero real-provider calls in current development evidence. Approve the provider, exact model, synthetic-data transfer, finite attempts, budget and evaluation window, then execute the [real-provider procedure](AI_PRELAUNCH.md#first-real-provider-evaluation-procedure). |
| CB-08 | Actual model quality, latency and cost bounds | BLOCKED | Measure extraction, corrections, context, approved answers, refusal/fallback behavior, timeouts and usage on the approved real model. Fake providers and a successful API smoke call do not establish this result. |
| CB-09 | Selected-host access, persistence and offsite recovery | BLOCKED | Select and approve a host and backup destination. Verify private access, recovery, secret custody, process restart and later-event reconciliation on that host. |
| CB-10 | Operations and real-world testing plan | BLOCKED | Define pricing and cost assumptions, support ownership, monitoring, incident response, retention, recovery objectives, rollback, participants, authorized data, success criteria and stop conditions. [Operations proposal](PRELAUNCH_OPERATIONS.md) is preparation, not execution. |
| CB-11 | Release decision | BLOCKED | Review all applicable gates and approve this program's exact scope and activation. Keep public suspensions and draft PR status until separately authorized. |

If the owner later chooses a deterministic-only callback release, record that scope explicitly and review the actual-model gates against that scope. Do not silently relabel the current untested AI offering as ready. The spreadsheet OCR failures are not callback release gates once separation is verified. Failures in shared authentication, storage or recovery still affect callback.

The [run76 HTTP workload](https://github.com/panelreply-business/panelreply-demo/actions/runs/44788287151/job/136468890517) passed nine workflow groups across 516 responses with zero unexpected errors. Its restart reopens the HTTP server and store in the same Node process. It does not establish host restart, failover or capacity. [Both public suspension guards](https://github.com/panelreply-business/panelreply-demo/actions/runs/44788287151/job/136468890923) passed. Three public application checks remain policy-BLOCKED.

## Required workflow evidence

- Sign in and verify the callback product and cookie. Reject spreadsheet pages, scripts, project APIs and OCR routes.
- Collect bundled and multi-turn details, preserve prior context, and distinguish customer names and job ZIPs from equipment, business or project labels.
- Handle explicit corrections, negation, ambiguity, conflicts and stale business facts without inventing values.
- Review, save, reopen, edit notes/status, export JSON and restart with unchanged saved values.
- Preserve contact permission, STOP/opt-outs and safety holds through retries, new sessions, deletion and restored snapshots. Reconcile events newer than the snapshot before reopening access.
- Reject cross-business access, stale versions, changed retry payloads, expired sessions and revoked in-flight work without unintended writes.
- Exercise interrupted replies, timeout/cancellation, malformed provider output, durable allowances and accessible error recovery.

The selected browser cases are in [product_browser_test.py](../tests/product_browser_test.py). Physical phones, actual Safari, live calls/messages and calendar booking must not be inferred from browser emulation or deterministic intake tests.

## Schedule and release review

Run the daily checklist through December 20, 2026. At that review, prepare a callback-only real-world test plan with the exact build, participants, tasks, data, hosting/provider requirements, budget, support owner and recovery procedure. Start only when the required technical gates and owner approvals are met.

December 31 is the target for the first program release. The owner has not selected the first program or the second release date. A callback release decision must stand on its own evidence. The portfolio's 10,000-test target and conditional 20,000 target do not replace these gates or authorize external activity.
