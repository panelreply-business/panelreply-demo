# Callback detail and list snapshot repair

## Defect and scope

On source `7a0a93aee098918de7bac251fc7eb929ffec16f3` plus the separately verified spreadsheet read-snapshot repair, callback detail and list reads could combine different saved states. `getLead()` and `listLeads()` selected request rows, then fetched suppression, conversation and audit records through separate autocommit queries.

Coordinated commits from a second store connection reproduced five failures. A status or note edit returned the earlier revision and values with the later edit audit. Conversation deletion returned an earlier revision with an empty transcript and a deletion audit from the next revision. Safety holds and STOP could likewise mix saved request values with later contact or audit state. A list could combine earlier records with later metadata for another record.

The regression uses synthetic product-bound callback databases and two real SQLite connections. The test hook waits until the actual native query has returned, then commits a public mutation through the second connection. It does not fabricate rows, audits, safety flags, transaction outcomes or API responses.

## Repair

The shared `readSnapshot()` helper in `workspace/store.cjs` now covers each complete `getLead()` and `listLeads()` read. It starts a deferred transaction only when the connection has no transaction. It commits or rolls back only the transaction it started. A caller-owned read or write transaction remains open and unchanged.

`getPanelProject()` uses the same helper with the behavior already verified in the preceding spreadsheet milestone. `exportBusiness()` keeps its existing outer transaction. Its nested request reads reuse that snapshot. Callback task summaries already run inside their task read transaction and remain unchanged.

The response represents the saved state observed by its read. Another connection may commit immediately afterward. New task and status mutations still check the current saved revision, STOP suppression and safety hold within their existing mutation transaction. The regression confirms that stale revisions fail and that current-revision writes remain blocked after STOP or a safety hold.

## Verification

The unchanged eight-case regression file produced these before and after outcomes.

| Case | Before | After |
| --- | --- | --- |
| Detail status and notes remain consistent with revision and audit during an edit | FAIL | PASS |
| Conversation deletion cannot mix an earlier revision with a later transcript and audit | FAIL | PASS |
| Whole-list snapshot during a safety hold, followed by current mutation checks | FAIL | PASS |
| Detail snapshot during STOP, followed by current contact checks | FAIL | PASS |
| Later list records remain in the first record's snapshot | FAIL | PASS |
| Failed detail and list reads release owned transactions without writes or stale later reads | PASS | PASS |
| Caller-owned read transaction survives concurrent deletion and a missing-record error | PASS | PASS |
| Business export retains its outer snapshot through nested reads and a concurrent hold | PASS | PASS |

Final baseline: 3 PASS, 5 FAIL, no skipped or cancelled cases. An earlier development run had an invalid test mutation missing its required status field. That harness mistake was corrected before the final baseline and is excluded from defect and passing-case claims.

The focused callback and spreadsheet selection passed all 15 methods. The final affected selection passed 275 methods with 0 failures, 0 skips and 0 cancellations on Linux x86_64 with Node v24.22.3. It covers callback store/API/export/revocation/task paths, parent integrity, lifecycle, concurrency, shared panel writes and product-bound recovery. `WORKSPACE_HTTP_TESTS=1` enabled the existing loopback recovery startup checks.

The eight new callback cases and the preceding seven panel cases are included in 275. The focused run overlaps that selection and adds no distinct cases. No claim of cross-platform completion follows from this local run.

The source manifest stayed `70614530233fbb49a32fa8d5d41797b69e4ceaf90626562cb66d65285bb22776` before and after the final selection. This identifies the isolated candidate, not a later integrated commit. [Machine-readable evidence](evidence/callback-read-snapshot-2026-11-23.json) records the baseline, source hashes, commands, individual outcomes and logs.

Independent read-only review found no concrete transaction-ownership, contact-restriction or test-hook issue. The review added no test executions.

Reproduce the new regression:

```sh
node --test --test-reporter=tap tests/workspace-conversation-snapshot.test.cjs
```

Reproduce the affected selection:

```sh
WORKSPACE_HTTP_TESTS=1 node --test --test-reporter=tap tests/workspace-conversation-snapshot.test.cjs tests/panel-read-snapshot.test.cjs tests/workspace-store.test.cjs tests/workspace-api.test.cjs tests/workspace-export.test.cjs tests/workspace-revocation.test.cjs tests/callback-tasks.test.cjs tests/callback-tasks-api.test.cjs tests/callback-task-parent-integrity.test.cjs tests/data-lifecycle.test.cjs tests/prelaunch-concurrency.test.cjs tests/panel-store.test.cjs tests/product-backup.test.cjs
```

## Remaining limits

- A returned snapshot can become stale after its read. It does not authorize a later contact or mutation.
- Actor checks, tenant predicates, revision rules, contact restrictions, session policy, audit writes and persistence formats are unchanged.
- The patch establishes a SQLite read boundary. It does not establish filesystem path stability, Windows native storage, host durability or real customer acceptance.
- The integrated source still requires its full regression and committed-source CI. No production data, provider, public deployment or release action occurred.
