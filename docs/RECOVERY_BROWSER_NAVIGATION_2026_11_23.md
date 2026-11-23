# Recovery browser navigation repair

November 23, 2026. Candidate based on `1b35490335203348572e938bcc30dfc0f05d93e1`.

## Observed CI error

Run 83, private Linux WebKit job `137841954850`, completed 132 browser cases with 131 passes and one error. WebKit was the bundled 26.5 engine under Playwright 1.62.0 and Python 3.12.16.

The error occurred in `test_encrypted_restore_preserves_requests_and_restrictions_but_rejects_old_sessions`. After the restored owner's API logout, the test called `assert_login_rejected` for the second owner. That helper started a new navigation to `/login` and WebKit interrupted it before the credential rejection check ran.

The completed job log records:

```text
workspace_recovery_browser_test.py, line 414
    self.assert_login_rejected(username="other-restore@example.test", origin=restored_origin)
workspace_recovery_browser_test.py, line 201
    self.page.goto(origin + "/login")
playwright._impl._errors.Error: Page.goto: Frame load interrupted
Call log:
  - navigating to "http://127.0.0.1:33343/login", waiting until "load"
Ran 132 tests in 182.121s
FAILED (errors=1)
```

The raw log's SHA256 is `2ca9bd161ca444b3f0f3ce57e1395014f936ef06640e39414affcfeffd68020d`.

## Source diagnosis and change

Opening a request starts a separate saved-task read. The previous test waited only for the request notes, then revoked the session through the API while the private page remained active. A task read or focus-session check receiving `401` causes the application to replace its location with `/login`. That navigation can compete with the helper's forced navigation. This is a source-based explanation consistent with the observed stack. The job log does not identify which request initiated the competing navigation.

The revised drill waits for the saved-task result, clicks the owner's actual Sign out control, requires the matching `POST /api/logout` response to return `204`, and waits for the login page's `load` state and empty password field. This also waits for the deferred login script. It checks that `/api/session` returns `401`. The credential-rejection helper then uses that loaded login page without starting another navigation.

The drill still checks both archived passwords before owner recovery, independent password reset for each restored owner, restored request/profile contents, STOP and safety restrictions, cross-business rejection and unchanged source credentials. The separate expired-export drill still uses API logout to exercise session-expiry handling. Console, script-error and external-request guards remain in place.

The repair adds no retries, sleeps or navigation-exception handling. It changes no product runtime code and adds no browser case identities.

## Local verification and remaining evidence

Python 3.12.14 and Playwright 1.62.0 compiled and collected the module. All nine existing method identities are unchanged. `git diff --check` passed. Local browser execution remains unavailable, so this candidate has zero local browser passes.

An independent read-only peer review found no removed business assertion, relaxed console guard, retry or exception suppression. It also checked the final explicit `load` wait and preserved method identities. No browser execution was claimed by the reviewer.

Candidate test-file SHA256: `84d2d55be9cbbad1081fc7dc6ffd57896980ee89c0455e828bc80c11a5b17256`.

The next CI run must execute the corrected drill in the private browser suite. Run 83's error remains an error, and collection does not provide browser or release acceptance credit.
