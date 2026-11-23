# Static sample action investigation

Date: 2026-11-23

Status: cause unconfirmed, failure retained

## Observed result

Run 86's static Mac WebKit report recorded 91 passing methods and one failure. In `browser_test.DemoBrowserTests.test_keyboard_access_to_every_control`, every native Tab/focus assertion through the footer passed. The existing pointer click on “Run the sample request” returned. The subsequent title assertion remained at “Save the call.” instead of “Ready for callback.”

The report contains neither the pointer event target nor scroll, focus or hit-test geometry for that action. The ordinary sample walkthrough passed in the same suite. That pass does not establish the cause of the keyboard-to-pointer failure or clear it. A later unchanged pass also does not establish a repair.

The report identifies macOS 24.6.0 on x86_64, bundled WebKit 26.5, Playwright 1.62.0 and Node 24.19.0. Its source hash is `2ec4c2b878e6d954df4ab0fd7b8cf04630669dca724c1bf1e174533f84cb4658`. The HTML, demo handler, browser test, browser selector and evidence collector at local base `9264d2a3575889c6b39140554fc767caf6e6a7ad` match the report's file hashes exactly.

## Source findings

The sample control has `type="button"`. Its handler resets the demonstration, invokes the simulated-call control and sends a fixed synthetic sample to the local parser. With AI disabled in the copied static page, this branch updates the view before any `await`. This source trace does not prove which handler ran during the failed pointer action. The observed title alone does not establish a form submission failure.

The document uses smooth scrolling. Tab traversal reaches the footer before the pointer action returns to the sample control near the top. A scroll/focus interaction is a candidate to investigate. The existing artifact does not establish it as the cause. No runtime or styling change is justified by the available evidence.

## Diagnostic change

Only the existing keyboard-access test changes. A passive observer starts before Tab traversal. It records up to six focus observations and sixteen pointer, mouse, click, invalid or submit observations. The trace includes fixed control identities, trust flags, event phases, default-prevention flags, pointer coordinates, hit-test targets, sample-button bounds, scroll positions and counts. Initial, footer-focus and failure snapshots include viewport/document geometry, focus, visibility, handler presence and counts.

It records no input values, conversation text, credentials, request payloads, URLs or storage. It never dispatches input, changes DOM values, replaces handlers, moves focus, scrolls, changes motion preferences or retries the action. The application itself may emit an untrusted simulated-call click. Its trust flag remains visible in the trace.

If the pointer action or following title assertion fails, the test adds the trace to that same exception and re-raises it. The JSON is bounded to 4,500 characters. Oldest rows are removed with explicit drop counters if required. This keeps evidence within the collector's existing 8,000-character diagnostic limit. Observers are removed after the sample attempt, or by context teardown after an earlier keyboard failure. A diagnostic-read error records only its exception class and never suppresses the original failure.

The pointer action, all keyboard operations, all assertions, timeouts, external-request checks, console checks and later reset checks remain unchanged. The observer performs layout reads, so its timing cost is an experimental limit. An observed later pass is still not a causal diagnosis.

## Verification and next step

- Python compilation and parsing passed.
- Node parsed all three JavaScript observer expressions.
- AST comparison confirmed the original action/assertion sequence and every other test body remain identical after removing the added observer wrapper.
- Portable collection still contains the same 92 method IDs. No new method was added.
- Exception-note verification retained the original failure and diagnostic marker within the collector's limit.
- `git diff --check` passed.
- No browser was launched locally. No new passing browser case or release-goal credit is claimed.

[The evidence record](evidence/static-sample-pointer-2026-11-23.json) preserves the historical failure, artifact and source hashes, and local checks. The next authorized Mac WebKit execution must retain any diagnostic trace if this action fails again. The remaining question is whether native pointer delivery, scroll/focus movement, or a later state transition accounts for the unchanged title.

[Playwright's actionability documentation](https://playwright.dev/python/docs/actionability) describes the normal click checks. This patch keeps those checks enabled and preserves the independent application-state assertion.

## Subsequent unchanged-source job observation

Run87 static Intel Mac WebKit reports success. Its relevant application and browser-test bytes are unchanged from run86. This job-status observation is not a verified case ledger and does not establish the earlier failure's cause or a repair. Preserve the failure and collect the passive context on the next candidate. [Job metadata](evidence/run87-job-observation-2026-11-23.json).
