# PanelReply development progress

## Autonomous implementation — November 23, 2026

Development resumed from the existing documentation head `9175d905c74ff060a3f8e8fcbe01e15accb7342b`, on the same branch and draft PR8. This environment has Node 24.22.3, a working checkout and permitted loopback HTTP tests. The earlier daily audit's runtime/checkout blocks do not describe this session.

The candidate adds the missing callback scheduling/follow-up workflow, exact UTC/time-zone controls, a due/overdue queue, task/request concurrency checks, contact holds, retry preservation, schema-4 recovery and JSON export v2. Independent review reproduced and repaired outcome-note loss, unknown-result retry clearing, revision exhaustion and malformed Unicode replacement. [Scheduling contract](CALLBACK_SCHEDULING.md).

The frozen local OCR corpus improved 277/310 → 285/310 with eight gains and no regressions; every image hash remained unchanged. Twenty-five nonexact cases keep OCR quality FAIL. Native fixture/resource checks pass their named scopes. [Measured results](OCR_SMALL_TEXT_2026_11_23.md). Mac/Apple Silicon jobs add actual platform execution for callback and explicitly scoped manual spreadsheet workflows; native macOS OCR and physical devices remain separate. [Platform scope](PLATFORM_EXPANSION.md).

The full stable-source local Node/SQLite/API/HTTP regression passed 9,072 cases with zero failures, skips, cancellations or infrastructure errors. Excluding 83 evidence-harness checks leaves 8,989 product executions. All 49 test files ran under Node 24.22.3 with `WORKSPACE_HTTP_TESTS=1`; the executable/test/workflow hash stayed `fa274e9210cf963ff2f92b1df0b3d748997f81e852f936646b2ccc160ea5839b` throughout. [Local candidate evidence](evidence/callback-scheduling-local-2026-11-23.json). This is uncommitted-candidate verification, not a clean committed-source platform ledger. Committed browser/expanded-platform CI is next. Do not assign historical run76 passes to this changed implementation. No purchase, production data, customer contact, public activation, merge or release occurred. [Persistent next steps and remaining requirements](AUTONOMOUS_CONTINUATION.md).

## Daily quality check — November 23, 2026 (America/Detroit)

