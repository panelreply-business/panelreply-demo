# Spreadsheet release acceptance

## November 26 — run 99 attempt 2 and pending-command repair candidate (America/Detroit)

[Run 99 attempt 2](https://github.com/panelreply-business/panelreply-demo/actions/runs/45421164049/attempts/2) completed November 25 at 10:18:44 AM EST. Apple Silicon [job 139298507952](https://github.com/panelreply-business/panelreply-demo/actions/runs/45421164049/job/139298507952) cancelled at 10:18:14 AM, with no assigned runner or executed steps. Do not retry the same runner restriction again without a changed prerequisite. [Aggregate job 139308590385](https://github.com/panelreply-business/panelreply-demo/actions/runs/45421164049/job/139308590385) ran the source-bound collector on Node 24.22.3. All 41 jobs and 49 artifacts inventoried via the 100-item API pages. 36 success, four failures, one cancellation. No later branch run at review. No open issues or PR reviews/comments. Main remained `c6152b38ae2e3a824e6a81199aa0d757d47a19ae`; prior branch head `1b75407e6a76a3769f6f832ca4cd33ade76db74d` differed from tested head `7497a314b6844feb51a2df44be385f26106d804b` only by eight documentation/evidence files. PR8 is draft and unmerged. Tested merge `d61371623c718e0e8118eb41be4ab48b1267a861`, tree `573ced02f53da1cabaf28d7609f4caa03cbf29b8`, manifest `38ade4d889cc405bd2248526c3bb5d915f54a3b3d70b85fed6db5ec011d40354`; CI clean committed evidence.

Historical completed aggregate on that source: 24,951 PASS, zero FAIL, three ERROR, zero SKIP/BLOCKED product entries; 9,409 distinct cases, 7,467 generated. Callback 10,721 PASS / one ERROR; spreadsheet 12,019 PASS / two ERROR; shared 2,211 PASS once. 415 harness PASS and 7,131 duplicate observations excluded. 44 automated PASS, two FAIL, ten NOT_TESTED, seven manual NOT_TESTED. The two FAIL matrix rows are Windows bundled Firefox and installed Safari spreadsheet. Attempt 2 adds no product execution. No independent archive reconstruction this review. Attempt 2 summary artifact 15036277212 SHA-256 `50105757c3789c16c1cc9918e209c876a16c95038a125f99947fbe600255f245`. OCR historical 289/310 exact, 263/263 blank fields, zero review violations; quality FAIL. Native Windows fixture 14/15, Safari callback 3/3, spreadsheet 1/3, Ubuntu 26 native deny 6/6, Ubuntu 24 blocked remain earlier-source results.

New independently reproduced client defects (isolated JavaScript functions from exact prior source with synthetic API/DOM stubs; not browser, full Node, HTTP or production evidence):
- Callback profile receipt, high impact: `workspace/app.js` blob `3d3f7a332a79f80bc70c6c9ce3ee7d4471e1cd53`, saveProfile/renderProfile accept truthy business and facts. After an edited name and approved service answer, a synthetic 200 containing old revision 5 and empty facts replaced the edits, marked the form clean and reported “Business profile saved.” No real write is established. FAIL narrow reproduction. Repair still open: validate identity, full shape, exact normalized submitted fields and fresh revision before rendering; preserve pending draft and provide explicit safe recovery after an uncertain write. Do not confuse current-value readback with writer attribution.
- Spreadsheet project create and source upload, high impact: `workspace/panels.js` blob `3048e7ce1bbdfc6bc37e1c03a7107ba88b05057e`. Both catch paths treated all 4xx as definitive. Synthetic HTTP 408/429 cleared the frozen pending command and unlocked editing before an outcome was known. Candidate excludes 408/429 from definitive refusals, consistent with callback request-save behavior. Four baseline scenarios reproduced; eight candidate isolated scenarios (create/upload × 408/429/403/500) met expected behavior, including same serialized body/key through later 403 then synthetic success, while initial definitive 403 unlocks. Receipt validator, actual persistence and browser transport were stubbed. No additional product count. Four regression methods added to the existing platform client suite; full Node/browser/integration gates NOT TESTED locally. The candidate changes executable/test source; prior totals cannot qualify it. No change to OCR, session/product binding, deletion or provider controls.
- The separate permanent-refusal recovery dead end remains open: known project/update/upload needs explicit validated reload without claiming previous outcome; unknown create identity must not be guessed and its frozen key must not be silently replaced.

Read-only Render PASS for both services owner-suspended, auto-deploy and previews off. Fresh direct GET and full local execution BLOCKED (DNS, missing worktree, Node 22.16.0 rather than 24). Source review confirms fixed entrypoints, product-specific configuration, cookie stems, capability separation, product-specific store selection and no external provider activation. Runtime isolation/recovery on the changed candidate still awaits CI. Do not count synthetic stubs or an installer as tests. No spending, deploy, main merge, customer data/contact or provider activation. Active target remains 10,000, firstGoalAchievedAt unset. Both programs NO-GO for trial/release.

Next: verify the candidate's exact branch/PR merge and completed ordinary public PR CI, including four new methods; do not transfer previous passes. Then implement the profile receipt/recovery repair on a fresh source checkout, reproduce permanent spreadsheet refusal paths and verify native Windows fixture construction, Safari original file-read exception, Firefox navigation and outstanding OCR/host/platform/operating gates. December 20 independent readiness review and December 31 first-release target unchanged; no trial activation. [Evidence](evidence/run99-attempt2-review-2026-11-26.json).

## November 25 — run 99 attempt 1 review and targeted retry (America/Detroit)

[Run 99](https://github.com/panelreply-business/panelreply-demo/actions/runs/45421164049) attempt 1 completed November 24 at 10:21:33 AM EST. Head `7497a314b6844feb51a2df44be385f26106d804b`, merge `d61371623c718e0e8118eb41be4ab48b1267a861`, tree `573ced02f53da1cabaf28d7609f4caa03cbf29b8`, manifest `38ade4d889cc405bd2248526c3bb5d915f54a3b3d70b85fed6db5ec011d40354` (same executable/test/workflow manifest as run 97, not a new source fix). CI reports clean evidence. All 41 attempt-1 jobs inventoried: 36 success, four failure, one cancelled. [Evidence and artifact hashes](evidence/run99-daily-review-2026-11-25.json). Actual summary, Windows and Safari ZIPs inspected; not a complete independent aggregate reconstruction.

Latest completed ledger: 24,951 PASS, three ERROR, zero FAIL across 9,409 distinct cases (7,467 generated). Callback 10,721 PASS/one ERROR (3,506 distinct), spreadsheet 12,019 PASS/two ERROR (4,202 distinct), shared 2,211 PASS (1,701 distinct, counted once). Exclude 415 harness passes and 7,131 duplicate observations. Automated requirements 44 PASS, two FAIL, ten NOT_TESTED; seven manual NOT_TESTED. The decrease from run 97 is mostly cancelled ARM coverage, not a source regression. Keep active target 10,000 and achievement timestamp unset; do not add the runs together.

- Callback fixed Linux/Intel Mac suites pass; installed Safari 26.6 callback 3/3 PASS. Windows Firefox static demo empty-form case ERROR at Page.goto 5s timeout before the validation assertion. Treat as a navigation failure, cause unproven.
- Spreadsheet installed Safari 1/3 PASS, two upload ERROR. In both artifact records Python reads all 26,973 fixture bytes with stable identity and hash before/after. Trusted selection/click events observed, zero policy events, later arrayBuffer and FileReader both NotReadableError, zero saved sources. Original exception not captured; no conclusion that CSP or Safari sandbox caused it. Manual export case passes.
- Native Windows component 14/15, failed WNS.root_security_rejection: the supposed unprotected fixture is actually protected with a single owner grant. Failure occurs before openPrivateDirectory, so this is a confirmed fixture precondition defect, not evidence of unsafe runtime acceptance. Null/empty rejection completed, broad root case not reached. Hardlink case passes. Next native candidate should explicitly construct and independently verify the unprotected descriptor (including the correct inheritance control) only inside disposable fixture storage, then retain all original rejection/unchanged-identity assertions. Do not weaken runtime policy; no code repair claimed.
- OCR 289/310 exact, 263/263 blanks preserved, zero review violations; accuracy FAIL. Linux full Node/API/HTTP 9,124 product passes. Portable Windows and Intel Mac 7,019 each. Native host and manual Excel/physical devices/assistive technology, representative photos, selected-host/offsite recovery and applicable actual provider gates remain open.
- Render read-only check PASS: both user-suspended, auto-deploy and PR previews off. Prior November 24 CI GET guard 2/2 PASS; today's direct GET BLOCKED (DNS).
- Fresh local execution BLOCKED: prior worktree absent, GitHub DNS unavailable, Node 22.16.0 rather than 24. At 10:03 AM EST requested one targeted public-repository ARM job rerun for the missing runner coverage; [attempt 2](https://github.com/panelreply-business/panelreply-demo/actions/runs/45421164049/attempts/2) queued at observation, not a pass. Attempt-specific artifact names preserve prior failures. Do not rerun the full matrix or count duplicate cases. Reconcile attempt 2 when terminal, then reproduce Windows fixture, Safari file-read boundary, Firefox navigation and profile/spreadsheet pending-command defects on an authorized host. No provider activation, deployment, spending, customer interaction or product code change.

Both products remain separate NO-GO for trial and release. Preserve earlier worktrees and exact source, and do not transfer earlier passes across changes. This documentation-only checkpoint deliberately skips an unrelated CI rerun while the targeted attempt is pending.

## November 24 — run 97 evidence review (America/Detroit)

[Run 97](https://github.com/panelreply-business/panelreply-demo/actions/runs/45316302295) completed November 23 at 10:17 PM EST on head `e474392e98b4990c3159afd3ec8cc485393ccab8` through PR merge `5fb22b7f0e28155dad754e52050ae00cfd342353`, tree `29026635c5f82fd7ebcc3d99d6a80c2a33ce48ce`, source manifest `38ade4d889cc405bd2248526c3bb5d915f54a3b3d70b85fed6db5ec011d40354`. The CI collector reports clean committed evidence. All 41 jobs were inspected: 38 success and three failure. The [source-bound CI log reconciliation](evidence/run97-daily-review-2026-11-24.json) preserves the aggregate and job inventory. This is review of the prior evening's completed evidence, not fresh November 24 execution or independent ZIP reconstruction.

Portfolio: 32,334 PASS, two ERROR, zero FAIL across 9,409 distinct product cases (7,467 generated). Callback 14,112 PASS / 3,506 distinct; spreadsheet 15,880 PASS / two ERROR / 4,202 distinct; shared 2,342 PASS / 1,701 distinct, counted once. Excluded 527 harness passes and 7,131 duplicate observations. Automated requirements 55 PASS / one FAIL; seven manual NOT_TESTED. Active target stays 10,000; firstGoalAchievedAt remains null.

Apple Silicon now completes portable Node 7,019 product passes and bundled Chromium/Firefox/WebKit fixed-product suites. Installed Safari 26.6 on Intel: callback 3/3 PASS, spreadsheet 1/3 PASS (two upload-related ERROR). Linux full Node/API/HTTP: 9,124 product and 191 harness PASS. Native Windows storage 14/15 FAIL scope, separate 28 and 19 harness passes. Native OCR Ubuntu 26 six PASS, Ubuntu 24 BLOCKED (RTM_NEWADDR). Frozen OCR accuracy FAIL 289/310 exact; 263/263 expected blanks preserved. Both Render services independently read as owner-suspended with auto-deploy and previews off. CI GET guards passed 2/2; direct review GET unavailable. Both products remain independent NO-GO. No code fix, deployment, customer contact, provider call or new product execution performed in this review.

Fresh execution BLOCKED: prior local worktree not present, GitHub DNS inaccessible in review sandbox, Node 22.16.0 rather than required Node 24, no fresh dispatch action available. Preserve prior worktrees; resume on authorized host. Inspect the Safari and Windows artifact bytes, identify the remaining failing native case without weakening controls, reproduce the next profile/spreadsheet pending-command defect, then test any repair on its exact source. Keep selected-host/offsite, manual device/accessibility/Excel/representative-photo and applicable provider gates open.

## November 23 — same-image recovery verified

After an injected read failure, all six selected Linux and Intel macOS browser suites saved the reselected image exactly once and checked its bytes after reopening. Installed Safari passed its manual correction and export case, but both journeys requiring a source upload errored. The CI collector assigned 12,019 passing spreadsheet executions and two errors across 4,202 distinct spreadsheet cases. OCR matched all three fields on 289/310 synthetic images. Native Safari, OCR quality, representative photos, native Excel and operating requirements remain open. [Run 96, attempt 1](https://github.com/panelreply-business/panelreply-demo/actions/runs/45313971458/attempts/1).

## November 23 — request-save recovery and native diagnostics

The next 207-file candidate has manifest `ed53015aaf8936613d1f32c1542c5820544b83f9d8b9eaeedf206cab9a59425c`, based on published `6b4964f`. Callback request receipts now bind identity, revision and normalized fields. Uncertain retries retain their command, and explicit validated reload resolves a permanent-refusal dead end without claiming the earlier write succeeded. The integrated 58-file Node/API/HTTP run passes 9,311 checks: 9,120 product and 191 excluded harness, with no failures/skips or source changes. Eleven new product IDs are added and all prior 9,109 remain. The full raw report is preserved. The two new callback browser journeys await source-bound CI. [Milestone](REQUEST_RECOVERY_NATIVE_DIAGNOSTICS_2026_11_23.md), [root evidence](evidence/request-recovery-root-integration-2026-11-24.json).

Root independently reconciles run 93 on `6b4964f`: 24,893 product PASS/zeroFAIL/twoERROR,9,391 distinct cases. It excludes 405 harness passes and 7,118 duplicate observations. Requirements remain 45 automated PASS/oneFAIL/tenNOT_TESTED plus seven manual NOT_TESTED. Actual Safari is 4 PASS/two upload ERROR, native Windows 13 PASS/twoFAIL with cleanup verified, OCR 26 fivePASS/oneFAIL and OCR 24 BLOCKED. Native diagnostic/fixture changes preserve the outstanding acceptance checks. Both independent products remain NO-GO. [Verified ledger](evidence/run93-independent-verification-2026-11-23.json).

## November 23 final run91 and OCR compatibility candidate

The independently verified run91 spreadsheet bucket records 11,999 PASS, one FAIL and two ERROR across 4,194 distinct cases. All six fixed spreadsheet suites pass their recorded methods. Installed Safari still fails all three journeys. Required OCR isolation remains BLOCKED on both observed hosts. [Verified ledger](evidence/release-run91.json).

The next candidate denies every ioctl and changes only the exact FIOCLEX error from EPERM to EACCES to permit CPython's existing fallback. Four policy/model regressions pass. Tagged source supports this hypothesis; it does not prove the actual failing syscall or native enforcement. Both hosts must rerun readiness and all six denial checks. The sysfs observation correction preserves its read/type/identity bounds. [OCR scope](OCR_FIOCLEX_COMPATIBILITY_2026_11_23.md) and [integration](evidence/native-compatibility-root-integration-2026-11-23.json).

Windows fixture and Safari input candidates also need native execution. The SQLite observer output boundary is repaired and locally verified, but native observation remains inactive pending component prerequisites. Accuracy remains 289/310 exact. Devices, Excel, native Mac extraction, ARM and host/operating requirements remain open. Spreadsheet remains an independent NO-GO decision.

Spreadsheet records one FAIL and two ERROR outcomes in installed Safari run91. These native failures remain open. [Source-bound verification](evidence/native-safari-run91-independent-2026-11-23.json).

## November 23 actual OCR host comparison

Run91 on `1562c8e` verifies the source-bound Ubuntu24 and Ubuntu26 reports separately. Ubuntu24 remains BLOCKED during loopback setup. Ubuntu26 reaches the engine/language checks but Python cannot open the mounted preprocessing script, so it also remains BLOCKED. Neither host executes any of the six native denial cases. No policy, privilege or host control changed. [Root verification](evidence/run91-native-independent-verification-2026-11-23.json).

Windows still has two empty-DACL fixture failures and incomplete cleanup. Its component remains outside the applications. The later callback receipt change preserves spreadsheet runtime bytes, and its combined local checks cannot be treated as spreadsheet-only credit. Accuracy, actual Safari, Windows integration, native Mac extraction, ARM, devices, Excel and operating gates remain open. Spreadsheet remains an independent NO-GO decision.

## November 23 native controls and host comparison

The reviewed candidate preserves native Safari upload actions, source confirmation, row persistence and download assertions while adding failure observations. Native select input now requires trusted keyboard/input/change events and exact values. Actual Safari verification is pending. The earlier upload failure cause remains unestablished. [Candidate](NATIVE_SAFARI_CONTROLS_2026_11_23.md).

Ubuntu24 and Ubuntu26 will run the unchanged six-case restricted OCR verifier separately, with source/dependency binding and bounded read-only host evidence. The output-alias correction has passed focused and independent review, with zero native attempts locally. [Output repair](OCR_HOST_OUTPUT_BOUNDARY_2026_11_23.md). These changes do not repair the 21 OCR mismatches, accept a production host or enable private Windows support. The spreadsheet release remains NO-GO.

## November 23 final run90 spreadsheet evidence

On committed `2882d4f`, the spreadsheet bucket has 11,999 product PASS and three installed-Safari ERROR outcomes across 4,194 distinct cases. All six fixed spreadsheet suites pass: nine methods per Linux engine and ten per Intel Mac engine. Shared checks remain counted once outside product buckets. [Final evidence](evidence/callback-scheduling-run90.json).

The response-integrity repair passes the source-bound Node/browser scopes executed in that run. Installed Safari still fails two source-upload confirmations and one reviewed-row persistence journey. OCR remains 289/310 exact, required native isolation remains BLOCKED, and Windows storage, native Mac extraction, ARM, physical devices, Excel, representative photographs and host/operating acceptance remain open. The independent spreadsheet release remains NO-GO.

## November 23 final run88 spreadsheet evidence

The spreadsheet bucket has 11,975 product PASS and three native Safari ERROR outcomes across 4,186 distinct cases on source `1322d063`. Shared checks are counted separately once. All six fixed spreadsheet suites pass their nine Linux or ten Intel Mac methods. Native Safari still fails source-upload confirmation in two workflows and reviewed-state persistence in one, so downloads/recovery are not accepted there. [Final run88 record](evidence/callback-scheduling-run88.json).

OCR remains 289/310 exact synthetic images, with all 263 expected blank fields preserved. Required native isolation executes zero denial cases and remains BLOCKED. Windows/private macOS extraction, ARM, physical devices, actual Excel, representative photographs and operating approval remain open. Later OCR response source `2882d4f` requires its own platform results.

## November 23 extraction receipt and draft integrity

Eight new cases reproduce and repair acceptance of a wrong-project OCR result and an error that left malformed candidates addable. Project/source/revision, candidate fields, warnings, confidence and unreviewed state now validate before result installation. Invalid re-extraction leaves no stale Add action and preserves saved corrections. Valid blank/Unicode/ambiguous output remains available for manual work. [Evidence](OCR_RESPONSE_INTEGRITY_2026_11_23.md).

The combined suite passes 9,241 checks, with 9,094 product cases and 147 excluded harness checks. These span both products. The changed manifest is `e359d184cae83587b5a98e5362ac52b0ce2b72332c8b68fc7dcf54878c544cc4`; actual browser verification remains pending. [Local evidence](evidence/ocr-response-local-2026-11-23.json).

All three Safari spreadsheet methods now pass plural-label setup but error later: two wait for upload confirmation, one does not retain reviewed status after save/reload. Native downloads and recovery remain unverified. These observed failures precede the current response-validation change. OCR remains 289/310 exact images; no engine, parser, preprocessing, model or expected answer changed. [Native evidence](evidence/native-safari-run88.json).

## November 23 required-OCR path boundary and native repair

The next manifest `6b951e01bef645f9434dc6e2adac382d1f9d6d419258d2df245a857ecbb6951e` adds 15 product regressions for required-OCR trusted-path checks. Private storage, repository and both home paths must resolve outside the runtime mount. The fixed normalizer and cached/per-stage checks reject redirection before native work. This repairs a configuration gap, with no observed native leak and no claim of sandbox denial or mount-topology pinning. Resource-limits behavior remains. [Scope and evidence](OCR_PATH_BOUNDARY_2026_11_23.md).

The combined local suite passes 9,233 checks: 9,086 product and 147 excluded harness cases. These totals span both products. Safari's spreadsheet title contract now matches the actual plural product label, but all three native spreadsheet workflows still need execution on changed source. No download/storage/recovery pass follows from a harness check. [Local record](evidence/native-boundaries-local-2026-11-23.json) and [Safari repair](NATIVE_SAFARI_INPUT_REPAIR_2026_11_23.md).

Final run86 passes all six fixed-spreadsheet suites with nine Linux and ten Intel Mac methods per engine. It preserves three native Safari setup failures. Windows component build fails before native execution in run87; its command-resolution repair still needs Windows. OCR remains 289/310 exact and native isolation remains BLOCKED. Actual Excel, representative photos, required platforms and operating approval remain open. [Run86](evidence/callback-scheduling-run86.json) and [Windows evidence](evidence/windows-native-component-run87.json).

## November 23 first native Safari spreadsheet execution

Run86 on `13b8741` verifies the installed Safari session but all three spreadsheet methods fail setup: the test expects singular PanelReply Spreadsheet while the actual product label is PanelReply Spreadsheets. This test-contract correction is pending. No native download, storage or recovery acceptance follows from these failures. [Source-bound native evidence](evidence/native-safari-run86.json).

The reviewed Windows storage component remains unimported. Its local evidence checks do not establish native private storage, SQLite sidecars, spreadsheet workflows or Windows extraction. All corresponding product gates remain open. [Component scope](WINDOWS_NATIVE_COMPONENT_2026_11_23.md).

## November 23 project read-snapshot correction

Seven new regressions reproduce and repair mixed project/source revisions during actual second-connection deletion and upload. CSV and XLSX now receive one saved snapshot, caller transactions remain open and failed reads clean up their own snapshot. Five baseline failures become seven passing cases, including two baseline contract passes. [Spreadsheet evidence](SPREADSHEET_READ_SNAPSHOT_2026_11_23.md).

The shared final local regression passes 9,217 checks, including 9,071 product cases and 146 excluded harness checks, with zero failures or skips and stable source. This is not spreadsheet-only credit. [Final local record](evidence/snapshot-layout-local-2026-11-23.json).

Run85's final verified record passes all six fixed-spreadsheet suites: nine methods per Linux engine and ten per Intel Mac engine. The two receipt/retry journeys pass throughout. ARM ends cancelled without execution. All three native Safari spreadsheet methods are NOT_RUN because session creation rejects an iOS-only desktop capability. The corrected strict desktop request still requires actual native downloads and product-bound recovery. [Final run](evidence/callback-scheduling-run85.json) and [Safari scope](NATIVE_SAFARI_SCOPE.md).

OCR remains FAIL at 289/310 exact. Required native isolation, representative photos, actual Excel, native Windows/full macOS extraction, remaining actual/physical platforms and operating approval stay open. No spreadsheet trial or release is approved.

## November 23 native-browser candidate

Run84 on `7a0a93a` passes all fixed-spreadsheet jobs on Linux (9/9 each) and Intel Mac (10/10 each), including both new receipt/retry journeys across all six jobs. All 34 emitted release ZIPs and 35 reports pass independent source/policy reconciliation. The run remains partial while ARM is queued. Private WebKit recovery passes all 132 methods. These observations belong to that committed source. [Verified snapshot](evidence/callback-scheduling-run84.json).

Three new fixed-spreadsheet journeys target installed Safari: manual correction with actual CSV/XLSX downloads, image retention/source links with unavailable OCR, and product-bound encrypted recovery. A pass requires native file observations and exact bytes; API readback cannot replace a download. No native Safari product method has run locally. All manual and extraction gates remain. [Scope](NATIVE_SAFARI_SCOPE.md).

The candidate's shared local regression passes 9,202 checks with zero failures/skips, including 9,056 product cases and 146 excluded harness checks. [Local evidence](evidence/safari-reflow-local-2026-11-23.json). A separately reproduced concurrent project/source read defect is being repaired next and is not included in this candidate.

OCR accuracy, required isolation, representative photos, actual Excel, remaining actual/physical platforms, selected-host/offsite recovery and operating approval remain open. No spreadsheet trial or release is approved.

## November 23 current spreadsheet checkpoint

[Run83](evidence/callback-scheduling-run83.json) completes on source `1b35490` with 11,865 passing spreadsheet case/platform executions across 4,125 distinct spreadsheet cases. Shared cases remain counted once separately, and the shared private WebKit recovery navigation error is unresolved on that source. All three Intel Mac manual spreadsheet suites pass 8/8. Their scope excludes native macOS extraction.

OCR dependency identity passes with all 310 extraction outcomes unchanged from run82 on identical CI dataset/pipeline bytes. Accuracy remains FAIL at 289/310, with 263 expected blank fields preserved and zero native errors/review violations. Twenty-one nonexact cases remain. [Dependency CI evidence](evidence/ocr-dependency-ci-run83.json).

The next candidate guards every affected panel mutation against invalid/backward clocks and exhausted live revisions before writes, with product-bound encrypted recovery regressions. Shared legacy migration now rejects unsafe propagation before schema or data changes and preserves the saved spreadsheet project through rejected-upgrade recovery. It retains unconfirmed commands through later refusals, validates full project/row/source receipts before replacing a draft and requires later revisions for update/upload confirmation. The complete integrated local run passes 9,192 cases, including 9,056 product executions and 136 excluded harness checks. This is a shared local total, not spreadsheet-only credit. [Mutation/recovery](SPREADSHEET_MUTATION_RECOVERY_2026_11_23.md) and [response integrity](PANEL_RESPONSE_INTEGRITY_2026_11_23.md).

Two new fixed-spreadsheet browser journeys check real committed create/update/upload responses corrupted only in transit, preserved drafts and exact retry/readback without duplicate records/revisions or changed source bytes. Linux spreadsheet collects nine methods and Mac manual spreadsheet ten. Browser collection is not execution. The changed client, these journeys and the shared recovery navigation correction need committed-source CI. Historical PASS rows below apply only to their named checkpoints.

Required isolation, representative photographs, actual Excel, actual/physical platforms, native Windows storage/full macOS extraction, selected-host/offsite recovery and operating approval remain open. No trial or release is approved. [Persistent next steps](AUTONOMOUS_CONTINUATION.md).

## November 23 committed deskew and dependency checkpoint

Run82 independently measures 289/310 exact on its recorded CI image bytes, four gains with no regressions against run81. All 263 expected blank fields remain blank, with zero native errors or review violations. Twenty-one nonexact cases keep quality FAIL. [CI comparison](evidence/ocr-deskew-ci-run82.json). All three Intel Mac manual spreadsheet suites pass 8/8, including WebKit after the optional-preview repair. That scope excludes native macOS extraction. [CI snapshot](evidence/callback-scheduling-run82.json).

The next candidate records native executable/model/configuration identities and a separate identity gate. Its complete local replay retains every previous extraction outcome and matching pre/post identities. Missing identity blocks provenance, changed identity fails it, and neither state is treated as an accuracy pass. The integrated Node/API/HTTP regression passes 9,123 checks, with 136 verifier checks excluded from the 8,987 product executions. [Identity and count correction](OCR_DEPENDENCY_EVIDENCE_2026_11_23.md) and [local record](evidence/mobile-metadata-local-2026-11-23.json).

Required OS isolation, representative photographs, actual Excel, physical/actual platform scopes, native Windows storage and full macOS extraction, host/offsite recovery and operating approval remain open. No trial or release is approved.

A subsequent audit reproduced project mutations that can invalidate recovery after a clock rollback or revision exhaustion. Pre-mutation guards and recovery regressions are in progress and are not included in this candidate.


## November 23 deskew and platform follow-up

The next production OCR candidate measures 289/310 exact on the same local synthetic image bytes, with four gains over the small-text candidate, no earlier exact-image regression, all 263 expected blank fields preserved and zero native errors/review violations. Twenty-one nonexact images keep the quality gate FAIL. Independent review and actual native geometry/resource/cancellation checks pass their named scopes. [Deskew measurements and reproduction](OCR_DESKEW_2026_11_23.md).

Run81 independently measures the preceding pipeline at 285/310 on its recorded CI dataset and Tesseract build. [CI evidence](evidence/ocr-small-text-ci-run81.json). Intel Mac manual spreadsheet suites pass 8/8 in Chromium and Firefox. WebKit runs all eight methods but fails two teardown console checks because optional screenshot preparation injects a forbidden stylesheet. The capture correction preserves every product and console assertion. Fresh corrected-source CI is required. Native macOS OCR remains unsupported, Apple Silicon is unassigned, and OS isolation, photos, actual Excel/physical devices and operating gates remain open. No customer trial or release is approved.

## November 23 small-text OCR candidate

Conditional image enlargement improved the unchanged local 310-image benchmark from 277 to 285 exact images. Eight failures became exact, no earlier exact image regressed, all 263 expected blank fields stayed blank, and native errors/review violations remained zero. Twenty-five images remain nonexact, so OCR quality remains FAIL. [Source hashes, before/after outcomes and limits](OCR_SMALL_TEXT_2026_11_23.md).

The changed pipeline still requires committed CI verification on its recorded Tesseract/runtime build and dataset. Intel Mac and Apple Silicon manual project/correction/export/recovery coverage is being added with an explicit native-OCR-unavailable case. That scope does not establish native macOS extraction. Actual photographs, Excel, Safari/physical devices, OS worker isolation, selected-host/offsite recovery and operating requirements remain open. The program remains NO-GO for customer testing or release. [Persistent continuation](AUTONOMOUS_CONTINUATION.md).

## November 23 daily check

Spreadsheet entrypoint, dedicated cookie/store marker, blocked callback/provider routes and product-bound encrypted recovery remain implemented with no code changes since tested `ca5f0cb`. Last full [PR8 run76](https://github.com/panelreply-business/panelreply-demo/actions/runs/44788287151): 4,118 distinct spreadsheet cases and 11,836 passing case/platform executions, plus shared cases counted once; selected Linux Chromium, Firefox and WebKit journeys passed 21/21. No fresh PR run today (**BLOCKED**). [Main run79](https://github.com/panelreply-business/panelreply-demo/actions/runs/45194906999) does not verify spreadsheet. OCR accuracy remains **FAIL 277/310**, with 33 nonexact; native isolation BLOCKED with zero denial cases. Representative photos, actual Excel/physical mobile, selected-host/offsite recovery and operating approvals remain open. **GO for isolated synthetic review; NO-GO for customer trial or release.** [Daily evidence](evidence/daily-audit-2026-11-23.json).


## November 22 daily check

Current spreadsheet program source remains tested `ca5f0cb` (docs-only branch head `bc86e8e1`). The last exact-source evidence is [run76](https://github.com/panelreply-business/panelreply-demo/actions/runs/44788287151): **4,118 distinct spreadsheet cases, 11,836 passing case/platform executions**, and 21/21 selected spreadsheet browser journeys on Linux Chromium, Firefox and WebKit. Another 1,675 distinct shared cases (2,185 passes) are counted once. Separate fixed entrypoint, source routes, data/session boundary, encrypted product backup and restore were inspected in unchanged code. No fresh spreadsheet execution today: **BLOCKED** by runtime/checkout/full-dispatch limits. OCR accuracy remains **FAIL 277/310, 33 nonexact**; required worker isolation **BLOCKED**, zero native denial cases; real photos, Excel, actual/physical platforms, selected host and offsite recovery remain open. **NO-GO for human trial/release**. [November 22 daily evidence](evidence/daily-audit-2026-11-22.json).

## November 21 daily check

The fixed spreadsheet entrypoint, product-only routes, separate cookie/data binding and encrypted product restore remain implemented in the unchanged tested source `ca5f0cb`. Last verified product ledger: 4,118 distinct spreadsheet cases, 11,836 case/platform passes, plus 1,675 distinct shared cases counted once (2,185 shared executions). Seven selected spreadsheet journeys per Linux Chromium, Firefox and WebKit passed in run76. No fresh spreadsheet regression executed today (environment and full-matrix dispatch BLOCKED). OCR quality is still FAIL (277/310 exact, 33 nonexact); required OS isolation remains BLOCKED before native denial tests. Representative photos, Excel, manual platforms, selected-host/offsite recovery and operating approvals remain open. NO-GO for human trial/release. [Daily audit](evidence/daily-audit-2026-11-21.json).


Review date: November 20, 2026. Current decision: NO-GO for release or a real-world trial. Continue source review and isolated synthetic evaluation.

This record covers `spreadsheet-server.cjs` and its own bound data directory. It covers panel projects, private source images, local OCR candidates, human review, saved rows and CSV/XLSX export. Unknown values stay blank. Source bytes remain available. OCR does not certify electrical specifications, identify compatibility or approve a part.

[Program setup and boundaries](PRODUCT_SEPARATION.md) · [Daily checklist](DAILY_QUALITY_CHECKLIST.md) · [Test milestones](TEST_MILESTONES.md) · [Detailed shared acceptance history](RELEASE_ACCEPTANCE.md)

## Evidence and open gates

PASS applies only to the named executed scope. [Run76](https://github.com/panelreply-business/panelreply-demo/actions/runs/44788287151) is a verified checkpoint, not completed platform or release acceptance:

- Branch head: `ca5f0cbfbf0d23cc20e007018c13cc630fb8f42a`.
- Tested merge: `7a9b95ac3d36ff238ef49b036457e4d00e77a972`.
- Source/test manifest SHA-256: `823418de33d6f2d166d6aae9013f6b3baf2ca43ecd1286bed76b5e81bb218e81`.

The [Linux Node/API/HTTP job](https://github.com/panelreply-business/panelreply-demo/actions/runs/44788287151/job/136468890829) passed 8,942 cases with no failures, skips, cancellations or infrastructure errors and `sourceChanged:false`. Excluding 79 evidence-harness cases leaves 8,863 product executions. These shared totals are not a spreadsheet-only count. The same job passed nine native OCR cases, eight native resource/lifecycle cases and nine independent XLSX-reader cases. OCR quality is scored separately.

Selected spreadsheet journeys passed seven cases in each of Linux [Chromium](https://github.com/panelreply-business/panelreply-demo/actions/runs/44788287151/job/136468891345), [Firefox](https://github.com/panelreply-business/panelreply-demo/actions/runs/44788287151/job/136468891210) and [WebKit](https://github.com/panelreply-business/panelreply-demo/actions/runs/44788287151/job/136468891123): 21/21 executions, zero failures or skips. The two selected products together passed 42/42. [Windows WebKit static coverage](https://github.com/panelreply-business/panelreply-demo/actions/runs/44788287151/job/136468891533) passed 92/92. These results do not establish private Windows/macOS product workflows or actual Safari support.

[Run75 Mac WebKit](https://github.com/panelreply-business/panelreply-demo/actions/runs/44786004194/job/136460919199) had 90 passes and two failures: native Tab did not focus the root demo's `#call` (Simulate missed call) button, and marketing-preview selects measured below 44 px. [Run76 Mac WebKit](https://github.com/panelreply-business/panelreply-demo/actions/runs/44788287151/job/136468891138) passes 92/92 with the root-page Tab-order and select-size corrections. The keyboard and geometry requirements remain. [Defect history](PRELAUNCH_DEFECTS.md) preserves run73/run74/run75 results.

Seven required platform scopes remain NOT TESTED under the [milestone policy](test-milestones.json): actual macOS Safari, physical iPhone Safari, physical iPad Safari, physical Android Chrome, private product workflows on Windows, private product workflows on macOS, and Apple silicon macOS. Automated passes do not close these scopes.

| ID | Gate | Result | Evidence and remaining requirement |
| --- | --- | --- | --- |
| SS-01 | Linux product boundary and configuration | PASS | Run76 includes the [boundary](../tests/product-boundaries.test.cjs) and [configuration](../tests/product-config.test.cjs) suites. Spreadsheet-only routes, fixed identity, distinct cookies, directory binding and no conversation-orchestrator startup are exercised on the committed checkpoint. |
| SS-02 | Projects, images, review, version checks and persistence | PASS | Run76 store/API and selected spreadsheet journeys pass. They cover save/reopen, source bytes, unreviewed OCR candidates, explicit correction, retry and deletion behavior. Host durability remains a separate gate. |
| SS-03 | Saved CSV/XLSX structure, values and types | PASS | Run76 passes the [export matrix](../tests/release-export-matrix.test.cjs), writer/API cases and nine independent XLSX-reader cases. They cover executed file contracts, escaping and formula-like text. ZIP/XML or openpyxl readback does not prove Excel or every application's resave behavior. |
| SS-04 | Controlled bound backup, restore and restart | PASS | Run76 includes [product recovery](../tests/product-backup.test.cjs), matching-product restore, source preservation, fixed-entrypoint startup and the selected browser restart case. Restore strips sessions and disables copied passwords. Operator recovery sets a new password. This is controlled synthetic recovery, not hosted restart or offsite acceptance. |
| SS-05 | Exact synthetic OCR quality | FAIL | [Run76 measurement](https://github.com/panelreply-business/panelreply-demo/actions/runs/44788287151/job/136468891092): 277/310 images match every expected field, with 33 nonexact, zero native errors and zero review violations. All 310 outcomes match run75. Completing the run does not make extraction accurate. [Benchmark contract](OCR_BENCHMARK.md). |
| SS-06 | Required native-worker isolation | BLOCKED | [Run76 restricted worker](https://github.com/panelreply-business/panelreply-demo/actions/runs/44788287151/job/136468890987) executes zero native deny cases. Bubblewrap 0.12.0 passes its version check, but readiness fails with `bwrap: loopback: Failed RTM_NEWADDR: Operation not permitted`. The classifier reports `worker_startup_cause_unconfirmed` and `confirmedExternalBlocker:false`. No fallback or privileged retry ran. |
| SS-07 | Isolation and dependency operation on selected host | BLOCKED | No selected-host execution. Verify the required worker, patch policy, resource ceilings, cancellation, crash recovery and native deny cases on the approved host. |
| SS-08 | Representative photograph quality | NOT TESTED | No authorized representative photo corpus has been measured. Evaluate glare, wear, angle, crop, blur, low contrast, punctuation and ambiguous characters with exact expected values and manual-review outcomes. Synthetic labels are not field-photo accuracy. |
| SS-09 | Actual Microsoft Excel | NOT TESTED | No authorized Excel run. Open exported originals and compare exact values/types, leading zeros, Unicode, formula-like text and both worksheets. Test resave behavior separately. |
| SS-10 | Complete required platform acceptance | NOT TESTED | Seven required platform scopes above lack executed evidence. Browser emulation, bundled WebKit and Intel Mac passes do not establish those scopes. |
| SS-10A | Automated platform matrix | PASS | All 30 automated requirements pass in [run76 accounting](https://github.com/panelreply-business/panelreply-demo/actions/runs/44788287151/job/136478385752), with clean reports tied to the tested source. This includes the Mac corrections and all six selected-product jobs. The seven untested platform scopes remain separate. |
| SS-10S | Selected spreadsheet UI on Linux | PASS | Seven cases per Chromium, Firefox and WebKit, 21/21 executions. Project/source persistence, explicit OCR-review controls, exports, isolated routes, restart and sign-out are exercised. |
| SS-10D | Actual Safari, physical devices and native camera/file-picker behavior | NOT TESTED | Bundled WebKit, emulation and synthetic file uploads do not establish these behaviors. Full assistive-technology use also remains untested. |
| SS-11 | Selected-host persistence, offsite recovery and operations | BLOCKED | Approve pricing and cost assumptions, then exercise the selected host, backup destination, recovery objectives, rollback, retention, support ownership, monitoring and incident response. Local recovery does not close this gate. |
| SS-12 | Real-world testing and release decision | BLOCKED | Review applicable gates, authorized participants/data, success criteria, stop conditions and recovery. Approve this program's exact release scope and activation separately. |

The callback program's actual-model gap does not block a spreadsheet-only release once separation is verified. Shared security and recovery failures affect both programs. The current spreadsheet gate still includes OCR quality and isolation. Manual correction or a large test total does not waive them.

The [run76 HTTP workload](https://github.com/panelreply-business/panelreply-demo/actions/runs/44788287151/job/136468890517) passed nine workflow groups across 516 responses with zero unexpected errors. Its restart reopens the HTTP server and store in the same Node process. It does not establish host restart, failover or capacity. [Both public suspension guards](https://github.com/panelreply-business/panelreply-demo/actions/runs/44788287151/job/136468890923) passed. Three public application checks remain policy-BLOCKED.

## Required workflow evidence

- Sign in and verify the spreadsheet product and cookie. Reject callback pages, scripts, business facts, leads, preview and assistant routes.
- Create and reopen a project. Upload valid source images and preserve the original bytes.
- Reject malformed signatures, invalid dimensions, oversized uploads and quota violations without saved partial state.
- Run bounded OCR, retain raw text, keep candidates unreviewed, edit values, mark review explicitly and save.
- Reopen the project and compare every saved field. Export CSV/XLSX and read files independently to confirm text identifiers, quantities, row order, source links and review metadata.
- Cover lost responses, retries, stale versions, cancelled processing, native failures and source/project deletion. Keep uncertainty visible until a matching receipt or confirmed saved state arrives.
- Restore an encrypted product archive to a new directory, reset copied credentials after reconciliation, reopen through the fixed entrypoint and verify rows, images and exports.

The selected browser cases are in [product_browser_test.py](../tests/product_browser_test.py). The [benchmark](OCR_BENCHMARK.md) keeps engine versions, font/image hashes and measurements separate. Compare identical inputs when claiming a pipeline improvement. Do not remove failing images, guess identifiers or count benchmark measurements as extra passing application tests.

## Schedule and release review

Run the daily checklist through December 20, 2026. At that review, prepare a spreadsheet-only real-world test plan with the exact build, authorized source images, tasks, participants, device/Excel environment, host, support owner, success criteria and recovery procedure. Start only when its technical gates and owner approvals are met.

December 31 is the target for the first program release. The owner has not selected the first program or the second release date. This program needs its own release decision. The portfolio's 10,000-test target and conditional 20,000 target do not replace OCR, isolation, photo, Excel or operational acceptance.
