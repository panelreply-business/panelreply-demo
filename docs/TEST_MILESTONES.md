# PanelReply release tracks and daily verification checklist

Owner direction recorded November 20, 2026 (America/New_York). This is a plan and audit checklist, not completed implementation, test execution or deployment approval. The authoritative current technical status remains [DEVELOPMENT_PROGRESS.md](DEVELOPMENT_PROGRESS.md) and [RELEASE_ACCEPTANCE.md](RELEASE_ACCEPTANCE.md). Preserve draft PR #8 and the existing branch. Do not create duplicate accounts, implementations, preview sites or public deployments.

## Dates and approval boundaries

- Engineering/audit checklist runs daily through **December 20, 2026**, including December 20. Use the existing automation, not a second schedule.
- December 20 is a **readiness decision**, not automatic permission to use live data or contact people. Real-world tests may start afterward only with a fresh, specific owner-approved pilot scope, participants, data handling, provider spend and security/hosting conditions.
- December 31 is a **target** for the first release, contingent on each product's own acceptance gates and a distinct deployment approval. The second product launches on a separately authorized date, not automatically on December 31.
- Primary test milestone: **10,000 meaningful passing case-by-platform executions** across a documented supported matrix. If verified before December 31, raise the goal once to **20,000**; do not auto-double again. Meeting a count cannot override an unresolved critical or release-blocking gate.
- Zero new cost, external provider activity, customer interaction, public app activation or deployment is authorized by this document. Both existing Render services stay suspended. No merge into main without approval.

## Product tracks: independently controlled

| Track | Product boundary | What exists now | What must be proved before its own release |
| --- | --- | --- | --- |
| **Callback / Intake** | Customer-request capture, business answers, consent, safety, review and contractor inbox. A callback window is only a preference, not a booked appointment. Saving a request sends no call, message or notification. | Authenticated local inbox, deterministic parser, fake-provider assistant, profile approvals, saved requests and JSON records. Real provider transport is disabled; phone/call integrations are absent. | Independent callback/intake build and enable switch, separate release artifact and runbook, threat/tenant/consent tests, real-model evaluation if AI is included, hosted access/recovery, support/legal/price approval. Any calling or delivery requires separately approved integration and end-to-end verification. |
| **Spreadsheet / Panel Parts** | Private panel images, OCR candidate review, corrected rows, save/reopen, CSV/XLSX export and backup. | Authenticated local panel projects, native Tesseract/Pillow pipeline, human review and saved exports. Synthetic accuracy 277/310 exact; 33 nonexact. Required native OS isolation remains BLOCKED. | Independent spreadsheet/panels build and enable switch, separate release artifact and runbook, isolation on chosen host, representative authorized-photo accuracy, source ownership, exact independent spreadsheet readback, hosted recovery and support/legal/price approval. |

### Design requirements for the separation

- The two modules must be independently enabled, disabled, tested, rolled back, priced and released. Neither may silently activate the other. Both need separate readiness and go/no-go decisions.
- Preserve existing common authentication and tenant isolation **inside the current development implementation** during the transition. Do not invent a second identity system. New public entry points, separate hosting or billing require design review and specific approval.
- Separate runtime routes, UI navigation/access controls, configuration, deployment artifacts and release criteria. Prove that disabling one product makes its runtime endpoints unavailable while the other retains full function.
- Make ownership of shared data explicit. Do not migrate, duplicate, delete or combine saved customer data as part of product splitting without a reviewed migration and separately approved procedure.
- Keep future optional bundle/composition in mind: shared versioned identities and documented data contracts, but no forced combined subscription or coupling. A future merger of the products is a later business and engineering decision after both have evidence of adoption.
- Current dual-product website and monolithic local workspace are **not yet independent releases**. Mark separation NOT IMPLEMENTED until verified code and runnable independent artifacts exist.

## Daily audit checklist, November 20–December 20

Record a dated result and evidence link for each item; use PASS, FAIL, BLOCKED, NOT IMPLEMENTED or NOT TESTED. Do not mark boxes complete from earlier-source CI. Every day:

- [ ] Read the newest owner brief, README, DEVELOPMENT_PROGRESS, RELEASE_ACCEPTANCE, defects and the two track-specific plans. Refresh main/PR8 refs, commits, source/test/workflow blobs, reviews, issues and CI jobs.
- [ ] Verify both Render services are owner-suspended, auto-deploy off and PR previews off using read-only access. Attempt safe GET-only external checks. An expected 503 and owner-suspension notice are PASS, not an outage. Public application checks remain BLOCKED.
- [ ] Seek a full applicable regression of the **current PR application source** once per calendar day if not already performed that day. Run isolated/local/no-cost authorized CI where available. Mark execution BLOCKED if Node, network, CI dispatch or native prerequisites prevent it. Never relabel historical CI as a new run.
- [ ] Inspect failing logs and changed code; reproduce any suspicious medium/high issue independently before correction. Do not weaken safety, auth, tenant, consent, OCR or export assertions to make CI green.
- [ ] Run or inspect adversarial consent, STOP/safety, cross-tenant, session expiry, CSRF/Origin, old-password races, fake-provider cancellation/timeout/retry, and exact-value recovery coverage.
- [ ] Run or inspect independent panel image-selection, upload quota, OCR readiness/isolation, manual correction/save/reopen, CSV/XLSX and owner-only export tests.
- [ ] Run or inspect Chromium/Firefox/WebKit responsive and keyboard failures across 360/390/430/768/1024/1440 and landscape; report physical iOS, Android and actual Safari as NOT TESTED until genuinely executed.
- [ ] Verify both independent product enable/disable paths when implemented, including disabled-route response, navigation, state preservation and independent rollback. Until then mark NOT IMPLEMENTED.
- [ ] Update the single progress record and release matrix only with verified new evidence. Report **both** track decisions and separate blocking gates.

