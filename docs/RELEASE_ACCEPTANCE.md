# Pre-launch release acceptance

Assessment date: November 19, 2026. Current tested source is [17223d6](https://github.com/panelreply-business/panelreply-demo/commit/17223d6b972cc4bd3e58e9412964d237cbc0eeb9), verified by [run66](https://github.com/panelreply-business/panelreply-demo/actions/runs/44634698683). The 1,096 application checks passed in attempt 1, which failed because both required suspension guards failed. After owner-approved suspension, attempt 2 succeeded with only the suspension job rerun: two PASS, zero FAIL and three policy-BLOCKED checks. The application results carried forward without re-execution. OCR measurement completion is not an accuracy PASS.

In the table, Source 66 means commit 17223d6 and the application checks executed in run66 attempt 1. The suspension row separately identifies its attempt 2 rerun. A PASS applies to the stated tested scope. It is not commercial readiness.

| ID | Requirement | Implementation / verification | Last evidence | Result / remaining gate |
| --- | --- | --- | --- | --- |
| BASE-01 | Continue verified work without duplicates | All 120 starting blobs matched 41e31a8; existing branch/PR8 preserved | Baseline tree and current GitHub refs | PASS |
| AI-01 | Multi-turn draft, context, corrections and conflicts | Assistant orchestrator, 49-scenario corpus, component/API and four browser cases per engine | Source 66; AI_PRELAUNCH.md | PASS for synthetic integration |
| AI-02 | Grounded fields and approved business answers | Strict allowlist, field-bound evidence, independent adversarial tests, profile-version recheck | Source 66 | PASS for tested proposals |
| AI-03 | Timeouts, errors, cancellation and retries | Bounded calls, cancellation/auth rechecks, unavailable-state preservation and fake browser failures | Source 66 | PASS |
| AI-04 | Concrete provider transport | Disabled Responses adapter; 31 mock HTTP cases including compression and late cancellation | Source 66 | PASS for mock transport; actual provider compatibility BLOCKED |
| AI-05 | Actual model quality | No real-provider calls or credentials activated | 49 fake scenarios do not measure model behavior | BLOCKED by provider, data-transfer and budget approval |
| AI-06 | 300–500 meaningful evaluation scenarios | 49 curated scenarios implemented; no trivial multiplication | Source 66 corpus/evaluation report | NOT IMPLEMENTED beyond 49; expansion remains unfinished |
| SAFE-01 | Consent, STOP and electrical safety holds | Existing deterministic store controls, new bounded hazard cases, in-process/API/browser checks | Source 66 | PASS for tested phrases and restrictions |
| OCR-01 | Validated image, private source and bounded processing | Native engine with prlimit, timeout/cancel/shutdown/reaping, API and browser paths | Source 66; 14 native cases | PASS; process ceilings are not an OS sandbox |
| OCR-02 | Synthetic extraction quality | 310 unique images, exact fields, omissions, wrong values and latency | Source 66 and baseline/candidate benchmark artifact | FAIL: 253 exact, 57 nonexact |
| OCR-03 | Representative photograph quality | Review/correction workflow exists | No approved representative photo set supplied | NOT TESTED; authorized photos needed |
| DATA-01 | Panel save, reopen, corrections and source ownership | Existing SQLite store and authenticated API/browser checks in three engines | Source 66 | PASS for executed workflows |
| DATA-02 | Concurrent updates and duplicate retries | Six independent cross-connection worker races and interrupted uncommitted writer | Source 66 | PASS; sustained hosted concurrency not established |
| DATA-03 | Intake requests, notes, status and history | Existing request API, pure logic, real HTTP and private-browser suites | Source 66 | PASS |
| EXP-01 | Saved corrected CSV and inert formulas | Existing exporter, exact-value API/browser checks and unsaved-draft handling | Source 66 | PASS |
| EXP-02 | Saved typed XLSX with tenant/session boundaries | 13 writer cases, API cases, 9 independent reader fixtures, 7 browser cases per engine | Source 66; XLSX_EXPORT.md | PASS for tested writer/readers/browsers |
| EXP-03 | Native spreadsheet compatibility | Installed LibreOfficeDev 26.8 imported nine files; exact original-file reader tests | Local native observations documented in XLSX_EXPORT.md | PARTIAL evidence: resaving has normalization limits; Microsoft Excel NOT TESTED |
| AUTH-01 | Authentication, CSRF, Origin, session pins and tenant boundaries | Existing store/API, real HTTP and three-engine private workflows | Source 66 | PASS for executed attack/failure cases |
| SEC-01 | Inputs, files, outputs, errors and secret handling | Independent code review, negative tests, CSP and repository pattern scan | Source 66 plus documented local scan | PASS for tested controls; no absolute-security claim |
| REC-01 | Encrypted backup and safe fresh-directory restore | Existing recovery suite plus 204-project/301-request source/restored digest drill | Source 66 | PASS; source unchanged, images/exports/restrictions retained |
| REC-02 | Offsite recovery and host objectives | Review proposal only | PRELAUNCH_OPERATIONS.md | NOT IMPLEMENTED; host/destination/budget approval required |
| UX-01 | Existing design and core workflows at six widths | Chromium 186, Firefox 121 and WebKit 121 executed cases; desktop/mobile captures | Source 66 | PASS; actual phones and Safari NOT TESTED |
| A11Y-01 | Labels, keyboard, focus, motion, feedback and control geometry | Existing assertions retained; focus and precision corrections verified | Source 66 | PASS for scoped automated checks; full assistive-technology audit NOT TESTED |
| PERF-01 | Bounded storage/resource workload | One drill, five workflow groups, zero unexpected errors; CPU/memory/storage observations | Source 66; 1,792 ms CI drill; separate local record | PASS for bounded drill; HTTP saturation, hosted capacity and production CWV NOT TESTED |
| OPS-01 | Hosting, backup, monitoring, retention and rollback proposal | Architecture-specific options and approval gates documented | PRELAUNCH_OPERATIONS.md | PASS for preparation; hosted implementation NOT IMPLEMENTED |
| OPS-02 | Durable provider budgets and restricted OCR worker | Process-local limits exist; durable ledger and OS sandbox absent | AI_PRELAUNCH.md and OCR_BENCHMARK.md | NOT IMPLEMENTED; required before customer/provider activation |
| BUS-01 | Positioning, competitive facts, cost variables, pilot/support/legal inputs | Official sources, labeled hypotheses and proposed decisions | PRELAUNCH_OPERATIONS.md | PASS for preparation; no approved price, SLA, legal document or pilot |
| DEP-01 | Both public services suspended | Owner-approved suspension, Render state reads and GET-only guards | Run66 attempt 2, job 135989918969; both HTTP 503 with owner-suspension text and no app markup | PASS at November 19, 7:30 PM EST; keep suspended and require separate approval for further state changes |
| DEP-02 | No merge, automatic deployment, PR preview or live activation | Main unchanged, PR8 draft, Render auto-deploy/previews off, zero real-provider calls | GitHub/Render reads and Source 66 | PASS at checkpoint; recheck before later actions |
| LAUNCH-01 | Live customer, messaging, calendar and public pilot readiness | No new deployment or live integration | Current restrictions | BLOCKED; separate owner approval and missing engineering gates |

## Verification layers

- Component tests exercise parsing, grounding, validation, storage, writers, resource adapters and error contracts.
- Integration tests use real SQLite connections, encrypted archives, native Tesseract, independent spreadsheet readers and actual loopback HTTP.
- Browser/failure tests exercise saved versus unsaved state, interruption, retries, account changes, uploads, exports and review controls through three engines.

These are different layers. Repeatedly running one assertion does not count as three forms of verification. The finite suite does not prove every defect is absent.

## Release-candidate decision

NO-GO for a human pilot, live-provider activation or public release. Required suspension is now verified. OCR accuracy, representative images, real-model quality, durable usage controls, host isolation/recovery and retention/operations remain unresolved. No aggregate pass count overrides these gates.

GO for owner code/design review and isolated synthetic evaluation. Keep PR8 in draft. Do not merge or deploy.

[Authoritative progress](DEVELOPMENT_PROGRESS.md) · [Defects and reproductions](PRELAUNCH_DEFECTS.md) · [Original verification evidence](evidence/prelaunch-verification.json) · [Suspension follow-up evidence](evidence/public-suspension-2026-11-19.json).
