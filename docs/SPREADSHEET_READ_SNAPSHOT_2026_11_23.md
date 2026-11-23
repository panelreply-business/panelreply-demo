# Spreadsheet read and export snapshot repair

## Defect and scope

On committed source `7a0a93aee098918de7bac251fc7eb929ffec16f3`, project detail and both spreadsheet exports could combine two saved revisions. `getPanelProject()` fetched the project row, then fetched source metadata in a separate autocommit query. Another connection could commit source deletion between those queries.

A coordinated local reproduction returned revision 3 with a reviewed row referencing an image absent from the response. The committed database held revision 4, with the source removed, the link cleared and the row unreviewed. CSV silently emitted the reviewed row without its source filename. XLSX rejected the mixed record with `xlsx_invalid_data`. Whole-project deletion and a new source upload also produced mixed project/source responses.

The regression uses synthetic product-bound databases and two real SQLite connections. Its hook runs after the native project-row query returns, then commits through the other store's public mutation method. The hook does not fabricate query results, project data, exported bytes or transaction outcomes.

## Repair

`workspace/store.cjs:getPanelProject()` now reads the project row and source metadata within one deferred read transaction. Both exports already obtain their saved record through this method, so they receive the same consistent boundary.

When the caller already owns a transaction, the read uses it. It does not issue a nested `BEGIN`, commit caller work or roll back the caller's snapshot. Otherwise it commits or rolls back only the read transaction it started. A missing project or failed source-metadata query leaves the connection ready for later reads and writes.

A read that starts before deletion can return the complete earlier snapshot. A subsequent read sees the committed deletion or later revision. Source downloads remain subject to the current stored source record, so a later request for a deleted source returns not found. This repair does not promise that a returned snapshot remains current after it is read.

## Verification

The final seven-case regression file has the following before/after results.

| Case | Before | After |
| --- | --- | --- |
| Project detail during source deletion | FAIL | PASS |
| CSV during source deletion | FAIL | PASS |
| XLSX during source deletion | FAIL | PASS |
| Project detail during whole-project deletion | FAIL | PASS |
| New source cannot appear under the preceding revision | FAIL | PASS |
| Existing outer read transaction survives successful and missing-record reads | PASS | PASS |
| Owned read failure releases its snapshot without writes or stale later reads | PASS | PASS |

Baseline: 2 PASS, 5 FAIL, no skipped or cancelled cases. The baseline used an export of the committed index plus the unchanged new regression file.

Final affected selection: 191 PASS, 0 FAIL, 0 SKIP, 0 CANCEL, on Linux x86_64 with Node v24.22.3. This includes the seven new cases, existing panel store/API/XLSX and mutation-recovery cases, lifecycle and concurrency checks, product-bound encrypted recovery, and actual loopback startup of both restored product entrypoints. The seven new cases are included in 191 and are not added again. Earlier focused/repeated executions are not additional distinct cases.

The source manifest at verification is `90b8d821b43ffdd6e963f5d4f784da14c8f6113acf3b7934914d3ff1436cfa26`. This belongs to the isolated candidate based on `7a0a93a`, not to a later integrated commit. [Machine-readable evidence](evidence/spreadsheet-read-snapshot-2026-11-23.json) records hashes, commands, cases and results.

Independent read-only review found no concrete transaction-ownership, failure-cleanup or test-hook issue. That review ran no duplicate tests.

## Inspected boundaries and remaining limits

- Source images remain SQLite BLOBs in the private database. Source lookup selects metadata and bytes together with project and business predicates. It returns a separate Buffer. No image path or URL is read from the client.
- CSV and XLSX still export saved data in memory. Formula handling, text preservation, unknown fields and review requirements are unchanged.
- Existing failed-write tests verify rollback of source, project, audit and deletion state. Product-bound recovery still preserves source bytes and exports, disables copied credentials and rejects the other product binding.
- The change does not establish filesystem pathname stability against external replacement, selected-host durability, Windows private storage, native OCR isolation, actual Excel behavior or physical-device acceptance. Those remain separate requirements.

Reproduce the focused regression:

```sh
node --test --test-reporter=tap tests/panel-read-snapshot.test.cjs
```

Reproduce the final affected selection, including the existing loopback recovery cases:

```sh
WORKSPACE_HTTP_TESTS=1 node --test --test-reporter=tap tests/panel-read-snapshot.test.cjs tests/panel-store.test.cjs tests/panel-api.test.cjs tests/panel-xlsx.test.cjs tests/panel-mutation-recovery.test.cjs tests/data-lifecycle.test.cjs tests/lifecycle-api.test.cjs tests/prelaunch-concurrency.test.cjs tests/product-backup.test.cjs
```

The integrated source still requires its own complete regression and committed-source CI. No production data, provider, deployment or release action occurred in this milestone.
