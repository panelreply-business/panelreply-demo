# Private workspace verification

This record covers the standalone local contractor workspace. Both public Render demos remain suspended. No deployment, real account, provider request, call, SMS or customer contact is part of this change.

## Candidate checks

The first combined offline run passed208 tests with zero failures or skips. This covers the existing intake/demo logic and fake-provider behavior, plus the new conversation, SQLite persistence, authentication and mocked HTTP-handler tests. Generated `index.html` and its CSP hashes match the source. The new browser suite compiles.

Real HTTP and Chromium checks are pending the PR workflow. Do not treat browser behavior or release readiness as PASS until that run and the captured images have been reviewed.

## Reproduced defects corrected in the candidate

| Priority | Defect and reproduction | Correction and verification |
| --- | --- | --- |
| Medium | Send a complete request, then `Actually the job ZIP is 48084`. The new field splitter could replace the job with part of the label. | Keep ZIP labels intact. Regression test now preserves the job, callback and work date while changing ZIP. Offline PASS. |
| Medium | Ask `Could you contact me at 586-555-0101 tomorrow?`. The preview could miss the phone and put it into the callback field. | Recognize explicit polite contact clauses. With-time and without-time regression tests PASS offline. |
| Medium | Opt out a known phone after an earlier request was saved as New. Effective contact permission changed but the earlier request could still appear ready. | In the same transaction, move matching New requests to Needs review, increment versions and add audit metadata. Persistence and stale-write tests PASS offline. |
| Medium | A valid long transcript containing multibyte or escaped Unicode could exceed the old64KiB HTTP limit before reaching the documented field limits. | Increase the bounded body cap to192KiB. A fixture at every supported lead-field limit is accepted. Over-limit input still fails. Offline PASS. |
| Medium | Refresh an open inbox request while entering notes during the pending response. The arriving response could replace unsaved edits. | Freeze edit fields during refresh and retain the dirty-state guard. Browser regression pending. |
| Medium | Hit the conversation limit with an unsent message. The textarea could become disabled while Save required that message to be cleared. | Keep the textarea editable at the limit while Send stays disabled. Browser recovery regression pending. |
| Medium | Edit a request without callback permission or with a stored opt-out and select New or Contacted. | Reject unsupported status transitions. UI options follow the same restrictions. Backend regression PASS; browser verification pending. |

## Coverage and remaining gates

| Area | Current evidence |
| --- | --- |
| Core intake, saved answers and deterministic workspace preview | PASS — offline regression suite |
| SQLite persistence and business isolation | PASS — offline database tests |
| Authentication, sessions, CSRF, input bounds and failure responses | PASS — offline handler tests |
| Actual HTTP server and browser interactions | NOT TESTED — pending CI |
| Desktop/mobile visual review | NOT TESTED — pending CI capture |
| Public application behavior | BLOCKED — both services intentionally offline |
| Live AI | BLOCKED — secure key choice and approved use remain pending |
| Calendar booking, live calls/SMS and notifications | NOT IMPLEMENTED |
| Hosted private access, backup/restore, account recovery and retention operations | NOT IMPLEMENTED |
| Customer pilot | NO-GO |

Source setup and implementation limits are documented in [Private workspace](PRIVATE_WORKSPACE.md).
