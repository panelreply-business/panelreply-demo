# Autonomous development checkpoint

Updated November 23, 2026, America/Detroit. Continue `feature/interactive-dual-product-site` and draft [PR8](https://github.com/panelreply-business/panelreply-demo/pull/8). Do not restart the project.

## Authority and schedule

The owner authorizes inspection, implementation, relevant testing, repair, verified development-branch commits and progress updates until authorized readiness work passes or an execution/usage limit prevents continuation.

Purchases, customer contact, production customer data, public deployment, production merge and release require owner approval. Record those blockers and continue independent work. Keep both existing services owner-suspended, with auto-deploy and previews off.

The two products have separate release decisions and independent entrypoints, data binding, sessions and recovery. December 31, 2026 remains the first-release target. The existing daily check runs at 10 AM America/Detroit through December 20 inclusive. Do not duplicate it. Product order and the second release date remain undecided. Real-world testing needs its applicable technical gates and owner approval.

## Last committed CI checkpoint

[Run83](https://github.com/panelreply-business/panelreply-demo/actions/runs/45217347462) is complete, with failures retained. It tested branch source `1b35490335203348572e938bcc30dfc0f05d93e1` through merge `017a1b39b00851f2fbacb4bed7f8ffbd3e23c880`. Both have Git tree `510bc73ebc676725e166ae6b29ba0ac276c3589b`. The executable/test/workflow/policy manifest is `a635027376caf189c9d11b0db747196683387e6d0b2783b85dded4124999803a`. [Final source-bound record](evidence/callback-scheduling-run83.json).

All 34 emitted release artifacts and 35 reports were inspected. Independent aggregation with the exact committed collector/policy matches CI. The ledger has 24,672 product passes, two failures and one error across 9,260 distinct cases. It excludes 340 harness checks and 7,071 duplicate observations. Forty automated requirements pass, four fail and ten Apple Silicon requirements have no execution. Seven manual/actual-platform gates remain NOT TESTED. The active 10,000 goal remains incomplete, so the one-time 20,000 target has not activated.

- All 24 fixed callback touch executions pass across Chromium/WebKit and four emulated phone/tablet orientations. They verify trusted touch events, scheduling, outcomes/follow-up, persistent restrictions and unsaved edits. These are not physical-device results.
- Selected callback WebKit fails at 320px with doubled text on Linux and Intel Mac. Observed document widths are 521px and 443px. The exact overflowing element was not recorded in run83.
- Private WebKit recovery has one `Frame load interrupted` error during competing login navigation after API logout. The initiating in-flight request is unproven. Other authentication and recovery assertions remain required.
- The Apple Silicon job finishes cancelled with runner ID zero, no steps and zero cases. No agent requested cancellation. Its cause remains unconfirmed.
- Native OCR dependency identity passes. All 310 field outcomes match run82 on unchanged CI pipeline and dataset bytes. Accuracy stays FAIL at 289/310, with 263 blank fields preserved and zero native errors/review violations. [Dependency evidence](evidence/ocr-dependency-ci-run83.json).
- Required native isolation remains BLOCKED before denial cases at bubblewrap loopback setup. Do not use a privilege exception or silent fallback. The nine HTTP workload checks and two public suspension guards pass as separate measurements, outside product-goal totals.

## Next integrated integrity milestone

This batch follows `1b35490`. Locate its eventual commit in branch history by the executable/test/workflow/policy manifest `e4c91c70dc0d92b087a49d5e3e2c529974da968ec6365efb5719f05f972ea6d3`. The full local Node/API/HTTP run passes 9,192 cases across 55 files with zero failures, skips, cancellations, TODOs or infrastructure errors and no source change during execution. Product passes are 9,056 after excluding 136 harness checks. Sixty-nine meaningful product cases are new relative to the preceding 9,123-case source. Focused runs and local/CI overlap receive no duplicate credit. [Local manifest, case inventory and file totals](evidence/integrity-local-2026-11-23.json).

Implemented and locally verified:

- Reject malformed UTF-16 before storage/archive publication while preserving valid pairs, combining text and literal replacement characters. [Text integrity](CALLBACK_TEXT_INTEGRITY.md).
- Guard panel clocks and live revision bounds before row/source/audit/tombstone writes. Preserve completed retries and safe terminal deletion. Verify encrypted recovery and both restored entrypoints. [Panel mutation/recovery](SPREADSHEET_MUTATION_RECOVERY_2026_11_23.md).
- Preflight request and contact-restriction fan-out clocks/revisions within the existing transaction. Keep failed restriction writes atomic, make zero provider calls and reject invalid archive chronology. [Request integrity](CALLBACK_REQUEST_INTEGRITY.md).
- Preflight every legacy safety-propagation target before migration DDL or writes. Reject unsafe upgrades while preserving logical schema/records and backup/recovery. Keep unaffected terminal legacy records and idempotent reopen. [Legacy migration](LEGACY_MIGRATION_INTEGRITY_2026_11_23.md).
- Keep session activity monotonic, preserve stored deadlines and return controlled invalid-clock/profile-exhaustion errors before writes. Arbitrary clock jumps still do not establish true elapsed-time expiry. [Account invariants](ACCOUNT_INVARIANTS_2026_11_23.md).
- Retain unconfirmed spreadsheet commands through later 4xx replies. Validate full project/row/source receipts, target IDs and matching upload metadata before replacing a draft. Require revision advancement for update/upload confirmation. [Unconfirmed saves](PANEL_UNCERTAIN_SAVE_2026_11_23.md) and [response integrity](PANEL_RESPONSE_INTEGRITY_2026_11_23.md).

Browser corrections and additions still need actual committed-source CI:

- Constrain native request controls and narrow grid track minima for WebKit reflow. Keep 320px overflow and actual root/body/control font-doubling assertions. Failure-only geometry will identify any remaining overflow without recording field content.
- Synchronize completed task reads, actual UI logout response and loaded login page before rejecting another restored owner's old password. Do not suppress navigation errors or weaken recovery assertions. [Navigation change](RECOVERY_BROWSER_NAVIGATION_2026_11_23.md).
- Two fixed-spreadsheet journeys commit real create/update/upload writes before corrupting only their success responses. They verify preserved drafts, original retry keys/bodies/image bytes and no duplicate records/revisions. Linux spreadsheet collects nine methods, Mac manual spreadsheet ten, combined private stays 132 and callback stays 15. Collection executes zero browser cases. [Collection/review](evidence/panel-receipt-browser-collection-2026-11-23.json).

The existing Apple Silicon job now tries the documented standard `macos-15` ARM64 runner after prior `macos-26` jobs ended with runner ID zero and no steps. All suites, actual `darwin/arm64` assertions, timeouts and policy gates remain. This is an alternate standard-image attempt, not a confirmed queue diagnosis or platform pass. [GitHub runner reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners).

The policy still has 54 automated requirements and seven manual gates. Nine fixed-spreadsheet requirements increase their minimum case counts to nine on Linux and ten on Mac. Policy SHA256 is `bde713a2eb921df4a730331938297b1d26740306c2ab9d36e65acd5b474f8886`. The collector must bind every new report to these exact bytes.

## Exact next steps

1. Finish review of this integrated milestone, commit verified source/docs to the existing development branch with a current-head lease, and keep PR8 draft/main unchanged. Verify the committed executable manifest equals the local tested manifest above. Do not include unrelated worktree changes.
2. Inspect that commit's actual PR workflow. Prioritize both selected callback WebKit reflow cases, the private WebKit recovery case and both new fixed-spreadsheet receipt journeys on all configured Linux/Mac engines. Preserve failures and investigate before changing assertions. Strict response validation needs the full browser regression, not just the local client-state selection.
3. Download every emitted report, verify artifact digests and tested merge/tree, and aggregate using the new committed policy. Preserve zero ARM executions if no runner is assigned. Do not transfer run83 passes or measurements to a changed source.
4. Update this checkpoint, development progress, both product acceptance records and PR metadata with exact source, actual outcomes and next tasks. Continue authorized implementation.
5. Independently investigate actual Safari verification on the existing standard Intel Mac runner using Apple's WebDriver and exact browser provenance. Research/design is in progress; no Safari execution or new gate satisfaction is claimed. Keep it separate from bundled WebKit and physical devices.
6. Follow [Windows storage gap](WINDOWS_STORAGE_GAP.md) before proposing private Windows tests. Owner SID/DACL, handle/reparse/link safety and atomic publication need an implemented and tested adapter. Removing POSIX checks or accepting Windows static-browser passes does not close this gate.

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
