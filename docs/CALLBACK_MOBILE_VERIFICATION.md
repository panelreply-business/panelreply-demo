# Callback scheduling touch verification

## Scope and current evidence

The `callback-mobile` suite runs the fixed `callback-server.cjs` product with its own product-bound synthetic database. It reuses the selected-product and mobile harnesses. External requests, provider requests, another product's API requests, uncaught script errors and unexpected console errors still fail the cases. No CSP exception was added.

Prepared against `e711d15d418406969631202642c9d055b47afca5`. Local verification on November 23, 2026 compiled the two Python files and collected 12 methods for Chromium and 12 for WebKit. It also checked the UTC fixture helper across release dates, a year boundary and a leap day. These checks executed zero browser cases and earn zero product-test credit. Actual browser results remain pending the next CI execution on the integrated source.

The suite uses browser device emulation on the private Linux server. Physical phones/tablets, their operating-system keyboard and picker behavior, branded Safari/Android Chrome, and physical-device acceptance remain separate release requirements. Data entry uses Playwright `fill` and `select_option`. Task and navigation actions use `locator.tap()` without a mouse-click or dispatched-event fallback.

## Journeys

| Journey | Assertions |
| --- | --- |
| `scheduling_lifecycle` | Schedule an overdue task, open it from the due queue, reschedule it into the future, verify it leaves the due queue, record a synthetic no-answer outcome, create a separate follow-up, check open/completed filters, and verify saved values after a server restart. Parent/task revisions advance. The requested work date and callback window remain intact. |
| `blocked_contact` | Save a task before an opt-out, save the opt-out through the request form, verify completion/rescheduling are disabled, verify a later permission-field correction cannot clear suppression, cancel the blocked task, and reopen its record after reload. The task retains its due instant and contact stays blocked. |
| `unsaved_edits` | Keep a task draft when touch navigation triggers the guard, discard it on a later navigation, verify no task or revision was saved, then keep and save a request correction. Task/request editing locks prevent one form from overwriting the other form's unsaved state. |

Each journey asserts no horizontal document/body overflow within its unchanged device profile. The scheduling controls and draft guard must work at that profile's width and height. A viewport resize does not stand in for a new profile execution.

## Profiles and accounting

| Profile ID | Chromium descriptor | WebKit descriptor |
| --- | --- | --- |
| `phone_portrait` | Pixel 7 | iPhone 13 |
| `phone_landscape` | Pixel 7 landscape | iPhone 13 landscape |
| `tablet_portrait` | Galaxy Tab S4 | iPad Pro 11 |
| `tablet_landscape` | Galaxy Tab S4 landscape | iPad Pro 11 landscape |

The runner reports `suite: callback-mobile`, `deploymentMode: callback`, `productScope: callback` and `emulated: true`. The twelve method IDs below are identical between engines. The engine/profile platform key distinguishes actual executions. Three journeys across four profiles and two engines can provide 24 platform executions after they pass. Assertions, seeded rows, repeat runs, helper checks and inherited desktop/combined-mobile methods add no extra cases.

```text
callback_mobile_browser_test.CallbackMobileBrowserTests.test_phone_landscape_blocked_contact
callback_mobile_browser_test.CallbackMobileBrowserTests.test_phone_landscape_scheduling_lifecycle
callback_mobile_browser_test.CallbackMobileBrowserTests.test_phone_landscape_unsaved_edits
callback_mobile_browser_test.CallbackMobileBrowserTests.test_phone_portrait_blocked_contact
callback_mobile_browser_test.CallbackMobileBrowserTests.test_phone_portrait_scheduling_lifecycle
callback_mobile_browser_test.CallbackMobileBrowserTests.test_phone_portrait_unsaved_edits
callback_mobile_browser_test.CallbackMobileBrowserTests.test_tablet_landscape_blocked_contact
callback_mobile_browser_test.CallbackMobileBrowserTests.test_tablet_landscape_scheduling_lifecycle
callback_mobile_browser_test.CallbackMobileBrowserTests.test_tablet_landscape_unsaved_edits
callback_mobile_browser_test.CallbackMobileBrowserTests.test_tablet_portrait_blocked_contact
callback_mobile_browser_test.CallbackMobileBrowserTests.test_tablet_portrait_scheduling_lifecycle
callback_mobile_browser_test.CallbackMobileBrowserTests.test_tablet_portrait_unsaved_edits
```

The existing username touch probe remains in `touchEvidence.events`. The new `touchEvidence.actions` array records each scheduling, cancellation or navigation action as `{action, events}`. Document capture listeners observe the target control's real `touchstart` and `touchend` events. Each action must produce one start with one touch and one end with zero touches, both with `isTrusted: true` and one changed touch. The probe also checks that the event target belongs to the intended control. This evidence survives an in-page task-list re-render. No test changes the reported hardware touch-point count.

## Clock fixture audit

The new cases obtain `generatedAt` from the real task-list API. They round that UTC instant down to a minute and choose overdue at minus two days, upcoming at plus two days and follow-up at plus three days. Both the form and expected API timestamp use UTC. This avoids a host time-zone dependency, daily expiration, DST ambiguity and a due-state boundary within the journey. The recorded `touchEvidence.timeFixtures` contains the original server timestamp and all three expected instants.

Local fixture inspection covered November 23, December 20 and December 31, 2026, January 1, 2027, February 29, 2028, and January 1, 2099. In each inspection the overdue instant stayed more than a day in the past and upcoming stayed more than a day in the future. This was fixture inspection, not additional test-case execution.

The existing desktop callback tests use December 1–3, 2026 for exact saved-time conversions and persistence. They do not assert those instants remain in the future. The task API deliberately accepts past instants, so those cases remain valid during daily runs through December 20 and after release. Preserve their exact conversion expectations.

The March 8 and November 1, 2026 Detroit cases assert a specific clock gap and fold. Their dates identify the behavior under test. Replacing them with today's date would remove that coverage. Past task instants are permitted, so these cases do not expire on their calendar dates.

The existing desktop queue test uses 2020 as an overdue fixture and 2099 as an upcoming fixture. That assumption holds throughout the current release window, but the 2099 fixture has a calendar horizon. The new touch suite uses relative values for both states. The fixed February 29, 2028 value in the design suite checks date entry/display rather than whether work is in the future.

## Reproduce

Run collection without a browser launch:

```sh
python -m py_compile tests/callback_mobile_browser_test.py tests/release_platform_runner.py
PANELREPLY_BROWSER=chromium python tests/release_platform_runner.py --suite callback-mobile --list --output /tmp/callback-mobile-chromium-collected.json
PANELREPLY_BROWSER=webkit python tests/release_platform_runner.py --suite callback-mobile --list --output /tmp/callback-mobile-webkit-collected.json
```

With the repository's pinned Playwright runtime and the corresponding bundled browser installed in the authorized CI environment, run:

```sh
PANELREPLY_BROWSER=chromium python tests/release_platform_runner.py --suite callback-mobile --output /tmp/callback-mobile-chromium.json
PANELREPLY_BROWSER=webkit python tests/release_platform_runner.py --suite callback-mobile --output /tmp/callback-mobile-webkit.json
```

Release evidence must match the committed source, its policy hash, the fixed callback deployment and all required engine/profile combinations. Browser collection alone does not satisfy these gates. Physical-device gates remain unchanged.
