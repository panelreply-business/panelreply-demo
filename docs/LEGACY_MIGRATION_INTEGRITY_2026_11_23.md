# Legacy request migration integrity

Recorded November 23, 2026. This incremental repair follows the staged copy of the current integrated runtime based on `1b35490335203348572e938bcc30dfc0f05d93e1`.

## Reproduced failure

The legacy upgrade propagated a safety hold to another saved request at the same contact point without checking whether its timestamp or revision could advance. Startup committed the migration and returned success even when the resulting request could no longer pass recovery validation.

Both counterexamples started from a valid schema-2 database containing a held request and an unheld request at the same phone number.

- With the workspace clock one second behind the saved creation time, migration wrote `updatedAt: 2026-11-23T14:59:59.000Z` below `createdAt: 2026-11-23T15:00:00.000Z`. Schema 4 committed. Backup validation then returned `invalid_database`. Correcting the clock did not make the record writable because its stored chronology was already invalid.
- With the affected legacy request at the accepted revision `9007199254740991`, migration wrote `9007199254740992`. Schema 4 committed. Backup validation failed and reading the request raised `ERR_OUT_OF_RANGE`.

The failure affects controlled upgrades and recoverability. It requires no customer data or external service to reproduce.

## Repair

Migration now identifies every request that requires safety propagation before creating tables or changing records. The target set includes both existing schema-3 hold digests and held legacy request records. Contacts remain scoped to their business.

The same pure clock and revision guards used for ordinary request mutations now also serve migration. They moved to module scope so startup can call them before opening the current runtime's mutation interface.

Each affected request must have valid stored timestamps. The captured migration time must be at least its latest update. Its next live revision must remain below `Number.MAX_SAFE_INTEGER`. The guards run inside the existing transaction and before DDL, hold insertion, request changes or audit insertion.

Successful migration retains the required safety propagation and records one audit entry for each affected request. Existing fields, conversation history and earlier audit entries remain intact. A current-schema reopen does not run migration again.

## Boundaries and compatibility

| Condition | Result |
|---|---|
| Invalid migration clock or clock before an affected request's latest update | Controlled `503 clock_unavailable` |
| Invalid affected request chronology | Controlled `409 request_metadata_invalid` |
| Affected revision cannot advance within the supported live range | Controlled `409 version_exhausted` |
| Affected revision `MAX_SAFE_INTEGER - 2` | Advances to `MAX_SAFE_INTEGER - 1` |
| Unaffected or already-held legacy record at `MAX_SAFE_INTEGER` | Remains readable and valid for recovery |
| Existing schema-3 hold digest | Retains its saved timestamp and contact restriction |
| Reopen after successful migration | Keeps revisions and history unchanged |

Rejected migrations preserve the schema, schema version and all logical records. Startup can change journal mode, WAL files or connection pragmas before rejection. This evidence does not claim identical SQLite-file bytes.

An exhausted propagation target remains blocked for operator review. The preserved legacy store remains readable through the existing recovery-open path and can be backed up. This repair does not reset revisions or alter historical timestamps to force an upgrade.

## Verification

The exact final eight new cases ran against the staged runtime baseline and the repair.

| Run | Passed | Failed | Skipped |
|---|---:|---:|---:|
| Before migration repair | 2 | 6 | 0 |
| After migration repair | 8 | 0 | 0 |
| Two selected existing migration regressions | 2 | 0 | 0 |

The new cases cover rollback before creation, rollback before a later correction, exhausted revisions, multi-row and business isolation, the last supported live increment, unaffected terminal records, existing schema-3 holds, encrypted recovery after rejection, invalid clocks, and idempotent reopen.

The multi-row case places an unsafe target after an earlier writable request. Failure leaves the earlier request, other business, audit history and schema unchanged. No new safety-hold table or digest is committed. The recovery case restores the rejected legacy store, compares the saved request and spreadsheet project, then completes safety propagation after clock recovery.

```bash
node --test --test-reporter=tap tests/migration-request-integrity.test.cjs
node --test --test-reporter=tap --test-name-pattern='legacy schema 2 archive|schema3 migration adds scheduling' tests/data-lifecycle.test.cjs tests/callback-tasks.test.cjs
```

The independent review found no preservation or safety regression. It confirmed that preflight precedes DDL and writes, existing digests remain inputs, the pure guards moved unchanged, and current-schema reopen introduces no repeated increment.

[Verification evidence](evidence/legacy-migration-integrity-2026-11-23.json) records the original counterexamples, source hashes, exact test identities, results and review. There are eight new product cases. Repeated executions and review receive no duplicate goal credit.

## Remaining scope

The final integrated Node/API/HTTP candidate passes 9,192 checks with unchanged source and zero failures/skips; [combined evidence](evidence/integrity-local-2026-11-23.json). Committed-source platform CI remains required. These executions used synthetic schema-2 and schema-3 stores. They do not repair already-corrupted historical records or establish production migration, hosted recovery or release readiness.
