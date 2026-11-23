# Native desktop Safari scope

## Pending native input and label verification

The next candidate corrects the spreadsheet's plural label and uses actual native segmented keyboard entry for datetime-local controls. It verifies compatible observed locale/control settings, trusted key/input/change records and exact field values. All six method IDs and local/UTC/timezone, persistence, restrictions and real download assertions remain. Nine Python harness checks pass but supply no product credit. Actual Safari execution on manifest `6b951e01bef645f9434dc6e2adac382d1f9d6d419258d2df245a857ecbb6951e` is pending. [Repair evidence](NATIVE_SAFARI_INPUT_REPAIR_2026_11_23.md).

Run87 repeats the two empty datetime failures and three label failures on unchanged Safari source. Its job status/log observation is not a new fully verified product ledger. [Observation](evidence/run87-job-observation-2026-11-23.json).

## Run86 native execution

The exact desktop request on committed `13b8741` starts installed Safari26.6 with stable matching browser/driver/host evidence. All six methods are attempted: callback one PASS/two FAIL and spreadsheet zero PASS/three FAIL. The failed callback methods type an ISO datetime string but observe an empty native control value. The spreadsheet methods fail setup on a singular/plural product-label expectation. The corresponding complete workflows remain unverified. [Source-bound job record](evidence/native-safari-run86.json).

The next repair must use actual native keyboard/control entry, retain exact local/UTC/timezone and persistence checks, and preserve real CSV/XLSX downloads. No injected value/events or API seeding can replace those observations. The manual Safari gate remains separate.

Prepared on 2026-11-23. No native Safari product journey has run locally.

## First committed attempt and correction

Run85 on `76db2d6` observed installed Safari26.6, its matching driver and
macOS15.7.9 with unchanged before/after hashes. Session creation failed because
the macOS driver rejects the `safari:useSimulator` capability even when false.
All six methods remain NOT_RUN and contribute zero product passes. This is a
runner configuration defect, not evidence that the app failed or that operator
permission is missing. [Preserved native report](evidence/native-safari-run85.json).

The correction sends exactly the pinned standard desktop request:
`browserName=safari`, `platformName=mac`, `pageLoadStrategy=normal` and the
observed installed `browserVersion`. It rejects extra request keys, including
either value of the iOS simulator capability. The observed session still must
identify desktop Mac, match the installed Safari version, preserve native host
checks and reject any returned simulator=true. Native startup and all six
journeys still need execution on the corrected committed source.

## Execution boundary

The standard `macos-15-intel` job uses the installed release Safari and
`/usr/bin/safaridriver`. It does not use Playwright's bundled WebKit. One native
W3C session runs the callback and spreadsheet products in sequence. Each
product starts its own fixed entrypoint, product-bound private directory and
synthetic owners. Each method gets a new owner. Data stays on the CI runner.

The client is pinned to Selenium Python 4.54.0. Its local service path is
explicit. Selenium Manager, a remote grid and a driver download are not used.
The local file detector passes an absolute fixture path to Apple's file-input
command, without a Selenium Grid upload extension.

The image's official build script already enables Safari remote automation.
Its GUI login script configures a logged-in desktop. These scripts support a
bounded ordinary-user attempt. They do not prove that a particular allocated
runner can start a session. The workflow does not run `sudo`, enable automation,
change Safari/TCC preferences, start a simulator or try an alternate browser.
If startup fails, the report records the error and all six planned cases as
`NOT_RUN`. It makes one session-start attempt.

## Six product journeys

| Suite | Method | Observed behavior required for a pass |
| --- | --- | --- |
| `callback-safari` | `test_intake_status_persistence_and_sign_out` | Keyboard login, typed intake, request save/edit/status persistence, fixed-product route denial, callback cookie identity, UI sign-out and session revocation |
| `callback-safari` | `test_schedule_reschedule_outcome_follow_up_and_cancel` | Native date/time entry, zone conversion, schedule/reschedule, recorded outcome, follow-up creation/cancellation, restart persistence and queue filtering |
| `callback-safari` | `test_contact_hold_and_keyboard_dirty_edit_guard` | Label association and keyboard focus, preserved unsaved task edits, opt-out/closed contact restrictions, blocked contact actions and permitted task cancellation |
| `spreadsheet-manual-safari` | `test_manual_corrections_persist_and_native_downloads_match` | Typed manual rows, preserved unknown manufacturer, rejected incomplete review, saved corrections, leading-zero and formula-like text, real CSV/XLSX downloads and independent CSV/openpyxl content checks |
| `spreadsheet-manual-safari` | `test_file_upload_source_links_and_unavailable_ocr` | Native file-input upload, exact retained image bytes, displayed image, row/source linking, saved manual review and unchanged project/source after the native OCR-unavailable response |
| `spreadsheet-manual-safari` | `test_bound_recovery_revokes_archived_sessions_and_credentials` | Encrypted spreadsheet archive, product binding, owner-only restored directory, archived-cookie rejection, disabled archived password, explicit operator reset, native relogin and retained project/image data |

The suite contains exactly three methods per product. Setup, fixture rows,
assertions and evidence-harness tests do not add product executions. Retries of
the same source/case/platform key do not add coverage. No browser test is
automatically retried.

