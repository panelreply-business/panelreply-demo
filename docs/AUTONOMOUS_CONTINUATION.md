# Autonomous development checkpoint

Updated November 23, 2026, America/Detroit. Continue the existing `feature/interactive-dual-product-site` branch and draft [PR8](https://github.com/panelreply-business/panelreply-demo/pull/8). Do not restart the project.

## Current authority

The owner authorizes inspection, implementation, relevant testing, failure repairs, verified development-branch commits and progress updates until all authorized readiness work passes or an execution/usage limit prevents continuation.

No purchase, customer contact, production customer data, public deployment, production merge or software release is authorized. Record approval blockers and continue independent work. Keep both existing public services owner-suspended, with auto-deploy and previews disabled.

The two products require separate release decisions and independently functioning workflows. December 31, 2026 remains the first-release target. The existing daily check continues at 10 AM America/Detroit through December 20. Do not create another schedule. Real-world testing still requires applicable technical gates and owner approval. The first product and second release date remain undecided.

## Current implementation and source

The preceding committed implementation is `e711d15d418406969631202642c9d055b47afca5`, with source/test/workflow/policy manifest `0b64d9d37f324dcdd43776fe67cd3079c94415ae589977a3fa601132d10d1f62`. [Run82](https://github.com/panelreply-business/panelreply-demo/actions/runs/45214236178) tests merge `f4bd404ba58730bd7110f6a88dbccf19ef96e580`. Use current remote branch history to locate the next integrated commit instead of reverting to this parent.

- Callback: schema-4 scheduling and follow-up, business-scoped due queues, create/reschedule/complete/cancel, exact UTC/named zones, clock-gap/fold handling, task/request revisions, retained uncertain retries, contact restrictions, JSON export v2 and product-bound recovery. [Contract](CALLBACK_SCHEDULING.md).
- Resource correction: queue summaries avoid materializing unused request history. Archive validation scans bounded ledgers once. Same-spec near-capacity workload observes backup 74.45s to 3.58s and restore 47.21s to 2.12s. This is synthetic measurement, not a host SLA. [Evidence](CALLBACK_RESOURCE_VERIFICATION.md).
- Spreadsheet: fixed product entrypoint, private sources, local OCR candidates, explicit review/correction, persistent rows and CSV/XLSX. Small-text and bounded deskew improve the local synthetic corpus 277 to 285 to 289 exact out of 310. The CI comparison also confirms the last four gains with no regression on its own unchanged image bytes. Accuracy remains FAIL. [Deskew](OCR_DESKEW_2026_11_23.md) and [CI comparison](evidence/ocr-deskew-ci-run82.json).
- Browser corrections: sidebar scrollability restores tablet sign-out. Strict CSP stays intact. Optional WebKit screenshots are unavailable because of tool stylesheet insertion; product, geometry, keyboard and console checks remain active. Run82 verifies all three Mac manual spreadsheet suites and both existing mobile suites. Its callback font-probe calculation failure is repaired in the next candidate.

## Next integrated candidate

The candidate adds callback touch journeys, OCR native-dependency identity, source-bound policy enforcement for the expanded mobile matrix and the exact font-doubling calculation. It passes 9,123 local Node/API/HTTP checks across 51 files with zero failures, skips, cancellations, TODOs or infrastructure errors. The manifest remains `a635027376caf189c9d11b0db747196683387e6d0b2783b85dded4124999803a`. [Local candidate record](evidence/mobile-metadata-local-2026-11-23.json).

Product passes are 8,987. All 136 evidence-tooling checks are excluded. Thirteen existing helper cases were previously misclassified as product tests. The prior reported 9,000 therefore compares to 8,987 under the corrected classifier. Preserve historical reports and this correction. Never add overlapping local and CI observations to the same case/platform total.

Callback collection identifies 12 methods in Chromium and 12 in WebKit. Three journeys per engine/profile cover scheduling/outcomes/follow-up, persistent contact suppression/cancellation and unsaved-edit guards with actual trusted touch events. These are emulated devices. Local collection executed zero browser methods. The policy now has 54 automated requirements and seven manual gates; SHA256 `1e23889598a3cfbf7a517aa308214f33a918dda288b04c15631f48223ba88717`. [Mobile contract](CALLBACK_MOBILE_VERIFICATION.md).

OCR dependency tracking records successful language-directory observations and pre/post hashes for the fixed native executables, English/OSD models and TSV configuration. Missing identity blocks provenance; changed identity fails it. The local 310-image replay has matching identities and unchanged output, 263 preserved blank fields, zero native errors/review violations and 660 closed observed children. It does not change production extraction settings. Rejected alternative models and line segmentation remain outside production. [Identity evidence and classification correction](OCR_DEPENDENCY_EVIDENCE_2026_11_23.md).

## Exact next steps

1. Commit the locally verified integrated candidate to the existing branch using the current remote head as a lease. Keep PR8 draft and main unchanged. Do not include unrelated detached-agent work without review and verification.
2. Inspect every job of that commit's PR workflow. Confirm actual callback font doubling/reflow, all 24 new emulated touch executions, the OCR identity report and unchanged separate-product boundaries. Repair reproduced failures without weakening assertions or changing scopes.
3. Keep the preceding [run82 snapshot](evidence/callback-scheduling-run82.json), failed font assertions and queued ARM observation. Complete any remaining reads without treating an unfinished job as a pass. A green measurement job does not override OCR accuracy FAIL or worker-isolation BLOCKED.
4. Download reports for the new committed source and aggregate them with the exact policy bytes. Every report must contain the matching `docs/test-milestones.json` hash in its source manifest. The aggregator must reject missing/mismatched policy and misclassified harness cases. If ARM remains unassigned, preserve zero executions and the incomplete requirement. An independent partial aggregation may report completed scopes but must not claim the full goal.
5. Repair two defects reproduced after this candidate froze. A one-second backward clock change can let a spreadsheet update save updatedAt before createdAt, and the project revision ceiling can save a value rejected by archive validation. Guard every affected panel mutation before any write and verify backup/restore. Separately, the shared text validator accepts lone UTF-16 surrogates in business names and request transcripts, which SQLite changes to U+FFFD. Reject malformed Unicode before writes while preserving valid pairs. Independent agents are preparing minimal store/API/recovery patches in separate worktrees. Review and integrate them as the next milestone. Do not repeat passed suites unless a change or remaining risk calls for it.
6. Update progress, both product acceptance records and PR metadata with exact commits/manifests, executed counts, failures and remaining tasks. Continue the next unfinished authorized milestone.

## Remaining technical and owner-dependent requirements

- Twenty-one synthetic OCR mismatches, plus representative authorized photographs. Do not guess ambiguous part numbers or approve OCR candidates automatically.
- Required OS worker isolation is still blocked before native denial tests. The recorded bubblewrap readiness failure has an unconfirmed cause. Do not use a privilege exception or silently downgrade isolation.
- Actual Safari, physical iPhone/iPad/Android, full private Windows/macOS scopes and Apple Silicon execution remain incomplete. Mac manual spreadsheet results do not establish native OCR. Standard ARM jobs remain unassigned in the snapshot.
- Native Windows storage needs an owner-SID/DACL, handle/reparse/link and atomic-publication adapter. Removing POSIX mode checks is not a valid substitute. [Investigated gap and next sequence](WINDOWS_STORAGE_GAP.md).
- Actual Excel behavior remains separate from independent XLSX readback.
- Real-provider compatibility, quality, latency and budget remain blocked if the callback launch includes a real model. No provider call is authorized by this checkpoint.
- Selected host/private access, restart and offsite recovery need approved destinations and operating arrangements. Local recovery does not establish them.
- Pricing, support, monitoring, incident response, retention/recovery objectives, participants, rollout and each product's release decision require owner input/approval.

The 10,000 goal includes required-platform coverage. The one-time 20,000 goal starts only when the complete first goal passes before launch. Neither numeric target closes a failed or unexecuted release requirement.

## Resume protocol

Fetch the development branch and inspect its diff before editing. Read this checkpoint, the newest `DEVELOPMENT_PROGRESS.md` entry, matching evidence JSON and both product acceptance documents. Preserve remote advancement and existing work. Recheck current runtime/tool availability rather than repeating a prior environment's blocked audit. Never report a blocked test as passing or reuse main's scheduled workflow as evidence for unmerged PR source.

Current local environment has Node24 and working loopback HTTP. The pinned Playwright browser is unavailable locally; its official download attempt returned a 403. Actual browser verification runs in the authorized PR workflow. Do not count local collection as execution or retry a blocked download through another route.
