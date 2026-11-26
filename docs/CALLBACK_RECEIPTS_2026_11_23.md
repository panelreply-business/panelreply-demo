# Callback task receipt validation

## Result

Callback task saves now validate the receipt before clearing the pending command, clearing the operator draft, or passing the parent request to the application renderer.

The repair has 173 passing Node checks on its recorded development source. Native and browser acceptance remains open. Both products remain NO-GO.

## Reproduced defect

The previous scheduler checked the parent ID, parent version type, task parent ID and task version type. It accepted a completion receipt for another task, unchanged revisions, a scheduled result for a completion, different reschedule fields, and a task without an ID or schedule. Each response cleared the draft and retry state and displayed success.

A second path used the shipped `app.js` and `schedule.js` through the existing platform state helper. A successful response with `lead.audit: [null]` reached the request renderer after the scheduler had cleared the draft and pending command. The renderer threw while reading the audit action. The draft was empty and the retry control could no longer send the original command.

These reproductions supplied synthetic response corruption. They do not establish that the current server emitted these malformed responses in normal use.

## Receipt rules

- The parent record must contain the fields, flags, timestamps, conversation entries and audit entries consumed by the request renderer.
- The task must have a saved ID, parent ID and revision, schedule, status, contact restrictions, notes and terminal-state metadata consistent with the returned parent.
- An update must return the requested task ID and retain its kind and creation timestamp.
- A fresh result must advance the parent revision by one. Creation starts task revision one. An update advances the task revision by one.
- At the committed task revision, returned status, notes, time zone, scheduled instant and outcome must agree with the submitted action. Notes follow the server's trimming rule.
- A replay may return later task and parent revisions. Later rescheduling, completion, cancellation and contact restrictions remain visible. A finished task cannot acquire a later task revision through another mutation.
- An invalid receipt retains the original command and key. A later client rejection cannot discard an already uncertain write.
- Chronology uses numeric instants, including supported extended-year timestamps. Readable legacy parent and general request-audit revisions may reach the safe integer limit. The stricter task revision limit remains enforced.

The full parent preflight runs inside `schedule.js`. This patch does not change `app.js` or the backend write protocol.

## Verification

The frozen baseline source is commit `2882d4f836d4694c8b445f91f52d64df943cf213`. The candidate source manifest is `4ba6aa9b5c8699835af3ae6aaec01218dd7c74972071f334cc179c4c2dc34b68`, covering 193 files. All six changed source/test files have identical baseline bytes at that commit and the published native-control commit `1562c8ea0326b31f34386925ac55f44f9f9328b1`.

| Check | Result |
| --- | --- |
| Original callback client requirements on the old source | 31 passed |
| Original callback client requirements after receipt guards and fixture correction | 31 passed |
| New guard regressions against the old source | 6 failed as expected |
| Advanced replay controls against the old source | 2 passed |
| Candidate callback client state checks | 38 passed |
| Candidate platform client state checks | 38 passed |
| Candidate callback store checks | 72 passed |
| Candidate callback API checks | 14 passed |
| Candidate parent integrity checks | 11 passed |
| Candidate report integrity | Source unchanged during execution, no infrastructure errors |
| Selected callback browser suite | 16 owned methods collected, no execution |

The original 31 callback client test bodies and assertions remain byte-identical. Their helper now emits complete parent records, advancing task revisions, normalized notes, terminal metadata and current contact restrictions, matching the backend response contract. The 37 preexisting browser class methods, including helpers, retain identical parsed bodies.

The new API regression passes real store/API receipts into the client validator. It covers fresh creation, rescheduling, parent-only advancement after opt-out, cancellation, and current-state replay of earlier creation and rescheduling commands without another mutation.

Independent review found two valid backend receipts rejected by the first candidate: a timestamp crossing into an extended year and a replay from an archive-valid legacy request at the maximum safe revision. Two store regressions reproduce those rejections against the first candidate and pass after correction. Their fixtures pass the existing archive validator. The first candidate's 171-pass record is preserved and superseded by the 173-pass result.

The final independent review passed the corrected source, checked both original counterexamples and passed 41 focused client/API/store cases. That review preserves the original failed observations and adds no portfolio test credit.

The new browser journey commits through the real API, corrupts one parent audit array and one update task ID at the response boundary, and requires preserved drafts followed by matching same-key replays. It requires one stored task, its original ID, task revision two and exactly two parent revision increments. It has been collected and syntax checked. It has not passed in a browser yet.

The machine-readable records are `docs/evidence/callback-receipts-local-2026-11-23.json` and `docs/evidence/callback-receipts-repair-2026-11-23.json`. The local development results receive no additional portfolio credit and do not replace a clean committed CI result.

Reproduce the focused checks with:

```sh
node --test tests/callback-schedule-client.test.cjs tests/platform-client-state.test.cjs tests/callback-tasks.test.cjs tests/callback-tasks-api.test.cjs tests/callback-task-parent-integrity.test.cjs
python tests/release_platform_runner.py --suite callback --list --output /tmp/callback-receipts-collected.json
```

## Root integration

The reviewed files integrate unchanged on `1562c8e`, with combined manifest `63d709515f0a3c44fa9b4369cbc18e772119bd9f8465ee225ef844b4e5d1f05e` across 200 files. The root full run passes 9,274 and explicitly skips nine disabled socket cases. Those exact nine pass after enabling the existing local setting on the same source. The union has 9,283 distinct verified checks, including 9,105 product and 178 excluded harness cases. All 9,094 prior product IDs remain. Keep the full run and supplement separate. [Root record](evidence/callback-receipts-root-integration-2026-11-23.json).

## Remaining work

Run the changed source through the existing CI platform matrix and the new browser journey. Keep prior native Safari and Windows Firefox failures open until their own source-bound evidence resolves them.

The audit also reproduced a separate `app.js` request-save defect. `saveLead` accepts a response for another request and accepts a non-advancing revision, then replaces the current edit and reports success. That defect remains for the next milestone. The current patch only guards callback task receipts.
