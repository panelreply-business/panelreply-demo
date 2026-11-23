# Test milestones and counting policy

## November 23 callback receipt counting

Manifest `63d709515f0a3c44fa9b4369cbc18e772119bd9f8465ee225ef844b4e5d1f05e` verifies 9,283 distinct local cases across two recorded executions. The full run has 9,274 PASS and nine SKIP because socket testing was not enabled. The exact nine skipped IDs then pass with `WORKSPACE_HTTP_TESTS=1` on unchanged source. The union has 9,105 product passes and 178 excluded harness passes, retaining all 9,094 prior product IDs and adding 11. Original reports stay separate. Author/reviewer overlaps receive no extra credit. [Evidence](evidence/callback-receipts-root-integration-2026-11-23.json).

The new callback browser method is collected but not executed locally. Run91's failed Windows component and blocked OCR host reports remain outside product counting. Run90 is still the latest complete reconciled ledger. Keep the policy, active 10,000 goal and unset firstGoalAchievedAt unchanged until every required platform scope passes.

## November 23 native-control candidate counting

Final candidate manifest `14b0b86f595e026f78d666674a1133d7dcde072fd7a66c9784e780e0bc1740da` adds verification-tool cases only. The complete pre-output-correction run passed 9,261 cases, including 9,094 product and 167 harness cases. On the corrected source, the affected selection passes 155: 152 harness plus three existing product cases. Eleven new output-boundary cases receive zero product credit. These focused overlaps are not added to the prior full run or run90 ledger. [Source-bound records](evidence/native-host-final-focused-2026-11-23.json).

Separate Python/native-component/SQLite-observer harness checks, OCR host context, build-failure reporting and future SQLite measurements remain outside the goal. The 56 automated and seven manual requirements, active 10,000 target and unachieved complete first goal remain unchanged. Actual changed-source CI is pending.

## November 23 final run90 accounting

The verified source is `2882d4f`, tested through merge `f08bd878`, with manifest `e359d184cae83587b5a98e5362ac52b0ce2b72332c8b68fc7dcf54878c544cc4`. Root rechecks all 35 ZIPs, 37 source-bound reports and the immutable collector/policy, then reproduces CI's aggregate except generatedAt. [Final record](evidence/callback-scheduling-run90.json) and [verification](evidence/run90-independent-verification-2026-11-23.json).

- Product executions: 24,852 PASS and six ERROR.
- Distinct product cases: 9,375. Cases passing on every observed platform: 9,369.
- Callback: 10,644 PASS and three ERROR across 3,482 distinct cases.
- Spreadsheet: 11,999 PASS and three ERROR across 4,194 distinct cases.
- Shared: 2,209 PASS across 1,699 distinct cases, counted once.
- Excluded: 371 harness passes and 7,110 duplicate observations.
- Required coverage: 43 automated PASS, three FAIL, ten NOT_TESTED, and seven manual NOT_TESTED.

The numeric thresholds are exceeded, but the complete 10,000 goal is not achieved. Active target stays 10,000 and firstGoalAchievedAt remains unset. Do not activate the conditional 20,000 goal, convert reruns into new cases, or use measurements/native component checks as product credit. Later source changes need separate evidence.

## Latest reconciled progress — November 23, 2026

Run88 on source `1322d063` records 24,829 product case/platform passes and five native Safari errors across 9,367 distinct cases. It excludes 371 harness checks and 7,102 duplicate observations. All 37 source-bound reports reconcile with the CI aggregate. [Final run88 record](evidence/callback-scheduling-run88.json).

The callback bucket has 10,645 PASS/two ERROR, the spreadsheet bucket 11,975 PASS/three ERROR, and the shared bucket 2,209 PASS counted once. Forty-four automated requirements pass, two fail, ten ARM requirements remain untested, and all seven manual gates remain untested. The complete first goal remains unachieved, `firstGoalAchievedAt` remains unset and the active target remains 10,000. These counts do not transfer to later changed source.

This implementation checkpoint supersedes the planning-only record in commit `d5d270f8dd7866c905076d25dfac9efbc7de471d`. That commit and its unimplemented status remain in history. Runtime separation is implemented and has committed integration evidence in run76. Each program still needs its own release decision.

Owner requirements, November 20, 2026:

1. Reach at least 10,000 meaningful passing tests across the documented platform matrix.
2. If that complete goal is verified before December 31, raise the target once to 20,000 under the same rules.
3. Run the daily checklist through December 20, then review readiness for real-world testing.
4. Release the callback and spreadsheet programs independently. A future merger is optional and requires a later decision.

The active target starts at 10,000. The machine-readable policy is [test-milestones.json](test-milestones.json). It records the America/Detroit cutoff, required platform coverage and the 20,000 target. Do not silently reinterpret the requirement as 10,000 tests per program or repeatedly double beyond 20,000.

## Verified progress — November 20, 2026

