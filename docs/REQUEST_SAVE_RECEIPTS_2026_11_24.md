# Request save receipts and recovery

## Result

Request saves now validate the returned record before replacing the selected request, clearing its draft, or reporting success. An uncertain save retains its original payload and revision. A conflicting retry can confirm current saved values through a separate read.

The isolated candidate passes 152 affected Node checks with zero failures, skips or infrastructure errors. Its source manifest is `c57a66e3ef4c2c52800c6ccf37059f190efa42116c7fa38ddc5ae4fc583f068c`. The callback browser suite collects 17 methods, including one new journey. No browser or native execution took place for this milestone. Release acceptance remains open.

## Reproduced defects

The previous `app.js` accepted a successful response for another request and accepted a response at the submitted revision. Both replaced the current edit and reported `Changes saved`. It also accepted different saved notes. A response containing `audit: [null]` changed the selected revision and began rendering before throwing. The draft was not consistently protected by a pending command.

The [counterexample record](evidence/request-save-counterexamples-2026-11-24.json) reproduces those four responses against the original runtime from `7fec73b7ca7fe323accaf22eb99e11d905f698b3`. These are synthetic response corruptions. They do not show that the server emitted such records during normal operation.

The first nine new regression methods run against that old runtime with the candidate test fixtures. One first-refusal control passes and eight methods fail. The unchanged-draft and recovery scenarios fail at the absent pending-state guard. They do not establish that the old client had a readback recovery path. The candidate passes those nine methods, a further phone-contract regression, and all selected existing methods. [Before](evidence/request-save-before-node-2026-11-24.json) and [final after](evidence/request-save-after-node-v2-2026-11-24.json) reports retain separate source manifests and raw logs. The earlier 151-pass candidate report is preserved separately.

## Actual write contract

`PATCH /api/leads/:id` uses an optimistic revision check. It does not have an idempotency key or a replay receipt. A successful write returns exactly the next request revision. Repeating the old revision after that commit returns a version conflict.

The client now requires:

- A complete parent record accepted by the existing scheduler parent-shape predicate, including every conversation and audit field consumed by the request renderer.
- The issued request ID and its original creation timestamp, with a nondecreasing update timestamp.
- Exactly the next revision for a successful PATCH receipt. A fresh write cannot produce the legacy maximum-safe read revision.
- The submitted text after the server's trimming rules, its canonical US phone number, and the submitted status. Phone validation rejects malformed UTF-16 and forbidden controls before trimming, matching the server.
- Current contact permission and restriction flags consistent with the public record. A newly discovered opt-out or safety hold can make the result more restrictive. Existing safety holds remain sticky. An opt-out on an unchanged phone cannot disappear.

The scheduler's validator and task-save logic remain unchanged. This patch only exports the existing `validLeadReceipt` predicate for the request screen. The backend write, safety, contact and profile receipt policies remain unchanged.

## Uncertain saves

A network failure, server error, invalid successful response, timeout or rate response retains the issued payload. The form stays locked and its button changes to `Retry save`. The request keeps its original revision through later client refusals. Navigation, deletion, exports, task writes and profile saves remain blocked while this command is unresolved. The unload guard also covers an unchanged draft whose save is uncertain.

A retry sends the original PATCH. If it returns a version conflict, the client reads that request and validates its complete shape and identity. A readback at the original revision cannot confirm the save, even when all field values already match.

A later revision with matching normalized values displays `Saved values confirmed`. That message confirms the current persisted values. It does not prove which command or writer produced them. The client does not invent an operation key, rebase the payload, or describe the result as a PATCH replay.

A later record with different values keeps the original draft and payload. The owner can choose `Reload saved version`, read the discard explanation, and confirm that choice. The client retains the draft if that read fails or returns incomplete or mismatched data. It clears the pending command only after a valid current record is available. A stale discard dialog cannot authorize dropping a later uncertain command.

Session expiry clears the pending command and request fields. A late response cannot repopulate the signed-out screen. The request progress label is also cleared.

## Verification

| Check | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| First nine new methods on original request runtime | 1 | 8 | 0 |
| Phone-contract method before its precheck repair | 0 | 1 | 0 |
| Candidate platform client state methods | 46 | 0 | 0 |
| Candidate workspace API methods | 20 | 0 | 0 |
| Existing callback client methods | 38 | 0 | 0 |
| Existing callback task API methods | 14 | 0 | 0 |
| Existing product UI methods | 34 | 0 | 0 |
| Candidate affected total | 152 | 0 | 0 |

