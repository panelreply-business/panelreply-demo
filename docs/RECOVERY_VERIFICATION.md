# Recovery stage verification

Audit date: November 19, 2026, America/New_York.

This record covers business-record export, encrypted local backup and restore, and operator password recovery. The previous baseline is main commit `3fe946d6479c2b71f709e54463c0979da688c94e`, after [PR6](https://github.com/panelreply-business/panelreply-demo/pull/6). Both public demos remain suspended with auto-deploy off.

## Candidate status

The implementation is under verification in [PR7](https://github.com/panelreply-business/panelreply-demo/pull/7). Local tests cover synthetic SQLite data and mocked request streams. The first CI attempt is recorded below. A corrected candidate must pass the complete HTTP and Chromium suites before merge.

| Coverage | Status | Evidence |
| --- | --- | --- |
| Local logic, schema, filesystem, recovery and export checks | PASS | 282 combined tests, zero failures or skips, on Node 24.22.3. No sockets or external providers used. |
| Full Node/HTTP and existing browser regression run | PASS | First candidate: 291 Node/HTTP checks and all 96 existing Chromium cases. |
| New export, restore and password-reset browser drill | FAIL | First candidate: 8 passed, 1 test-fixture error. The corrected fixture and expanded two-owner drill await CI. |
| Both Render services stay suspended | PASS | Render service reads confirmed suspension and auto-deploy off during this audit. |
| Public application operation | BLOCKED | Owner-directed suspension. No reactivation is authorized. |
| Live AI provider roundtrip | BLOCKED | Secure key choice and approved provider usage remain unresolved. |
| Calls, SMS, notifications and calendar booking | NOT IMPLEMENTED | These integrations are absent from the local workspace. |
| Customer pilot | NO-GO | Hosting and operational/integration gates remain open. |

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

The failed case attempted to replace `URL.createObjectURL` with a throwing function. Its `page.evaluate` assignment returned that function, so Playwright invoked it before the Export button was clicked. The corrected fixture assigns the function inside an outer block that returns nothing. The required behavior remains unchanged: a failed download preparation preserves edits and reports no saved file. This behavior must pass in the next CI run.

The follow-up also tests both restored owners independently, checks that both source passwords still work, refuses HTTP redirects in fixture API requests and resets scrolling before full-page evidence captures.

The first runner selected Ubuntu 26.04 through `ubuntu-latest`. Dependency/font downloads took roughly 11 minutes. The workflow now selects `ubuntu-24.04` to keep its OS baseline explicit. This pin does not guarantee network speed. GitHub documents the [latest-label migration](https://github.blog/changelog/2026-09-17-ubuntu-26-generally-available-and-latest-migration/) and the [supported runner labels](https://docs.github.com/en/actions/reference/runners/github-hosted-runners).

## Remaining gates

The local recovery tools do not establish an offsite backup service, retention policy, recovery-time target or hosted self-service account recovery. Native Windows/macOS behavior, sustained load and all-device accessibility remain NOT TESTED. Hosting, approved provider usage, calendar integration and live contact channels remain separate work.

No real customer data, real account, provider request, call, SMS or outbound notification is used by these tests. No public deployment is part of this change.

See the [operator guide](RECOVERY.md) for the implemented workflow and limits.
