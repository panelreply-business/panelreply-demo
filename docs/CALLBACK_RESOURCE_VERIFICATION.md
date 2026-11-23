# Callback resource verification

## Result and source

The candidate removes repeated history reads from the callback queue and repeated operation-ledger scans from backup validation. It preserves schema 4, indexes, API fields, contact rules and archive rejection requirements.

The baseline is commit `1f7b6dc766d8d59b351c09d44d2a138a24583ccb`. The candidate is an uncommitted change based on the same commit. Both workload runs retained unchanged runtime-file hashes during execution. The [evidence record](evidence/callback-resource-verification.json) contains those hashes, the full candidate working-tree manifest, raw results and test logs. Full integrated regression and committed-source CI remain required.

This is a synthetic Linux development-host result. It does not establish selected-host capacity, a service-level objective, physical-device support or release approval. It adds no test-count credit by itself.

## Measured behavior

The workload held 500 requests, 2,000 tasks and 20,000 callback operations. Each request contained 20,000 transcript characters. Each task contained 2,000 note characters. The transcripts and notes used U+6F22 to exercise UTF-8 storage. All tasks were scheduled at revision 10. Requests were at revision 41. The read order placed 500 different requests in each 500-task page.

| Operation | Baseline | Candidate |
| --- | ---: | ---: |
| Full database validation | 25,649.40 ms | 750.83 ms |
| Encrypted backup | 74,448.31 ms | 3,579.42 ms |
| Encrypted restore | 47,206.85 ms | 2,121.99 ms |
| 500-task queue, component median | 307.14 ms | 19.02 ms |
| 20-task HTTP page, median | 17.43 ms | 6.44 ms |
| 100-task HTTP page, median | 76.74 ms | 11.07 ms |
| 500-task HTTP page, median | 265.56 ms | 49.72 ms |
| 12 clients reading 500 tasks each | 2,592.17 ms | 426.27 ms |
| Health request during that burst | 2,586.96 ms | 426.00 ms |
| JSON export | 1,194.19 ms | 868.95 ms |

The 500-task queue previously materialized 10,000,000 transcript characters and 20,500 audit rows that the response did not use. The candidate materialized zero transcript characters and zero audit rows. Both returned 3,267,478 bytes for that page.

Observed callback-process resident memory after the request workload fell from 240,017,408 to 74,870,784 bytes. These are observations at the measurement point, not peak-memory guarantees. The maximum event-loop delay recorded during the workload fell from 2,369.78 to 385.88 ms.

Each successful run made 39 queue HTTP requests, one JSON export and one expected quota-refused mutation. Both had zero unexpected errors. Archives were 63,942,736 bytes. Exports were 48,839,613 bytes. Backup and restore retained the same record counts.

The two fixtures were generated separately from one captured specification. Random identifiers and password salts differed. Database-byte hashes were not captured before those temporary fixtures were removed. The comparison therefore uses the specification and generator hashes, not a claim that the databases were byte-identical. Host scheduling, cache state and garbage collection were not controlled. Fixture specification SHA-256: `f754b5b4e6022a1ed29c548bf544d94165a0a1661749c5010c2945f805eabac9`.

## Implementation and correctness

`callbackLeadSummary` reads the request's name, phone, revision, status and contact restrictions within the callback read snapshot. It retains the business predicate and shares contact-permission and suppression logic with the existing full request reader. Queue and task-export reads no longer fetch conversations or audit histories. Full request reads and business exports still include their required histories.

Archive validation reads task identities and parent revisions into a map and scans operation metadata once. It checks the same task/business/request relationships, retry-key and digest syntax, timestamp ranges, revision counts, audit sequence and terminal-state requirements. Task, audit and operation map sizes are bounded by the existing 20,000-operation limit. No schema migration, index or archive-format change is needed.

The focused command passed 116 tests with zero failures or skips. Five new resource cases cover history-free queue reads, each contact restriction, task export without duplicate history reads, bounded validation statement counts, and an actual near-capacity encrypted backup/restore. The capacity case verifies all 2,000 task identities across four pages, all three task states, transcripts, audit histories, retained STOP restrictions, tenant boundaries, disabled restored passwords and the operation quota. It is one integration case. Its fixture records are not individual test executions.

Independent review passed 75 overlapping cases with zero failures or skips. All 16 existing archive-corruption mutations remained rejected. The review found no auth, consent or tenant-boundary regression. The 75 observations must not be added to the 116 as distinct coverage.

The new resource test requires the private POSIX SQLite environment. It does not enter the Windows-portable suite. Its assertions check resource behavior and correctness. There is no hardware-dependent latency threshold.

## Excluded attempt

The [first workload attempt](evidence/callback-resource-excluded-attempt1.json) stopped because its fifth 500-row read used offset 2000 and expected 500 rows. The application correctly returned an empty page. The harness now wraps the offset within the 2,000-task fixture. That failed attempt remains recorded and is excluded from the before/after comparison and test goal.

## Reproduce

From the repository on Node 24 and a private POSIX filesystem, run:

```sh
PANELREPLY_BENCHMARK_LABEL=review node scripts/callback-workload.cjs
```

The script creates temporary synthetic records, starts the callback product on loopback, measures the workload, verifies expected results and removes the temporary data. It writes `artifacts/callback-workload-review.json`. It never enables a provider, calls a customer or deploys a service.

Set `PANELREPLY_BENCHMARK_ROOT` to another checked-out implementation to compare revisions, and `PANELREPLY_BENCHMARK_OUTPUT` to choose the evidence file. The reusable script captures the checkpointed SQLite database SHA-256 and size for future runs, alongside runtime hashes before and after execution. The exact harness used for the recorded observations is preserved as text in the evidence directory.

The reusable harness applies a 15-second timeout to every HTTP fetch and rejects redirects. Child shutdown has a 10-second deadline, with termination and kill signals after 3 and 7 seconds. Runtime-source changes cause a failing observation and nonzero exit.

A [candidate-only smoke](evidence/callback-resource-final-harness-smoke.json) of the final reusable script completed with zero unexpected errors, unchanged runtime hashes and clean child shutdown without forced signals. It captured fixture database SHA-256 `0ae46edeba169232b81898aa0bbea05d2338008b3e6bff832bbc2f696d3366d8`. The timeout, forced-termination and runtime-mutation branches were reviewed but were not separately fault-injected in that smoke.

The original paired timings came from the separately preserved harness version. The final smoke verifies the reproducible harness and adds no goal credit. A future measurement must identify its own script hash, fixture identity and source revision.
