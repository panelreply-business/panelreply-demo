# PanelReply development progress

## Current engineering remediation

The final remediation directive is being executed on the same branch and draft PR8. No website redesign, merge, deployment, paid service or customer integration is involved. Both Render services still report suspended, auto-deploy off and previews off in the fresh read-only checks.

[Remediation verification](REMEDIATION_VERIFICATION.md) is the current detailed checkpoint. The earlier run66 report below remains historical evidence for source 17223d6. It does not verify the new source.

The candidate adds 334 curated synthetic AI scenarios, durable usage accounting, explicit provider configuration preparation, tenant/version/idempotency-aware deletion and schema-3 recovery. OCR has improved from 253 to 277 exact images on the unchanged 310-image set, with no regression among previously exact cases. The remaining 33 nonexact images keep that quality gate FAIL. Real AI quality remains BLOCKED.

Independent review found corrections that needed field-specific permission, deletion retries that could lose an earlier uncertain outcome, timeout accounting misclassification, and STOP/safety persistence lost at the transcript limit. Reproduction and regression evidence is recorded in the [defect register](PRELAUNCH_DEFECTS.md).

The final applicable local run passed 1,117 checks with zero failures or skips, including the transcript-limit and monotonic-clock regressions. [Hash-bound local evidence](evidence/remediation-local-verification.json) records the source files and executed log. Actual browser, concurrent HTTP and restricted-worker evidence must come from the committed CI candidate. Until then those rows remain NOT TESTED or BLOCKED in the [release matrix](RELEASE_ACCEPTANCE.md).

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
