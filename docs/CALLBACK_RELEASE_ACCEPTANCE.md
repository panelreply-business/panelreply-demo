# Callback release acceptance

Review date: November 20, 2026. Current decision: NO-GO for release or a real-world trial. Continue source review and isolated synthetic evaluation.

This record covers `callback-server.cjs` and its own bound data directory. It covers authenticated request intake, business answers, review/save/reopen, notes and statuses, JSON record export, contact restrictions and usage controls. Saving a request sends no message and books no appointment. Calling, SMS, calendar integration and delivery of a human handoff are not implemented release capabilities.

[Program setup and boundaries](PRODUCT_SEPARATION.md) · [Daily checklist](DAILY_QUALITY_CHECKLIST.md) · [Test milestones](TEST_MILESTONES.md) · [Detailed shared acceptance history](RELEASE_ACCEPTANCE.md)

## Evidence and open gates

PASS applies only to the named executed scope. Historical combined-platform evidence does not verify the new fixed entrypoint's committed browser/platform results. Focused test counts overlap the eventual full suite and are not added again.

| ID | Gate | Result | Evidence and remaining requirement |
| --- | --- | --- | --- |
| CB-01 | Local product boundary and configuration | PASS | [Boundary](../tests/product-boundaries.test.cjs) and [configuration](../tests/product-config.test.cjs) suites pass locally. Callback-only routes, fixed identity, distinct cookies, directory binding and no OCR-service startup are exercised. Final committed candidate evidence remains required. |
| CB-02 | Synthetic parsing and conversation contracts | PASS | [AI preparation](AI_PRELAUNCH.md) records 334 synthetic scenarios. New matrix and [name-grounding regressions](../tests/release-name-grounding.test.cjs) exercise apostrophes, field roles, clarification and rejection. This is synthetic evidence, not real-model accuracy. |
| CB-03 | Session, tenant, CSRF, version and retry behavior | PASS | Shared API and [release API matrix](../tests/release-api-matrix.test.cjs) pass locally after separation. Rejected operations preserve records. Delayed work rechecks authority. Selected-host behavior remains unverified. |
| CB-04 | Consent, STOP, safety holds and reviewed persistence | PASS | Existing store/API/corpus checks and the selected callback API lifecycle pass. Restrictions survive the tested reset, retry, deletion and recovery paths. No unrestricted safety-language detection claim follows. |
| CB-05 | Local bound backup, restore and restart | PASS | [Product recovery](../tests/product-backup.test.cjs) passes locally, including matching-product restore and fixed-entrypoint startup. Source data remains intact. Restored sessions and credentials stay disabled. |
| CB-06 | Complete committed-source platform and selected UI evidence | NOT TESTED | Publish and inspect the final candidate's required OS/runtime/browser/channel reports and callback journeys. Historical combined runs do not close this gate. Actual Safari and physical-device behavior require their own evidence. |
| CB-07 | Actual provider/model compatibility | BLOCKED | Zero real-provider calls in current development evidence. Approve the provider, exact model, synthetic-data transfer, finite attempts, budget and evaluation window, then execute the [real-provider procedure](AI_PRELAUNCH.md#first-real-provider-evaluation-procedure). |
| CB-08 | Actual model quality, latency and cost bounds | BLOCKED | Measure extraction, corrections, context, approved answers, refusal/fallback behavior, timeouts and usage on the approved real model. Fake providers and a successful API smoke call do not establish this result. |
| CB-09 | Selected-host access, persistence and offsite recovery | BLOCKED | Select and approve a host and backup destination. Verify private access, recovery, secret custody, process restart and later-event reconciliation on that host. |
| CB-10 | Operations and real-world testing plan | BLOCKED | Define pricing and cost assumptions, support ownership, monitoring, incident response, retention, recovery objectives, rollback, participants, authorized data, success criteria and stop conditions. [Operations proposal](PRELAUNCH_OPERATIONS.md) is preparation, not execution. |
| CB-11 | Release decision | BLOCKED | Review all applicable gates and approve this program's exact scope and activation. Keep public suspensions and draft PR status until separately authorized. |

If the owner later chooses a deterministic-only callback release, record that scope explicitly and review the actual-model gates against that scope. Do not silently relabel the current untested AI offering as ready. The spreadsheet OCR failures are not callback release gates once separation is verified. Failures in shared authentication, storage or recovery still affect callback.

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
