# Callback release acceptance

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
