# Recovery stage verification

Audit date: November 19, 2026, America/New_York.

This record covers business-record export, encrypted local backup and restore, and operator password recovery. The previous baseline is main commit `3fe946d6479c2b71f709e54463c0979da688c94e`, after [PR6](https://github.com/panelreply-business/panelreply-demo/pull/6). Both public demos remain suspended with auto-deploy off.

## Verified application candidate

The application and test changes in [PR7](https://github.com/panelreply-business/panelreply-demo/pull/7) passed 396 checks with zero failures in [CI run 44516705029](https://github.com/panelreply-business/panelreply-demo/actions/runs/44516705029), job `135534459873`.

- Tested commit: [`c67469e967083fa9e20d8e65db07666f02b7b807`](https://github.com/panelreply-business/panelreply-demo/commit/c67469e967083fa9e20d8e65db07666f02b7b807).
- Tested tree: `6a7088cd80de0c39d6b6cc9cbec0fac00a30cda9`.
- Runtime: Node 22.23.4, Python 3.12 and Chromium 151.0.7922.34 on Ubuntu 24.04.
- Three public application checks were intentionally skipped and classified BLOCKED. They are excluded from the 396 passes.
- A documentation/evidence follow-up records these results and the inspected screenshots. It changes no application or test code. Review the [current PR checks](https://github.com/panelreply-business/panelreply-demo/pull/7/checks) when assessing a later revision.

| Coverage | Status | Evidence |
| --- | --- | --- |
| Local logic, schema, filesystem, recovery and export checks | PASS | 282 combined tests, zero failures or skips, on Node 24.22.3. No sockets or external providers used. |
| Full Node/HTTP and suspension guards | PASS | 291 passed, zero failed. Three intentional public-app blockers are separate. |
| Existing browser regressions | PASS | 96 passed across demo, intake, UI and private-workspace suites. |
| New export, restore and password-reset browser drill | PASS | All 9 cases passed, including the corrected failure fixture and both restored owners. |
| Desktop/mobile visual review | PASS | Inspected actual CI captures at 1440-pixel and 360-pixel widths. |
| Both Render services stay suspended | PASS | Render service reads confirmed suspension and auto-deploy off during this audit. |
| Public application operation | BLOCKED | Owner-directed suspension. No reactivation is authorized. |
| Live AI provider roundtrip | BLOCKED | Secure key choice and approved provider usage remain unresolved. |
| Calls, SMS, notifications and calendar booking | NOT IMPLEMENTED | These integrations are absent from the local workspace. |

The combined local run overlaps CI and is not added to its 396 total.

### Browser totals

| Suite | Passed | Failed |
| --- | ---: | ---: |
| Demo behavior | 11 | 0 |
| Intake, questions and corrections | 42 | 0 |
| Interface, keyboard and layout | 12 | 0 |
| Private workspace | 31 | 0 |
| Export and recovery | 9 | 0 |
| Total | 105 | 0 |

The recovery change adds 74 Node cases and 9 browser cases to the earlier 313-pass baseline. Counts refer to test cases, not individual assertions.

### Captured interface evidence

- [Desktop inbox and record export](evidence/recovery-inbox-desktop.jpg).
- [360-pixel inbox and record export](evidence/recovery-inbox-mobile.jpg).

Both images come from the passing run and contain synthetic fixtures. Review confirmed the export control and disclosure fit the page, the form stays readable, and the unsaved-edit message does not claim those edits are in the download. The mobile case also passes the overflow and keyboard-download assertions.

## Verification scope

- Encryption, wrong-passphrase and tamper rejection, bounded archive size, supported schema, integrity and business relationships.
- Committed WAL data, session removal, opt-out and safety-hold preservation, source nonmutation and a fresh restore destination.
- Mandatory password reset for each restored owner so old archives cannot revive superseded credentials.
- Selected-owner session revocation, failed-reset rollback, other-business preservation and sign-in/reset concurrency.
- A business-scoped JSON export from one database snapshot, with credentials excluded and unsaved edits preserved.
- Actual Chromium download, error/retry, expired session, keyboard and mobile-layout checks.
- A real restore drill using synthetic data, including restored login after operator recovery and continued access to the original fixture.

## Confirmed defects and regression evidence

| Priority | Reproduction | Correction and local result |
| --- | --- | --- |
| Medium | Start an authenticated profile PATCH, pause halfway through its JSON body, reset the owner's password, then finish the body. The earlier handler saved the edit after session revocation. | Revalidate the same session, actor/business and CSRF after the body read. Preview processing revalidates after awaited work. Eight delayed-request regressions pass, including rejection before profile, lead and opt-out writes. |
| Medium | Begin verifying the old password, commit a reset while scrypt is pending, then finish sign-in. | Session creation atomically requires the captured password hash to remain current. The old in-flight sign-in returns unauthorized and creates no session. |
| Medium | Supply an unpaired UTF-16 surrogate in a password. UTF-8 replacement previously let it match a different password containing U+FFFD. | Reject malformed Unicode before accepting password verification or hashing. The focused regression passes. |

Recovery-specific failure cases also pass: old backup credentials stay disabled after restore, failed reset audit rolls back all changes, foreign-business data stays isolated, and a concurrent writer cannot mix profile and request revisions in one export. These are required behavior checks for the new capability, separate from defects in the earlier application.

## First CI attempt and correction

[Run 44514088313](https://github.com/panelreply-business/panelreply-demo/actions/runs/44514088313) tested commit `a65a02036223118f10e45227c539adcd628aeedb`: 395 passed, 1 failed browser case and 3 intentional offline blockers. All 291 Node/HTTP checks and 96 existing browser cases passed. Eight recovery browser cases passed.

The failed case attempted to replace `URL.createObjectURL` with a throwing function. Its `page.evaluate` assignment returned that function, so Playwright invoked it before the Export button was clicked. The corrected fixture assigns the function inside an outer block that returns nothing. The required behavior remains unchanged: a failed download preparation preserves edits and reports no saved file. This behavior passed in run `44516705029`.

The follow-up also tests both restored owners independently, checks that both source passwords still work, refuses HTTP redirects in fixture API requests and resets scrolling before full-page evidence captures.

The first runner selected Ubuntu 26.04 through `ubuntu-latest`. Dependency/font downloads took roughly 11 minutes. The workflow now selects `ubuntu-24.04` to keep its OS baseline explicit. Browser dependency installation took about 16 seconds in the passing follow-up run. These are observations from two runs, not a speed guarantee. GitHub documents the [latest-label migration](https://github.blog/changelog/2026-09-17-ubuntu-26-generally-available-and-latest-migration/) and the [supported runner labels](https://docs.github.com/en/actions/reference/runners/github-hosted-runners).

## Release decision

GO for the local recovery milestone and continued development. No confirmed medium-or-higher defect remains unresolved within this change's verified scope.

NO-GO for a customer pilot, hosted deployment, live AI, customer messaging or appointment booking. The gates below remain open. Passing these tests does not establish that all possible faults are absent.

## Remaining gates

The local recovery tools do not establish an offsite backup service, retention policy, recovery-time target or hosted self-service account recovery. Native Windows/macOS behavior, sustained load and all-device accessibility remain NOT TESTED. Hosting, approved provider usage, calendar integration and live contact channels remain separate work.

No real customer data, real account, provider request, call, SMS or outbound notification is used by these tests. No public deployment is part of this change.

See the [operator guide](RECOVERY.md) for the implemented workflow and limits.
