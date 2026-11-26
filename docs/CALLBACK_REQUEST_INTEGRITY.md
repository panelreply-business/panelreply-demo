# Callback request mutation integrity

November 23, 2026. Candidate based on `e711d15d418406969631202642c9d055b47afca5`, with the callback text-preservation patch applied first.

## Reproduced failures

Request changes could report success after a clock rollback, leaving `updated_at` before `created_at`. STOP and safety propagation could also increment a previously valid terminal request revision into an unsafe integer. Later reads or backup validation then failed. The archive validator accepted request timestamps beyond the JavaScript Date range and could publish a restored database whose requests could not be read.

The repair captures one valid operation time and checks every affected request before writing. STOP and safety propagation preflight the complete set within the existing transaction. A rejected operation changes no request, restriction, transcript, task, audit or deletion receipt. API previews return the explicit persistence error before invoking the provider.

## Boundaries and compatibility

| Operation | Required state |
| --- | --- |
| New timestamp | Safe integer milliseconds from `0` through `8640000000000000` |
| Request mutation | Time at or after the current `updated_at`, with valid stored creation/update chronology |
| Live revision increment | Current revision below `Number.MAX_SAFE_INTEGER - 1` |
| Existing request read or recovery | Positive safe revisions through `Number.MAX_SAFE_INTEGER` remain accepted |
| Whole-request deletion | A current revision of `Number.MAX_SAFE_INTEGER - 1` may produce the safe terminal deletion receipt |
| Conversation deletion | Follows the live revision bound because the request remains stored |
| Exact create or deletion retry | Returns its saved result before checking mutation clock or revision bounds |
| Repeated recorded restriction | Succeeds without new writes when no affected records remain |

Equal timestamps remain valid. One timestamp now identifies the request, restriction and associated audit writes for an operation. A backward or invalid clock returns `503 clock_unavailable`. Exhausted live revisions return `409 version_exhausted` before writes.

No schema changes or existing-data rewrites occur. Archive validation rejects invalid request timestamp range/chronology and invalid suppression timestamps before publishing a restore. Epoch-zero timestamps and existing safe terminal request revisions remain readable after encrypted recovery. Malformed earlier archives require an operator data review, and their source files remain intact.

The shared profile/session and spreadsheet paths are separate milestones. This patch does not change their behavior.

## Verification

The twelve new regression methods all failed on the prior runtime. All twelve pass after repair. The affected regression passes 428 methods with zero failures, skips or cancellations on Node 24.22.3, Linux x64. The focused twelve overlap those 428 and must not be added to that total.

The new methods verify whole-transaction rollback across multiple requests, two-business isolation, pending task preservation, exact retries during invalid clocks, the last supported live revision, terminal recovery compatibility, single-operation audit timestamps, malformed archive rejection before publication, and source/temporary-file preservation. A fake-provider API case returns explicit `409` or `503` errors for failed STOP and safety persistence with zero provider invocations and no partial request, restriction or audit changes.

The affected regression includes existing task concurrency, deletion, assistant restriction, authenticated API, product-bound archive and near-capacity recovery cases. It ran with `WORKSPACE_HTTP_TESTS=1`. Synthetic fixture clocks are explicit and do not depend on execution before a calendar deadline.

An independent read-only runtime review found no concrete defect in the preflight/transaction order, tenant predicates, clock capture, retry order, terminal deletion or safe existing revision compatibility. Archive timestamp checks align with public Date serialization.

The [source-bound evidence](evidence/callback-request-integrity-2026-11-23.json) preserves the source manifests, file hashes, commands, original failures and complete test logs. A focused replay is:

```sh
node --test tests/callback-task-parent-integrity.test.cjs
node --test --test-name-pattern='authenticated archives with invalid request chronology' tests/workspace-backup.test.cjs
```

This is local synthetic Node/SQLite, API and recovery evidence. Browser engines, physical devices, real providers, production data and hosted capacity are not established by this result. Integration with the other active repairs and platform CI remain required.
