# Daily product quality checklist

Owner direction: November 20, 2026. Run daily through December 20, 2026, in America/Detroit. The existing recurring audit runs at 10:00 AM local time beginning November 21. November 20 is the current development and verification session.

November 20 execution is complete. [The verified record](evidence/independent-products-verification.json) contains the tested source, separate product results, 30 passing automated platform requirements and the remaining platform/quality gates. Future checks must use that day's current source and record fresh evidence under the rules below.

## Two independent decisions

Maintain separate records for the callback program and spreadsheet program. Each receives its own defects, evidence, operating checklist, real-world-testing decision and release decision. A pass or a launch for one never activates the other.

December 31 remains the target for the first release. The owner has not selected which program launches first or a date for the second release. December 20 is the readiness review for real-world testing, not automatic permission to use a provider, spend money, contact a customer, load customer data or deploy.

Use PASS, FAIL, BLOCKED and NOT TESTED. Mark a row PASS only from completed execution or the explicitly named review. Record the tested commit, source manifest, platform, result file and completion time. A historical pass is not today's execution.

## Daily sequence

| ID | Check | Evidence required |
| --- | --- | --- |
| D01 | Read the latest owner brief, branch, draft PR and both product records. Coordinate with work already in progress. | Current refs, source changes and active work identified. |
| D02 | Check that callbacks and spreadsheets remain independently configured and controlled. | Fixed entrypoints, product identity, independent data directories/cookies and server route boundaries verified. |
| D03 | Run the current applicable Node, API, SQLite, data-contract and failure suites. | Completed exact-source report. Reuse a completed same-day run only when its executable/test/workflow source is identical. |
| D04 | Run available browser/platform suites and each selected product's user journey. | OS, actual browser/channel/version and emulation status recorded. Missing platforms stay NOT TESTED. |
| D05 | Complete the callback workflow and its failure paths below. | Callback report and regression cases. |
| D06 | Complete the spreadsheet workflow and its failure paths below. | Spreadsheet report and regression cases. |
| D07 | Exercise shared security, data integrity and recovery requirements. | Session/tenant/product separation, no-write-on-rejection and independent recovery evidence. |
| D08 | Reproduce new defects, assign severity and fix authorized code defects. | Before/after reproduction and a meaningful regression. Preserve existing assertions. |
| D09 | Verify the final changed candidate. | Required affected regression and integration results for the final source. Do not transfer an earlier source's count to changed code. |
| D10 | Aggregate evidence and update test milestones. | Distinct cases, generated cases, case/platform executions, duplicate exclusions, failures/skips/blocks and per-product scope. |
| D11 | Check current suspended public-service state using read-only access. | Current service/GET evidence or an explicit access block. No state changes. |
| D12 | Record the next work and independent readiness decisions. | Callback status, spreadsheet status, shared blockers and the next evidence needed. |

When a prerequisite is unavailable, complete every other authorized row. Record the reason and the next concrete requirement. Do not repeatedly attempt a known host restriction, weaken isolation, create empty commits, duplicate schedules or count retries toward the target.

## Callback program

- Sign in, expire/revoke a session and recover from an interrupted request.
- Collect bundled and multi-turn customer details. Preserve names, phone formatting, job scope, ZIP, callback preferences and requested dates.
- Verify corrections, ambiguous answers, wrong-role numbers/names, negation and conflicts. Prior values remain until the customer supplies the required clarification.
- Review, save, reopen, search, update status/notes and export the saved request.
- Verify persistent STOP/opt-outs, contact permission and safety holds across resets, retries, deletion, restore and new sessions.
- Verify cancellation, timeout, malformed output, stale facts, duplicate attempts and durable usage controls with synthetic providers.
- Confirm saving sends no message and does not book an appointment.
- Confirm spreadsheet routes, assets and OCR execution are unavailable in callback mode.
- Keep actual-model compatibility and quality BLOCKED until the provider, data transfer and finite budget are approved and the evaluation is executed.

## Spreadsheet program

- Create a project, upload a supported image, review extraction, edit every relevant field, save, close, reopen and export CSV/XLSX.
- Compare exported values and types with the saved project using independent readers. Cover leading zeros, punctuation, Unicode, formula-like text, row ordering, quantities and source/review metadata.
- Test invalid/oversized images, file signatures, malformed dimensions, quotas, cancelled processing and native process failure.
- Verify unsaved-change handling, stale versions, lost responses, duplicate retry keys, response loss followed by refusal and deletion receipts.
- Preserve source image bytes, explicit human review and blank unknown values. Never repair OCR using expected fixture values or guessed part numbers/manufacturers.
- Measure the frozen synthetic OCR corpus. Record every nonexact result separately from engine execution success.
- Verify required native isolation on an appropriate host without an unconfined fallback. Keep representative-photo quality separate.
- Confirm callback intake, business-answer, assistant/provider, lead and callback export routes are unavailable in spreadsheet mode.
- Keep actual Excel, camera/file-picker behavior and physical mobile workflows explicit until tested.

## Shared requirements

- Correct product/data-directory binding and independent start/stop/configuration.
- Separate cookies and no cross-product or cross-business session/data access.
- Exact Host/Origin, CSRF, session pins and rechecks after awaited work.
- No database, image, audit, usage or deletion mutation after a rejected operation, except documented session activity/expiry behavior.
- Durable persistence, idempotent replay, version conflicts and concurrent update behavior.
- Encrypted backups and restoration into a fresh directory, preserving source data and product identity. Restored credentials/sessions remain disabled.
- Clear validation, keyboard/focus behavior, mobile controls, readable text and error recovery.
- No secrets or customer data in source, test inputs, reports or screenshots.
- Independent program activation, rollback, monitoring and support ownership before release.

## Daily report fields

For each program record: source, product entrypoint, tested platforms, fresh passing cases, failures, skipped/blocked work, fixed defects, remaining defects, recovery evidence and the next required action. Report shared tests separately and count them once in portfolio totals. Link the completed evidence files and CI jobs.

The report must distinguish a collected test inventory, an in-progress run and a completed pass. Installing a browser, defining a scenario or opening a workflow is not execution.

## December 20 review

Prepare two decisions and two bounded test plans. Each plan must state the exact version, tasks, participants, data, provider/hosting requirements, cost ceiling, support owner, success criteria, stop conditions and recovery procedure. Complete preparation before requesting approval for any remaining external step.

Proceed to real-world testing only for a program that satisfies its technical requirements and receives the needed owner approval. Keep the other program in development if its requirements remain open. Never let a date, aggregate count or success in the other program override a failed requirement.
