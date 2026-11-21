# Test milestones and counting policy

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
