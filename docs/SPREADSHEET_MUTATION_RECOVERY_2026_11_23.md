# Spreadsheet mutation and recovery repair

Recorded November 23, 2026. Runtime patch based on `e711d15d418406969631202642c9d055b47afca5`.

## Defect and release requirement

A panel correction could succeed while making the saved database fail backup validation.

The first reproducer moved the synthetic workspace clock back one second. The project had `createdAt: 2026-11-23T12:00:00.000Z`. The update returned success at version 2 with `updatedAt: 2026-11-23T11:59:59.000Z`. The previously valid database then failed `validateDatabase` with `invalid_database`.

The second reproducer started from an archive-valid project at version `Number.MAX_SAFE_INTEGER - 1`. The update succeeded and stored `Number.MAX_SAFE_INTEGER`. The project validator rejects that live revision, so subsequent backup validation failed. Upload and source-deletion mutations shared the unchecked increment.

These defects affect [SS-02 and SS-04](SPREADSHEET_RELEASE_ACCEPTANCE.md): saved correction/source integrity, version checks, and recoverable product-bound archives. Fixing these local persistence contracts is within the authorized independent development scope.

## Changes

`workspace/panels.cjs` now supplies two guards used before the first panel mutation.

- A write clock must be an integer from 0 through 8,640,000,000,000,000 milliseconds, matching the public Date range and existing deletion-clock contract. It must be at least the project's latest saved update time.
- An operation that retains a live project must leave its version below `Number.MAX_SAFE_INTEGER`.

Project creation, correction, source upload, source deletion, and project deletion now use one captured clock value for record and audit timestamps. Invalid or backward clocks return HTTP 503 with `clock_unavailable`. A live revision that cannot be incremented returns HTTP 409 with `version_exhausted`.

The guards run before changing rows, image bytes, versions, tombstones, deletion receipts, or audit records. Existing transactions remain in place. Rejected corrections keep the caller's draft unchanged. Rejected source deletion preserves the source links and review state.

## Boundary decisions

| Operation | Boundary behavior |
|---|---|
| Correction, source upload, source deletion | `MAX_SAFE_INTEGER - 2` can advance to `MAX_SAFE_INTEGER - 1` |
| Another mutation that retains that live project | Rejected before mutation with `version_exhausted` |
| Whole-project deletion at `MAX_SAFE_INTEGER - 1` | Allowed with a `MAX_SAFE_INTEGER` receipt, which the existing archive contract accepts |
| Completed create, upload, source-deletion or project-deletion retry | Returns the confirmed result before checking a new clock or revision block |

Whole-project deletion removes the live record. Its terminal receipt and audit are still safe integers. This preserves the existing ability to remove a terminal project and retry that deletion. It does not permit a live project to enter an invalid revision.

The archive validation contract is unchanged. This patch does not rewrite existing rows, infer missing values, change OCR answers, or alter the source image.

## Verification

The exact final 13 new regression cases ran against the unchanged `e711d15` runtime. Three passed and ten failed. The same cases all pass with the repair.

The selected regression command passed 298 tests, with zero failures, skips, cancellations, or TODOs.

```bash
WORKSPACE_HTTP_TESTS=1 node --test tests/panel-mutation-recovery.test.cjs tests/panel-store.test.cjs tests/panel-api.test.cjs tests/panel-xlsx.test.cjs tests/data-lifecycle.test.cjs tests/lifecycle-api.test.cjs tests/product-backup.test.cjs tests/workspace-backup.test.cjs tests/product-boundaries.test.cjs
```

The new cases check:

- One-second clock rollback and rollback after a later saved correction.
- Invalid, fractional, negative, non-finite and out-of-range clock values.
- No partial row, image, audit, tombstone, or deletion-receipt mutation after rejection.
- Preservation of explicit reviewed rows and blank unknown fields.
- Final supported live increments and rejected further increments.
- Confirmed create/upload/deletion retries after later clock or revision blocks.
- Terminal whole-project deletion and exact retry.
- One clock read per operation, shared by record and audit timestamps.
- Controlled errors through the fixed spreadsheet API, with saved exports still available.
- Encrypted spreadsheet-bound recovery with exact rows, original source bytes, CSV and XLSX bytes, disabled copied credentials, and rejection by the callback product.

The broader selection also starts both actual restored product entrypoints on loopback. An earlier narrow run left those two checks unexecuted because the HTTP gate was disabled. The final command enables the gate and passes them. The overlapping runs add no duplicate goal credit.

Evidence is in [spreadsheet-mutation-recovery-2026-11-23.json](evidence/spreadsheet-mutation-recovery-2026-11-23.json). It records the original corruption reproducers, source hashes, the same-test before/after results, and the final regression inventory.

The new file contains 13 product tests. These local dirty-source results still need source-bound CI after integration before they can contribute clean committed goal evidence.

## Integration and remaining work

The store patch touches only panel create/update/upload functions. The lifecycle patch touches only panel/source deletion hooks. The separately owned shared-text validation and spreadsheet client retry repairs can be integrated as separate hunks.

A separate read-only audit found that some existing archive timestamp validators accept values outside public Date serialization limits. That requires its own validator review and evidence. It is not hidden by this runtime guard repair.

The spreadsheet program still requires committed CI, remaining OCR quality work, required worker isolation, representative photographs, actual Excel, and owner-dependent platform and operating acceptance. These tests establish the executed local persistence and recovery behavior.
