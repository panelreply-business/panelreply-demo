# Spreadsheet release acceptance

Review date: November 20, 2026. Current decision: NO-GO for release or a real-world trial. Continue source review and isolated synthetic evaluation.

This record covers `spreadsheet-server.cjs` and its own bound data directory. It covers panel projects, private source images, local OCR candidates, human review, saved rows and CSV/XLSX export. Unknown values stay blank. Source bytes remain available. OCR does not certify electrical specifications, identify compatibility or approve a part.

[Program setup and boundaries](PRODUCT_SEPARATION.md) · [Daily checklist](DAILY_QUALITY_CHECKLIST.md) · [Test milestones](TEST_MILESTONES.md) · [Detailed shared acceptance history](RELEASE_ACCEPTANCE.md)

## Evidence and open gates

PASS applies only to the named executed scope. A completed OCR run is not a passing accuracy result. Historical combined-platform evidence does not verify the new fixed entrypoint's committed browser/platform results. Focused counts overlap the eventual full suite.

| ID | Gate | Result | Evidence and remaining requirement |
| --- | --- | --- | --- |
| SS-01 | Local product boundary and configuration | PASS | [Boundary](../tests/product-boundaries.test.cjs) and [configuration](../tests/product-config.test.cjs) suites pass locally. Spreadsheet-only routes, fixed identity, distinct cookies, directory binding and no conversation-orchestrator startup are exercised. Final committed candidate evidence remains required. |
| SS-02 | Projects, images, review, version checks and persistence | PASS | Existing store/API checks and the selected spreadsheet API lifecycle pass locally. They cover save/reopen, source bytes, unreviewed OCR candidates, explicit correction, retry and deletion behavior. Host durability remains a separate gate. |
| SS-03 | Saved CSV/XLSX structure, values and types | PASS | [Export matrix](../tests/release-export-matrix.test.cjs), writer/API tests and existing independent readers cover executed file contracts, escaping and formula-like text. Readback by ZIP/XML or openpyxl does not prove Excel or every application's resave behavior. |
| SS-04 | Local bound backup, restore and restart | PASS | [Product recovery](../tests/product-backup.test.cjs) passes locally, including matching-product restore, source preservation and fixed-entrypoint startup. Restored sessions and credentials stay disabled. |
| SS-05 | Exact synthetic OCR quality | FAIL | Latest recorded [benchmark](OCR_BENCHMARK.md): 277/310 images match every expected field. 33 remain nonexact. Zero native errors and zero review violations do not convert those extraction failures to passes. Preserve the frozen inputs and report all nonexact cases. |
| SS-06 | Required native-worker isolation | BLOCKED | [Isolation gate](OCR_ISOLATION.md) remains blocked during readiness before native deny cases execute. Resource ceilings and a patched dependency do not prove filesystem, network or syscall isolation. Do not weaken the policy or use an unconfined fallback to pass this gate. |
| SS-07 | Isolation and dependency operation on selected host | BLOCKED | No selected-host execution. Verify the required worker, patch policy, resource ceilings, cancellation, crash recovery and native deny cases on the approved host. |
| SS-08 | Representative photograph quality | NOT TESTED | No authorized representative photo corpus has been measured. Evaluate glare, wear, angle, crop, blur, low contrast, punctuation and ambiguous characters with exact expected values and manual-review outcomes. Synthetic labels are not field-photo accuracy. |
| SS-09 | Actual Microsoft Excel | NOT TESTED | No authorized Excel run. Open exported originals and compare exact values/types, leading zeros, Unicode, formula-like text and both worksheets. Test resave behavior separately. |
| SS-10 | Complete committed-source platform and selected UI evidence | NOT TESTED | Publish and inspect final-source OS/runtime/browser/channel reports and spreadsheet journeys. Actual Safari, physical phones/tablets and native camera/file-picker behavior need their own evidence. |
| SS-11 | Selected-host persistence, offsite recovery and operations | BLOCKED | Approve pricing and cost assumptions, then exercise the selected host, backup destination, recovery objectives, rollback, retention, support ownership, monitoring and incident response. Local recovery does not close this gate. |
| SS-12 | Real-world testing and release decision | BLOCKED | Review applicable gates, authorized participants/data, success criteria, stop conditions and recovery. Approve this program's exact release scope and activation separately. |

The callback program's actual-model gap does not block a spreadsheet-only release once separation is verified. Shared security and recovery failures affect both programs. The current spreadsheet gate still includes OCR quality and isolation. Manual correction or a large test total does not waive them.

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
