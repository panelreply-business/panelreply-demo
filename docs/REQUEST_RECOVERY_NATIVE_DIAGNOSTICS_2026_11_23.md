# Request-save recovery and native failure diagnostics

November 23, 2026 development milestone. The individual validation records use their actual UTC timestamps, including November 24.

## Source and status

The integrated candidate extends published `6b4964ff65c2cd8b904d5974382cb6c241e2c378`. Its 207-file source/test/workflow/policy manifest is `ed53015aaf8936613d1f32c1542c5820544b83f9d8b9eaeedf206cab9a59425c`. The planned development commit is `Confirm callback request saves and diagnose native failures`. Both products remain separate NO-GO decisions for customer trial/public release.

## Application behavior

A callback request save must return a complete record for the submitted request, creation identity, next writable revision and normalized fields before the client replaces its draft. Malformed or uncertain responses retain the original payload/revision for retry. A later validated GET may confirm current saved values, without claiming which command or writer produced them.

If a later refusal prevents retry recovery, the operator can choose Reload saved version. Cancel does not issue a GET. Confirm retains the draft until the current record validates. A wrong identity, incomplete response or stale record leaves the original command intact. A valid explicit reload may return the original revision, because the operator is choosing the saved record, not confirming a write. The resulting message leaves the earlier save outcome unestablished.

The initial request repair reproduces eight failures among nine new methods. Root review found that raw phone control characters could pass client receipt normalization despite real API 400. That case failed before the raw-text precheck and passes afterward. Root then reproduced the permanent-refusal dead end. Its new regression fails before the explicit reload path and passes afterward. The final affected suite is 153 PASS with zero failures/skips. Two new browser journeys are collected and await actual CI. [Receipt design](REQUEST_SAVE_RECEIPTS_2026_11_24.md), [reload design](REQUEST_SAVE_RELOAD_2026_11_24.md).

## Native and evidence scopes

| Scope | Implemented change | Verified scope | Still required |
| --- | --- | --- | --- |
| Windows component evidence | Three exclusive held output descriptors, bounded child observation framing, retained outcomes and a terminal completion receipt | Root 28 harness PASS | Actual Windows execution and output completion |
| Windows SQLite harness | Canonical TEMP fixture paths and alias retargeting that does not rename an open parent | Root 25 PASS and four targeted alias cases PASS after three prior alias failures | Windows 19-case portable selection |
| Windows native cases | Root descriptor evidence before rejection, actual unprotected precondition, link setup/removal outside the lease with identity-bound reopen | Source review, syntax check,13 other bodies unchanged | Native DACL, four hardlink rejection checks, single-link readback and cleanup |
| OCR verifier | Bounded registered PID identity/state and lifecycle timing, keeping original signal-zero result decisive |53 affected harness PASS, ten new observer cases, peer review | Actual native cleanup outcome with all six original cases |
| Native Safari observer | Fixed-fixture host identity/modes/hash and passive bounded policy-event metadata | Root 25 harness PASS, all six method bodies and original upload actions preserved | Original native upload outcomes and a supported cause |

All these harness/diagnostic scopes add zero product-target credit. Host readability does not establish Safari sandbox access. An empty policy-event window does not exclude every browser or host restriction. Process observations do not treat zombie state, missing proc data or PID reuse as proof of absence. The extra observations can affect timing.

## Integrated regression

The 207-file candidate passes 9,311 checks across 58 Node files with `WORKSPACE_HTTP_TESTS=1`: 9,120 product and 191 excluded harness checks. There are zero failures, skips, cancellations, TODOs or infrastructure errors. All 9,109 previous product IDs remain. Eleven new distinct request-save/recovery IDs are added. Before/after source manifests match.

[Root integration](evidence/request-recovery-root-integration-2026-11-24.json) records the exact command, source manifest, test IDs added, scope hashes and reviews. It preserves the entire 5,600,637-byte raw JSON report in [gzip/base 64 form](evidence/request-recovery-root-full-2026-11-24.json.gz.base64), plus its log. Decode with Python's `base64.decodebytes` followed by `gzip.decompress` and verify the decoded SHA-256 recorded in the integration JSON. This preserves the raw outcomes without relying on temporary paths.

The separate 53-case output harness run and 25-case Safari harness run remain on their own recorded integration snapshots. Their exercised runner/helper/harness bytes match this final candidate. They are not added again to product totals. The first root Safari evidence wrapper used nonverbose output but expected per-method verbose lines. Its record assertion failed after 25 OK. The corrected wrapper captures the verbose source-bound report, and the initial wrapper failure remains recorded.

## Committed-source evidence

Run 93 on the published predecessor is independently reconciled from 40 archives,37 release reports, all 202 immutable source entries and the immutable collector/policy. The reproduced aggregate matches CI except generatedAt.

| Product scope | PASS | FAIL | ERROR | Distinct cases |
| --- | ---: | ---: | ---: | ---: |
| Callback |10,680|0|0|3,494|
| Spreadsheet |12,004|0|2|4,198|
| Shared, counted once |2,209|0|0|1,699|
| Portfolio |24,893|0|2|9,391|

The ledger excludes 405 harness passes and 7,118 duplicate observations. Automated requirements are 45 PASS/oneFAIL/tenNOT_TESTED, with seven manual gates NOT_TESTED. The workflow still fails. The active 10,000 platform goal is incomplete despite the numeric count exceeding 20,000. Policy stays unchanged and firstGoalAchievedAt remains unset.

Native Safari passes four of six journeys, including all three callback journeys and manual corrections with exact native CSV/XLSX download bytes. Both uploads still error. Windows has 13 component PASS/twoFAIL with cleanup verified. OCR 26 reaches readiness and passes five of six native cases, with a process-existence assertion unresolved. OCR 24 remains blocked before native cases. Synthetic extraction accuracy remains 289/310 exact, leaving 21 mismatches. These separate failures are not erased by the portfolio count. [Run 93 ledger](evidence/release-run93.json), [root verification](evidence/run93-independent-verification-2026-11-23.json).

## Publication and continuation

Read-only checks confirm PR 8 remains open/draft, main remains `c6152b38ae2e3a824e6a81199aa0d757d47a19ae`, and both Render services remain owner-suspended with automatic deployment and previews off. No purchase, customer contact, production data, public deployment, main merge or release occurred. [Checks](evidence/request-recovery-publication-guards-2026-11-24.json).

After publishing this source, verify its own platform run and eighteen-method fixed callback suites. Continue profile receipt validation, spreadsheet uncertain-command recovery and the remaining native/OCR/platform gates. [Exact continuation checklist](AUTONOMOUS_CONTINUATION.md).
