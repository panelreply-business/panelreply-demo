# Pre-launch release acceptance

Current assessment is in progress. Historical passing results do not cover the working-tree changes. This matrix is updated with exact commits/runs after CI. A completed measurement is not necessarily an accuracy PASS. No overall score is calculated.

| ID | Requirement | Implementation | Verification | Current result / remaining gate |
| --- | --- | --- | --- | --- |
| BASE-01 | Preserve latest verified branch and existing intake | Existing PR8 branch,120matching starting blobs | GitHub tree comparison,397fresh baseline checks | PASS on starting41e31a8 |
| AI-01 | Multi-turn and structured proposals | `workspace/assistant.cjs`, `conversation.cjs` | Component, corpus, API and synthetic browser suites | IN PROGRESS, independent adversarial fixes/fullCI pending |
| AI-02 | No unsupported commitments or model actions | Allowlisted fields/intents/topics, approved answers, deterministic wording | Grounding/adversarial and API tests | IN PROGRESS |
| AI-03 | Provider errors/cancellation/duplicate retries | Bounded orchestrator and API cancellation/auth rechecks | Component/API/browser failure cases | IN PROGRESS |
| AI-04 | Real model response quality | No live provider activated | Real-provider300–500scenario evaluation | BLOCKED by explicit provider/data-transfer approval |
| SAFE-01 | Consent, STOP and safety holds | Existing store and deterministic intake boundary | Existing regressions plus adversarial hazard cases | IN PROGRESS, new hazard gaps being corrected |
| OCR-01 | Validated image and bounded local processing | `workspace/ocr.cjs`, private source API | Unit, native resource/lifecycle, API/browser tests | IN PROGRESS, fullCI pending |
| OCR-02 | Synthetic field extraction quality | Same OCR/parser, generated benchmark | Exact fields, false positives, omissions and latency | FAIL: nonexact cases remain; see benchmark |
| OCR-03 | Representative photo quality | Review workflow exists | Authorized noncustomer photo benchmark | BLOCKED: no authorized representative photos supplied |
| DATA-01 | Panel save/reopen/source ownership | Existing SQLite projects/sources | Store/API/browser and parallel-worker tests | IN PROGRESS, regression pending |
| DATA-02 | Concurrent writes and retry integrity | Transactions, versions and idempotency | Real cross-connection workers, interrupted transaction | IN PROGRESS |
| DATA-03 | Intake persistence/history/status/notes | Existing authenticated request API | Existing Node/HTTP/browser tests | IN PROGRESS, regression pending |
| EXP-01 | Corrected saved CSV | Existing CSV exporter and authenticated route | Unit/API/browser exact-value/formula checks | IN PROGRESS, regression pending |
| EXP-02 | Typed safe XLSX | `workspace/xlsx.cjs`, saved export API/UI | Component, independent XML/openpyxl, browser | IN PROGRESS, exact tested-reader evidence required |
| AUTH-01 | Sessions, CSRF, Origin and tenant boundaries | Existing auth/store/API plus assistant rechecks | Unit, API, realHTTP and browser | IN PROGRESS, regression pending |
| SEC-01 | Input/file/export/secret boundaries | Existing validation/CSP, bounded new code | Independent review and negative tests | IN PROGRESS, no absolute-security claim |
| REC-01 | Encrypted backup and fresh-directory restore | Existing backup/reset tools | Existing recovery suite plus workload digests | IN PROGRESS, regression pending |
| REC-02 | Offsite recovery and host objectives | Proposal only | Selected-host restore and approved archive destination | BLOCKED by infrastructure/budget approval |
| UX-01 | Core workflow and six viewport widths | Existing design/application shell | Chromium, Firefox, WebKit workflow suites | IN PROGRESS, new browser execution pending |
| A11Y-01 | Labels, keyboard, focus, motion and errors | Existing semantic controls/shared design | Browser assertions/visual review | IN PROGRESS; assistive-technology audit NOT TESTED |
| PERF-01 | Bounded local storage/resource workload | New workload script, OCR limits | Real timings and integrity/error counts | IN PROGRESS; not production capacity/CWV |
| OPS-01 | Hosting, monitoring, retention and rollback plan | `PRELAUNCH_OPERATIONS.md` | Document review against current architecture | PASS for proposal preparation; hosted implementation BLOCKED |
| BUS-01 | Positioning, competitive facts, cost model, onboarding/support | `PRELAUNCH_OPERATIONS.md` | Official sources plus explicitly proposed decisions | PASS for preparation; pricing/legal/pilot approval pending |
| DEP-01 | Both existing services suspended | Render configuration outside code | Repeated read-only reads, GET-only CI guard | FAIL: both report active; owner state-change approval required |
| DEP-02 | No merge, auto-deploy or PR previews | Main unchanged, both Render settings off | GitHub/Render reads | PASS at baseline; recheck at delivery |

## Decision

NO-GO for a human pilot, live provider activation or public release. Continue isolated engineering and review. Real-model quality, representative OCR, infrastructure/recovery, retention/operations and the required deployment state are unresolved. No test count overrides these gates.

[Authoritative progress](DEVELOPMENT_PROGRESS.md) records the current branch, source and next action. [Historical platform verification](PLATFORM_VERIFICATION.md) remains unchanged as prior evidence.
