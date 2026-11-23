# Native Safari input repair — November 23, 2026

## Observed failure

Run 86, workflow run `45233837607`, native Safari job `137900161273`, reached installed Safari 26.6 (build 20624.4.5.18.1) on macOS 15.7.9, Intel x86_64.

The callback report retains one PASS and two FAIL outcomes. Both failures occur before a task write. Sending an ISO datetime string to the native segmented control leaves its value empty.

The spreadsheet report retains three FAIL outcomes. Each fails in setup because the test expects `PanelReply Spreadsheet`, while the fixed product definition and served page use `PanelReply Spreadsheets`.

The prior five failures remain failures. This patch does not revise those reports.

## Changes

- Match the spreadsheet title to the existing product definition. The login and home-page identity assertions remain.
- Enter datetime-local with one native WebDriver key sequence: move to the first field, enter month, day, year, hour, minute and AM/PM, advance with Right keys, then leave with Tab.
- Capture the existing control type, minute step, document language, writing direction, navigator languages, and Intl format context. Accept only the reviewed English, Gregorian, Latin-digit, horizontal LTR field layout.
- Record at most 128 native key, input and change events. Require trusted events, all five Right key down/up pairs, and final-value input/change events.
- Require the exact requested local datetime after native entry. Existing exact saved UTC and IANA timezone checks remain.
- Preserve attempted input evidence in a finally block if typing fails. No retry, DOM value assignment, synthetic event, API task seed, browser preference change or alternate control path is used.
- Keep all six native method identities. No new browser cases, workflow requirements or product-credit rules are added.

The Intl record describes the page's language context. It does not expose Safari's internal native fields. A mismatch in actual native behavior still fails the exact value and event assertions. This helper does not claim support for every English locale or native date layout.

## Basis for the keyboard sequence

WebKit's own datetime-local keyboard regression uses a separate value for each field, Right to advance, and A or P for the period. Numeric field code handles digits without automatically advancing. The field code handles the Right and Left navigation keys. The owning control focuses its first field, and the Cocoa implementation obtains its date/time format from the element language.

Inspected upstream commit: `cacd76e68f391f29279023c0fbe7d35395b68db3`. The evidence JSON records each fetched blob identity. These references establish the proposed interaction. They are not a byte-identity claim about the installed Safari binary.

- [datetimelocal-editable-components-keyboard-events.html](https://github.com/WebKit/WebKit/blob/cacd76e68f391f29279023c0fbe7d35395b68db3/LayoutTests/fast/forms/datetimelocal/datetimelocal-editable-components/datetimelocal-editable-components-keyboard-events.html)
- [DateTimeFieldElement.cpp](https://github.com/WebKit/WebKit/blob/cacd76e68f391f29279023c0fbe7d35395b68db3/Source/WebCore/html/shadow/DateTimeFieldElement.cpp)
- [DateTimeNumericFieldElement.cpp](https://github.com/WebKit/WebKit/blob/cacd76e68f391f29279023c0fbe7d35395b68db3/Source/WebCore/html/shadow/DateTimeNumericFieldElement.cpp)
- [BaseDateAndTimeInputType.cpp](https://github.com/WebKit/WebKit/blob/cacd76e68f391f29279023c0fbe7d35395b68db3/Source/WebCore/html/BaseDateAndTimeInputType.cpp)
- [LocaleCocoa.mm](https://github.com/WebKit/WebKit/blob/cacd76e68f391f29279023c0fbe7d35395b68db3/Source/WebCore/platform/text/cocoa/LocaleCocoa.mm)

## Local verification

Nine evidence-harness checks passed on Linux. Five additions cover the product-label contract, midnight/noon and leap-day key plans, incorrect or untrusted native observations, transport failure retention, and unsupported layout refusal. The keyboard doubles cannot prove native Safari behavior and receive no product-test credit.

Python syntax checks passed for the three changed modules. Static collection still returns exactly three callback and three spreadsheet methods. `git diff --check` passed.

No Safari browser ran in this local verification. The corrected six journeys require the next native Safari CI execution. Exact saved timestamps, contact restrictions, persisted data, source bytes, credential rejection, and native CSV/XLSX download checks remain acceptance gates.

## Daily execution

The four December 2026 callback times remain fixed fixtures. These journeys test operator-entered task times and status changes. The product accepts both future and past task times, and these methods do not assert that a task is upcoming. Their meaning therefore remains valid after the fixture dates pass.

## Reproduce

```sh
python -m unittest discover -s tests -p safari_runner_test.py -v
python -m py_compile tests/safari_product_browser_test.py tests/release_safari_runner.py tests/safari_runner_test.py
python tests/release_safari_runner.py --list --output-dir /tmp/panelreply-safari-input-collected
```

Actual acceptance uses the existing native Safari CI job and its source-bound reports. No local browser acceptance is claimed.
