# Bounded HTTP, storage and recovery verification

## Current synthetic HTTP result

[Run68, job136023013671](https://github.com/panelreply-business/panelreply-demo/actions/runs/44656230988/job/136023013671) executed the real loopback HTTP workload from source `91c5553fbe4ac97fcfcf8991da7c0c6cca41fbf7`. It passed all nine workflow groups. Twelve authenticated clients in two businesses completed 516 responses with zero unexpected errors. Seed data contained 220 projects and 300 requests. All data and images were synthetic. No Render endpoint was load-tested.

The workload includes 480 concurrent list/save/export operations, eight writers competing for one saved version, four simultaneous native OCR requests, foreign-tenant denial, separate-connection SQLite contention, an interrupted body, a same-key retry, session expiry, an in-process HTTP/store restart, encrypted restoration and operator password recovery. Seven stale writers and three excess OCR requests received their expected rejections. Interrupted submission created no partial request. Retrying it created one request, producing 301 final requests.

| HTTP operation | Samples | Median | p95 | Maximum |
| --- | ---: | ---: | ---: | ---: |
| Project list | 96 | 39.604 ms | 63.774 ms | 71.783 ms |
| Request list | 96 | 56.005 ms | 84.710 ms | 86.000 ms |
| Save | 96 | 49.118 ms | 75.398 ms | 76.908 ms |
| Saved 200-row CSV | 96 | 19.539 ms | 27.549 ms | 31.417 ms |
| Saved 200-row XLSX | 96 | 48.221 ms | 67.580 ms | 75.087 ms |
| Authentication | 14 | 190.107 ms | 321.424 ms | 321.424 ms |

The complete bounded workload took 5,345.479 ms on the Linux CI runner with Node22.23.4. Node process CPU measured 5,438.553 ms user and 388.197 ms system. Process high-water RSS was 228,061,184 bytes. The 20 ms sampler also observed that value. These totals include the HTTP server and clients in one Node process and exclude native OCR child CPU/RSS. They are not a hosted capacity or latency commitment.

The synthetic data directory grew from 259,376 to 5,037,680 bytes after seeding, including SQLite sidecars. At the later pre-restart sample it was 3,953,472 bytes. The restored directory was 950,272 bytes after vacuuming and credential/session handling. Logical record and image hashes, not equal database file sizes, establish integrity.

The HTTP server and database reopened in the same Node process in 15.313 ms. This is not an OS-process crash or host restart. Encrypted backup took 232.361 ms and authenticated restore took 219.942 ms, each one sample. All twelve logical-table digests and the source image matched after restart/restore. Separate checks rejected restored sessions until explicit owner password recovery. Deletion, restrictions and usage metadata have additional nonempty backup fixtures in the repository suite.

[Full HTTP measurements and integrity digests](evidence/remediation-run68-http.json). [Current local storage drill](evidence/remediation-storage-workload.json). The current local schema-3 storage drill passed five workflow groups with 204 projects, 301 requests and five images. Its measured duration was 8,367 ms. It is recorded separately from the CI HTTP result and the historical drill below.

## Historical storage-only checkpoint

The following November19 measurements precede the schema-3 remediation. They are retained for comparison and are not measurements of the new HTTP workload.

Date: 2026-11-19. Tests use temporary synthetic SQLite databases and existing application code. They open no HTTP listener, contact no service and use no real customer record.

## Concurrent writers

`tests/prelaunch-concurrency.test.cjs` passed six cases with zero failures. Each competing operation runs in a separate Node worker with its own real SQLite connection. A shared start barrier releases the writers together. The tests do not substitute synchronous calls in one event loop for actual competing connections.

| Case | Verified result |
| --- | --- |
| Four identical project creates | One created record, one ID, three idempotent retries and exact saved strings |
| Four identical request creates | One request, one transcript and one creation audit event |
| Two edits from the same project version | One accepted version, one `version_conflict`, winning data retained |
| Four identical image retries | One private source, one version increment and exact image bytes |
| Two businesses sharing the same retry key | Two independent records, no cross-business read/export |
| Termination during an uncommitted write | Uncommitted data invisible to the reader, rollback after worker termination, unchanged saved project and passing SQLite integrity/foreign-key checks |

These are bounded writer races, not sustained many-user capacity tests. The interruption uses worker termination while a SQLite connection owns an uncommitted transaction. It does not simulate disk failure, power loss or remote storage faults.

## Storage and recovery drill

`scripts/prelaunch-stress.cjs` completed one bounded drill with zero unexpected errors. It checks five workflow groups. Operation repetitions and internal assertions are measurements, not additional independent test cases.

Workload:

- Two businesses and two owners.
- 204 projects: 200 for one business and four for the other.
- 301 requests, including a safety-hold fixture, plus transcripts and audit records.
- One 200-row project, five source images and 100 repeated saves.
- 100 CSV exports of the saved 200-row project.
- Twenty passes through a 240-request list and 200-project list.
- Five database close/reopen cycles.
- Five sessions before backup, a stored phone opt-out and a login-attempt fixture.
- Three expected capacity rejections: project count, image count and row count.

Fictional names and 555-0100–0199 callback numbers are generated locally. No message, appointment or provider request is sent.

[Machine-readable workload, timings, source hashes and per-business integrity digests](evidence/prelaunch-stress.json).

### Measured local timings

Node v24.22.3 on the Linux development machine. Times measure synchronous storage operations or the stated recovery operation. They exclude browser rendering and network latency.

| Operation | Samples | Median | p95 | Maximum |
| --- | --- | --- | --- | --- |
| Project create | 204 | 0.228 ms | 0.760 ms | 5.408 ms |
| Request create | 300 | 0.179 ms | 0.436 ms | 6.198 ms |
| Source attach | 5 | 3.043 ms | 7.099 ms | 7.099 ms |
| Save 200 rows | 100 | 1.342 ms | 2.235 ms | 4.017 ms |
| CSV export, 200 rows | 100 | 0.547 ms | 1.177 ms | 2.092 ms |
| List 240 requests | 20 | 13.752 ms | 28.407 ms | 29.010 ms |
| List 200 projects | 20 | 1.443 ms | 1.954 ms | 1.983 ms |
| Database reopen | 5 | 1.597 ms | 2.028 ms | 2.028 ms |

The encrypted backup took 312.757 ms and restore took 347.268 ms, each measured once. Their single samples are not latency distributions. The entire drill took 2,615 ms. Node process CPU was 2,543 ms user and 214 ms system. Observed RSS grew from 39,251,968 to 89,870,336 bytes, with process peak RSS 120,672 KiB. These are observations, not service limits or hosting estimates.

The source directory grew from 168,736 to 1,242,224 bytes, including SQLite sidecars at the sample time. The encrypted archive was 995,408 bytes. The restored directory was 995,328 bytes at the later sample point. Backup vacuuming and sidecar state mean these file sizes need not match. Record and source-image digests, rather than equal database file size, establish recovery integrity.

## Recovery evidence

The drill creates an encrypted archive, restores into a fresh private directory and compares canonical SHA-256 digests for each business. The digest covers profile facts, user identities, exact request data, transcripts, audit records, opt-outs, projects and source-image bytes. Image BLOBs are represented by their length and SHA-256. Sorting removes incidental row order, without trimming or changing saved strings.

Password hashes, sessions and login attempts are excluded only from the expected restored business-data digest because recovery intentionally changes them. Separate assertions verify both password hashes are disabled, all sessions and login-attempt rows are absent, old credentials fail, and an operator reset permits only the chosen owner to sign in. The other owner remains disabled.

The complete source database, including credentials and sessions, is hashed separately before and after backup/restore and is unchanged. CSV export hashes and every restored image byte also match. Consent suppression and the safety hold survive recovery. Cross-business project, source and export reads still fail.

The artifact includes the tested harness, store and backup SHA-256 values. Its generated IDs and timestamps belong to that run only. Future runs should compare source/restored values within the same run, not expect new synthetic UUIDs to equal this historical file.

## Reproduction

```bash
node --test tests/prelaunch-concurrency.test.cjs
node scripts/prelaunch-stress.cjs /tmp/panelreply-stress-result.json
```

Both commands require the supported Node built-in SQLite runtime. They create and remove only their own temporary synthetic directories. The concurrency helper caps each batch at eight workers and includes worker/barrier timeouts. The workload has fixed finite counts and does not touch Render or shared databases.

## Remaining limits

HTTP request saturation, hosted disk behavior, multi-process deployment capacity, operating-system crashes, storage exhaustion, offsite backup restoration and operational recovery objectives are not established by this drill. Existing unit/API/browser regression evidence and failure-injection tests remain separate layers. No throughput, customer-capacity or recovery SLA is claimed.
