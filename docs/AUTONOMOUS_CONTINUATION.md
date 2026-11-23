# Autonomous development checkpoint

Updated November 23, 2026, America/Detroit. Continue `feature/interactive-dual-product-site` and draft [PR8](https://github.com/panelreply-business/panelreply-demo/pull/8). Do not restart the project.

## Authority and schedule

The owner authorizes inspection, implementation, relevant testing, repair, verified development-branch commits and progress updates until authorized readiness work passes or an execution/usage limit prevents continuation. Compaction is not a stopping point.

Purchases, customer contact, production customer data, public deployment, production merge and release require owner approval. Record those blockers and continue independent work. Keep both existing services owner-suspended, with auto-deploy and previews off. Main remains `c6152b38ae2e3a824e6a81199aa0d757d47a19ae` at this checkpoint.

The products have separate release decisions and independent entrypoints, data binding, sessions and recovery. December 31, 2026 remains the first-release target. The existing daily check runs at 10 AM America/Detroit through December 20 inclusive. Do not duplicate it. Product order and the second release date remain undecided. Real-world testing needs its applicable technical gates and owner approval.

## Current extraction-response milestone

This candidate follows `5cead3344fc2615d699e68d606f38da399d21348` and has manifest `e359d184cae83587b5a98e5362ac52b0ce2b72332c8b68fc7dcf54878c544cc4` across 193 files. The full local run passes 9,241 checks: 9,094 product and 147 excluded harness cases, with zero failed/skipped/cancelled/TODO/infrastructure outcomes and stable source. All 9,086 prior product IDs remain; eight new cases move from 2 PASS/6 FAIL on the unchanged client to 8 PASS after repair. [Local evidence](evidence/ocr-response-local-2026-11-23.json).

The spreadsheet client binds OCR receipts to requested/current project, source and revision, validates consumed candidate/warning/confidence fields, and prepares warning nodes before installing the result. Invalid re-extraction clears old/malformed addable candidates while preserving saved corrections. Blank/Unicode/ambiguous output and explicit Add/Save remain. Engine, parser, preprocessing, model and dataset stay unchanged. [Repair](OCR_RESPONSE_INTEGRITY_2026_11_23.md).

Run88 actual Safari passes plural-label setup and all three exact trusted datetime input observations, but complete outcomes stay one PASS/five ERROR. Later failures concern native option clicking, source-upload confirmation and review-status persistence after reload. Date input success is not whole-workflow acceptance. [Native record](evidence/native-safari-run88.json). A separate Safari worktree is investigating these failures without injected values/events or API seeding.

Run89 Windows native build/identity passes and 13 component methods pass. Two empty-DACL metadata opens fail with recorded Windows 5; cleanup EPERM remains. The corrected instrumented race method passes with every independent absence assertion. [Verified record](evidence/windows-native-component-run89.json). A separate fixture investigation examines synchronous metadata access and cleanup without changing storage.cc, ACLs, privileges or accepting error 32 as DACL evidence.

Run88 has a preserved 18:38 partial ledger with 24,433 product PASS/five ERROR from 29 ZIPs/31 reports. It excludes 371 harness checks and 7,102 duplicates. Five jobs were still running and ARM unassigned. Do not treat this as a complete aggregate. [Partial record](evidence/callback-scheduling-run88-partial-1838.json).

The standalone SQLite observation patch is frozen at /tmp/panelreply-windows-sqlite-observation-20261123.patch, SHA256 22bdcb6fe48a65c0968d5ea080750082856bbe1cc84e80eb2cbe5c1024aa85ae, inventory /tmp/panelreply-windows-sqlite-observation-handoff-20261123.json. It has 12 passing harness checks, zero Windows executions and zero product credit. It is not yet integrated. Its read-only process-token hunk is independent of fixture metadata/cleanup code. Review/integrate after the current runtime milestone and keep actual eight Windows observations pending component prerequisites.

## Preceding Windows diagnostic milestone

The current candidate follows committed `1322d0630d377d9fe769dc15543321cb5f5fe373`, tree `6834fd89e5383cf8e4de5a50138c2244d0aab9a7`. Its manifest is `991af22d5c66708b55d1d7e01ce739a9dbab28e27c9e1f89c7f04cf5ecad6b8c` across 193 files. It changes only four component-test/helper sources, with application/storage policy and the 15 native method IDs unchanged. Nine component-evidence harness checks pass, one new, all excluded from product credit. Native execution is pending. [Diagnostic record](WINDOWS_FIXTURE_DIAGNOSTICS_2026_11_23.md).

Run88 on `1322d063` compiles all three native artifacts and executes 12 PASS/three FAIL component methods, plus cleanup EPERM. Root verifies all 193 manifest entries and downloaded binary/project/build/toolchain/header-manifest hashes. Two empty-DACL fixture metadata operations fail without their native error details. The third failure rejects Windows 1921 after both held-directory enumerations prove absence. The candidate preserves bounded native errors, makes JSON emission atomic and allows 1921 only with the same independent absence assertions. It does not repair the unresolved empty-DACL lifecycle. [Verified run88 component](evidence/windows-native-component-run88.json).

Next publish/verify this diagnostic candidate and inspect its Windows report for the exact empty-DACL API/error. Keep cleanup errors and original native failures. A retained DELETE fixture handle may itself force sharing failure against the component's read-only share mode. Do not accept error 32 as DACL evidence or change ACLs/privileges to make tests pass. Review a lifecycle solution only after native diagnostics establish the cause.

Run88's six installed-Safari workflows and static Mac WebKit diagnostic journey are still running in the latest job observation. The current runtime manifest is `6b951e01…` as below. A separate reviewed spreadsheet client repair is in progress for wrong-project OCR responses and malformed warning metadata; use its own before/after evidence and preserve unchanged engine/dataset scope.

## Preceding verified runtime milestone

This milestone follows committed `9264d2a3575889c6b39140554fc767caf6e6a7ad`, tree `8213edf25c09c86042fbcc9b425f3116d5308006`. Its executable/test/workflow/policy manifest is `6b951e01bef645f9434dc6e2adac382d1f9d6d419258d2df245a857ecbb6951e` across 193 files. All 9,233 local Node/API/HTTP checks pass across 58 files with zero failures, skips, TODOs, cancellations or infrastructure errors and unchanged source. Product cases are 9,086 after excluding 147 harness checks. All 9,071 prior product IDs remain. Fifteen product cases and one diagnostic harness case are new. Nine Python Safari harness checks pass separately with zero product credit. Focused runs earn no duplicate credit. [Local manifest and record](evidence/native-boundaries-local-2026-11-23.json).

- Required OCR isolation checks canonical private-storage, repository, environment-home and account-home paths against the read-only runtime mount. It rejects unresolved/overlapping paths, verifies the fixed normalizer and rechecks cached readiness and each native stage. Resource-limits mode remains unchanged. Fifteen product regressions use real paths/symlinks with fake native transport. This configuration guard does not prove native denial or stable host mount topology. [Scope](OCR_PATH_BOUNDARY_2026_11_23.md).
- Safari expects the actual plural spreadsheet label and edits datetime-local with native keyboard actions. It requires observed locale/control compatibility, trusted events and exact resulting values. All six methods and local/UTC/timezone, persistence and downloaded-byte assertions remain. No injected field value/event or API task seed substitutes for input. Nine harness passes are not native execution. [Repair](NATIVE_SAFARI_INPUT_REPAIR_2026_11_23.md).
- The Windows builder selects the first application command in PowerShell precedence order while retaining every version/hash/toolchain pin. Run87 combined two Node paths into one invalid command and never compiled or ran a native method. [Failure and repair](WINDOWS_BUILD_RESOLUTION_2026_11_23.md).
- The static sample keyboard journey gains bounded passive event/geometry observations around its original actions. Run86's Mac WebKit pointer action returned without changing the title. Run87's job succeeds on unchanged relevant bytes, establishing no cause or repair. Original assertions and method IDs remain. Keep this defect open. [Diagnostic scope](STATIC_SAMPLE_POINTER_2026_11_23.md).

Actual browser/native execution on this changed manifest is pending. Do not transfer prior passes to it.

## Latest complete release ledger

[Run86](https://github.com/panelreply-business/panelreply-demo/actions/runs/45233837607) tests runtime commit `13b8741ca7ce192c9d187b0b7c0033760531c5b5` through merge `939b9aefad105a7529b9d13857118dbe9a399e15`. Both have tree `14f72250bbc305d9087cb271fb4b5eaf2ad58aaa`, manifest `2ec4c2b878e6d954df4ab0fd7b8cf04630669dca724c1bf1e174533f84cb4658` across 179 files. All 35 release ZIPs and 37 reports pass digest, path, source and exact-policy checks. The immutable aggregate matches CI except generatedAt, independently checked by root. [Final record](evidence/callback-scheduling-run86.json).

The ledger records 24,813 product passes and six failures across 9,352 distinct cases. It excludes 370 harness checks and 7,102 duplicate observations. Automated requirements are 43 PASS, three FAIL and ten NOT_TESTED. Seven manual gates remain NOT_TESTED.

- All six selected callback suites pass 15/15, including Linux/Intel Mac WebKit at 320px with doubled text, the native permission select, unsaved-task navigation and keyboard focus. This verifies the bounded reflow/focus correction on `13b8741`.
- Both emulated mobile engines pass the shared 40-method suite and fixed callback 12-method suite. WebKit's completed-save/reopen correction passes without suppressing browser errors. These are emulated devices.
- All six fixed-spreadsheet suites pass: nine methods per Linux engine and ten per Intel Mac engine. Committed-response corruption/retry journeys pass. Private Linux WebKit passes 132/132.
- Installed Safari26.6 starts with matching native browser/driver/host evidence. Callback intake/status/persistence/sign-out passes. Two callback methods fail on empty datetime input and three spreadsheet methods fail setup on the label expectation. Preserve all five failures. [Native evidence](evidence/native-safari-run86.json).
- Static Intel Mac WebKit passes 91 methods and fails one keyboard/sample journey. The trace does not identify why its final click leaves the title unchanged. The next observer is diagnostic only.
- OCR dependency identity passes. Exact extraction remains FAIL at 289/310 exact images, with 263 expected blanks preserved, no native errors and no review violations.
- Required native isolation remains BLOCKED at bubblewrap loopback setup before all six denial cases. The recorded error is RTM_NEWADDR operation not permitted. Its underlying host cause is unconfirmed. No privilege exception or fallback.
- ARM is cancelled with runner ID zero, no steps and zero cases. No agent requested cancellation. Standard labels and repository visibility match current GitHub documentation. Cause remains unknown. [Review](APPLE_SILICON_ASSIGNMENT_2026_11_23.md).
- HTTP workload, public suspension and auxiliary native OCR/resource/orchestration/storage measurements stay separate from product-goal credit.

The 18:08 and 18:17 run86 snapshots remain byte-preserved beside the final record. Prior final run83, run84 and run85 ledgers and failures remain in `docs/evidence`.

## Windows source and subsequent CI

Committed `9264d2a` adds an isolated Windows storage component and separate standard Windows job. Its manifest is `1d80393f3534eda1e76be9fa28c41f9a0a01e873ba1dec4253915472bbc6afe1` across 192 files. Neither application imports it. Previous application/test bytes, 14 prior workflow jobs and release-policy bytes remain unchanged. [Integration](evidence/windows-component-integration-2026-11-23.json).

[Run87](https://github.com/panelreply-business/panelreply-demo/actions/runs/45235230394) tests that source. Its component artifact passes digest/source inspection but records a build failure before compilation: 15 native methods NOT_RUN, zero native PASS/FAIL and one infrastructure error. Eight evidence-harness checks pass. [Verified artifact](evidence/windows-native-component-run87.json). Job metadata records native Safari failure, static Mac WebKit success, cancelled unassigned ARM and failed aggregate. No complete run87 ledger is claimed here. [Job observation](evidence/run87-job-observation-2026-11-23.json).

The component requires observed local NTFS, protected owner-SID DACLs, held ancestor/directory handles, same-handle relative creation/read/cleanup, reparse/link rejection and explicit cleanup failures. Its creation lease retains DELETE for rollback and remains exclusive until close. Separate normal/probe binaries observe mutation timing and redirected transient creation. Anonymous denial requires actual IO, an explicit positive control and guaranteed identity restoration. This does not prove ordinary second-account isolation. [Scope](WINDOWS_NATIVE_COMPONENT_2026_11_23.md) and [review](reviews/windows-native-component-2026-11-23.md).

Pinned Node24.22.3 uses SQLite path opens and native-default creation security attributes for main/sidecar files. A standalone eight-scenario observation tool is being prepared separately: SQLite-created versus component-precreated main files, DELETE versus WAL, explicit close versus forced termination of its own paused child. Record actual Node-child token/owner and main/journal/WAL/SHM identity, DACL and phase outcomes. Results stay OBSERVED/ERROR/NOT_RUN, acceptance NOT_ESTABLISHED and zero product credit. No application or workflow integration yet. [Assessment](WINDOWS_SQLITE_PUBLICATION_ASSESSMENT_2026_11_23.md).

SQLite sidecars, ordinary-account isolation, persistent incomplete-restore state and no-overwrite publication remain prerequisites before native Windows product integration. A process-held DELETE lease does not preserve publication state after a crash. Keep existing POSIX startup/storage checks intact.

## Exact next steps

1. Verify the commit containing this checkpoint is on the development branch with manifest `e359d184cae83587b5a98e5362ac52b0ce2b72332c8b68fc7dcf54878c544cc4`. Publish only reviewed staged scope with an expected-head lease if not already published. Keep PR8 draft and main unchanged.
2. Inspect that commit's Windows build promptly. Require actual compiler/SDK/Node identities, normal/probe/fixture hashes, all 15 native outcomes and cleanup/positive-control evidence. Repair failures without importing the component or weakening storage policy.
3. Inspect all six native Safari methods. Retain trusted keyboard/control input, exact local/UTC/timezone behavior, native identity and actual CSV/XLSX bytes. Preserve failed input evidence. Harness success is not a browser pass.
4. Inspect static Mac WebKit sample-action observations. A pass alone cannot close the intermittent defect. Distinguish timing hypotheses from observations.
5. Verify OCR startup classification and applicable Node/browser regressions. Keep native isolation BLOCKED until denial cases execute. Path preflight is not sandbox acceptance.
6. Complete review of the separate SQLite/token observation tool. Run only after component build/fixture validation. Pin its owned live child identity, retain phase/cleanup errors, bound synthetic data and make no token/ACL/privilege changes or product-readiness claim.
7. Reconcile release artifacts with immutable source/collector/policy, update product acceptance and this checkpoint, commit verified fixes and continue the next authorized requirement. Do not wait indefinitely for ARM or substitute duplicates for coverage.

## Remaining requirements

The policy has 56 automated requirements and seven manual gates, SHA256 `1d44f761935bdd80d8fe1dde99add06e8e4e7d39912ce72d8f70fd65c2783216`. The numeric total exceeds 20,000, but the full 10,000 platform goal remains incomplete. Do not activate or declare the one-time 20,000 goal from count alone.

- Twenty-one synthetic OCR mismatches and representative authorized photographs. Do not guess ambiguous part numbers or auto-approve candidates. Rejected PSM7/PSM13/tessdata_best experiments are recorded. Do not repeat without a new evidence-backed hypothesis.
- Required native worker isolation and selected-host operation remain unverified.
- Actual Safari, physical iPhone/iPad/Android, private Windows, full native macOS extraction and Apple Silicon remain incomplete. Mac manual spreadsheet does not prove native OCR.
- Actual Excel needs original-file/resave checks. Independent XLSX readers do not establish Excel behavior.
- Actual-model compatibility/quality/latency/budget remains blocked if callback release includes a real provider. No real-provider call is authorized by this checkpoint.
- Selected host/private access, restart, offsite recovery and secret custody need approved destinations and operating arrangements.
- Pricing, support, monitoring, incident response, retention/recovery objectives, participants, rollout and each product's activation need owner decisions.

Callback and spreadsheet remain separate NO-GO decisions for customer trial/public release.

## Resume protocol

Fetch the development branch and inspect diff/history before editing. Read this checkpoint, newest progress entry, matching evidence and both product acceptance records. Preserve remote advances and existing work. Recheck runtime/tool availability instead of repeating a historical environment block. Main's scheduled workflow does not verify unmerged PR source.

Local Node24 and loopback HTTP work. The pinned Playwright browser is unavailable locally and its official download returned 403. Actual browser verification uses the authorized PR workflow. Do not count collection as execution or retry the blocked download by another route.
