# Windows Firefox input investigation

## Observed result

Run 90 (`45241670227`), job `137927658205`, executed the 92 static-client browser methods on Windows Server 2022 AMD64 with bundled Firefox 153.0, Playwright 1.62.0, Python 3.12.10 and Node 24.22.3.

The result is 91 PASS and one ERROR. No method was skipped or left unrun. The failing identity is:

`ui_browser_test.WorkspaceBrowserTests.test_character_limit_counter_and_accessible_description_stay_in_sync`

The method checked the accessible description and `maxlength=500`, filled 500 characters, checked the `500 / 500` counter, and completed an End key command. The subsequent `press_sequentially("y")` operation timed out after 5,000 milliseconds. Its call log says it was waiting for the same exact textbox role/name locator.

The method did not reach the checks that the extra character was refused, the count remained 500, or submission cleared the message and counter. Those outcomes are unproven in this failed execution.

## Evidence verification

Artifact `14853225617`, `release-platform-windows-2022-firefox-attempt-1`, is 14,140 bytes. Its downloaded SHA-256 matches both the API digest and upload log:

`24cd0fa98fefeff1d91c57bcf663db676a115bc272bb86e704afaab60d6c4634`

The ZIP contains one bounded JSON report. Its source is PR merge commit `f08bd8782d1997ba548ae7aad606cbcf8d1a9f04`, whose parents include development commit `2882d4f836d4694c8b445f91f52d64df943cf213`. The merge tree matches that development commit. All 193 source-file hashes match the development revision. The source manifest is `e359d184cae83587b5a98e5362ac52b0ce2b72332c8b68fc7dcf54878c544cc4`, clean and unchanged before and after execution.

The report and source verification are retained in `docs/evidence/windows-firefox-run90.json`. The decoded job log is retained separately as a JSON string, including all original CRLF sequences. The evidence records its byte count and hash and verifies exact reconstruction by UTF-8 encoding that string. No rerun or revised pass count replaces this error.

## Cause remains open

The report does not show the control's state, accessible snapshot or native input events at the timeout. It cannot distinguish a page/control change from a browser or locator operation that stopped making progress. A product or browser cause has not been established.

The static page's input listener updates the character counter. Inspection found no application key handler that removes or renames the textbox on End or at 500 characters. This inspection does not prove what happened in the failed browser execution.

## Added observations

The same method now records its last completed phase and at most 16 passive key/input/focus events. Each event records elapsed time, trusted state, value length, selection positions and active element ID. On completion or error, a bounded read captures the control's identity, connection, labels, description, value length, selection, display, geometry and counter. A failure also attempts a bounded accessibility snapshot.

The release runner carries this observation into the existing method's report. It does not create another test execution.

The role locator, input sequence, assertions, timeout, case ID and failure propagation remain unchanged. The observer never sets a value or focus, cancels an event, changes requests or retries an action. Observation errors remain diagnostic fields and cannot replace the original method error. Passive observation adds execution overhead, so a later pass alone will not establish the original cause or an intermittent repair.

## Local checks and next step

Python syntax and static collection pass. Collection still contains 92 methods. A syntax-tree comparison confirms that every original action and assertion remains in the same order. The 112 release-evidence harness checks pass and receive no product-test credit.

No Windows or Firefox browser ran locally. The next normal CI execution must provide the input observations. If the failure returns, compare the last phase, event trace, connected textbox state and role snapshot before changing application code or the interaction. Keep the 500-character refusal and post-submit reset checks as requirements.