## Native identity and source evidence

Each source report retains the shared before/after source manifest, commit,
tree and policy-file digest. New Python files and pinned requirements are in
that manifest. Evidence must identify `darwin/x86_64/webkit/safari/desktop`.
The native channel cannot be supplied by another suite, a combined deployment,
another product, Playwright WebKit, another OS/architecture or an emulated
profile.

A passing method requires all of the following.

- Installed `/usr/bin/safaridriver` path, version and SHA256.
- Installed `/Applications/Safari.app` release bundle identifier, version,
  build, metadata hash and executable hash.
- Observed macOS version/build and x86_64 architecture.
- Unchanged installed driver/browser observations before and after execution.
- An actual native session whose Safari version matches the installed app and
  whose platform is Mac. The exact standard request selects Mac and contains
  no iOS or simulator capability.
- The final requested capabilities retain the pinned Selenium defaults and
  installed browser version. Returned native OS version/build fields must
  agree with `sw_vers`. Absent optional fields are listed as unavailable.
- A hash of the observed native session ID on each case. The control token
  itself is not written to an artifact.
- The pinned client version, matching observed browser version and actual
  desktop viewport dimensions.

The desktop assertion requires an observed viewport of at least 900 by 500.
It makes no 320px, phone, tablet, simulator or physical-device claim. Safari
screenshots use the native screenshot endpoint and do not inject stylesheets
or change CSP.

Driver version/build matching uses complete tokens from the installed
`Included with Safari <version> (<build>)` output. A version or build with an
extra suffix cannot pass by matching only a prefix.

## Downloads and remaining observation limits

The spreadsheet export journey first fetches the saved export bytes through
Safari's same-origin HTTP API. That readback is recorded separately. It then
clicks the actual export button and waits up to 15 seconds for the exact new
UUID-named CSV/XLSX file in the disposable runner's Downloads directory.
Preexisting files and symlinks cannot satisfy the observation. A pass requires
the newly downloaded bytes to equal the saved bytes. Both files are parsed
independently and the test removes only its own observed synthetic downloads.

The collector rejects the export pass if either native download is missing,
unobserved, empty or different from the saved bytes. The API readback cannot
replace a missing native download. No browser preference or permission is
changed to obtain a file. A Safari permission prompt or unsupported native
file/date interaction remains an unresolved CI result.

Standard WebDriver does not expose download progress. This suite also has no
Playwright-equivalent request interception or complete console capture. The
app's same-origin CSP stays in place, provider credentials are omitted from
the fixture processes, and the callback case verifies live provider execution
is disabled. The suite does not claim a complete external-traffic or console
audit.

## Release accounting

Two automated Safari requirements are added, each requiring all three methods
for its fixed product. Every existing requirement and all seven manual gates
remain unchanged. These small automated scopes do not close the manual Safari
acceptance gate, full macOS native OCR support, physical-device acceptance,
Windows private-product support or Apple Silicon acceptance.

Local checks are evidence-harness verification only. The first actual Safari
result must come from the committed candidate's standard Mac CI job. A written
scope, method collection or synthetic report is not product acceptance.

## Primary references

- Apple, enable native automation:
  https://developer.apple.com/documentation/safari-developer-tools/macos-enabling-webdriver.md
- Apple, native driver and associated Safari:
  https://developer.apple.com/documentation/webkit/testing-with-webdriver-in-safari
- Apple, WebDriver isolation and session behavior:
  https://developer.apple.com/documentation/safari-developer-tools/webdriver
- GitHub, standard runner labels:
  https://docs.github.com/en/actions/reference/runners/github-hosted-runners
- GitHub, installed macOS 15 Intel image inventory:
  https://github.com/actions/runner-images/blob/main/images/macos/macos-15-Readme.md
- GitHub, image Safari setup:
  https://github.com/actions/runner-images/blob/main/images/macos/scripts/build/install-safari.sh
- GitHub, image GUI login:
  https://github.com/actions/runner-images/blob/main/images/macos/scripts/build/configure-autologin.sh
- GitHub, complete installed Safari/driver version and build reporting:
  https://github.com/actions/runner-images/blob/6d72cf29b31dca29cc53e9d4046505fbdfd32210/images/macos/scripts/docs-gen/SoftwareReport.Browsers.psm1
- Selenium, pinned Python release:
  https://github.com/SeleniumHQ/selenium/blob/selenium-4.54.0/py/CHANGES
- Selenium's published Python distribution and Python 3.12 support:
  https://pypi.org/project/selenium/4.54.0/
- Selenium's pinned native Safari capability defaults:
  https://github.com/SeleniumHQ/selenium/blob/selenium-4.54.0/py/selenium/webdriver/common/desired_capabilities.py
- Selenium, native Safari support:
  https://www.selenium.dev/documentation/webdriver/browsers/safari/
- Selenium, native file-input path entry:
  https://www.selenium.dev/documentation/webdriver/elements/file_upload/
- Selenium, download-observation limitation:
  https://www.selenium.dev/documentation/test_practices/discouraged/file_downloads/
- WebKit's Apple-authored platform and iOS simulator capability description:
  https://webkit.org/blog/9395/webdriver-is-coming-to-safari-in-ios-13/
