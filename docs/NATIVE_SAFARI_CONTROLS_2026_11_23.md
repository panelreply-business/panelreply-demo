# Native Safari controls and failure evidence

## Observed failures

Run 88 (`45239272309`) exercised installed Safari 26.6, build `20624.4.5.18.1`, on macOS 15.7.9 Intel. Its six journeys retain one PASS and five ERROR outcomes. The reports are preserved in `docs/evidence/native-safari-run88.json`.

- Two callback journeys stop at Selenium `Select.select_by_value`, which clicks an option. Safari returns `ElementNotInteractable` for contact permission and task outcome.
- Two spreadsheet journeys select `complete.png`, click Save image, then time out waiting for the visible source-save confirmation. The report does not establish whether the native click, file read, request or save failed.
- The spreadsheet corrections journey reads `reviewed` immediately after selecting it. After Save and reload, the value is `unreviewed`. The report has no input/change trace for those selections.

The preceding datetime repair produced three exact, trusted input observations. Those observations did not turn the later failed journeys into passes.

## Proposed selection repair

The harness now sends keys to the actual select control. It reads the enabled options and current selection, then types the target label's first character enough times to reach the target. Tab leaves the control. Shared first characters, disabled options and wraparound are accounted for before typing.

This scope accepts one select with at most 32 options and an ASCII initial character. It rejects missing or duplicate values, disabled/hidden targets, multiple selects, listboxes, inconsistent current values and unsupported labels before typing. An already selected value is recorded as unchanged.

For each changed selection the report records:

- The observed option inventory and planned character count.
- At most 128 key, input and change events.
- Each event's native trusted flag and control value.
- The exact final value after Tab.

The helper requires both input and change events for the requested value. Capture-phase observation retains a request to mark an incomplete row reviewed, while the application can reject it and leave the expected final value unreviewed. Failed typing and missing/untrusted events remain failures. There is no retry, value assignment, event dispatch or API replacement for selection.

## Basis and uncertainty

Inspected upstream WebKit commit `cacd76e68f391f29279023c0fbe7d35395b68db3`:

- [Session.cpp](https://github.com/WebKit/WebKit/blob/cacd76e68f391f29279023c0fbe7d35395b68db3/Source/WebDriver/Session.cpp) checks option geometry before its option-selection branch. Its send-keys implementation focuses the supplied control and performs keyboard interactions.
- [HTMLSelectElement.cpp](https://github.com/WebKit/WebKit/blob/cacd76e68f391f29279023c0fbe7d35395b68db3/Source/WebCore/html/HTMLSelectElement.cpp) handles typed character selection and saves the prior selection when the control receives focus.
- [TypeAhead.cpp](https://github.com/WebKit/WebKit/blob/cacd76e68f391f29279023c0fbe7d35395b68db3/Source/WebCore/html/TypeAhead.cpp) cycles repeated initial characters after the selected option and ignores disabled options through the select's data source.
- [WebAutomationSessionProxy.cpp](https://github.com/WebKit/WebKit/blob/cacd76e68f391f29279023c0fbe7d35395b68db3/Source/WebKit/WebProcess/Automation/WebAutomationSessionProxy.cpp) routes option selection through the select's user-change handling.

These sources support the proposed interaction. They do not identify the exact source of the installed Safari binary. The review-status failure may involve the selection/change cache after the earlier rejected attempt. That remains an inference until native execution records the new trace and saved result.

The revised selection path tests native keyboard operation. It does not establish pointer operation of Safari's native option popup.

## Upload and failure evidence

Upload behavior and acceptance checks remain unchanged. The harness still uses native file-input send-keys, clicks Save image, requires the visible confirmation, checks the stored source count and later verifies source bytes.

Passive observers now record file-selection events, the native upload click, uncaught page errors and promise rejections. They preserve the selected and final UI states, file metadata, element geometry, hit targets and status/error text. Observers do not change controls, intercept requests, prevent events or replace the application's file reader.

The added observations change timing between native actions. If an upload subsequently passes, that pass alone will not establish the original cause or prove that an intermittent failure has been repaired. The failed run and its missing observations remain part of the record.

Before teardown clears a failing page, the result collector records the UI, a read-only saved-project response and a screenshot when the CI capture directory is present. Failures during diagnostic capture cannot erase or replace the original failure. Password fields, cookies, tokens and browser storage contents are not captured.

## Local verification

- 15 Python evidence-harness checks passed. Six additions cover selection plans, invalid inventories, trusted change requirements and rejected review attempts, input failure retention, upload failure retention, and capture before teardown.
- 112 release-evidence harness checks passed.
- Python syntax checks and `git diff --check` passed.
- Collection still returns the same six native journey IDs. Each of the six native method bodies is byte-for-byte unchanged.
- Application code, browser configuration, workflow, release policy and product-credit rules are unchanged.

All local checks are evidence-harness checks and receive zero product-test credit. No native Safari browser ran locally. The six native journeys, stored results and CSV/XLSX downloads still require CI verification. Run 88 remains failed.

## Reproduce

```sh
python -m unittest discover -s tests -p safari_runner_test.py -v
node --test tests/release-evidence.test.cjs
python -m py_compile tests/safari_product_browser_test.py tests/release_safari_runner.py tests/safari_runner_test.py
python tests/release_safari_runner.py --list --output-dir /tmp/panelreply-safari-controls-collected
```