[Run76](https://github.com/panelreply-business/panelreply-demo/actions/runs/44788287151) records 24,372 product case/platform passes across 9,114 distinct cases. The distinct total includes 7,467 generated input/state cases. The count excludes 237 evidence-harness passes and 7,017 duplicate observations. All 30 automated platform requirements pass. [Source-bound evidence](evidence/independent-products-verification.json) preserves per-product totals, actual platform versions, hashes and artifact digests.

The numeric execution count exceeds both thresholds. Seven required platform scopes remain NOT TESTED, so the complete goal has not been achieved. The policy remains at 10,000, with `firstGoalAchievedAt` unset. This is not a claim of 10,000 distinct cases or coverage of every required platform. The one-time increase to 20,000 follows verification of the complete first goal before the deadline.

## What counts

The milestone unit is one completed product case / platform configuration execution on the current tested source. Platform configuration includes the OS, runtime or browser engine/channel and device profile. A justified platform repetition is recorded separately from a distinct scenario.

Report all of these numbers:

- Distinct product cases.
- Generated/model-based cases and other cases.
- Passing product case/platform executions.
- Callback-specific, spreadsheet-specific and shared coverage.
- Duplicate observations excluded.
- Failed, cancelled, skipped, blocked and unexecuted work.
- Evidence-harness checks, excluded from the product milestone.

An identical case/platform rerun never adds another pass. Shared tests count once in portfolio totals. An assertion, loop iteration, request response, benchmark measurement, suite container or duplicate standalone evaluation is not an additional product case. An unresolved same-source failure cannot disappear because a later report repeats the same case successfully.

Generated cases must test a meaningful input domain, state transition, boundary or failure interaction against an independent expected result. Reject duplicate semantic inputs where the suite generates a catalog. Generic malformed types must not be multiplied across unrelated prior states solely to increase the count.

## Source and result integrity

The Node and browser reporters record the checked-out commit, Git tree, actual source/fixture hashes, working-tree state, OS, runtime/browser versions and per-case outcome. They check for source changes during execution. Aggregation rejects mixed sources, malformed reports and contradictory platform metadata.

Local runs against edited files can guide development. Complete milestone acceptance requires committed, stable-source evidence. Documentation-only updates may point to an identical tested executable tree, but the relationship must be verified and stated.

The reports distinguish reaching the numeric threshold from completing required platform coverage. Neither establishes release readiness by itself.

## Platform interpretation

| Evidence | What it establishes | What remains separate |
| --- | --- | --- |
| Linux Node/API/SQLite suite | Executed server and contract behavior on that Linux runtime | Hosted operation and other server OS support |
| Portable Node contracts on Windows/macOS/Linux | Those modules' behavior on the measured OS/runtime | Private Windows/macOS server support |
| Bundled Chromium/Firefox/WebKit | The measured browser build on the reported OS | Branded Safari or a physical phone |
| Chrome/Edge channel runs | The named installed channel and recorded version | Other channels or untested private hosted workflows |
| Phone/tablet emulation | Configured touch, viewport, device scale and browser user agent | Physical camera, keyboard, file picker or mobile OS behavior |
| Python ZIP/XML or openpyxl readback | Exact file structure/types/values within that reader's executed scope | Actual Microsoft Excel or universal spreadsheet compatibility |

The initial automated matrix includes three OS families, three browser engines, explicit Chrome/Edge channels on Windows/Linux and separate phone/tablet emulation. Actual Safari, physical iPhone/iPad/Android and private product journeys on untested client OSes remain NOT TESTED until evidence exists. Do not claim “all platforms passed” from Linux browser engines or viewport resizing.

The fixed CI runners are Ubuntu 24.04 x86_64, Windows Server 2022 x86_64 and macOS 15 Intel. The macOS 14 label was replaced after checking the [official runner inventory](https://github.com/actions/runner-images/blob/main/README.md) and [retirement announcement](https://github.com/actions/runner-images/issues/13518). The initial macOS 15 ARM64 jobs in runs73/74 remained queued without an assigned runner. Their cause is unconfirmed and they provide no pass evidence. The follow-up uses the ordinary `macos-15-intel` standard public-repository runner listed in [GitHub's runner reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners), without using a paid larger runner. Apple silicon macOS remains an explicit unverified requirement; Intel results cannot close it. Actual OS and architecture remain part of every evidence report.

## Independent release gates

Callback release acceptance includes intake quality, consent/safety behavior, approved actual-model evaluation when AI is part of that release, data integrity, access controls and operating recovery. Its selected entrypoint must not expose or start the spreadsheet/OCR program.

Spreadsheet release acceptance includes exact saved data and exports, image handling, OCR quality/review behavior, required native isolation, representative images, data integrity, access controls and operating recovery. Its selected entrypoint must not expose or activate the callback/AI program.

Each program has its own evidence and launch decision. A spreadsheet OCR failure does not automatically block a callback-only release once isolation is verified, and a callback provider gap does not automatically block a spreadsheet-only release. Shared security/recovery failures still affect every dependent program.

## Working checkpoints

| Date | Callback program | Spreadsheet program | Shared work |
| --- | --- | --- | --- |
| November 27 | Separate entrypoint, data and workflow evidence | Separate entrypoint, data and export evidence | Deduplicated baseline and daily evidence records |
| December 6 | Verify independent start/stop and saved inbox data | Verify independent start/stop and saved projects | Full changed-source CI and separate recovery/rollback plans |
| December 13 | Close synthetic intake, consent and failure defects | Measure OCR failure corpus and required isolation | Platform progress, host/access/support and pricing decisions |
| December 20 | Separate decision and bounded real-world test plan | Separate decision and bounded real-world test plan | Record prerequisites, success criteria and remaining approvals |
| December 21–30 | Authorized evaluation and defect correction | Authorized photos, export and operating evaluation | Verify each final candidate and its own release decision |
| December 31 | First release target, if selected and accepted | Separate launch date if not selected first | No automatic deployment or forced combined release |

Each release also needs its own operating owner, support process, rollback evidence and pricing/legal decisions. Shared implementation does not force combined billing, simultaneous release or data migration. The existing suspended public services remain unchanged.

## Raising the target

Record the qualifying source, completed evidence, America/Detroit achievement date and coverage decision. If the complete first goal is verified before 00:00 on December 31, 2026, set the target to 20,000 once. The automated counter only reports eligibility and never edits the milestone policy or grants deployment permission.

The existing recurring audit carries this rule. The daily schedule ends after the December 20 check. The rule also remains in this repository for later authorized real-world testing and release review.
