# Pre-launch defect register

## Run76 checkpoint — November 20, 2026

[Run76](https://github.com/panelreply-business/panelreply-demo/actions/runs/44788287151) tested branch head `ca5f0cbfbf0d23cc20e007018c13cc630fb8f42a` through PR merge `7a9b95ac3d36ff238ef49b036457e4d00e77a972`. The source/test manifest SHA-256 is `823418de33d6f2d166d6aae9013f6b3baf2ca43ecd1286bed76b5e81bb218e81`, with `sourceChanged:false`. Prior failures remain recorded below. Passing corrections apply to this tested source.

| Executed scope | Run76 result | Evidence and limit |
| --- | --- | --- |
| Linux Node/API/HTTP | 8,942 PASS, zero failures or skips | [Linux job](https://github.com/panelreply-business/panelreply-demo/actions/runs/44788287151/job/136468890829). Excluding 79 evidence-harness cases leaves 8,863 product executions. Zero cancellations, todo cases and infrastructure errors. |
| Native OCR and resource/lifecycle | 9 + 8 PASS | Same Linux job. These execution checks do not establish extraction accuracy or OS isolation. |
| Independent XLSX reader | 9 PASS | Same Linux job. Actual Excel remains NOT TESTED. |
| Mac static browser workflows | 92/92 per engine | [Chromium](https://github.com/panelreply-business/panelreply-demo/actions/runs/44788287151/job/136468891157), [Firefox](https://github.com/panelreply-business/panelreply-demo/actions/runs/44788287151/job/136468891131) and [WebKit](https://github.com/panelreply-business/panelreply-demo/actions/runs/44788287151/job/136468891138) pass on Intel macOS. WebKit verifies native Tab order and the 44 px select targets. Actual Safari and Apple silicon remain unverified. |
| Selected callback and spreadsheet programs | 42/42 PASS | Seven cases per program in each of Linux Chromium, Firefox and WebKit. [Callback evidence](CALLBACK_RELEASE_ACCEPTANCE.md) and [spreadsheet evidence](SPREADSHEET_RELEASE_ACCEPTANCE.md) link all six jobs. |
| Automated platform matrix | PASS, 30/30 requirements | [run76 accounting](https://github.com/panelreply-business/panelreply-demo/actions/runs/44788287151/job/136478385752) validates the reports against the tested source. All 23 browser jobs total 1,633 PASS, zero failures, errors or skips. The seven untested platform scopes remain separate. |
| Controlled storage/recovery drill | Five groups PASS, zero unexpected errors | Linux job. Source preservation, encrypted recovery and credential reset are exercised. Restored sessions are stripped and copied passwords disabled. |
| Concurrent HTTP drill | Nine groups PASS, 516 responses, zero unexpected errors | [Workload job](https://github.com/panelreply-business/panelreply-demo/actions/runs/44788287151/job/136468890517). Twelve clients in one Node process. The restart reopens the HTTP server and store in that process, not the host. |
| Synthetic OCR quality | FAIL, 277/310 exact | [Measurement job](https://github.com/panelreply-business/panelreply-demo/actions/runs/44788287151/job/136468891092). 33 nonexact images, zero native errors and review violations. All 310 recorded outcomes match run75. |
| Required native-worker isolation | BLOCKED, zero native deny cases | [Isolation job](https://github.com/panelreply-business/panelreply-demo/actions/runs/44788287151/job/136468890987). Bubblewrap 0.12.0 passes its version check. Engine readiness reports `bwrap: loopback: Failed RTM_NEWADDR: Operation not permitted`. Cause remains `worker_startup_cause_unconfirmed`, with `confirmedExternalBlocker:false`. No fallback or privileged retry. |
| Public suspension | Two guards PASS, three application checks policy-BLOCKED | [GET-only guard job](https://github.com/panelreply-business/panelreply-demo/actions/runs/44788287151/job/136468890923). No service activation or Render change follows from this result. |

The Linux job also passes the standalone 334-scenario, 374-turn conversation evaluation with zero real-provider calls and the 197-case Chromium browser baseline. The conversation scenarios overlap Node coverage. Drill operations, benchmark images, assertions and reruns do not add product cases.

Complete required platform acceptance remains NOT TESTED. Seven required scopes lack evidence under the [milestone policy](test-milestones.json): actual macOS Safari, physical iPhone Safari, physical iPad Safari, physical Android Chrome, private product workflows on Windows, private product workflows on macOS, and Apple silicon macOS. The automated matrix and any portfolio count cannot close these gaps.

Actual provider/model evaluation, representative photographs, Excel, selected-host operation and offsite recovery remain open. Controlled fixed-entrypoint restart and recovery do not establish hosted restart, failover or recovery objectives. The December 20 readiness review and each program's release decision remain separate from the December 31 first-release target.

## Run75 checkpoint — November 20, 2026

[Run75](https://github.com/panelreply-business/panelreply-demo/actions/runs/44786004194) tested branch head `3bbb0528ba4487e0aa9b3298ad1b5d475939fe70` through PR merge `f314429a7470f17b69f841c3f41e490ba9d16806`. The source/test manifest SHA-256 is `fbffb29fd99a316d26ab8247df3c2162ee6d84fe6c048e95c5dcb2b5c4f9db74`, with `sourceChanged:false`. This checkpoint proves the executed scopes below. It is not completed platform or release acceptance.

| Executed scope | Run75 result | Evidence and limit |
| --- | --- | --- |
| Linux Node/API/HTTP | 8,942 PASS, zero failures or skips | [Linux job](https://github.com/panelreply-business/panelreply-demo/actions/runs/44786004194/job/136460918652). Excluding 79 evidence-harness cases leaves 8,863 product executions. Zero cancellations and infrastructure errors. |
| Native OCR and resource/lifecycle | 9 + 8 PASS | Same Linux job. These execution checks do not establish extraction accuracy or OS isolation. |
| Independent XLSX reader | 9 PASS | Same Linux job. Actual Excel remains NOT TESTED. |
| Selected callback and spreadsheet programs | 42/42 PASS | Seven cases per program in each of Linux Chromium, Firefox and WebKit. [Callback evidence](CALLBACK_RELEASE_ACCEPTANCE.md) and [spreadsheet evidence](SPREADSHEET_RELEASE_ACCEPTANCE.md) link all six jobs. These are separate fixed-entrypoint journeys. |
| Windows WebKit static workflows | 92/92 PASS | [Windows job](https://github.com/panelreply-business/panelreply-demo/actions/runs/44786004194/job/136460919002). Includes ordinary Tab on the explicitly focusable skip link, export activation and dialog-focus assertions. |
| Mac WebKit static workflows | 90 PASS, 2 FAIL | [Mac job](https://github.com/panelreply-business/panelreply-demo/actions/runs/44786004194/job/136460919199). Root-page keyboard focus and native-select target size remain open as detailed below. |
| Controlled storage/recovery drill | Five groups PASS, zero unexpected errors | Linux job. Synthetic capture, restore, source preservation and credential recovery are exercised. |
| Concurrent HTTP drill | Nine groups PASS, 516 responses, zero unexpected errors | [Workload job](https://github.com/panelreply-business/panelreply-demo/actions/runs/44786004194/job/136460918928). Twelve clients in one Node process. The restart reopens the HTTP server and store in that process, not the host. |
| Synthetic OCR quality | FAIL, 277/310 exact | [Measurement job](https://github.com/panelreply-business/panelreply-demo/actions/runs/44786004194/job/136460918788). 33 nonexact images, zero native errors and review violations. All 310 outcomes match run74. |
| Required native-worker isolation | BLOCKED, zero native deny cases | [Isolation job](https://github.com/panelreply-business/panelreply-demo/actions/runs/44786004194/job/136460918352). Bubblewrap 0.12.0 passes its version check. Engine readiness reports `bwrap: loopback: Failed RTM_NEWADDR: Operation not permitted`. Cause remains `worker_startup_cause_unconfirmed`, with `confirmedExternalBlocker:false`. No fallback or privileged retry. |
| Public suspension | Two guards PASS, three application checks policy-BLOCKED | [GET-only guard job](https://github.com/panelreply-business/panelreply-demo/actions/runs/44786004194/job/136460918896). No service activation follows from this result. |

The standalone conversation evaluation passes 334 scenarios across 374 turns with zero real-provider calls. Those scenarios already appear in Node coverage. Do not add repeated runs, drill responses, benchmark images or assertions to the portfolio count. Complete platform aggregation remains separate, and Mac's two failures prevent complete browser acceptance for this source.

Actual provider/model validation, representative photographs, actual Safari, physical devices, Excel, selected-host operation and offsite recovery remain open. Controlled fixed-entrypoint restart and restore tests do not establish hosted restart, failover or recovery objectives. Real-world testing still requires the separate December 20 readiness review and the authorized test scope. The December 31 first-release target does not close these gates.

### Run75 findings and run76 verification

| ID | Evidence and impact | Current status and required verification |
| --- | --- | --- |
| SPLIT-UI-07 | Mac WebKit ordinary Tab does not focus the `#call` (Simulate missed call) button on root `index.html` in `browser_test.DemoBrowserTests.test_keyboard_access_to_every_control`. | FAIL in run75, corrected and PASS in run76 Mac WebKit 92/92. Root page buttons, select, navigation/footer links and disclosure summaries use explicit `tabindex="0"` in document order. The existing case verifies ordinary Tab across navigation, actions and disclosures, with no positive tabindex or substituted focus calls. |
| SPLIT-UI-08 | Mac WebKit measures marketing-preview selects at 21 px (`request-filter`), 23 px (`detail-status`) and 23 px (`callback`). | FAIL in run75, corrected and PASS in run76 Mac WebKit 92/92. The controls retain native select behavior while using `appearance:none`, a 44 px minimum height and a CSS chevron, with native appearance restored under forced colors. The 44 px browser assertion remains unchanged. |

## Independent product and test expansion — November 20, 2026

These findings describe the separated-product work and its earlier checkpoints. Focused regressions overlap the full suite and must not be added to it. The checkpoint sections above supersede pending-verification wording only for their named executed scopes. Original run73/run74 failures remain historical evidence.

| ID | Evidence and impact | Correction | Regression evidence |
| --- | --- | --- | --- |
| SPLIT-AI-01 | A customer name such as `O’Neil` retains its typographic apostrophe in the message and proposal, while independent deterministic extraction folds it to an ASCII apostrophe. Raw comparison rejects matching evidence. | Normalize apostrophes for the customer-name comparison only. Preserve the supplied value and exact message/evidence checks. | Four apostrophe controls in `release-assistant-matrix.test.cjs`, plus existing assistant cases. |
| SPLIT-AI-02 | An unanchored `name is` cue can accept a site, manufacturer, business or project name as the customer's name. Four independent cases failed before the correction. | Anchor the explicit name cue to the clause start, allowing bounded greetings and correction prefixes. Retain actual self-identification and the sole pending name-question path. | `release-name-grounding.test.cjs`: 20 PASS/4 FAIL before correction, 24 PASS after correction. Combined name and assistant regression: 1,468 PASS, zero FAIL/skips. |

The new count policy also removed redundant multiplication of malformed provider inputs across unrelated states. The retained assistant matrix has 983 independently named cases. Evidence-harness tests remain excluded from the product goal. Run75's Linux count is recorded above. The final portfolio count and milestone decision require complete source-bound aggregation.

### First expanded platform run

[Run73](https://github.com/panelreply-business/panelreply-demo/actions/runs/44783047893) tested PR merge `d35465f11858992bc25310e42618271a9407c402`, containing candidate `61f071c89829bce4c57cd107d8bb4677742a790d`. The candidate and tested merge have the same Git tree and source manifest. Its full Linux Node result is 8,860 product passes plus 79 evidence-harness passes, with no failures or skips. Portable Windows and Linux each passed 6,935 product cases plus 79 harness cases. The Linux portable observations overlap the full Linux result and do not increase its count.

Expanded browsers exposed the following findings. Their original failures remain recorded. A local correction is not a browser pass. The verified scopes below come from the executed follow-up jobs.

| ID | Evidence and impact | Correction | Executed verification / remaining scope |
| --- | --- | --- | --- |
| SPLIT-UI-01 | Selected callback navigation overwrites its product-specific tab title with the legacy combined label. One method fails in each engine in run73. | Keep the callback label when changing inbox/profile views. | PASS in run75's selected callback suite, seven cases per Linux engine, 21/21. Two client-state controls also retain callback and combined behavior. |
| SPLIT-UI-02 | Windows WebKit does not focus a pointer-clicked Export button. Blur validation moves the button before click, so the recorded activation count is zero. | Focus Export on primary pointerdown so the existing blur guard preserves the target until click validation. | PASS in run74 and the run75 Windows WebKit 92/92 job. Activation, validation and focus assertions remain. |
| SPLIT-UI-03 | Windows WebKit opens the walkthrough without focusing its launch button. Native dialog dismissal cannot restore that expected opener. | Focus the known opener before opening the native dialog. | PASS in run74 and run75 Windows WebKit. Escape/Close focus restoration and review/skip destination checks remain. |
| SPLIT-UI-04 | At 320 px and 200% text, Firefox and Linux WebKit measure a 349 px page, exceeding the unchanged 321 px tolerance. | Allow text and containing flex items to reflow without shrinking text or hiding overflow. Add offending-element diagnostics and unclipped heading bounds. | PASS in run75 Linux [Firefox, 65/65](https://github.com/panelreply-business/panelreply-demo/actions/runs/44786004194/job/136460919120) and [WebKit, 65/65](https://github.com/panelreply-business/panelreply-demo/actions/runs/44786004194/job/136460918706). The 200% text and 321 px limits remain. |
| SPLIT-UI-05 | Firefox's implicit `/favicon.ico` request triggers a CSP error and fails every static-suite teardown in run73. | Declare an embedded SVG icon and add only `img-src data:`. Retain default deny, hashed scripts/styles, same-origin connections, form/base restrictions and every console assertion. | PASS in run75 Linux Firefox 65/65. A Node contract verifies the embedded icon and policy. Network image loads remain blocked. |
| SPLIT-UI-06 | Windows WebKit ordinary Tab initially skips the skip link. The alternate-Tab fixture change still fails in run74, whose other 91 methods pass. | Give the skip link `tabindex="0"` and restore ordinary Tab on every platform. Preserve document order, actual keyboard input and focus diagnostics. | PASS in run75 Windows WebKit 92/92. This closes the observed Windows skip-link case. The separate Mac root-page keyboard failure remains open as SPLIT-UI-07. |

The static Firefox suites also report the browser's implicit favicon request as a CSP violation. The candidate declares an embedded icon and permits only data images while preserving default, script/style, connection and form/base restrictions and every console assertion. External image loads remain blocked.

WebKit mobile methods failed before their journeys because the harness assumed `navigator.maxTouchPoints` must be nonzero. The corrected harness retains that value as telemetry and checks real browser-generated, trusted touchstart/touchend events from `locator.tap()`, plus focus and the original viewport/DPR/user-agent checks. It does not override navigator values, synthesize events or replace taps with clicks. The original 40 failures remain separate from the follow-up result. [Playwright touch contract](https://playwright.dev/python/docs/api/class-touchscreen).

The first Windows WebKit keyboard correction used an alternate Tab chord based on the [upstream keyboard discussion](https://github.com/microsoft/playwright/issues/5609). Run74 showed that this did not focus the skip link in the measured Windows build. Its other 91 static methods passed, including the export and dialog-focus corrections. The next correction gives the skip link an explicit `tabindex="0"` and restores ordinary Tab on every platform. It retains document order, real keyboard input and every focus/activation assertion. Failure diagnostics include the actual focused element. Run75 verifies the Windows correction at 92/92. The original failed run74 result remains part of this history.

Run74 separately verifies all 40 mobile WebKit journeys with recorded trusted touch events and all 40 Chromium mobile journeys. Linux Firefox's 65 static methods, Windows Firefox's 92 methods and Linux WebKit's 65 static methods pass with the favicon and text-reflow corrections. The original run73 failures remain historical evidence, not passes transferred onto changed code. The macOS ARM64 jobs in both runs remain queued without an assigned runner at this checkpoint; no queue cause is confirmed. The next CI candidate uses the standard public-repository Intel Mac runner and retains Apple silicon as an explicit unverified requirement in the milestone policy.

Workflow artifacts now include the run-attempt number, preserving each attempt instead of overwriting evidence or colliding on daily reruns. Aggregation still deduplicates case/platform observations and retains unresolved same-source outcomes.

Date: 2026-11-19. This register covers the work after baseline `41e31a8`. [Development progress](DEVELOPMENT_PROGRESS.md) is the authoritative current status. A regression test demonstrates its stated case, not absence of every possible defect. [Historical platform defects](PLATFORM_VERIFICATION.md) remain recorded separately.

## Engineering remediation after 36b2bf3

This section records new reproductions from the final remediation directive. Historical defects and failed runs below remain unchanged. Focused pass counts overlap the final suite. See [current remediation verification](REMEDIATION_VERIFICATION.md) for the committed source and complete CI status.

| ID | Priority | Evidence and reproduction | Correction | Regression |
| --- | --- | --- | --- | --- |
| REM-AI-01 | Medium | Ask for several electrical tasks or include component/location qualifiers. A shorter provider proposal can discard supplied scope. | Require proposed job content to retain independently recognized electrical clauses and qualifiers. | Expanded corpus extraction-completeness and multiple-requests cases. |
| REM-AI-02 | Medium | Ask multiple supported questions while the provider omits or inserts unrelated topics. Replies can omit relevant approved answers or include unrelated facts. | Compose recognized topics deterministically and reject unrequested provider topics/intents. | Business-answer, scheduling, handoff and disclosure fixtures. |
| REM-AI-03 | High | “The wire is glowing” or “I smell burnt plastic at the outlet” can miss the hazard gate. | Add bounded electrical-context patterns before generation. | No-provider hazard regressions plus routine-work controls. |
| REM-AI-04 | High | “Do not call me” can fail to register withdrawal. Clearing only the browser stopped flag can also ignore retained STOP history. | Recognize explicit call withdrawal and restore STOP from retained customer history. | Consent corpus and historical-STOP regressions. |
| REM-AI-05 | Medium | “The circuit label number is 48315” can become the job ZIP. | Exclude equipment/account-number contexts unless a job ZIP cue identifies the value. | Explicit-number corpus and shared-parser regression. |
| REM-AI-06 | High | Reset a preview or delete a hazardous request, then enter the same phone in a fresh session. Without a retained safety hold, generation can resume. | Persist a minimal business-scoped safety-hold digest and check both the old phone and independently extracted new phone before generation. Recheck after awaited work. | Store lifecycle, first-message API and cross-session independent race cases. |
| REM-AI-07 | Medium | Restart the process or create another session after reaching an in-memory allowance. The old counters do not enforce a durable business budget. | Add transactional reservations, per-minute/day/lifetime limits, active leases and non-refunded failed attempts. | 17 ledger tests, independent SQLite workers, API and encrypted-backup cases. |
| REM-AI-08 | Medium | An adapter throws `assistant_timeout`. The browser reports timeout but the ledger records failed. | Map the actual timeout outcome without refunding the attempt. | Independent case failed before correction and passed afterward. |
| REM-AI-09 | Medium | Saved job is “Install an EV charger.” New message says “I also need to change the kitchen outlet.” A proposed correction overwrites the earlier scope because change/update was treated as a generic correction. Timing fields have the same cross-clause risk. | Bind correction permission to the affected field. Preserve explicit correction controls and clarify conflicts. | Six independent defect cases failed before correction. Six legitimate correction controls remained passing. All 12 pass afterward. |
| REM-AI-10 | High | Submit STOP or a new electrical hazard with a valid 60-message transcript. The append limit returns 413 before phone suppression/hold is persisted. A cleared draft loses that restriction. | After full message/state validation, preserve deterministic contact restrictions even when append cannot fit, cancel same-scope assistance and retain the original 413. | Four independent before-fix failures cover existing and first-supplied phones. Focused 42-case API regression passes after the correction. |
| REM-UI-01 | Medium | A deletion response is lost. A subsequent retry returns 403. The interface treats that later refusal as proof the original deletion did not commit. | Keep uncertainty until the matching receipt arrives. Keep the same operation key/version/body for all retries. | Independent state-machine case failed before correction. All 11 deletion cases pass afterward. Equivalent browser regression is in CI. |
| REM-UI-02 | Medium | Run67 screenshots showed low-contrast deletion retention text. Existing light-panel muted/status colors on the navy dialog measure 2.72:1 and 2.06:1, below the 4.5:1 normal-text target. | Scope both text styles to the existing light-blue foreground, calculated 8.93:1, and separate actions from the input. | Preserved before captures and color calculations. Actual confirmation/error contrast assertions passed in run68, but Chromium fixture cleanup failed as recorded below. Final CI pending. |
| REM-OCR-01 | Medium | Relative readiness age and the shared multi-pass timeout used the host wall clock. A backwards clock adjustment could extend a processing deadline. | Use a monotonic elapsed-time clock. | The default-clock regression rejects any Date.now dependency. Final-source component, native lifecycle and 310-image measurements pass their execution checks. |
| REM-QA-01 | Medium | Run67 reported generic isolation_unavailable after discarding readiness stderr. The result could not distinguish a configuration defect from a host restriction. | Observe bounded stderr and exit metadata from the same required startup invocation. Do not add probes or weaken isolation. | Six mocked diagnostic cases pass. The follow-up CI must supply the actual cause. |
| REM-SEC-01 | High | Run68 installed Ubuntu bubblewrap 0.9.0-1ubuntu0.3, affected by the published symlink sandbox-setup flaw CVE-2026-87766. Required mode did not reject affected versions. No exploitation was observed and the worker failed before Tesseract. | Require a bounded, reaped version-only check before namespace setup. Reject anything other than a stable numeric upstream version at least 0.12.0. CI builds fixed upstream commit 2a76602a8c71f36c1527cf9fc3417d9149822e0c without setuid support or host-policy changes. Remove the unnecessary package from other jobs. | 88 focused OCR/diagnostic cases pass, including affected/malformed/missing versions, timeout, cancellation, output limits, downgrade and cache expiry. Fixed dependency build and native isolation await final CI. |

### Confirmed OCR limits and rejected experiments

All 57 baseline nonexact images were inspected. Orientation fallback and conditional pixel normalization correct 24 images without regressing any of the 253 previously exact images. 33 cases remain nonexact. See the hash-bound [OCR benchmark](OCR_BENCHMARK.md) for each failure, field errors and remaining review steps. This is still a FAIL for the strict exact-image quality gate.

Unconditional median filtering was rejected after the full 310-image run fell to 252 exact images, regressed 14 previously exact images and introduced a false-positive manufacturer. Scaling and adaptive-threshold experiments also had regressions. The retained pixel-noise detector uses source pixels rather than fixture IDs, expected fields or a guessed manufacturer.

### Test harness corrections

Run68 executed 1,618 application cases: 1,617 PASS and one Chromium fixture-cleanup FAIL. The new contrast fixture deliberately aborted its DELETE, but omitted the resulting expected `Failed to load resource: net::ERR_FAILED` console message. Both normal/error contrast assertions passed. The correction records exactly one targeted DELETE, permits only that exact message at most once in this test, and retains every other console/script/external-request check. Independent review caught a substring-versus-exact-count gap before commit and tightened this assertion. [Run68 evidence](evidence/remediation-run68-verification.json) is preserved. The corrected fixture awaits final CI.

The dependency finding is supported by the [upstream advisory](https://github.com/containers/bubblewrap/security/advisories/GHSA-pxhw-h44j-8pfx) and [Ubuntu CVE record](https://ubuntu.com/security/CVE-2026-87766). A fixed version does not by itself prove the worker's namespace or syscall-denial behavior on a given host.

The first combined local remediation run failed five existing client-state tests because its DOM harness did not load the newly shared deletion script. The harness now executes the shipped script and models dialog open/close state. All six client-state tests pass. No product assertion was removed.

The newly written API fixture initially omitted two required request fields and referenced incorrect response properties. Those fixture errors were corrected against the existing contracts. All 39 API cases then passed.

An independent review exceeded the intended local-listener boundary twice while developing the server-shutdown test. It first failed on a synthetic cookie, then passed with the correct cookie. No external endpoint or real data was involved. The case is now under the existing CI-only HTTP gate and excluded from offline evidence. The exact record is in [data reliability verification](DATA_RELIABILITY_VERIFICATION.md).

## Confirmed code defects

The following corrections are in `c5a47542d665a7d5ffb202e1cde4669c85512243`. The updated local suite passed 638 Node/SQLite/in-process API tests. Actual HTTP and browser verification passed in run66, source 17223d6, as recorded in the progress document.

| ID | Priority | Reproduction and impact | Correction | Regression evidence |
| --- | --- | --- | --- | --- |
| AI-01 | Medium | Ask one missing-field question, append a booking disclaimer, then answer with a bare name or time. The parser loses the last-question context. | Keep the targeted question last without removing the disclaimer. | `workspace-assistant.test.cjs` context-only replies. |
| AI-02 | Medium | Submit a valid natural correction while a prior field issue remains. A stale issue blocks the correction. | Separate current ambiguity from prior issues and preserve unrelated unresolved fields. | Natural name correction and direct confirmation cases. |
| AI-03 | Medium | Supply a proposal using actual electrical-job words as a name, a part-number-shaped number as a phone, or a work date as a callback window. Substring presence alone accepts the wrong field. | Bind proposals to field-specific evidence and independent parser cues. | Three independent grounding cases in `assistant-adversarial.test.cjs`. |
| AI-04 | Medium | Propose panel work after a customer says they do not need it, or Saturday after they say Saturday is unavailable. | Reject negated and unavailable clauses as positive field evidence. | Two independent negation regressions. |
| AI-05 | High | Describe fire inside a panel, a hot outlet or hot breaker box. Existing hazard patterns can miss the immediate electrical context. | Add bounded electrical-context patterns before provider generation. Preserve normal fire-alarm, smoke-detector, water-heater and hot-tub requests. | Four independent no-provider hazard cases plus eight positive and six routine-negative shared-parser cases. |
| AI-06 | Medium | Start generation using approved business facts, revoke those facts before the provider resolves, then receive the old answer. | Recheck the saved profile version after the await and return `profile_changed` without the obsolete response. | In-process API reproduction returned 200 before correction and 409 after correction. |
| AI-07 | Medium | Invoke the handler for a connection already marked aborted. Installing a later abort listener misses the event and starts generation. | Check the current abort/destroyed state before provider or OCR work. | API reproduction changes from one provider call to zero. |
| AI-08 | Medium | Return a valid compressed provider envelope through a Fetch-compatible transport. Wire Content-Length differs from decoded body length and a valid response is rejected. | Use exact length equality for identity encoding only. Always enforce the decoded stream limit. | Independent compressed-response regression and 31 mock-transport cases. |
| AI-09 | Low | Let an injected transport ignore cancellation and resolve its body after timeout cleanup. The late stream remains open. | Cancel a late body before acquiring its reader. | Independent late-response cancellation regression. |
| OCR-01 | Medium | Process the cropped multiple-component fixture with conflicting part numbers/manufacturers but one description. The description attaches to an unknown component. | Blank candidate fields when multiple core fields conflict, retaining the raw text for review. | Unit regression and actual native benchmark replay. |
| OCR-02 | Medium | Process the noisy conflicting-manufacturer fixture where OCR adds a leading bullet to one label. The second manufacturer is missed. | Recognize one bullet/hyphen before an otherwise exact field label, preserving value characters and ambiguity. | Unit regression and native replay; manufacturer remains blank. |
| XLSX-01 | Medium | Export literal OOXML escape-looking text, including `x005F_`, and read it through openpyxl. Reader normalization can alter a saved identifier. | Use bounded inline rich text for affected literals with token boundaries between text runs. | Exact independent readback and original-file LibreOffice import. Cross-application resaving limits remain documented. |

The 11 independent AI adversarial cases and 31 transport cases passed after the final fixes. These overlap the full suite and must not be added again to its count. The external transport remained disabled throughout verification.

## Test fixture correction

QA-01, Medium: all four assistant browser cases initially shared one process-wide ten-call/minute allowance. Their combined calls could exhaust the quota before the STOP case. A pure fake-provider sequence reproduced `assistant_limit` and an empty phone before STOP. Each browser scenario now restarts only its synthetic server. The real database remains in place and production quotas are unchanged. This corrects fixture independence, not an application quota defect. All four assistant browser cases passed in each engine in run66.

The browser reset scenario uses a 300 ms fake-provider delay. The deterministic component/API cancellation cases provide stronger evidence that cancellation occurred while generation was pending. Do not use the timing-based browser case alone to claim that guarantee.

## First browser run corrections

Run64 passed 645 Node/HTTP checks, 179 Chromium cases outside XLSX and four of seven XLSX cases. It exposed three callback errors before their browser assertions. Playwright cannot annotate a builtin `list.append` handler. Each is now wrapped in a Python lambda. All three corrected callbacks passed a local check through Playwright's actual mapping code. The browser rerun passed all seven XLSX cases in each engine in run66.

Firefox found a medium marketing interaction defect: the first invalid quantity blurred while clicking Export, displaying error content above the button and moving its hit target. Blur painting now defers when focus moves directly to Export. The click handler still validates and focuses the invalid field. The existing browser test retains its focus assertion and additionally checks that the click was delivered.

Three Firefox geometry checks measured 44 px controls as 43.99998474121094 or 43.99993896484375 px. The checks now compare at 0.001 CSS-pixel precision while retaining the 44 px requirement. This is a test measurement correction, not a larger touch-target design change. The new XLSX button is also included in the same responsive assertion. Run66 verified all of these assertions in Chromium, Firefox and WebKit.

## Resolved configuration finding

OPS-01, High: both Render services repeatedly reported `not_suspended`. Run64 and run66 attempt 1 GET-only guards returned HTTP 200 instead of the required 503. Those failures remain historical evidence.

The owner explicitly approved suspending both services again. Render confirmed the AI service suspended at 7:28:44 PM EST and the static service at 7:29:45 PM EST on November 19, with suspender user. Auto-deploy and PR previews remained off. Only the failed suspension job was rerun. Run66 attempt 2 job 135989918969 passed at 7:30 PM EST with two PASS, zero FAIL and three policy-BLOCKED checks. Both URLs returned HTTP 503, Render's exact owner-suspension message and no PanelReply application markup. OPS-01 is resolved and verified within this scope. [Follow-up evidence](evidence/public-suspension-2026-11-19.json).

The 1,096 application checks were not rerun. Their original passing results carried forward. No application code, workflow, merge, deployment or provider activation was part of the suspension correction. Keep both services suspended and obtain separate approval before any further state change.

## Unresolved findings and approval boundaries

| ID | Priority | Evidence | Status / next action |
| --- | --- | --- | --- |
| OCR-QUALITY | Medium | Run76 exactly matches all expected fields in 277/310 synthetic images. 33 remain nonexact, with zero native execution errors or review violations. All 310 outcomes match run75. The earlier 253/310 result remains in the historical records. | FAIL accuracy gate. Keep every candidate unreviewed and require source comparison. Use the unchanged failure corpus for further measured changes. Representative job-site quality remains NOT TESTED. |

Actual model quality, representative photographs, hosted recovery, retention/deletion, durable provider budgets, physical-device/assistive-technology checks and live integrations are incomplete requirements, not defects declared fixed by these local tests. See [release acceptance](RELEASE_ACCEPTANCE.md).

No critical vulnerability or cross-business exposure was observed in the executed checks. This statement is limited to their coverage. The public configuration finding is resolved by the separately approved and verified suspension. Other release gates remain open.

## Final verification

[Run66](https://github.com/panelreply-business/panelreply-demo/actions/runs/44634698683) passed 1,096 application checks with zero application failures at source 17223d6. This includes the focus correction and all XLSX failure paths. Run65 exposed one additional fixture error: Playwright passed Request as the second positional argument, replacing a captured MIME default. The handler now accepts that argument explicitly. Both fixture responses passed the real local Playwright wrapper, then all seven browser cases passed in each engine. No assertion was removed.

Run66 attempt 1's two public-suspension failures remain recorded. The subsequent isolated rerun passed both guards after suspension. The OCR quality gate still has 57 nonexact cases and remains open.

## Continuation evidence correction

The subsequent retention implementation at ca9dd8a passes run70 with 1,637 application cases. REM-UI-02's contrast assertions and corrected fixture now pass in all three engines. REM-SEC-01's dependency gate and fixed dependency build execute successfully, while native worker isolation remains BLOCKED. REM-QA-01 now has bounded startup stderr, but the classifier still reports an unconfirmed root cause. Do not relabel it as successful isolation. [Evidence](evidence/continuation-verification.json).

The handoff and several matrix rows still referred to pending integration after the branch reached `c0a947e`. Run69 job logs now independently verify 1,628 passing application executions, both suspension guards and the bounded HTTP workload. The progress record and matrix include a superseding continuation section. Historical run66/run67/run68 observations remain preserved. OCR stays FAIL and worker isolation stays BLOCKED despite the green workflow. No product defect is declared fixed by this documentation correction.

