# Autonomous development checkpoint

Updated November 23, 2026, America/Detroit. Continue `feature/interactive-dual-product-site` and draft [PR8](https://github.com/panelreply-business/panelreply-demo/pull/8). Do not restart the project.

## Authority and schedule

The owner authorizes inspection, implementation, relevant testing, repair, verified development-branch commits and progress updates until authorized readiness work passes or an execution/usage limit prevents continuation.

Purchases, customer contact, production customer data, public deployment, production merge and release require owner approval. Record those blockers and continue independent work. Keep both existing services owner-suspended, with auto-deploy and previews off.

The two products have separate release decisions and independent entrypoints, data binding, sessions and recovery. December 31, 2026 remains the first-release target. The existing daily check runs at 10 AM America/Detroit through December 20 inclusive. Do not duplicate it. Product order and the second release date remain undecided. Real-world testing needs its applicable technical gates and owner approval.

## Current source and next component milestone

The runtime read-snapshot/layout/Safari-request milestone is committed as `13b8741ca7ce192c9d187b0b7c0033760531c5b5`, tree `14f72250bbc305d9087cb271fb4b5eaf2ad58aaa`, with the unchanged locally tested manifest `2ec4c2b878e6d954df4ab0fd7b8cf04630669dca724c1bf1e174533f84cb4658`. [Run86](https://github.com/panelreply-business/panelreply-demo/actions/runs/45233837607) is in progress. Do not transfer earlier passes onto this source without its reports.

Installed Safari now starts and executes all six methods with verified native identity. One callback intake/status/persistence/sign-out method passes. Two callback methods leave the native datetime-local field empty when the test types an ISO string. Three spreadsheet methods fail setup because the expected product label is singular while the application label is plural. Preserve these five failures; a native-keyboard/label repair is in a separate worktree. No JavaScript value/event injection or API seeding may replace the tested input workflow. [Verified native job](evidence/native-safari-run86.json).

The next Windows component candidate has manifest `1d80393f3534eda1e76be9fa28c41f9a0a01e873ba1dec4253915472bbc6afe1` across 192 entries. It adds 13 source files and one separate standard Windows CI job. All previous application and test bytes are unchanged; only the existing workflow gains the new job, with all 14 earlier jobs and their dependencies preserved. Eight evidence-harness checks and seven syntax checks pass locally. The 15 native methods have zero local executions and earn zero product credit. [Integration record](evidence/windows-component-integration-2026-11-23.json), [scope](WINDOWS_NATIVE_COMPONENT_2026_11_23.md) and [review](reviews/windows-native-component-2026-11-23.md).

Neither application imports this component. Actual native compilation, DACL/sharing/reparse boundaries, SQLite sidecars, persistent incomplete-restore state and no-overwrite publication remain prerequisites. The existing POSIX checks and all release-policy bytes remain unchanged.

## Runtime source and preceding CI

The Safari/reflow milestone is committed as `76db2d67702c2eee57185e06221257e1083e522e`, Git tree `5757371c9502fa7005f5bb1a652a819ac9991d3b`. [Run85](https://github.com/panelreply-business/panelreply-demo/actions/runs/45228816564) tests it through merge `f1947a5abbd16ade36295661e0e6ef60e7928a41`, with the same tree and manifest `208410e4ed9dde46a4e72ec4b163a5c4dfe0c45ff45e214dd1e65f9029ead6cd`.

Run85 is complete with 29 successful jobs, nine failed jobs including aggregate, and one cancelled ARM job. ARM has runner ID zero, no steps and zero cases; its cancellation cause remains unconfirmed and no agent requested it. All 35 release ZIPs and 37 reports, plus the CI aggregate, pass digest, path, committed-source and exact-policy checks. The immutable local aggregate matches CI except generatedAt. The final ledger records 24,791 product passes, seven failures and six NOT_RUN outcomes across 9,337 distinct cases. It excludes 370 harness checks and 7,102 duplicate observations. Automated requirements are 28 PASS, 13 FAIL, five BLOCKED and ten NOT_TESTED. Seven manual gates remain NOT_TESTED. The two formerly running Linux WebKit jobs pass 65/65 static and 9/9 spreadsheet methods. [Final run85 record](evidence/callback-scheduling-run85.json). The [17:45 partial snapshot](evidence/callback-scheduling-run85-partial.json) remains byte-preserved.

The seven failures are distinct from the six unexecuted native cases:

- Linux selected callback WebKit still produces a 521px document at a 320px viewport with doubled text. Its anonymous span-two field has 485px scroll width, but the trace does not identify the descendant control. A permission-select cause is an inference, not a recorded identification.
- Five other selected callback jobs reach a faulty focus probe while the task draft intentionally disables request editing. Mac WebKit passes earlier geometry assertions but the complete journey still fails.
- Emulated WebKit tablet save/reopen completes its data assertions but records a task-read page error at teardown. A view-read interruption is plausible, not a confirmed initiating cause.
- Installed Safari26.6 and its matching driver are observed, but session creation rejects the iOS-only `safari:useSimulator:false` capability on macOS. All six methods remain NOT_RUN, with zero product execution. [Native startup evidence](evidence/native-safari-run85.json).

The committed `13b8741` read-snapshot/layout milestone passes all 9,217 local Node/API/HTTP checks across 57 files, with zero failures, skips, cancellations, TODOs or infrastructure errors and stable source. Product cases are 9,071 after excluding 146 harness checks. Fifteen cases are new: seven spreadsheet and eight callback, with all 9,056 prior product cases retained. The manifest is `2ec4c2b878e6d954df4ab0fd7b8cf04630669dca724c1bf1e174533f84cb4658` across 179 files. [Final local evidence](evidence/snapshot-layout-local-2026-11-23.json). The committed executable bytes match this manifest. Earlier focused/full runs receive no duplicate credit.

Project rows/source metadata and callback requests/conversations now share a deferred SQLite read snapshot. Existing caller transactions remain open. Real second-connection regressions cover deletion, upload, exports, STOP/safety holds, owner boundaries and cleanup. Current-version writes still enforce fresh restrictions. [Spreadsheet repair](SPREADSHEET_READ_SNAPSHOT_2026_11_23.md) and [callback repair](CALLBACK_READ_SNAPSHOT_2026_11_23.md).

The browser candidate styles the real permission select inside a block-sized wrapper, retains its native popup/keyboard/disabled behavior and gives it a scoped focus-visible outline. It preserves 200% text, 320px geometry, control bounds, native Tab and unsaved-draft checks. Failure diagnostics now identify field descendants and computed control appearance. The focus probe runs after draft discard, and the mobile completed-save journey waits for rendered save/task completion before reload and teardown. No error is suppressed. [Reflow](CALLBACK_REFLOW_2026_11_23.md) and [sequencing](BROWSER_SEQUENCING_2026_11_23.md). Actual browser execution on changed source remains required.

Native Safari now requests exactly browserName, platformName, browserVersion and pageLoadStrategy, using the installed desktop browser and explicit `/usr/bin/safaridriver`. The collector enforces the same request and all prior installation/session/host checks. No automation permission is changed, no simulator or alternate browser is substituted, and downloaded export bytes remain required. Node verifier checks and four Python harness checks pass without product credit. [Scope](NATIVE_SAFARI_SCOPE.md).

The policy remains 56 automated requirements and seven manual gates, SHA256 `1d44f761935bdd80d8fe1dde99add06e8e4e7d39912ce72d8f70fd65c2783216`. OCR stays FAIL at 289/310 exact with identity PASS. Required native isolation remains BLOCKED before denial cases. The full 10,000 goal is incomplete and the 20,000 target has not activated.

## Prior final CI checkpoint

[Run83](https://github.com/panelreply-business/panelreply-demo/actions/runs/45217347462) is complete, with failures retained. It tested branch source `1b35490335203348572e938bcc30dfc0f05d93e1` through merge `017a1b39b00851f2fbacb4bed7f8ffbd3e23c880`. Both have Git tree `510bc73ebc676725e166ae6b29ba0ac276c3589b`. The executable/test/workflow/policy manifest is `a635027376caf189c9d11b0db747196683387e6d0b2783b85dded4124999803a`. [Final source-bound record](evidence/callback-scheduling-run83.json).

All 34 emitted release artifacts and 35 reports were inspected. Independent aggregation with the exact committed collector/policy matches CI. The ledger has 24,672 product passes, two failures and one error across 9,260 distinct cases. It excludes 340 harness checks and 7,071 duplicate observations. Forty automated requirements pass, four fail and ten Apple Silicon requirements have no execution. Seven manual/actual-platform gates remain NOT TESTED. The active 10,000 goal remains incomplete, so the one-time 20,000 target has not activated.

- All 24 fixed callback touch executions pass across Chromium/WebKit and four emulated phone/tablet orientations. They verify trusted touch events, scheduling, outcomes/follow-up, persistent restrictions and unsaved edits. These are not physical-device results.
- Selected callback WebKit fails at 320px with doubled text on Linux and Intel Mac. Observed document widths are 521px and 443px. The exact overflowing element was not recorded in run83.
- Private WebKit recovery has one `Frame load interrupted` error during competing login navigation after API logout. The initiating in-flight request is unproven. Other authentication and recovery assertions remain required.
- The Apple Silicon job finishes cancelled with runner ID zero, no steps and zero cases. No agent requested cancellation. Its cause remains unconfirmed.
- Native OCR dependency identity passes. All 310 field outcomes match run82 on unchanged CI pipeline and dataset bytes. Accuracy stays FAIL at 289/310, with 263 blank fields preserved and zero native errors/review violations. [Dependency evidence](evidence/ocr-dependency-ci-run83.json).
- Required native isolation remains BLOCKED before denial cases at bubblewrap loopback setup. Do not use a privilege exception or silent fallback. The nine HTTP workload checks and two public suspension guards pass as separate measurements, outside product-goal totals.

## Committed integrity milestone

This batch follows `1b35490` and is committed as `7a0a93a`, with executable/test/workflow/policy manifest `e4c91c70dc0d92b087a49d5e3e2c529974da968ec6365efb5719f05f972ea6d3`. The full local Node/API/HTTP run passes 9,192 cases across 55 files with zero failures, skips, cancellations, TODOs or infrastructure errors and no source change during execution. Product passes are 9,056 after excluding 136 harness checks. Sixty-nine meaningful product cases are new relative to the preceding 9,123-case source. Focused runs and local/CI overlap receive no duplicate credit. [Local manifest, case inventory and file totals](evidence/integrity-local-2026-11-23.json).

Implemented and locally verified:

- Reject malformed UTF-16 before storage/archive publication while preserving valid pairs, combining text and literal replacement characters. [Text integrity](CALLBACK_TEXT_INTEGRITY.md).
- Guard panel clocks and live revision bounds before row/source/audit/tombstone writes. Preserve completed retries and safe terminal deletion. Verify encrypted recovery and both restored entrypoints. [Panel mutation/recovery](SPREADSHEET_MUTATION_RECOVERY_2026_11_23.md).
- Preflight request and contact-restriction fan-out clocks/revisions within the existing transaction. Keep failed restriction writes atomic, make zero provider calls and reject invalid archive chronology. [Request integrity](CALLBACK_REQUEST_INTEGRITY.md).
- Preflight every legacy safety-propagation target before migration DDL or writes. Reject unsafe upgrades while preserving logical schema/records and backup/recovery. Keep unaffected terminal legacy records and idempotent reopen. [Legacy migration](LEGACY_MIGRATION_INTEGRITY_2026_11_23.md).
- Keep session activity monotonic, preserve stored deadlines and return controlled invalid-clock/profile-exhaustion errors before writes. Arbitrary clock jumps still do not establish true elapsed-time expiry. [Account invariants](ACCOUNT_INVARIANTS_2026_11_23.md).
- Retain unconfirmed spreadsheet commands through later 4xx replies. Validate full project/row/source receipts, target IDs and matching upload metadata before replacing a draft. Require revision advancement for update/upload confirmation. [Unconfirmed saves](PANEL_UNCERTAIN_SAVE_2026_11_23.md) and [response integrity](PANEL_RESPONSE_INTEGRITY_2026_11_23.md).

Browser corrections and additions included in `7a0a93a`; run84 outcomes are recorded above:

- Constrain native request controls and narrow grid track minima for WebKit reflow. Keep 320px overflow and actual root/body/control font-doubling assertions. Failure-only geometry will identify any remaining overflow without recording field content.
- Synchronize completed task reads, actual UI logout response and loaded login page before rejecting another restored owner's old password. Do not suppress navigation errors or weaken recovery assertions. [Navigation change](RECOVERY_BROWSER_NAVIGATION_2026_11_23.md).
- Two fixed-spreadsheet journeys commit real create/update/upload writes before corrupting only their success responses. They verify preserved drafts, original retry keys/bodies/image bytes and no duplicate records/revisions. Linux spreadsheet collects nine methods, Mac manual spreadsheet ten, combined private stays 132 and callback stays 15. Collection executes zero browser cases. [Collection/review](evidence/panel-receipt-browser-collection-2026-11-23.json).

The existing Apple Silicon job now tries the documented standard `macos-15` ARM64 runner after prior `macos-26` jobs ended with runner ID zero and no steps. All suites, actual `darwin/arm64` assertions, timeouts and policy gates remain. This is an alternate standard-image attempt, not a confirmed queue diagnosis or platform pass. [GitHub runner reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners).

The policy still has 54 automated requirements and seven manual gates. Nine fixed-spreadsheet requirements increase their minimum case counts to nine on Linux and ten on Mac. Policy SHA256 is `bde713a2eb921df4a730331938297b1d26740306c2ab9d36e65acd5b474f8886`. The collector must bind every new report to these exact bytes.

## Exact next steps

1. Commit the reviewed standalone Windows component, separate workflow and evidence/docs with a current-head lease on `13b8741`. Verify manifest `1d80393f3534eda1e76be9fa28c41f9a0a01e873ba1dec4253915472bbc6afe1`. Keep both product imports inactive, PR8 draft and main unchanged.
2. Inspect that source's Windows component build and all 15 native outcomes. Missing build, loader, NTFS or positive controls stay unresolved. Verify actual compiler/SDK/Node dependencies, separate normal/probe binaries, source hashes and cleanup outcomes before considering application integration.
3. Complete run86 artifact verification with its immutable `13b8741` collector/policy. Prioritize Linux/Mac callback reflow/focus, mobile WebKit save/reopen and all six native Safari cases. Preserve the five observed Safari failures. Do not wait indefinitely for ARM assignment.
4. Review and integrate the separate Safari label/native-date input repair only after its source/test contract is checked. Require actual native keyboard/control input and retain exact local/UTC/timezone, persistence and downloaded-byte assertions. No injected value/event or API-seeded substitute.
5. Review the isolated required-OCR-mode trusted-path overlap preflight. The current read-only /usr mount may include private storage/repository/home when configured under it. This is a source-confirmed configuration gap, not an observed native leak. Preserve resource-limits mode and the denied-host result; canonical overlap checks cannot prove absence of every bind alias or replace native denial execution.
6. Preserve final run84/run85 and prior snapshots. Continue the Windows SQLite-sidecar/publication assessment, then the next authorized requirement. Update progress, product acceptance and PR metadata with exact evidence. Compaction is not a stopping point.

## Independent Windows implementation

The standalone Node-API/Win32 private directory lease component is frozen for handoff at `/workspace/scratch/8f544d546bb7/panelreply-windows-storage`. Neither product imports it. Its 15 native methods have zero executions locally. Two independent source/test/provenance reviews are complete and eight evidence-harness cases pass. The component workflow is separate from release reports, existing jobs and policy requirements.

It requires observed NTFS, protected owner-SID DACLs, relative handle-bound creation, reparse/link rejection and explicit cleanup failures. The creation lease remains exclusive until close because it retains DELETE for same-handle rollback. Metadata-only sharing and attribute-only reparse assumptions were rejected during review. A separate instrumented binary observes the exact post-validation/pre-open mutation window and the returned file before payload/cleanup, with independently held directory observations. The normal artifact has no probe callback. Anonymous denial requires actual IO and an explicit anonymous positive control with guaranteed identity restoration. That scope does not establish ordinary second-account isolation, SQLite sidecars or restore publication.

Native compilation and execution are the next evidence. A missing build, loader, NTFS root or control remains NOT_RUN or unresolved, not a pass. Pinned Node dependencies, observed compiler/SDK and separate normal/probe hashes bind every result.

## Remaining requirements

- Twenty-one synthetic OCR mismatches and representative authorized photographs. Do not guess ambiguous part numbers or auto-approve candidates.
- Required native worker isolation and selected-host operation remain unverified. The recorded startup cause is unconfirmed.
- Actual Safari, physical iPhone/iPad/Android, private Windows, full native macOS extraction and Apple Silicon remain incomplete. Mac manual spreadsheet does not prove native OCR.
- Actual Excel needs its own original-file/resave checks. Independent XLSX readers do not establish Excel behavior.
- Actual-model compatibility/quality/latency/budget remains blocked if callback release includes a real provider. No real-provider call is authorized by this checkpoint.
- Selected host/private access, restart, offsite recovery and secret custody need approved destinations and operating arrangements.
- Pricing, support, monitoring, incident response, retention/recovery objectives, participants, rollout and each product's activation need owner decisions.

Counts and dates do not close failed or unexecuted release requirements. Callback and spreadsheet remain separate NO-GO decisions for customer trial/public release.

## Resume protocol

Fetch the development branch and inspect current diff/history before editing. Read this checkpoint, the newest progress entry, matching evidence and both product acceptance records. Preserve remote advances and existing work. Recheck current runtime/tool availability instead of repeating a historical environment block. Main's scheduled workflow does not verify unmerged PR source.

The current local environment has Node24 and working loopback HTTP. The pinned Playwright browser is unavailable locally and its official download returned 403. Actual browser verification uses the authorized PR workflow. Do not count collection as execution or retry the blocked download by another route.
