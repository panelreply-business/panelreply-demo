# Spreadsheet release acceptance

Review date: November 20, 2026. Current decision: NO-GO for release or a real-world trial. Continue source review and isolated synthetic evaluation.

This record covers `spreadsheet-server.cjs` and its own bound data directory. It covers panel projects, private source images, local OCR candidates, human review, saved rows and CSV/XLSX export. Unknown values stay blank. Source bytes remain available. OCR does not certify electrical specifications, identify compatibility or approve a part.

[Program setup and boundaries](PRODUCT_SEPARATION.md) · [Daily checklist](DAILY_QUALITY_CHECKLIST.md) · [Test milestones](TEST_MILESTONES.md) · [Detailed shared acceptance history](RELEASE_ACCEPTANCE.md)

## Evidence and open gates

PASS applies only to the named executed scope. [Run75](https://github.com/panelreply-business/panelreply-demo/actions/runs/44786004194) is a verified checkpoint, not completed platform or release acceptance:

- Branch head: `3bbb0528ba4487e0aa9b3298ad1b5d475939fe70`.
- Tested merge: `f314429a7470f17b69f841c3f41e490ba9d16806`.
- Source/test manifest SHA-256: `fbffb29fd99a316d26ab8247df3c2162ee6d84fe6c048e95c5dcb2b5c4f9db74`.

The [Linux Node/API/HTTP job](https://github.com/panelreply-business/panelreply-demo/actions/runs/44786004194/job/136460918652) passed 8,942 cases with no failures, skips, cancellations or infrastructure errors and `sourceChanged:false`. Excluding 79 evidence-harness cases leaves 8,863 product executions. These shared totals are not a spreadsheet-only count. The same job passed nine native OCR cases, eight native resource/lifecycle cases and nine independent XLSX-reader cases. OCR quality is scored separately.

Selected spreadsheet journeys passed seven cases in each of Linux [Chromium](https://github.com/panelreply-business/panelreply-demo/actions/runs/44786004194/job/136460918796), [Firefox](https://github.com/panelreply-business/panelreply-demo/actions/runs/44786004194/job/136460919391) and [WebKit](https://github.com/panelreply-business/panelreply-demo/actions/runs/44786004194/job/136460918875): 21/21 executions, zero failures or skips. The two selected products together passed 42/42. [Windows WebKit static coverage](https://github.com/panelreply-business/panelreply-demo/actions/runs/44786004194/job/136460919002) passed 92/92. These results do not establish private Windows/macOS product workflows or actual Safari support.

[Mac WebKit static coverage](https://github.com/panelreply-business/panelreply-demo/actions/runs/44786004194/job/136460919199) passed 90 and failed two cases: keyboard focus on the root demo's `#call` (Simulate missed call) button, and undersized native selects in the marketing preview. The next candidate makes the root page's native Tab order explicit and corrects the select dimensions. Its Mac browser verification remains pending, so overall browser acceptance stays open. [Defect history and current scope](PRELAUNCH_DEFECTS.md) preserve the earlier run73/run74 failures. Portfolio aggregation and any replacement candidate's verification remain separate.

| ID | Gate | Result | Evidence and remaining requirement |
| --- | --- | --- | --- |
| SS-01 | Linux product boundary and configuration | PASS | Run75 includes the [boundary](../tests/product-boundaries.test.cjs) and [configuration](../tests/product-config.test.cjs) suites. Spreadsheet-only routes, fixed identity, distinct cookies, directory binding and no conversation-orchestrator startup are exercised on the committed checkpoint. |
| SS-02 | Projects, images, review, version checks and persistence | PASS | Run75 store/API and selected spreadsheet journeys pass. They cover save/reopen, source bytes, unreviewed OCR candidates, explicit correction, retry and deletion behavior. Host durability remains a separate gate. |
| SS-03 | Saved CSV/XLSX structure, values and types | PASS | Run75 passes the [export matrix](../tests/release-export-matrix.test.cjs), writer/API cases and nine independent XLSX-reader cases. They cover executed file contracts, escaping and formula-like text. ZIP/XML or openpyxl readback does not prove Excel or every application's resave behavior. |
| SS-04 | Controlled bound backup, restore and restart | PASS | Run75 includes [product recovery](../tests/product-backup.test.cjs), matching-product restore, source preservation, fixed-entrypoint startup and the selected browser restart case. Restore strips sessions and disables copied passwords. Operator recovery sets a new password. This is controlled synthetic recovery, not hosted restart or offsite acceptance. |
| SS-05 | Exact synthetic OCR quality | FAIL | [Run75 measurement](https://github.com/panelreply-business/panelreply-demo/actions/runs/44786004194/job/136460918788): 277/310 images match every expected field, with 33 nonexact, zero native errors and zero review violations. All 310 outcomes match run74. Completing the run does not make extraction accurate. [Benchmark contract](OCR_BENCHMARK.md). |
| SS-06 | Required native-worker isolation | BLOCKED | [Run75 restricted worker](https://github.com/panelreply-business/panelreply-demo/actions/runs/44786004194/job/136460918352) executes zero native deny cases. Bubblewrap 0.12.0 passes its version check, but readiness fails with `bwrap: loopback: Failed RTM_NEWADDR: Operation not permitted`. The classifier reports `worker_startup_cause_unconfirmed` and `confirmedExternalBlocker:false`. No fallback or privileged retry ran. |
| SS-07 | Isolation and dependency operation on selected host | BLOCKED | No selected-host execution. Verify the required worker, patch policy, resource ceilings, cancellation, crash recovery and native deny cases on the approved host. |
| SS-08 | Representative photograph quality | NOT TESTED | No authorized representative photo corpus has been measured. Evaluate glare, wear, angle, crop, blur, low contrast, punctuation and ambiguous characters with exact expected values and manual-review outcomes. Synthetic labels are not field-photo accuracy. |
| SS-09 | Actual Microsoft Excel | NOT TESTED | No authorized Excel run. Open exported originals and compare exact values/types, leading zeros, Unicode, formula-like text and both worksheets. Test resave behavior separately. |
| SS-10 | Complete planned browser/platform acceptance | FAIL | Mac WebKit has two static-client failures in run75. Corrections are prepared, with Mac CI verification pending. Rerun on the resulting source, then reconcile the complete required matrix. Passing selected spreadsheet journeys do not erase these failures. |
| SS-10S | Selected spreadsheet UI on Linux | PASS | Seven cases per Chromium, Firefox and WebKit, 21/21 executions. Project/source persistence, explicit OCR-review controls, exports, isolated routes, restart and sign-out are exercised. |
| SS-10D | Actual Safari, physical devices and native camera/file-picker behavior | NOT TESTED | Bundled WebKit, emulation and synthetic file uploads do not establish these behaviors. Full assistive-technology use also remains untested. |
| SS-11 | Selected-host persistence, offsite recovery and operations | BLOCKED | Approve pricing and cost assumptions, then exercise the selected host, backup destination, recovery objectives, rollback, retention, support ownership, monitoring and incident response. Local recovery does not close this gate. |
| SS-12 | Real-world testing and release decision | BLOCKED | Review applicable gates, authorized participants/data, success criteria, stop conditions and recovery. Approve this program's exact release scope and activation separately. |

The callback program's actual-model gap does not block a spreadsheet-only release once separation is verified. Shared security and recovery failures affect both programs. The current spreadsheet gate still includes OCR quality and isolation. Manual correction or a large test total does not waive them.

The [run75 HTTP workload](https://github.com/panelreply-business/panelreply-demo/actions/runs/44786004194/job/136460918928) passed nine workflow groups across 516 responses with zero unexpected errors. Its restart reopens the HTTP server and store in the same Node process. It does not establish host restart, failover or capacity. [Both public suspension guards](https://github.com/panelreply-business/panelreply-demo/actions/runs/44786004194/job/136460918896) passed. Three public application checks remain policy-BLOCKED.

## Required workflow evidence

- Sign in and verify the spreadsheet product and cookie. Reject callback pages, scripts, business facts, leads, preview and assistant routes.
- Create and reopen a project. Upload valid source images and preserve the original bytes.
- Reject malformed signatures, invalid dimensions, oversized uploads and quota violations without saved partial state.
- Run bounded OCR, retain raw text, keep candidates unreviewed, edit values, mark review explicitly and save.
- Reopen the project and compare every saved field. Export CSV/XLSX and read files independently to confirm text identifiers, quantities, row order, source links and review metadata.
- Cover lost responses, retries, stale versions, cancelled processing, native failures and source/project deletion. Keep uncertainty visible until a matching receipt or confirmed saved state arrives.
- Restore an encrypted product archive to a new directory, reset copied credentials after reconciliation, reopen through the fixed entrypoint and verify rows, images and exports.

The selected browser cases are in [product_browser_test.py](../tests/product_browser_test.py). The [benchmark](OCR_BENCHMARK.md) keeps engine versions, font/image hashes and measurements separate. Compare identical inputs when claiming a pipeline improvement. Do not remove failing images, guess identifiers or count benchmark measurements as extra passing application tests.

## Schedule and release review

Run the daily checklist through December 20, 2026. At that review, prepare a spreadsheet-only real-world test plan with the exact build, authorized source images, tasks, participants, device/Excel environment, host, support owner, success criteria and recovery procedure. Start only when its technical gates and owner approvals are met.

December 31 is the target for the first program release. The owner has not selected the first program or the second release date. This program needs its own release decision. The portfolio's 10,000-test target and conditional 20,000 target do not replace OCR, isolation, photo, Excel or operational acceptance.