The real API regression authenticates through the handler, saves through SQLite, checks trimming and phone normalization, loses a committed response, refuses a retry, and later adds a phone opt-out. The original request already needs review, so this opt-out changes its public contact flags without incrementing that parent revision. The readback still follows the submitted revision. The client accepts that current restricted state without another write. Exactly two `lead.updated` audit entries remain after the two intended edits.

The boundary case retains the final supported writable revision and numeric chronology across year 9999 into year 10000. It rejects a fresh receipt at the legacy maximum-safe read revision. The session case waits on an in-flight response, expires the session through the API path and verifies that the late response restores no private fields.

Final review found a phone-contract edge in the first candidate. Leading vertical tab, interior form feed and trailing form feed each receive a real API 400 without changing the stored request. The client previously stripped or accepted those characters while comparing a fabricated canonical success receipt. The new API/client regression reproduces all three false confirmations, retains an existing lone-surrogate rejection, and proves that permitted tab/carriage-return formatting still saves through the real API. The final client applies the server's raw-text precheck before trimming. The [failing precheck report](evidence/request-save-phone-before-2026-11-24.json) and its log remain separate from the final passing report.

The new browser journey uses the callback entrypoint and normal page controls. It commits through the real API, corrupts one returned request ID, supplies a later 403, and requires the original command to reach a real 409 followed by a valid GET. A second committed response is lost before an opt-out changes the saved request. The journey requires an explicit reload decision and preserves the contact restriction. It checks unchanged command bodies, no idempotency header, final persisted state and exactly two update audit entries. Its method is collected and syntax checked. It has not passed in a browser yet.

The 38 preexisting browser class methods, including helpers, remain byte-identical. All original platform test bodies and workspace API test bytes remain intact apart from the new import and two new cases. The existing synthetic DOM helper moved to a shared fixture so the real SQLite/API methods stay out of the Windows/macOS portable suite. Its only extensions are an initial transport option, a real request-ID option, the existing button's markup label and access to its listener registry. [Final preservation record](evidence/request-save-preservation-v2-2026-11-24.json).

Run the affected tests with:

```sh
node --test tests/platform-client-state.test.cjs tests/workspace-api.test.cjs tests/callback-schedule-client.test.cjs tests/callback-tasks-api.test.cjs tests/product-ui.test.cjs
python3 tests/release_platform_runner.py --suite callback --list --output /tmp/request-save-collected.json
```

For the before comparison, use an isolated checkout at `7fec73b7ca7fe323accaf22eb99e11d905f698b3`, copy the candidate test files and shared fixture into it, and leave its original `app.js` and `schedule.js` in place. Then run:

```sh
node --test --test-name-pattern='^intake request |^request editor ' tests/platform-client-state.test.cjs tests/workspace-api.test.cjs
```

Both recorded runs kept their source manifests unchanged during execution. No new portfolio credit is booked by these local comparisons or repeated observations. The new candidate still requires integration and committed-source CI evidence.

An independent source review checked the request identity, revision, normalization, pending-command lifecycle, readback, explicit reload and unchanged task validator. Root review then found the phone precheck omission. The peer's [supplemental review](evidence/request-save-independent-review-supplement-2026-11-24.json) checks the correction against `store.text`, binds the final runtime hash, and corrects that earlier missed edge. Both reviews remain preserved. Neither review claims browser or native execution.

## Evidence history and remaining limits

The first real-API fixture incorrectly assumed that an opt-out always advances an already-reviewed request revision. That run had seven passing methods and one fixture failure. The test now follows the actual suppression behavior. The original November23 temporary report was not retained across interruption. This statement records the observed failure and does not claim the missing report has been recovered.

A separate session test found that expiry left `Saving changes…` visible in the hidden request status while correctly clearing the private fields. Its [eight-pass, one-fail report](evidence/request-save-session-cleanup-before-2026-11-24.json) remains preserved. The candidate clears that label and passes the method.

The earlier four-case November23 temporary reproduction was also unavailable after interruption. The November24 counterexample file is a new reproduction with current source binding. It is not presented as the original file.

The first narrow phone-regression run selected an extra file with no matching methods. Node emitted a passing file-shell outcome alongside the one failed regression. That initial report remains recorded as runner evidence with zero goal credit. It is not a passing product method. The corrected run selects only the API test file and reports zero passes and one failure. The final 152-method run includes actual methods from every selected file.

Pending edits remain in browser memory. This change does not add local storage of private drafts or guarantee recovery after browser termination. A persisted readback can establish current saved values, but the request PATCH protocol cannot establish execution of an individual lost command. Browser, platform and release gates remain separate from the passing Node checks.