## Test-count contract

A test count is a measurable **test case on a named platform/OS/browser/runtime**, with its own stable ID, precondition, assertion oracle, actual execution and source hashes. Browser engines are named separately. Do not count each individual assertion, each generated HTTP request, fixture setup, browser screenshot, or repeated invocation as an independent test.

- Deduplicate a case/platform pair on the same validated source across CI reruns; failed/blocked/skipped and unresolved accuracy outcomes do not contribute to passed counts.
- Record four numbers: **distinct cases**, **case/platform executions**, **passed accepted executions**, and **failed/blocked/not-tested**. Also report generated/property-based cases and real-device cases in their own columns.
- Property-based or parameterized cases count as distinct only when they exercise different declared input equivalence classes/requirements with independent oracles; do not inflate counts by arbitrary seeds.
- Add regression tests for real failure modes first. For each source change, preserve an immutable manifest of test IDs, platform and source hashes, date, outcome, and CI/log/evidence URL.
- Recorded benchmark **310 input images = 277 exact extraction results and 33 nonexact**, not 310 passing tests. The 334 curated fake-assistant scenarios and other focused tests overlap the recorded Node suite and must not be added twice.
- As of this planning record, **run70 source ca9dd8a** has 1,637 passing application executions on its named CI platforms, with no application failures. This is historical verified evidence; it is **not yet reconciled** to the new 10,000-target deduplicated ledger. New milestone accepted count is NOT TESTED until that reconciliation.
- Initial platform matrix: supported Linux/Node real SQLite/HTTP; Chromium, Firefox and WebKit automation with OS and versions recorded; native OCR/security on compatible Linux; openpyxl independent readback. Windows/macOS native, actual Safari, iOS/Android physical devices, Microsoft Excel and assistive technologies are explicit separate gates, not claimed from Linux browsers.
- If the 10,000 milestone including platform requirements is verified strictly before December 31, record the qualifying commit/run/manifest and promotion to 20,000. That is a **new goal**, not a claim that 20,000 passed.

## Milestone checkpoints

| Deadline | Callback / Intake track | Spreadsheet / Panel track | Shared QA / operation |
| --- | --- | --- | --- |
| Nov 27 | Specify independent module controls and acceptance suite without changing auth | Specify independent module controls and export compatibility | Baseline reconciled count, failure taxonomy, daily evidence path |
| Dec 6 | Verify independent runtime enable/disable and preserved inbox data | Verify independent runtime enable/disable and preserved projects | Full CI on changed branch, no new critical/high defects |
| Dec 13 | Synthetic business-answer, consent, restart, cancellation and fake-provider suite | OCR failure-corpus improvement and isolated worker diagnostic/fix, no weakening | Target-count progress plus cross-platform matrix and selected-host plan |
| Dec 20 | Independent release readiness review, clear remaining blockers | Independent release readiness review, clear remaining blockers | Written go/no-go decision **before any** proposed limited real-world evaluation |
| Dec 21–30 | Owner-approved limited testing only if all prerequisites pass | Owner-approved representative photos/Excel/hosting tests only if permitted | Fix new defects, freeze and verify each product separately |
| Dec 31 | First product **target**, only if accepted and explicitly authorized | Separate later launch decision | No auto-merge/deploy, no forced combined release |

## Remaining release gates at this record

- Callback: zero actual model-provider calls; no live calling/messaging, calendar or customer delivery. Provider/model costs and data transfer need separate approval.
- Spreadsheet: 33 of 310 synthetic OCR images nonexact; representative real photographs not measured; required OS-level isolation blocked before native deny tests; actual Microsoft Excel not tested.
- Shared: hosted private access, selected-host offsite recovery, monitoring delivery, backup-expiry/legal-hold/retention policy, self-service recovery, support ownership, pricing/legal review, physical devices and actual Safari. Existing public Render services must remain suspended.
- Independent product artifacts, independently enforceable release switches and independent rollback are **NOT IMPLEMENTED**. These are required before claiming separate product launch readiness.

The development branch remains a draft. Neither product is approved for a customer pilot or a public release at this checkpoint.
