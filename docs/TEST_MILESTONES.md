# Test milestones and counting policy

## November 25 — run 99 attempt 1 review and targeted retry (America/Detroit)

[Run 99](https://github.com/panelreply-business/panelreply-demo/actions/runs/45421164049) attempt 1 completed November 24 at 10:21:33 AM EST. Head `7497a314b6844feb51a2df44be385f26106d804b`, merge `d61371623c718e0e8118eb41be4ab48b1267a861`, tree `573ced02f53da1cabaf28d7609f4caa03cbf29b8`, manifest `38ade4d889cc405bd2248526c3bb5d915f54a3b3d70b85fed6db5ec011d40354` (same executable/test/workflow manifest as run 97, not a new source fix). CI reports clean evidence. All 41 attempt-1 jobs inventoried: 36 success, four failure, one cancelled. [Evidence and artifact hashes](evidence/run99-daily-review-2026-11-25.json). Actual summary, Windows and Safari ZIPs inspected; not a complete independent aggregate reconstruction.

Latest completed ledger: 24,951 PASS, three ERROR, zero FAIL across 9,409 distinct cases (7,467 generated). Callback 10,721 PASS/one ERROR (3,506 distinct), spreadsheet 12,019 PASS/two ERROR (4,202 distinct), shared 2,211 PASS (1,701 distinct, counted once). Exclude 415 harness passes and 7,131 duplicate observations. Automated requirements 44 PASS, two FAIL, ten NOT_TESTED; seven manual NOT_TESTED. The decrease from run 97 is mostly cancelled ARM coverage, not a source regression. Keep active target 10,000 and achievement timestamp unset; do not add the runs together.

- Callback fixed Linux/Intel Mac suites pass; installed Safari 26.6 callback 3/3 PASS. Windows Firefox static demo empty-form case ERROR at Page.goto 5s timeout before the validation assertion. Treat as a navigation failure, cause unproven.
- Spreadsheet installed Safari 1/3 PASS, two upload ERROR. In both artifact records Python reads all 26,973 fixture bytes with stable identity and hash before/after. Trusted selection/click events observed, zero policy events, later arrayBuffer and FileReader both NotReadableError, zero saved sources. Original exception not captured; no conclusion that CSP or Safari sandbox caused it. Manual export case passes.
- Native Windows component 14/15, failed WNS.root_security_rejection: the supposed unprotected fixture is actually protected with a single owner grant. Failure occurs before openPrivateDirectory, so this is a confirmed fixture precondition defect, not evidence of unsafe runtime acceptance. Null/empty rejection completed, broad root case not reached. Hardlink case passes. Next native candidate should explicitly construct and independently verify the unprotected descriptor (including the correct inheritance control) only inside disposable fixture storage, then retain all original rejection/unchanged-identity assertions. Do not weaken runtime policy; no code repair claimed.
- OCR 289/310 exact, 263/263 blanks preserved, zero review violations; accuracy FAIL. Linux full Node/API/HTTP 9,124 product passes. Portable Windows and Intel Mac 7,019 each. Native host and manual Excel/physical devices/assistive technology, representative photos, selected-host/offsite recovery and applicable actual provider gates remain open.
- Render read-only check PASS: both user-suspended, auto-deploy and PR previews off. Prior November 24 CI GET guard 2/2 PASS; today's direct GET BLOCKED (DNS).
- Fresh local execution BLOCKED: prior worktree absent, GitHub DNS unavailable, Node 22.16.0 rather than 24. At 10:03 AM EST requested one targeted public-repository ARM job rerun for the missing runner coverage; [attempt 2](https://github.com/panelreply-business/panelreply-demo/actions/runs/45421164049/attempts/2) queued at observation, not a pass. Attempt-specific artifact names preserve prior failures. Do not rerun the full matrix or count duplicate cases. Reconcile attempt 2 when terminal, then reproduce Windows fixture, Safari file-read boundary, Firefox navigation and profile/spreadsheet pending-command defects on an authorized host. No provider activation, deployment, spending, customer interaction or product code change.

Both products remain separate NO-GO for trial and release. Preserve earlier worktrees and exact source, and do not transfer earlier passes across changes. This documentation-only checkpoint deliberately skips an unrelated CI rerun while the targeted attempt is pending.

## November 24 — run 97 evidence review (America/Detroit)

[Run 97](https://github.com/panelreply-business/panelreply-demo/actions/runs/45316302295) completed November 23 at 10:17 PM EST on head `e474392e98b4990c3159afd3ec8cc485393ccab8` through PR merge `5fb22b7f0e28155dad754e52050ae00cfd342353`, tree `29026635c5f82fd7ebcc3d99d6a80c2a33ce48ce`, source manifest `38ade4d889cc405bd2248526c3bb5d915f54a3b3d70b85fed6db5ec011d40354`. The CI collector reports clean committed evidence. All 41 jobs were inspected: 38 success and three failure. The [source-bound CI log reconciliation](evidence/run97-daily-review-2026-11-24.json) preserves the aggregate and job inventory. This is review of the prior evening's completed evidence, not fresh November 24 execution or independent ZIP reconstruction.

Portfolio: 32,334 PASS, two ERROR, zero FAIL across 9,409 distinct product cases (7,467 generated). Callback 14,112 PASS / 3,506 distinct; spreadsheet 15,880 PASS / two ERROR / 4,202 distinct; shared 2,342 PASS / 1,701 distinct, counted once. Excluded 527 harness passes and 7,131 duplicate observations. Automated requirements 55 PASS / one FAIL; seven manual NOT_TESTED. Active target stays 10,000; firstGoalAchievedAt remains null.

Apple Silicon now completes portable Node 7,019 product passes and bundled Chromium/Firefox/WebKit fixed-product suites. Installed Safari 26.6 on Intel: callback 3/3 PASS, spreadsheet 1/3 PASS (two upload-related ERROR). Linux full Node/API/HTTP: 9,124 product and 191 harness PASS. Native Windows storage 14/15 FAIL scope, separate 28 and 19 harness passes. Native OCR Ubuntu 26 six PASS, Ubuntu 24 BLOCKED (RTM_NEWADDR). Frozen OCR accuracy FAIL 289/310 exact; 263/263 expected blanks preserved. Both Render services independently read as owner-suspended with auto-deploy and previews off. CI GET guards passed 2/2; direct review GET unavailable. Both products remain independent NO-GO. No code fix, deployment, customer contact, provider call or new product execution performed in this review.

Fresh execution BLOCKED: prior local worktree not present, GitHub DNS inaccessible in review sandbox, Node 22.16.0 rather than required Node 24, no fresh dispatch action available. Preserve prior worktrees; resume on authorized host. Inspect the Safari and Windows artifact bytes, identify the remaining failing native case without weakening controls, reproduce the next profile/spreadsheet pending-command defect, then test any repair on its exact source. Keep selected-host/offsite, manual device/accessibility/Excel/representative-photo and applicable provider gates open.

## November 23 — request-save recovery and native diagnostics

The next 207-file candidate has manifest `ed53015aaf8936613d1f32c1542c5820544b83f9d8b9eaeedf206cab9a59425c`, based on published `6b4964f`. Callback request receipts now bind identity, revision and normalized fields. Uncertain retries retain their command, and explicit validated reload resolves a permanent-refusal dead end without claiming the earlier write succeeded. The integrated 58-file Node/API/HTTP run passes 9,311 checks: 9,120 product and 191 excluded harness, with no failures/skips or source changes. Eleven new product IDs are added and all prior 9,109 remain. The full raw report is preserved. The two new callback browser journeys await source-bound CI. [Milestone](REQUEST_RECOVERY_NATIVE_DIAGNOSTICS_2026_11_23.md), [root evidence](evidence/request-recovery-root-integration-2026-11-24.json).

Root independently reconciles run 93 on `6b4964f`: 24,893 product PASS/zeroFAIL/twoERROR,9,391 distinct cases. It excludes 405 harness passes and 7,118 duplicate observations. Requirements remain 45 automated PASS/oneFAIL/tenNOT_TESTED plus seven manual NOT_TESTED. Actual Safari is 4 PASS/two upload ERROR, native Windows 13 PASS/twoFAIL with cleanup verified, OCR 26 fivePASS/oneFAIL and OCR 24 BLOCKED. Native diagnostic/fixture changes preserve the outstanding acceptance checks. Both independent products remain NO-GO. [Verified ledger](evidence/run93-independent-verification-2026-11-23.json).

## November 23 final run91 and native candidate accounting

Run91 records 24,852 product PASS, four FAIL and two ERROR across 9,375 distinct cases. The bucket counts are callback 10,644 PASS/three FAIL, spreadsheet 11,999 PASS/one FAIL/two ERROR and shared 2,209 PASS counted once. Exclude 402 harness passes and 7,110 duplicate observations. Required coverage is 44 automated PASS, two FAIL, ten NOT_TESTED and seven manual NOT_TESTED. Root reproduces CI's aggregate after verifying every report/source entry. [Verification](evidence/run91-independent-verification-2026-11-23.json).

The next candidate's full local run on manifest `f7b7f63a…` passes 9,290 checks: 9,109 product and 181 harness. Four new tests check denied ioctl decisions, preserved policy decisions, architecture rejection and a labelled CPython fallback model. The 65,536 request values inside one test do not become 65,536 cases. Three new sysfs cases are excluded harness checks.

Only the workflow selection changes after that full run. Final manifest `13df01f3f697ec9f586a62de9e8ca3203d4692c9f877a9c924f629f4c2195603` passes the corrected 19-case portable harness command. Keep the full run on its earlier source. Separate Safari/Windows harnesses and overlaps add no goal credit. Native Windows/OCR/Safari and the complete changed-source CI remain pending. [Integration](evidence/native-compatibility-root-integration-2026-11-23.json).

The numeric thresholds are exceeded but the complete 10,000 platform goal remains unachieved. Active target stays 10,000 and firstGoalAchievedAt remains unset. The policy and release requirements remain unchanged.

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
