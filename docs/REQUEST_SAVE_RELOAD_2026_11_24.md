# Owner-requested reload after an uncertain save

## Result

The request screen now offers a saved-version reload while a save remains unconfirmed. The owner must confirm the discard choice. The client keeps the draft and pending payload until a complete current record passes validation.

This is an incremental follow-up to the frozen request-receipt candidate. It changes five lines in `app.js`, adds one notice to `index.html`, and adds one state method and one browser journey. The earlier candidate and its evidence remain unchanged in their original worktree.

## Reproduced blocked state

On the earlier candidate, a lost save result followed by a permanent 400 or 403 kept the form locked on `Retry save`. Only a later version conflict triggered a readback. The existing reload control stayed hidden, and its handler required the conflict flag. The owner could not request a validated reload through the page.

The [counterexample](evidence/request-reload-counterexample-2026-11-24.json) records two PATCH attempts, the retained draft, locked fields, hidden conflict and discard controls, and zero GET readbacks after initial load. It binds to the frozen candidate source `c57a66e3ef4c2c52800c6ccf37059f190efa42116c7fa38ddc5ae4fc583f068c`.

## Behavior

An unconfirmed-save notice now provides `Reload saved version`. It appears after an uncertain result and keeps its wording separate from a confirmed version conflict. `Retry save` remains available.

Choosing reload opens the existing discard explanation. Cancelling that choice keeps the draft and makes no read request. Confirming it reads the current record through the existing validation path. A failed or wrong-record response retains the pending command and every draft value. The reload control remains available for another owner-requested attempt.

The owner may load a valid current record at the original revision. That is a discard and reload choice, not save confirmation. The status continues to say `Saved version loaded. Previous save outcome not established`. Automatic saved-value confirmation still requires a later revision and matching normalized fields.

The control disables during save and reload requests. The field lock, fixed retry payload, task guards, contact restrictions, response validators and backend policy remain unchanged.

## Verification

| Check | Result |
| --- | --- |
| New state method against frozen candidate | 0 passed, 1 failed |
| Final affected Node checks | 153 passed, 0 failed, 0 skipped |
| Infrastructure errors | 0 |
| Source changed during final run | No |
| Existing state methods preserved | 46 |
| Existing browser class methods preserved | 39 |
| Callback browser methods collected | 18 |
| Browser or native executions | 0 |
| Additional portfolio credit | 0 |

The state method covers a lost result followed by 400 and an invalid success receipt followed by 403. It checks cancel, no automatic GET, a mismatched current-record response, retained state during a held read, disabled duplicate actions, and successful owner reload at the unchanged revision. Both original PATCH bodies remain identical.

The browser journey uses the callback entrypoint and page controls. Two simulated write refusals leave the actual stored record untouched. It cancels the first reload choice, corrupts one real API readback's request ID, and requires the next explicit read to load the actual saved record. It checks zero update audit entries, unchanged stored values, retained draft after the bad response and the absence of a save-success claim. The journey is syntax checked and collected. It has not passed in a browser yet.

The [before report](evidence/request-reload-before-node-2026-11-24.json), [final report](evidence/request-reload-after-node-2026-11-24.json), raw logs and [preservation record](evidence/request-reload-preservation-2026-11-24.json) remain separate. The final isolated source manifest is `ce3559584e2ac45fea536cfd15a96ddfc9de3255103ad85497b0a16c7086dc4c`.

Run the affected Node files with:

```sh
node --test tests/platform-client-state.test.cjs tests/workspace-api.test.cjs tests/callback-schedule-client.test.cjs tests/callback-tasks-api.test.cjs tests/product-ui.test.cjs
```

The final passing count consists of 47 state methods, 20 workspace API methods, 38 callback client methods, 14 callback task API methods and 34 product UI methods. The new case is one method despite checking more than one failure path.

## Integration and remaining limits

Apply this incremental patch after the frozen 25-file request receipt patch. Its diff excludes that staged baseline. Root integration, committed-source CI and the new browser journey remain required.

A missing, unreadable or invalid current record still cannot complete a validated reload. The client retains the draft and does not invent a deletion or save receipt. Browser termination can still lose an in-memory draft. This change adds no private local storage and makes no claim about the execution of a lost PATCH command.
