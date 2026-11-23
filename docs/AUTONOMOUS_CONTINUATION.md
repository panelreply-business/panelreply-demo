# Autonomous development checkpoint

Updated November 23, 2026, America/Detroit. Continue the existing `feature/interactive-dual-product-site` branch and draft [PR8](https://github.com/panelreply-business/panelreply-demo/pull/8). Do not restart the project.

## Current authority

The owner has authorized inspection, implementation, relevant testing, repairs, verified development-branch commits and progress updates until all authorized release-readiness work is satisfied or an execution/usage limit prevents continuation.

No purchase, customer contact, production customer data, public deployment, production merge or software release is authorized. Record a blocked requirement and continue independent work. Keep both existing public services owner-suspended, with auto-deploy and previews disabled.

The two products need separate release decisions and independent functioning workflows. December 31, 2026 remains the first-release target. Daily checks continue through December 20. Real-world testing still requires the applicable technical gates and owner approval. The first product and second release date remain undecided.

## Candidate work in this continuation

- Callback scheduling/follow-up: schema 4, per-business task queue, create/reschedule/complete/cancel, exact UTC and named zone, explicit clock-change handling, request/task revisions, retry safety, contact restrictions, JSON export v2, deletion, retention review and encrypted recovery. [Contract and verification requirements](CALLBACK_SCHEDULING.md).
- OCR: conditional pixel-based enlargement of small text, preserving unknown fields and manual review. The frozen local benchmark improved 277/310 to 285/310 with eight gains and no regressions. Twenty-five nonexact images remain. [Measured results and artifact](OCR_SMALL_TEXT_2026_11_23.md).
- Platforms: Intel Mac callback and manual spreadsheet workflows plus standard Apple Silicon Node/client/product coverage. Native Mac OCR remains unsupported by the current Linux-native launcher. [Exact scope](PLATFORM_EXPANSION.md).

The candidate's changed source needs its own committed CI evidence. The last full verified checkpoint before these changes remains [run76](https://github.com/panelreply-business/panelreply-demo/actions/runs/44788287151), source `ca5f0cbfbf0d23cc20e007018c13cc630fb8f42a`. Its 24,372 product case/platform passes are historical and must not be assigned to the new implementation. Do not add reruns or overlapping reports to the milestone count.

## Exact next steps

1. Completed candidate review: outcome-note preservation, uncertain retries, revision exhaustion and malformed Unicode were reproduced and repaired.
2. Completed stable local Node/SQLite/API/HTTP regression: 9,072 PASS, zero failures/skips, 83 harness checks excluded, 8,989 product executions. [Source-bound local candidate record](evidence/callback-scheduling-local-2026-11-23.json). Native OCR measurements remain separately scoped.
3. Commit the verified candidate to the existing development branch, using the current remote head as a lease. Keep PR8 draft and main unchanged.
4. Inspect all jobs of that commit's PR workflow. Execute actual selected-product browser journeys and native Linux checks. Repair real failures without weakening assertions or substituting emulation for an actual platform.
5. Download the source-bound reports and aggregate deduplicated results. Check every required platform against the matching source, browser, architecture and scope. Reassess the Apple Silicon/Mac gaps only to the extent the executed evidence supports them.
6. Update progress, separate release acceptance records and the persistent evidence checkpoint. Record exact commits, source hashes, executed cases, unresolved failures and approval-dependent requirements.
7. Continue the next highest-impact unfinished milestone. Remaining independent work includes the residual OCR recognition failures, accessibility/state regressions revealed by the expanded matrix, and approved-scope recovery/performance evidence. Do not stop after a count or a written assessment.

## Requirements still needing separate evidence or approval

- OCR exact-image quality, representative authorized photographs and required OS worker isolation.
- Actual Safari and physical iPhone/iPad/Android journeys, plus any unexecuted private platform scopes.
- Actual Excel behavior beyond independent XLSX readback.
- Real-model compatibility, quality, latency and budget bounds, if the callback launch includes a real model. No real-provider call is authorized by this checkpoint.
- Selected host/private access, restart and offsite recovery after a host/destination and operating arrangements are approved.
- Pricing, support ownership, monitoring, incident response, retention/recovery objectives, rollout and separate owner release decisions.

The 10,000 execution goal includes required-platform coverage. The one-time 20,000 target starts only when that complete first goal passes before launch. Neither numeric threshold closes a product's unresolved requirement.

## Resume protocol

Fetch the development branch and inspect the diff before changing files. Use this checkpoint together with the newest entry in `DEVELOPMENT_PROGRESS.md`, the newest evidence JSON and both product acceptance documents. Preserve remote advancement and existing work. Read current runtime/tool capabilities rather than repeating a prior environment's blocked audit. Never report a blocked test as passing or reuse main's scheduled workflow as evidence for unmerged PR source.
