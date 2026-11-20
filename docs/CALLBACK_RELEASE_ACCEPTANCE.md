# Callback release acceptance

Review date: November 20, 2026. Current decision: NO-GO for release or a real-world trial. Continue source review and isolated synthetic evaluation.

This record covers `callback-server.cjs` and its own bound data directory. It covers authenticated request intake, business answers, review/save/reopen, notes and statuses, JSON record export, contact restrictions and usage controls. Saving a request sends no message and books no appointment. Calling, SMS, calendar integration and delivery of a human handoff are not implemented release capabilities.

[Program setup and boundaries](PRODUCT_SEPARATION.md) · [Daily checklist](DAILY_QUALITY_CHECKLIST.md) · [Test milestones](TEST_MILESTONES.md) · [Detailed shared acceptance history](RELEASE_ACCEPTANCE.md)

## Evidence and open gates

PASS applies only to the named executed scope. [Run75](https://github.com/panelreply-business/panelreply-demo/actions/runs/44786004194) is a verified checkpoint, not completed platform or release acceptance:

- Branch head: `3bbb0528ba4487e0aa9b3298ad1b5d475939fe70`.
- Tested merge: `f314429a7470f17b69f841c3f41e490ba9d16806`.
- Source/test manifest SHA-256: `fbffb29fd99a316d26ab8247df3c2162ee6d84fe6c048e95c5dcb2b5c4f9db74`.

The [Linux Node/API/HTTP job](https://github.com/panelreply-business/panelreply-demo/actions/runs/44786004194/job/136460918652) passed 8,942 cases with no failures, skips, cancellations or infrastructure errors and `sourceChanged:false`. Excluding 79 evidence-harness cases leaves 8,863 product executions. These shared totals are not a callback-only count. The standalone 334-scenario evaluation overlaps Node coverage.

Selected callback journeys passed seven cases in each of Linux [Chromium](https://github.com/panelreply-business/panelreply-demo/actions/runs/44786004194/job/136460918934), [Firefox](https://github.com/panelreply-business/panelreply-demo/actions/runs/44786004194/job/136460919173) and [WebKit](https://github.com/panelreply-business/panelreply-demo/actions/runs/44786004194/job/136460919133): 21/21 executions, zero failures or skips. The two selected products together passed 42/42. [Windows WebKit static coverage](https://github.com/panelreply-business/panelreply-demo/actions/runs/44786004194/job/136460919002) passed 92/92. These results do not establish private Windows/macOS product workflows or actual Safari support.

[Mac WebKit static coverage](https://github.com/panelreply-business/panelreply-demo/actions/runs/44786004194/job/136460919199) passed 90 and failed two cases: keyboard focus on the root demo's `#call` (Simulate missed call) button, and undersized native selects in the marketing preview. The next candidate makes the root page's native Tab order explicit and corrects the select dimensions. Its Mac browser verification remains pending, so overall browser acceptance stays open. [Defect history and current scope](PRELAUNCH_DEFECTS.md) preserve the earlier run73/run74 failures. Portfolio aggregation and any replacement candidate's verification remain separate.

| ID | Gate | Result | Evidence and remaining requirement |
| --- | --- | --- | --- |
| CB-01 | Linux product boundary and configuration | PASS | Run75 includes the [boundary](../tests/product-boundaries.test.cjs) and [configuration](../tests/product-config.test.cjs) suites. Callback-only routes, fixed identity, distinct cookies, directory binding and no OCR-service startup are exercised on the committed checkpoint. |
| CB-02 | Synthetic parsing and conversation contracts | PASS | Run75 passes the 334 synthetic scenarios and the matrix and [name-grounding regressions](../tests/release-name-grounding.test.cjs). Apostrophes, field roles, clarification and rejection are exercised. Zero real-provider calls occurred. |
| CB-03 | Session, tenant, CSRF, version and retry behavior | PASS | Shared API and [release API matrix](../tests/release-api-matrix.test.cjs) pass in run75. Rejected operations preserve records. Delayed work rechecks authority. Selected-host behavior remains unverified. |
| CB-04 | Consent, STOP, safety holds and reviewed persistence | PASS | Run75 store/API/corpus and selected callback journeys pass. Restrictions survive the tested reset, retry, deletion and recovery paths. No unrestricted safety-language detection claim follows. |
| CB-05 | Controlled bound backup, restore and restart | PASS | Run75 includes [product recovery](../tests/product-backup.test.cjs), matching-product restore, fixed-entrypoint startup and the selected browser restart case. Source data remains intact. Restore strips sessions and disables copied passwords. Operator recovery sets a new password. This is controlled synthetic recovery, not hosted restart or offsite acceptance. |
| CB-06 | Complete planned browser/platform acceptance | FAIL | Mac WebKit has two static-client failures in run75. Corrections are prepared, with Mac CI verification pending. Rerun on the resulting source, then reconcile the complete required matrix. A passing selected callback journey does not erase these failures. |
| CB-06S | Selected callback UI on Linux | PASS | Seven cases per Chromium, Firefox and WebKit, 21/21 executions. The callback title/navigation correction, isolated routes, persistence, STOP and sign-out are exercised. |
| CB-06D | Actual Safari, physical devices and full assistive-technology use | NOT TESTED | Bundled WebKit and emulated viewports do not establish these behaviors. Physical keyboard, touch and device integration need their own evidence. |
| CB-07 | Actual provider/model compatibility | BLOCKED | Zero real-provider calls in current development evidence. Approve the provider, exact model, synthetic-data transfer, finite attempts, budget and evaluation window, then execute the [real-provider procedure](AI_PRELAUNCH.md#first-real-provider-evaluation-procedure). |
| CB-08 | Actual model quality, latency and cost bounds | BLOCKED | Measure extraction, corrections, context, approved answers, refusal/fallback behavior, timeouts and usage on the approved real model. Fake providers and a successful API smoke call do not establish this result. |
| CB-09 | Selected-host access, persistence and offsite recovery | BLOCKED | Select and approve a host and backup destination. Verify private access, recovery, secret custody, process restart and later-event reconciliation on that host. |
| CB-10 | Operations and real-world testing plan | BLOCKED | Define pricing and cost assumptions, support ownership, monitoring, incident response, retention, recovery objectives, rollback, participants, authorized data, success criteria and stop conditions. [Operations proposal](PRELAUNCH_OPERATIONS.md) is preparation, not execution. |
| CB-11 | Release decision | BLOCKED | Review all applicable gates and approve this program's exact scope and activation. Keep public suspensions and draft PR status until separately authorized. |

If the owner later chooses a deterministic-only callback release, record that scope explicitly and review the actual-model gates against that scope. Do not silently relabel the current untested AI offering as ready. The spreadsheet OCR failures are not callback release gates once separation is verified. Failures in shared authentication, storage or recovery still affect callback.

The [run75 HTTP workload](https://github.com/panelreply-business/panelreply-demo/actions/runs/44786004194/job/136460918928) passed nine workflow groups across 516 responses with zero unexpected errors. Its restart reopens the HTTP server and store in the same Node process. It does not establish host restart, failover or capacity. [Both public suspension guards](https://github.com/panelreply-business/panelreply-demo/actions/runs/44786004194/job/136460918896) passed. Three public application checks remain policy-BLOCKED.

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