Fresh GitHub inspection confirms draft/open/unmerged [PR8](https://github.com/panelreply-business/panelreply-demo/pull/8) at documentation head `96ade607`, main `c6152b38`. The comparison from last tested application source `ca5f0cb` contains three documentation/evidence-only commits, no executable/test/workflow changes. The source manifest remains `823418de33d6f2d166d6aae9013f6b3baf2ca43ecd1286bed76b5e81bb218e81`. No open code issues or PR review comments were found. Fixed entrypoints, route deny lists and product-specific encrypted backups remain implemented in the same tested source.

[Scheduled main run79](https://github.com/panelreply-business/panelreply-demo/actions/runs/45194906999) completed November 23 at **9:33 AM EST**, 291 Node and 105 Chromium checks PASS (396 total), zero failures, three intentional public application skips and two suspension guards passing within the Node count. **Run79 tests main, not PR8.** Today's full PR8 regression remains **BLOCKED**, not passed: the checkout is unavailable locally, local Node 22.16.0 is below the Node24 release runner, and no authorized full-matrix CI dispatch was available without a new code change or paid execution. The last full matching-source [PR run76](https://github.com/panelreply-business/panelreply-demo/actions/runs/44788287151) retains 24,372 recorded product case/platform PASS, 9,114 distinct cases (7,467 generated), 7,017 duplicate observations and 237 harness PASS excluded. Callback 10,351, spreadsheet 11,836 and shared 2,185 counted once. These are not newly executed today.

Fresh Render reads confirm both existing services **owner-suspended**, auto-deploy/previews off, no post-suspension deployment/event/log. Independent direct GET for both public URLs was inaccessible, so fresh direct HTTP is **NOT TESTED**; today's main CI guards returned PASS, but are not PR application verification. Seven required physical/actual/manual platform scopes remain NOT TESTED. OCR remains FAIL (277/310 exact, 33 nonexact); native OS isolation BLOCKED before deny tests; real-model testing, representative photographs, actual Excel, selected-host and offsite recovery remain open. Numeric thresholds are exceeded, but the full 10,000 platform-qualified goal remains open, so no doubling yet. No new confirmed code defect, code change, deployment or service mutation. **Callback NO-GO and spreadsheet NO-GO for human trial/public release**. [Daily evidence](evidence/daily-audit-2026-11-23.json).


## Daily quality check — November 22, 2026 (America/Detroit)

Read-only audit completed at 2026-11-22, 10:04:23 a.m.. [Draft PR8](https://github.com/panelreply-business/panelreply-demo/pull/8) remains open, draft and unmerged at documentation head `bc86e8e1`; main remains `c6152b38`. The compare from tested implementation `ca5f0cb` to today's head contains documentation/evidence only. The executable/test/workflow manifest remains `823418de33d6f2d166d6aae9013f6b3baf2ca43ecd1286bed76b5e81bb218e81`. No new open issue or PR review was found. Fixed product entrypoints, routing, data binding and separate recovery implementation were inspected.

Today's completed [main scheduled run78](https://github.com/panelreply-business/panelreply-demo/actions/runs/45030730688) at 9:05:59 AM EST passed 291 Node and 105 Chromium checks (396 total), plus both public-suspension guards, with three public application checks policy-blocked. It tests **main, not PR8**. Fresh full PR8 regression remains **BLOCKED**: Node 22.16.0 is below the required release environment, no repository checkout is mounted, and no authorized complete workflow dispatch is available. Known remote DNS failure was not retried. No PR tests were freshly executed or counted today.

[Run76](https://github.com/panelreply-business/panelreply-demo/actions/runs/44788287151) remains the last full verified PR implementation regression: **24,372 PASS** case/platform executions across **9,114 distinct cases**, including 7,467 generated cases, zero product failures or skips, 7,017 duplicate observations and 237 harness passes excluded. Callback has 10,351 passes, spreadsheet 11,836, and shared 2,185 counted once. All 30 automated platform requirements passed, but seven manual/actual-platform requirements remain **NOT TESTED**. The active 10,000 milestone is not complete under its required platform condition, despite exceeding both numeric thresholds. No trigger to raise to 20,000 yet.

Fresh read-only Render configuration, events, deployments and logs show both public services **suspended by owner**, auto-deploy and previews off, with no post-suspension event or deployment. Direct independent web GET failed due to access restrictions, so fresh HTTP is **NOT TESTED**; main run78 guards passed. OCR exact-image quality remains **FAIL: 277/310**, 33 nonexact. Native OCR isolation remains **BLOCKED** with zero actual denial cases; actual-model evaluation, representative photos, Excel, physical phones/actual Safari, selected-host/offsite recovery and operating approvals remain open. No newly confirmed code defect, code fix or external mutation today.

Callback: **GO for draft review/synthetic evaluation, NO-GO for customer trial/release**. Spreadsheet: **GO for draft review/synthetic evaluation, NO-GO for customer trial/release**. Each retains an independent decision. [November 22 daily evidence](evidence/daily-audit-2026-11-22.json).

## Daily quality check — November 21, 2026 (America/Detroit)

Fresh read-only audit at 10:00 AM EST. The branch remains at documentation checkpoint `7280a1e`, derived from application/test source `ca5f0cb`. GitHub comparison confirms the only intervening commit changes 10 documentation/evidence files, not runtime, tests or workflows. PR8 remains open and draft; main remains `c6152b38`. No new open code issue or PR review was observed.

Fresh [main scheduled run77](https://github.com/panelreply-business/panelreply-demo/actions/runs/44912159620), completed November 21 at 9:08 AM EST, passed 396 checks (291 Node, 105 Chromium) and two public suspension guards, with three policy-blocked public application checks. **This tests main, not PR8.** A fresh full PR8 execution is **BLOCKED** today: local Node 22.16.0 is below the required version, git remote resolution failed, and the available GitHub Actions interface cannot dispatch an authorized full matrix without a code change or repeated individual jobs. No fresh PR cases are claimed.

The [run76 source-bound ledger](evidence/independent-products-verification.json) remains the last verified PR8 full result: 24,372 passing case/platform observations, 9,114 distinct cases, 7,467 generated distinct cases, 7,017 duplicate observations excluded and 237 evidence-harness passes excluded. Callback 10,351, spreadsheet 11,836 and shared 2,185, counted once. All 30 automated platform requirements passed. Seven required platform scopes remain NOT TESTED; the active milestone remains 10,000 rather than being raised to 20,000.

Fresh Render service and event reads confirm **both owner-suspended**, auto-deploy and PR previews off, with no post-suspension service event or deployment. Independent external GET retrieval was inaccessible from this environment. Today's main CI suspension guards passed, but are not substitute PR application tests. Existing OCR quality remains FAIL (277/310, 33 nonexact). Required OCR isolation remains BLOCKED (zero native denial cases). Actual model, authorized representative photographs, real Excel/Safari/phones, selected-host and offsite recovery remain incomplete. No new code defect was confirmed through this read-only audit; no fix is claimed.

**Callback:** GO for draft review and synthetic evaluation, NO-GO for human trial/release. **Spreadsheet:** GO for draft review and synthetic evaluation, NO-GO for human trial/release. No provider calls, customer interactions, spending, service-state changes, PR merge or deployment. [Day evidence](evidence/daily-audit-2026-11-21.json).


## Independent product checkpoint — November 20, 2026 (EST)

The callback and spreadsheet programs now have separate startup/configuration, bound data, sessions, routes, backups and release decisions. [Run76](https://github.com/panelreply-business/panelreply-demo/actions/runs/44788287151) completed successfully at 1:15 PM EST with all 31 workflow jobs successful. Its source-bound ledger records 24,372 passing product case/platform executions across 9,114 distinct product cases. All 30 automated platform requirements pass. Seven required platform scopes and the product-specific quality/operating gates remain open.

The [daily checklist](DAILY_QUALITY_CHECKLIST.md) is enabled for 10:00 AM America/Detroit from November 21 through December 20, 2026, inclusive. November 20 is this completed development and verification session. December 20 produces separate readiness decisions and bounded real-world test plans. December 31 remains the first-release target. Product order and the second release date remain undecided.

### Verified source and counts

- Branch source: `ca5f0cbfbf0d23cc20e007018c13cc630fb8f42a`.
- Tested PR merge: `7a9b95ac3d36ff238ef49b036457e4d00e77a972`.
- Matching branch and tested-merge tree: `8f4c704af5ead9f6a76cadd83fc6ec2fa2d5b131`.
- Executable/test/workflow manifest SHA-256: `823418de33d6f2d166d6aae9013f6b3baf2ca43ecd1286bed76b5e81bb218e81`.
- All 27 input reports are complete, clean and unchanged during execution. An independent aggregate matches the CI ledger, including every case/platform result.

| Scope | Distinct product cases | Product case/platform passes |
| --- | ---: | ---: |
| Callback | 3,321 | 10,351 |
| Spreadsheet | 4,118 | 11,836 |
| Shared, counted once | 1,675 | 2,185 |
| Portfolio | 9,114 | 24,372 |

The distinct total includes 7,467 generated input/state cases and 1,647 cases not marked generated. Product failures, errors, skips, cancelled and unexecuted outcomes are zero in the completed ledger. The goal excludes 237 evidence-harness passes and 7,017 duplicate observations from overlapping suites. Prior runs and the standalone assistant evaluation are not added again. [Final evidence, artifact digests and matrix](evidence/independent-products-verification.json).

Node product executions total 22,739: full Linux 8,863, portable Windows 6,938 and portable Intel macOS 6,938. Linux portable repeats the same 6,938 cases and is deduplicated. Browser executions total 1,633 across 23 jobs. Each selected program passes seven journeys in each of Linux Chromium, Firefox and WebKit, totaling 42. Mobile emulation passes 40 journeys in Chromium and 40 in WebKit, with browser-generated trusted touch events. Each Intel Mac engine passes all 92 static-client methods. Browser builds, channels and OS/runtime versions remain in the evidence.

Both numeric thresholds, 10,000 and 20,000 case/platform passes, are exceeded. The complete all-platform goal is not achieved. The active target remains 10,000, with no recorded first-goal achievement date. The [milestone policy](TEST_MILESTONES.md) retains the one-time increase to 20,000 only if the complete first goal is verified before December 31. Missing platforms and quality requirements cannot be waived by a count.

### Separate controls and corrected defects

[Product separation](PRODUCT_SEPARATION.md) documents the fixed callback and spreadsheet entrypoints. Callback never starts OCR. Spreadsheet cannot activate callback or model routes. Each product rejects the other's data binding and authenticated backup identity. The combined entrypoint remains an internal integration harness and refuses product-bound data. Separate [callback](CALLBACK_RELEASE_ACCEPTANCE.md) and [spreadsheet](SPREADSHEET_RELEASE_ACCEPTANCE.md) records control readiness, launch, rollback and recovery. A future merger needs a reviewed migration and both products' acceptance evidence.

The expanded tests found and verified corrections for customer-name apostrophe handling, unrelated-role name cues, callback page titles, export pointer activation, walkthrough focus restoration, small-width text reflow, root-page native keyboard order and Mac dropdown dimensions. Existing assertions remain. The [defect register](PRELAUNCH_DEFECTS.md) preserves before/after evidence.

### Open release requirements

Seven platform scopes remain NOT TESTED: actual macOS Safari, physical iPhone Safari, physical iPad Safari, physical Android Chrome, private product workflows on Windows, private product workflows on macOS and Apple silicon macOS. Intel results, bundled WebKit and device emulation do not establish those scopes.

Run76 separately passes nine native OCR execution cases, eight native resource/lifecycle cases, nine independent XLSX-reader cases, five storage/recovery groups and nine concurrent HTTP groups across 516 responses with zero unexpected errors. The 334-scenario, 374-turn assistant evaluation overlaps Node coverage and uses zero real-provider calls. Controlled recovery does not establish selected-host restart, failover or offsite recovery.

Native OCR quality remains FAIL at 277/310 exact synthetic images, with 33 nonexact and zero native errors/review violations. Required worker isolation remains BLOCKED before any native deny case, with startup cause unconfirmed. Actual-model, representative-photo, Excel, selected-host and operating evidence remain incomplete. Both public suspension guards pass; three public application checks remain policy-BLOCKED. Each program requires its own applicable gates before a trial or release. The work remains in draft PR8.

### Preserved verification history

[Run75 evidence](evidence/independent-products-run75.json) preserves 24,370 passes and two Intel Mac WebKit failures on source `3bbb0528ba4487e0aa9b3298ad1b5d475939fe70`. Run76 verifies both corrections on its own source. [Run74 evidence](evidence/independent-products-run74.json) preserves the failed Windows skip-link case and ARM64 Mac jobs that received no assigned runner. The queue cause is unconfirmed. Those observations are historical and are not added to the final count.

This follow-up changes documentation and evidence only. Its 155 executable/test/workflow source files retain the manifest verified in run76. The older combined-release records below are historical evidence, not current launch approval.

## Continuation checkpoint — November 19, 2026 (EST)

### Verified continuation result

Implementation commit `ca9dd8abe28a1d945b1f8c64d11a5829bf3a6e9b` passed [run70](https://github.com/panelreply-business/panelreply-demo/actions/runs/44662687751), completed at 10:00 PM EST on November 19. All seven jobs succeeded. Application executions: 1,150 Node/HTTP, 197 Chromium, 132 Firefox, 132 WebKit, 17 native OCR/resource and nine workbook-reader cases, totaling 1,637 PASS, zero failures and zero application skips. The nine additional cases comprise eight in-memory retention cases and one real store integration case. Linux CI verified the disk-backed integration that this Windows host could not execute under the unchanged POSIX permission contract.

Both suspension guards passed. Three public checks remain policy-blocked. The 12-client, 516-response workload passed all nine workflow groups without unexpected errors. OCR stayed 277/310 with zero native errors or review violations, so accuracy remains FAIL. Required isolation is still BLOCKED before any native deny case. No real-provider call occurred. [Final machine-readable evidence](evidence/continuation-verification.json).

The evidence follow-up changes documentation only. Its runtime, test and workflow files remain those tested at ca9dd8a. No duplicate application run is needed for those documentation edits. The earlier pending wording below describes the pre-CI state and is superseded by this result.

The branch had advanced to `c0a947e8415f990f4d58e29a4a1b13ed14bd4982` before this continuation. [Run69](https://github.com/panelreply-business/panelreply-demo/actions/runs/44659300598) completed successfully. Fresh reads of all seven jobs and their logs verify 1,628 application executions: 1,141 Node/HTTP, 197 Chromium, 132 Firefox, 132 WebKit, 17 native OCR/resource and nine workbook-reader cases, with no application failures. Two suspension guards passed and three public checks remained policy-blocked. The 12-client workload completed 516 responses and nine workflow groups with zero unexpected errors. Counts overlap the focused evaluations and must not be added to them. [Checkpoint evidence](evidence/continuation-checkpoint.json).

OCR remains 277/310 and FAIL. Required worker readiness remains BLOCKED, with zero native deny cases executed. Its bounded stderr reports `bwrap: loopback: Failed RTM_NEWADDR: Operation not permitted`. The diagnostic classifier still reports an unconfirmed startup cause. A successful workflow is not isolation acceptance.

This continuation adds a store-level retention review. An explicit timestamp and bounded result limit select closed, non-held requests and inactive panel projects for one business. Output contains identifiers, saved versions, dates and dependency counts, without customer content. A consistent read transaction makes no database changes. It does not configure a policy, delete records, add an HTTP route or run a schedule. Eight in-memory SQLite cases pass locally. The store integration case needs Linux CI because existing owner-only POSIX permission enforcement rejects this Windows filesystem. The baseline usage suite produced three passes and 14 permission failures locally. No security assertion was relaxed.

The continuation's broader local run passes 702 checks with zero failures or skips, including the eight new review cases. Generated-demo/CSP validation also passes. These are executed local scopes, not a Linux integration result. The initial new fixture used nonexistent columns and lacked parent business rows. Its schema errors were corrected against the shipped schema before all eight cases passed.

The older sections below retain their historical checkpoints. The release matrix now distinguishes run69 evidence from the new retention candidate. PR8 stays draft. No Render state change, deployment, merge, paid provider call or customer interaction was performed.

## Current engineering remediation

The final remediation directive is being executed on the same branch and draft PR8. No website redesign, merge, deployment, paid service or customer integration is involved. Both Render services still report suspended, auto-deploy off and previews off in the fresh read-only checks.

[Remediation verification](REMEDIATION_VERIFICATION.md) is the current detailed checkpoint. The earlier run66 report below remains historical evidence for source 17223d6. It does not verify the new source.

The candidate adds 334 curated synthetic AI scenarios, durable usage accounting, explicit provider configuration preparation, tenant/version/idempotency-aware deletion and schema-3 recovery. OCR has improved from 253 to 277 exact images on the unchanged 310-image set, with no regression among previously exact cases. The remaining 33 nonexact images keep that quality gate FAIL. Real AI quality remains BLOCKED.

Independent review found corrections that needed field-specific permission, deletion retries that could lose an earlier uncertain outcome, timeout accounting misclassification, and STOP/safety persistence lost at the transcript limit. Reproduction and regression evidence is recorded in the [defect register](PRELAUNCH_DEFECTS.md).

The final applicable local run passed 1,117 checks with zero failures or skips, including the transcript-limit and monotonic-clock regressions. [Hash-bound local evidence](evidence/remediation-local-verification.json) records the source files and executed log. Actual browser, concurrent HTTP and restricted-worker evidence must come from the committed CI candidate. Until then those rows remain NOT TESTED or BLOCKED in the [release matrix](RELEASE_ACCEPTANCE.md).

The first remediation candidate [4b26ace](https://github.com/panelreply-business/panelreply-demo/commit/4b26aceee1c2ff069ba6f3ce28e539fa492bd343) passed 1,609 application checks in [run67](https://github.com/panelreply-business/panelreply-demo/actions/runs/44653806457), with zero application failures or skips. The bounded HTTP drill passed nine workflow groups and completed 516 responses without unexpected errors. Both suspension guards passed. The separate OCR accuracy gate remains FAIL at 277/310. Required-worker readiness was BLOCKED with an indeterminate startup cause. Screenshot inspection then found a deletion-dialog contrast gap. The follow-up fixes that contrast, adds a computed-style browser regression, records bounded diagnostics from the same readiness attempt, and publishes the measured OCR hashes in CI. Follow-up integration evidence is pending.

No passing aggregate will override the outstanding OCR, real-model, representative-photo or selected-host recovery gates. Public release remains NO-GO.

---

## Historical pre-remediation checkpoint

The following November 19, 2026 report is retained as historical evidence for source 17223d6 and documentation checkpoint 36b2bf3. Its unfinished-work list describes that earlier source. The current remediation section and release matrix supersede it. Continue the existing feature/interactive-dual-product-site branch and draft [PR8](https://github.com/panelreply-business/panelreply-demo/pull/8).

## Current decision

GO for code review and isolated synthetic evaluation. NO-GO for a human pilot, real-provider activation or public release.

Application and test source [17223d6](https://github.com/panelreply-business/panelreply-demo/commit/17223d6b972cc4bd3e58e9412964d237cbc0eeb9) passed 1,096 executed application checks with zero application failures in [run66](https://github.com/panelreply-business/panelreply-demo/actions/runs/44634698683). Attempt 1 failed because the two required public-suspension guards failed. After explicit owner approval, both services were suspended and only that job was rerun. Attempt 2 succeeded at 7:30 PM EST on November 19 with two suspension guards PASS and three public application checks policy-BLOCKED. The 1,096 application results carried forward and were not rerun. The separate OCR quality gate remains FAIL.

This evidence checkpoint changes documentation and screenshots only. The runtime, tests and workflow remain the source verified above. No new application verification is inferred from a documentation commit.

## Source and baseline

- Starting commit: 41e31a8683bbf2e587b4dfcec8c5d2f2a65cffa8. All 120 local blobs matched its recursive GitHub tree before editing.
- Main remains c6152b38ae2e3a824e6a81199aa0d757d47a19ae. PR8 remains draft and unmerged.
- Pre-launch implementation: [c5a4754](https://github.com/panelreply-business/panelreply-demo/commit/c5a47542d665a7d5ffb202e1cde4669c85512243).
- Browser activation and fixture corrections: [2866e05](https://github.com/panelreply-business/panelreply-demo/commit/2866e05169a42a815fbd9053a0d307ef084f230a), then [17223d6](https://github.com/panelreply-business/panelreply-demo/commit/17223d6b972cc4bd3e58e9412964d237cbc0eeb9).
- Tested tree: f2b36ddf779e25be6de7cd496867afa53e3c6ca4, with all 156 blobs matched to the candidate. GitHub's temporary CI merge tree is identical. This is not a merge into main.
- Historical [run62](https://github.com/panelreply-business/panelreply-demo/actions/runs/44536934974) was fully green on the starting branch before the observed service-state discrepancy: 590 PASS and three intentional public blocks. Those results are historical, not new-code evidence.
- Fresh local baseline: 397 Node/SQLite/in-process API tests PASS. Updated local suite: 638 PASS, zero failures or skips. Real HTTP and browser execution used CI because local listeners/browser launch were unavailable.

## Verified run66 attempt 1 results

| Layer | PASS | FAIL | Scope |
| --- | ---: | ---: | --- |
| Node, API, SQLite, recovery, security and real HTTP | 645 | 0 | Includes six independent concurrent-writer cases and the synthetic AI corpus |
| Chromium 151.0.7922.34 | 186 | 0 | Existing 175 cases, four assistant cases and seven XLSX cases |
| Firefox 153.0 | 121 | 0 | Marketing, private intake, panels, recovery, responsive platform, assistant and XLSX |
| WebKit 26.5 | 121 | 0 | Same seven workflow suites; this is not an actual Safari test |
| Actual native OCR and resource/lifecycle cases | 14 | 0 | Tesseract 5.3.4/English in CI, including shutdown, CPU/memory limits and reaping |
| Independent ZIP/XML/openpyxl workbook reader | 9 | 0 | Exact original-file values/types and nonexecuting formula-like text |
| Executed application checks | 1,096 | 0 | Browser-engine repetitions are executions, not distinct product requirements |
| Required public-suspension guards | 0 | 2 | Both public URLs returned HTTP 200 instead of the required 503 |

Three public application checks are BLOCKED by the suspension policy and were not executed. Their legacy skip text describes the policy, not the observed service state. Build/generated-demo/CSP validation passed. There were no actual model requests, customer communications or customer data.

The standalone 49-scenario evaluation overlaps tests already counted above. The storage workload is one drill with five workflow groups. The 310 OCR measurements are separate quality measurements. None are added again to the 1,096 total.

[Machine-readable results and source provenance](evidence/prelaunch-verification.json). This table preserves the original failed suspension observations. The later owner-approved correction and isolated job rerun are recorded separately in [suspension evidence](evidence/public-suspension-2026-11-19.json).

## Completed and verified

| Workstream | Implementation and evidence |
| --- | --- |
| Existing website and unified private workspace | Preserved. All existing intake, panel, recovery, consent, safety, authentication and tenant checks remain. The six requested widths and guided-dialog landscape behavior passed. |
| Conversational assistance boundary | Multi-turn draft/context, grounded field proposals, corrections, clarification, approved business answers, bounded retries/timeouts and cancellation. Ten in-process API cases and four browser scenarios per engine cover the new integration. The default remains deterministic. |
| Disabled real-provider transport | Fixed Responses endpoint, explicit authorization/configuration/injected transport, strict structured output, bounded streaming, cancellation and redacted errors. 31 mock HTTP cases pass. No actual provider connection was activated. |
| XLSX export | Saved-project export through the existing authenticated tenant boundary. Explicit text cells, numeric quantities, two worksheets, frozen headers and filters. Independent reader plus all seven browser cases pass in each engine. CSV remains available. |
| Native OCR limits and measurements | Fixed local engine, process ceilings, one active recognition and safe cancellation/shutdown. Two ambiguity defects corrected. All candidates remain unreviewed. |
| Concurrency and recovery | Six actual cross-connection worker cases pass. A bounded two-business workload preserved 204 projects, 301 requests, image bytes, exact exports and restrictions through encrypted restore. Source data stayed unchanged. |
| Browser defects | Error rendering no longer moves Export during pointer activation. Firefox/WebKit focus checks pass. Playwright callback errors were corrected without removing assertions. Geometry comparisons retain the 44 px requirement at 0.001 CSS-pixel precision. |
| Business and operations preparation | Competitor comparison, positioning hypothesis, subscription options, cost variables, host options, recovery proposal, support, retention, legal inputs and rollback plan. No prices, SLA, legal terms or services were activated. |

See [AI evidence](AI_PRELAUNCH.md), [XLSX evidence](XLSX_EXPORT.md), [OCR benchmark](OCR_BENCHMARK.md), [stress/recovery](STRESS_RECOVERY.md), [defect register](PRELAUNCH_DEFECTS.md) and [operations proposal](PRELAUNCH_OPERATIONS.md).

## Measured limits and unfinished work

- OCR: 253/310 synthetic images exactly matched all expected fields; 57 remain nonexact. Known-field matches were 177/219 part numbers, 190/219 manufacturers and 210/229 descriptions. Zero false positives on fields expected to be blank does not mean all extracted values were correct. Real job-site accuracy is NOT TESTED.
- AI: 49 curated synthetic scenarios, 52 turns, 312 field checks, 47 context checks and 47 fake calls passed. Zero real-provider calls. This proves the tested integration behavior, not model accuracy, relevance or production quality. The requested 300–500 meaningful scenario target is not complete.
- Workload: the CI storage/recovery drill finished in 1,792 ms with zero unexpected errors. This is one synchronous storage drill, not a hosted-load result, latency SLA or many-user capacity claim.
- Spreadsheet compatibility: original XLSX files passed exact openpyxl readback. The available LibreOffice development build opened all nine fixtures, but resaving can normalize blank cells/newlines and escape-like strings. Microsoft Excel is NOT TESTED.
- Hosted private access, offsite restoration, retention/deletion, monitoring delivery, self-service recovery, an OS-level OCR sandbox and durable AI spending limits are NOT IMPLEMENTED.
- Actual Safari, physical phones, full assistive-technology conformance and production Core Web Vitals are NOT TESTED.

## Configuration defect resolved with owner approval

OPS-01 was HIGH / FAIL: repeated Render checks reported both existing services as not_suspended, with update times of 5:02:59 PM and 5:03:10 PM EST on November 19. Run66 attempt 1 independently returned HTTP 200 from both URLs. These historical observations remain recorded.

The owner approved the explicit request to suspend both services again. The AI service was suspended at 7:28:44 PM EST and the static service at 7:29:45 PM EST on November 19. Fresh Render reads confirmed suspended, suspender user, auto-deploy off and PR previews off for both services.

- [PanelReply AI service](https://dashboard.render.com/web/srv-dbv6do6tlv9c73fuvar0)
- [PanelReply static service](https://dashboard.render.com/static/srv-dbu5o8tckfvc73b6fb4g)

Only the failed Required public suspension job was rerun. Its new job [135989918969](https://github.com/panelreply-business/panelreply-demo/actions/runs/44634698683/job/135989918969) passed from 7:30:20 to 7:30:26 PM EST: two PASS, zero FAIL and three policy-skipped checks reported as BLOCKED. Both GET responses were HTTP 503, contained Render's exact owner-suspension message and contained no PanelReply application markup. Run66 attempt 2 is successful. The other jobs retain their original execution timestamps and results.

OPS-01 is resolved within this verified scope. [Machine-readable suspension evidence](evidence/public-suspension-2026-11-19.json) and [AI service dashboard capture](evidence/public-ai-suspended-2026-11-19.jpg). No application code, tests or workflow changed, and no merge, deployment or provider activation occurred. The services contain the older main-branch demos, not this unmerged private-workspace branch. Keep both suspended. Reopening or any further service-state change requires separate owner approval.

## Evidence history and visual review

Run64 exposed the validation-focus defect, Firefox fractional-coordinate assertions and three XLSX callback errors in each engine. Run65 verified the focus/geometry corrections and exposed the remaining route callback's positional-argument error. Run66 passed every application case after the correction. Earlier failures remain in GitHub and the defect register.

Two new Chromium run66 panel-workspace captures were inspected: [1440 px desktop](evidence/prelaunch-panels-desktop.jpg) and [360 px mobile](evidence/prelaunch-panels-mobile.jpg). The saved export controls, contained table scrolling, source-image area and mobile layout fit the captured states. [Capture provenance](evidence/prelaunch-captures.json). Historical marketing/dashboard captures remain in the [redesign record](PLATFORM_VERIFICATION.md). Screenshot review does not prove every state is defect-free.

## Next actions and approvals

1. Keep both public services suspended and monitor their configuration with read-only checks. The owner-approved correction is verified.
2. Continue OCR improvements from the recorded failure corpus and obtain authorized noncustomer photographs before claiming representative accuracy.
3. Expand meaningful conversation scenarios. Obtain a model, data-transfer terms and a bounded approved budget before any real-provider call.
4. Implement and verify durable usage limits and a restricted OCR worker before customer/provider activation. Prepare a bounded HTTP workload without treating the storage drill as HTTP capacity.
5. Approve a host, backup destination, retention/deletion policy and support responsibility, then execute the selected-host recovery/security gates.
6. Keep PR8 draft. Merge, public deployment, live integrations, customer data, spending and a pilot each require separate approval.

The recurring audit remains the existing task. It must read this record and fresh refs, distinguish new execution from historical results and preserve all deployment and authorization restrictions. No continuous 100–200 hours of work is claimed.

