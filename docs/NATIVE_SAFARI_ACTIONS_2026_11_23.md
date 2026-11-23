# Native Safari action input and upload read diagnostics

## Current release evidence

Run 91 tested commit `1562c8ea0326b31f34386925ac55f44f9f9328b1` through PR merge `26cf9a6fe503cf11b8e1fa515bf4a67c57ef90fe`. Both native reports bind 200 source files to manifest `14b0b86f595e026f78d666674a1133d7dcde072fd7a66c9784e780e0bc1740da` and policy `1d44f761935bdd80d8fe1dde99add06e8e4e7d39912ce72d8f70fd65c2783216`.

The installed Safari job ended with 0 passes, 4 failures and 2 errors. All six outcomes remain in [native-safari-run91.json](evidence/native-safari-run91.json). No download evidence was produced.

| Product journey | Outcome | Observed boundary |
| --- | --- | --- |
| Callback contact hold and dirty edit | FAIL | Contact permission became empty after Element Send Keys. No keyboard, input or change events were captured. |
| Callback intake, persistence and sign-out | FAIL | The preview permission select became empty with no captured events. This journey had passed run 90. |
| Callback schedule, outcome and follow-up | FAIL | Outcome remained empty with no captured events. |
| Spreadsheet manual corrections and exports | FAIL | Review status became empty on the blank-manufacturer rejection attempt. Exports were not reached. |
| Spreadsheet source upload and unavailable OCR | ERROR | The expected selection and Save-image click occurred. The page then displayed the pre-request image-read error. |
| Spreadsheet recovery and archived credentials | ERROR | The same upload boundary prevented the recovery steps. |

The three datetime inputs still reached their exact requested values. Each captured trusted events, including one input and one change event. These are partial observations inside failed cases and add no product passes.

Both upload traces captured trusted file input, change and Save-image click events. The selected file was `complete.png`, 26,973 bytes. The page displayed `The image could not be read. Choose the file again.` Read-only storage checks found version 1 projects with no sources. The original exception was not recorded.

## Bounded input change

The previous select helper sent a label initial and Tab through `WebElement.send_keys`. The WebDriver specification gives non-typeable form controls a value-setting branch. That branch is consistent with the empty value and absent events, but the report does not trace the installed Safari implementation.

The helper now performs these steps:

1. Read and validate the existing option inventory.
2. Click the select through WebDriver and send Escape through the Actions API.
3. Read focus, enabled state, value and selected index. Require the original value and index to remain intact.
4. Preserve the focus-preparation events separately. Start a new diagnostic event list for selection.
5. Send the planned initial character sequence and Tab through WebDriver Actions.
6. Require the exact final value, trusted keyboard events for every planned character, and trusted input/change events containing the attempted target value.

The application rejection check remains intact. A blank manufacturer must leave the row unreviewed even though the capture-phase events prove the attempted reviewed selection.

The helper uses no JavaScript focus, value assignment, option selection or event dispatch. It has no retry or alternate input path. Failure still records the attempted interaction and fails the original journey.

## Upload diagnostics

The upload catch covers source-list mapping, `fileBase64(file)` and `crypto.randomUUID()`. The base64 helper awaits `file.arrayBuffer()`, converts the bytes in 8,192-byte chunks and calls `btoa`.

The same page had already executed `crypto.randomUUID()` in `setProject` before the upload. This weakens a missing-capability hypothesis. It does not identify the exception thrown during upload.

Existing page snapshots now include read-only capability fields for secure context, crypto, randomUUID, FileReader, File/Blob arrayBuffer and btoa. No UUID or credentials are recorded.

Only after an original upload failure, a bounded diagnostic reads the selected synthetic file using the application’s arrayBuffer/base64 steps and an independent FileReader. It records:

- Selected-file metadata and declared byte count.
- Read byte counts and encoded length, without file content.
- FileReader progress byte counts.
- Exception stage, name, code and message.
- A four-second deadline for each unfinished read.

The diagnostic accepts exactly one selected file of 1 byte to 2 MiB. It never changes the file input, repeats the Save-image click, retries a request or invokes randomUUID. A timeout aborts only the diagnostic’s own FileReader. A failed diagnostic cannot replace the original upload exception or assertion. A successful upload never runs this extra read.

The later probe is explicitly marked `originalExceptionCaptured: false`. A later successful read cannot establish the original upload cause. The previous run 88/90 evidence remains unchanged.

No application or browser permission setting changed. The original file `send_keys`, selected-filename assertion, native Save-image click, saved-message assertion, API readback and stored-source count requirement remain intact.

## Local verification

The final source manifest is `812a89827b761655c2d1bde612761647baed75f14275274f74c694590a2ea31a` with 200 files. It remained unchanged during the local check.

- 19 harness tests passed with no failures, errors or skips.
- All 15 original harness case IDs remain. Transport assertions now check the Actions path instead of Element Send Keys.
- Four added harness cases cover unchanged focus, later diagnostic failure versus upload success, synthetic File API byte/error reporting, and size/time bounds.
- All six native product method bodies remain byte-identical to the tested run 91 source.
- Collection still returns exactly three callback and three spreadsheet native journeys.
- No native Safari, browser, server, provider or customer workflow ran locally. Harness checks add zero product-goal credit.

An initial Node VM fixture failed to pass the callback arguments into the exact diagnostic script. The focused reproduction retained two harness errors on manifest `59ca701e50e7ed0a3b745852a37b6532b532608f59a717f720bd249badf1681c`. The fixture now passes its arguments with `apply`. The diagnostic source did not change for that correction. Both the failed attempt and passing result are retained in [native-safari-actions-2026-11-23.json](evidence/native-safari-actions-2026-11-23.json).

Reproduce the local check:

```sh
python -m unittest discover -s tests -p safari_runner_test.py -v
python tests/release_safari_runner.py --list --output-dir /tmp/panelreply-safari-actions-collected
```

## Native verification still required

Run the unchanged six native journeys on the normal installed Safari CI job after publication to the development branch. Require actual trusted selection events and exact values. Inspect any after-failure file-read observations without treating them as the original application exception.

Both products retain their native Safari release blockers. This change supplies a candidate input repair and additional diagnostics, not a native pass claim.

## Primary references

- [WebDriver Element Send Keys, 9 November 2026 draft](https://www.w3.org/TR/2026/WD-webdriver2-20261109/#element-send-keys). The non-typeable-control branch sets a value without the typeable-string keyboard path.
- [Selenium keyboard actions](https://www.selenium.dev/documentation/webdriver/actions_api/keyboard/). Actions sends keyboard down/up input to the active element.
- [WebKit bug 322034](https://bugs.webkit.org/show_bug.cgi?id=322034). This reports upload-file path registration and WebProcess termination. Run 91 did not observe that termination, so this report does not establish the installed browser’s cause.
