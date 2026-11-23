# Release acceptance

## November 23 daily acceptance review

[Main CI run79](https://github.com/panelreply-business/panelreply-demo/actions/runs/45194906999) passed 396 main-only checks and both public suspension guards at 9:33 AM EST, but did not test unmerged PR8. Fresh full PR8 execution is **BLOCKED** by source-checkout/runtime/full-dispatch limits. PR8 executable/test/workflow files remain identical to source `ca5f0cb`, previously verified in [run76](https://github.com/panelreply-business/panelreply-demo/actions/runs/44788287151): 24,372 PASS, 9,114 distinct cases, no product failures. Seven required platform scopes remain NOT TESTED and therefore the 10,000 platform-qualified goal remains open. Callback real-model is BLOCKED (zero calls); spreadsheet OCR accuracy FAIL (277/310) and required native isolation BLOCKED (zero denial tests). Actual Safari/physical devices, representative photos, actual Excel, selected-host/offsite recovery, support/pricing/legal and activation approval remain open. Both public services remain suspended. **Both product trials and releases remain NO-GO.** [Daily evidence](evidence/daily-audit-2026-11-23.json).


## November 22 daily acceptance review

No changed application, test or workflow files since source `ca5f0cb`. Fresh [main run78](https://github.com/panelreply-business/panelreply-demo/actions/runs/45030730688) passed 396 main-only checks and two suspension guards, not PR8 acceptance. Today's fresh PR8 regression is **BLOCKED** by environment/dispatch constraints. Last full PR8 [run76](https://github.com/panelreply-business/panelreply-demo/actions/runs/44788287151) retains 24,372 verified case/platform passes with zero product failures, but seven required platform scopes **NOT TESTED**. Callback actual-model **BLOCKED**; spreadsheet OCR quality **FAIL 277/310**, isolation **BLOCKED**; real photos, actual Excel, approved host/offsite recovery and operating gates remain open. Both products **NO-GO** for trial/release. The active numeric milestone remains 10,000 until its required platform coverage is completed. [November 22 daily evidence](evidence/daily-audit-2026-11-22.json).

## Current release structure — November 20, 2026

Callback and spreadsheet have independent release decisions. Use [callback release acceptance](CALLBACK_RELEASE_ACCEPTANCE.md) and [spreadsheet release acceptance](SPREADSHEET_RELEASE_ACCEPTANCE.md) for their product gates. [Product separation](PRODUCT_SEPARATION.md) defines fixed entrypoints, data and recovery boundaries. The combined matrices below remain historical technical evidence.

The first-release target is December 31, 2026. Product order and the second date remain undecided. The [daily checklist](DAILY_QUALITY_CHECKLIST.md) is enabled at 10:00 AM America/Detroit through December 20, followed by separate readiness reviews for real-world testing.

### Current verified result

Source `ca5f0cbfbf0d23cc20e007018c13cc630fb8f42a` passed [run76](https://github.com/panelreply-business/panelreply-demo/actions/runs/44788287151). The tested PR merge `7a9b95ac3d36ff238ef49b036457e4d00e77a972` has the same Git tree. All 31 workflow jobs succeeded. The [final source-bound evidence](evidence/independent-products-verification.json) records 24,372 product case/platform passes across 9,114 distinct cases, with zero failures or unresolved product outcomes. It excludes 237 harness passes and 7,017 overlapping observations.

| Requirement | Result | Current evidence and limit |
| --- | --- | --- |
| Automated platform matrix | PASS | All 30 configured requirements pass. Linux, Windows and Intel Mac; bundled engines, selected Chrome/Edge channels, emulation and fixed-product journeys. |
| Selected program journeys on Linux | PASS | Callback 21/21 and spreadsheet 21/21 across Chromium, Firefox and WebKit. |
| Complete required platform coverage | NOT TESTED | Seven scopes remain: actual macOS Safari, physical iPhone/iPad Safari, physical Android Chrome, Windows/macOS private product workflows and Apple silicon macOS. |
| Callback actual-provider/model quality | BLOCKED | Zero real-provider calls. Synthetic contracts do not measure actual-model behavior. |
| Spreadsheet synthetic OCR quality | FAIL | 277/310 exact images. All 33 nonexact outcomes remain recorded. |
| Spreadsheet required native isolation | BLOCKED | Zero native deny cases. Readiness cause remains unconfirmed. |
| Representative photos and actual Excel | NOT TESTED | Controlled synthetic images and independent file readers are separate evidence. |
| Selected-host, offsite recovery and operation | BLOCKED | Controlled local restart/recovery passes do not establish these requirements. |
| Product release or real-world trial | BLOCKED | Each program needs its own applicable quality, operating and activation decision. |

The numeric execution count exceeds 10,000 and 20,000. The complete all-platform goal remains open, so the active target is still 10,000 and its achievement date is unset. [Counting policy](TEST_MILESTONES.md) and [platform requirements](test-milestones.json) preserve the one-time increase to 20,000 if the complete first goal is verified before December 31. Shared cases count once. Emulation and bundled WebKit are separate from physical devices and actual Safari.

[Run75](evidence/independent-products-run75.json) retains its two Mac failures and source. Run76 proves the native-Tab and dropdown corrections against the new source. [Run74](evidence/independent-products-run74.json) retains its Windows skip-link failure and unassigned ARM64 jobs. Prior failed observations are preserved, not transferred into passing results.

Callback and spreadsheet require separate GO/NO-GO decisions. A product-specific failure does not block the other after the shared and dependent gates pass. Neither date nor count activates a service. Both public suspension guards pass, and PR8 remains draft.

## Continuation reconciliation

Final continuation source `ca9dd8abe28a1d945b1f8c64d11a5829bf3a6e9b` passed [run70](https://github.com/panelreply-business/panelreply-demo/actions/runs/44662687751): 1,637 application executions, zero failures or application skips. The nine additional cases verify retention review, including its actual store integration. DEL-04, PERF-02, UX-01, A11Y-01 and DEP-01 retain PASS for this source. RET-01 now includes a passing Linux store integration. OCR-02 remains FAIL and OCR-04 remains BLOCKED. [Final evidence](evidence/continuation-verification.json). This supersedes pending-candidate wording below.

[Run69](https://github.com/panelreply-business/panelreply-demo/actions/runs/44659300598), source `c0a947e8415f990f4d58e29a4a1b13ed14bd4982`, supersedes the pending integration wording below for that source. Independently inspected job logs report 1,628 passing application executions and no failures. [Evidence](evidence/continuation-checkpoint.json). This evidence does not cover the subsequent retention-review candidate.

| Gate | Current executed scope | Result | Remaining work |
| --- | --- | --- | --- |
| DEL-04 | Eleven deletion browser cases in each of Chromium, Firefox and WebKit, including dialog contrast | PASS | Later changes need their own CI. |
| PERF-02 | Twelve clients, 516 HTTP responses, nine workflow groups, zero unexpected errors | PASS | Selected-host capacity remains unverified. |
| UX-01 | Run69 Chromium 197, Firefox 132 and WebKit 132 executions | PASS | Physical devices and actual Safari remain NOT TESTED. |
| A11Y-01 | Existing browser semantics/focus/geometry plus computed dialog contrast | PASS | Full assistive-technology audit remains NOT TESTED. |
| DEP-01 | Two GET-only suspension guards | PASS | No service-state change authorized. |
| OCR-02 | 277/310 exact synthetic images | FAIL | 33 nonexact images and representative photos. |
| OCR-04 | Required-worker readiness exits before native deny tests | BLOCKED | Startup diagnostic is recorded without a confirmed root cause. |
| RET-01 | Eight in-memory SQLite cases and one store integration, all passing in run70 | PASS | No automatic retention or deletion policy enabled. Review UI, legal holds and archive expiry remain separate work. |

All actual-model, selected-host, offsite-recovery and release approval gates remain open. NO-GO for launch.

Remediation checkpoint, November 19, 2026. This matrix separates executed test scopes from unverified external integrations. It uses PASS, FAIL, BLOCKED and NOT TESTED only. A PASS never approves deployment or establishes behavior outside its named test scope.

The baseline was commit 36b2bf3 on `feature/interactive-dual-product-site`, draft PR8. All 163 starting blobs matched. Its historical application source 17223d6 had 1,096 passing application checks in run66 attempt 1. Attempt 2 reran only the suspension guard after owner-approved suspension. Those results do not verify new remediation code.

Current candidate integration results and exact source are recorded in [remediation verification](REMEDIATION_VERIFICATION.md). Entries marked NOT TESTED below await that candidate's actual CI run.

| ID | Requirement and scope | Implementation | Executed test / evidence | Result | Remaining blocker |
| --- | --- | --- | --- | --- | --- |
| BASE-01 | Preserve latest verified work and branch | Same branch, PR8 draft, baseline snapshot | 163 Git blobs matched. Fresh unchanged local baseline 638/638. | PASS | No merge authorization. |
| AI-01 | At least 300 meaningful synthetic scenarios | 334 curated cases, original 49 unchanged | 334 scenarios, 374 turns, 2,196 field and 331 context comparisons. [AI evidence](AI_PRELAUNCH.md). | PASS | Fake proposals do not measure a real model. |
| AI-02 | Context, extraction, corrections, conflicts and approved answers | Deterministic validation and field-bound evidence/correction cues | Component, corpus, API and independent adversarial fixtures | PASS | Only executed synthetic cases are covered. |
| AI-03 | Timeout, cancellation, malformed output, retry and session controls | Bounded orchestrator, strict output contract, post-await checks | Component/API and independent completion-failure/cross-session races | PASS | Real-provider timing and semantics remain unverified. |
| AI-04 | Disabled provider transport and configuration mechanics | Fixed transport, explicit approvals, frozen prepared config | 31 mock transport cases and configuration-negative tests | PASS | This row covers mock/configuration behavior only. |
| AI-05 | Actual model compatibility and intake quality | Adapter prepared, never activated | Zero real-provider calls | BLOCKED | Provider/model, data-transfer and finite budget approval plus actual evaluation. |
| AI-06 | Durable business usage and configured allowances | Schema-3 reservations and server-owned policies | 17 focused ledger cases, cross-connection races, API tests and backup roundtrip | PASS | Monetary reservations are not measured invoices. Selected model pricing/cost-bound validation pending. |
| SAFE-01 | Consent, opt-outs and safety holds in tested flows | Persistent opt-out and business-scoped safety digest, pre/post-generation checks | Hazard/STOP/parser corpus, same-phone recreation, first-message checks and independent races | PASS | No general natural-language detection guarantee. |
| DATA-01 | Requests, notes, statuses, transcripts, panels, images and exact saves | Existing tenant-scoped SQLite operations preserved | Current store/API suites and logical-table recovery checks | PASS | Full updated real-HTTP/browser execution pending below. |
| DATA-02 | Concurrent version checks and duplicate submissions | Atomic transactions, idempotency and stale-version rejection | Separate SQLite connection races and terminated transaction tests | PASS | Multi-host architecture is not implemented. |
| DEL-01 | Authorized request/conversation/project/image deletion | Version, ownership, typed confirmation, stable receipt and tombstone | Lifecycle store cases and 24 API deletion cases | PASS | This verifies synthetic data only. |
| DEL-02 | Deleted data cannot be recreated by stale retries | Content-free tombstones and deleted source-link cleanup | Duplicate/concurrent deletion, stale create/upload replay and retained restrictions | PASS | Older archives need later-event reconciliation. |
| DEL-03 | Private deletion UI and response-loss handling | Shared confirmation state machine and same-key retry | 11 independent client-state cases | PASS | DOM tests do not establish browser behavior. |
| DEL-04 | Deletion browser workflows | Eleven workflows, including response loss then 403 and contrast | Run69: eleven cases per engine | PASS | Subsequent candidate changes need CI. |
| OCR-01 | Validation, bounded native pipeline and human review | Fixed Python/Pillow and Tesseract, stdin-only, deadlines, output/resource limits | 72 component/benchmark cases and 17 native fixture/resource cases | PASS | Native libraries still need a host patch policy. |
| OCR-02 | Exact-image synthetic quality | Orientation fallback and conditional pixel normalization | Same 310 images: 253→277 exact, 24 corrected, zero previously exact regressions | FAIL | 33 nonexact images remain. Not real-photo accuracy. |
| OCR-03 | Representative field photographs | Manual correction and source review preserved | No authorized representative photograph corpus | NOT TESTED | Authorized photos and measured evaluation. |
| OCR-04 | Required OS-isolated worker on test host | Fixed mounts, no network, nonroot, seccomp, no fallback | Run69: readiness blocked, zero native deny cases; loopback RTM_NEWADDR denied | BLOCKED | Startup root cause unconfirmed. Actual deny tests still required. No host-policy change. |
| OCR-05 | Required isolation on deployment host | Prepared configuration only | No selected-host execution | BLOCKED | Select and approve host, then verify there. |
| EXP-01 | Saved CSV data and formula-injection protection | Existing encoding/escaping and tenant boundaries retained | Exporter/API cases and exact saved-value comparisons | PASS | Updated browser run pending below. |
| EXP-02 | Typed original XLSX files | Text identifiers, numeric quantities, two worksheets | Nine independent ZIP/XML/openpyxl fixtures plus writer/API cases | PASS | Does not prove every spreadsheet application's resave behavior. |
| EXP-03 | Microsoft Excel | No authorized Excel environment used | No execution | NOT TESTED | Authorized Excel environment and exact readback. |
| AUTH-01 | Session, CSRF, Origin and tenant boundaries | Existing identity pin and rechecks retained | Current API/store, delayed deletion, cross-session and malformed input cases | PASS | Selected-host access and policy remain unverified. |
| REC-01 | Encrypted local backup/restore and source preservation | Schema 1/2/3 strict validation, fresh-directory restore, disabled credentials | Exact logical-table/image hashes, corrupt/invalid archives and terminated restore stages | PASS | Snapshot includes only events present at backup time. |
| REC-02 | Usage/deletion/restriction preservation in a snapshot | Schema-3 archive content and validation | Ledger roundtrip, malformed metadata, pre/post-deletion archive cases | PASS | Later events require reconciliation before re-enabling a restored workspace. |
| REC-03 | Offsite/selected-host recovery | Architecture and owner decisions documented | No offsite execution | BLOCKED | Approved destination, credentials, retention, hosting and actual recovery drill. |
| PERF-01 | Bounded storage/recovery workload | Synthetic 204-project/301-request/five-image drill | Five workflow groups pass with zero unexpected errors | PASS | This is not hosted capacity or a latency SLA. |
| PERF-02 | Multiple actual HTTP clients under failures | Twelve-client loopback workload, contention, OCR backpressure, interruption/restart | Run69: 516 responses, nine groups, zero unexpected errors | PASS | Selected-host capacity remains unverified. |
| UX-01 | Existing browser workflows and six viewport widths | Navy/blue website preserved, private controls extended | Run69: 197 Chromium, 132 Firefox, 132 WebKit cases | PASS | Continuation candidate requires fresh CI. Physical-device checks remain separate. |
| UX-02 | Actual Safari and physical phones | Responsive implementation only | No physical-device execution | NOT TESTED | Authorized devices and browser versions. |
| A11Y-01 | Labels, keyboard, focus, reduced motion and control geometry | Existing semantics plus native confirmation dialog | Run69 browser assertions, including computed contrast, pass | PASS | Full assistive-technology audit remains untested. |
| OPS-01 | Retention, monitoring, support, host policy and operational recovery | Proposals and controls documented | No production operation executed | BLOCKED | Owner decisions and selected-host evidence. Documentation alone is not acceptance. |
| DEP-01 | Both public services remain suspended | No service mutation in remediation | Fresh Render reads after 36b2bf3: both suspended, auto-deploy/previews off. CI GET guards pending for candidate. | PASS | Keep suspended. No deployment approval. |
| DEP-02 | No merge or integration activation | Same draft PR and unchanged main | Fresh GitHub refs and no live provider requests | PASS | Separate approval required for merge, deployment or external activation. |
| LAUNCH-01 | Public release or real-customer pilot | No launch performed | Missing gates above | BLOCKED | NO-GO until required quality, operational and approval gates are met. |

## Decision

GO for source review and isolated synthetic evaluation. NO-GO for public release, real-provider activation or a customer pilot. Preserve both suspensions and PR8 draft status. A green test workflow cannot override OCR FAIL, missing real-model evidence or unverified hosted operations.

