# Windows component evidence output repair

The component output runner now rejects canonical repository aliases and existing evidence leaves before source observation or native work. It creates the report, log and observation journal once, retains their descriptors, and verifies their bytes and identities through final closure.

This milestone changes evidence plumbing. It does not establish native Windows storage or product acceptance.

## Reproduced defects

The unchanged runner at `7fec73b7ca7fe323accaf22eb99e11d905f698b3` accepted an outside directory alias that resolved into the repository. The argument check used lexical containment after normalizing the output path. The baseline called only the parser for this alias and created no output in the repository.

A second owned fixture pre-created a report, log and observation journal with sentinel bytes. Running the old CLI with `--build-failed` replaced all three. The resulting report correctly retained 15 `NOT_RUN` outcomes, but the evidence leaves had been overwritten.

Both requirements failed on unchanged source. No native candidate was loaded. Earlier November 23 scratch records were absent after the workspace checkpoint. Their previously recorded hashes remain listed as unavailable history. A new November 24 baseline reproduces the defects from an isolated clean checkout.

## Changes

- Resolve the raw existing parent before joining the output basename. Reject repository descendants, repository ancestors, aliases into source, unavailable parents, reserved device names, alternate data stream names and `release-*` report names.
- Require an existing outside directory. Refuse any existing report, log or journal before creating a sibling.
- Hold three exclusively created descriptors. Do not reopen their pathnames for writes, remove their leaves or repair their permissions.
- Bound report and log output to 4 MiB each and the observation journal to 16 MiB. Verify partial writes, flush results, held readback hashes, file identity, link count, size and mode.
- Preserve created files and each write or close outcome on failure. Final success requires descriptor verification and closure. A structured failure receipt retains observed native outcomes when report writing or closure fails.
- Send observations through Node's intercepted child stdout channel. The child receives a random channel token instead of a journal pathname.
- Require a start frame, sequential records and a terminal count, byte count and SHA-256. Preserve each original JSON observation line in the parent-held journal.
- Bound records to 256 KiB each, the catalog to 4,096 records, a frame to 384 KiB and child stdout to 32 MiB. Support split frames and several frames in one chunk.
- Mark malformed, missing or incomplete framing as evidence failure. Retain native pass, failure and cancellation events already reported by Node.

The native build policy and the 15 native case bodies remain unchanged. The nine original evidence harness executions retain their original bodies and assertions.

## Local evidence

| Attempt | Harness pass | Harness fail | Source unchanged |
| --- | ---: | ---: | --- |
| Initial child transport fixture | 26 | 1 | Yes |
| Empty extra `execArgv` attempt | 26 | 1 | Yes |
| File-invoked child fixture | 27 | 0 | Yes |
| Final with complete-catalog acceptance check | 28 | 0 | Yes |

The failing method was the new synthetic Node child transport check. Its wrapper used `node -e`. Node 24 adds the caller's command arguments to children, so the child reevaluated that wrapper and produced no test methods or observation frames. Providing an empty `options.execArgv` list did not override those inherited arguments. A file-invoked wrapper matches the production CLI and delivers the start frame, three records including cleanup, the terminal digest and the expected synthetic assertion failure. The two failed attempts remain in the record.

The final 28 cases include 19 new requirements. They cover canonical aliases and dot segments, pre-existing leaves, three exclusive descriptors, partial writes and reads, partial preparation, input junction retargeting, changed leaf identity, hard links, write/flush/readback faults, output limits, post-close identity checks, split framing, invalid records, lost frames, callback completion, transport bounds, real Node child transport, native outcome retention, acceptance prerequisites and report/close failures.

Each owned temporary fixture is canonicalized before fault hooks compare filenames. The parent-change case retargets the input junction. It does not assume Windows permits renaming a directory containing open children.

The final candidate source manifest is `8010bb3011f2385cfa7693525ae5b56eb0732351bf19e3d9832ce93be46b9d1f`. The complete evidence record includes the source manifests, raw attempt outcomes, source preservation proof and independent source review.

```sh
node --test tests/windows-storage-evidence.harness.cjs
```

All local results are harness evidence. Native attempts, provider calls, passing product credit and release credit are zero. Repeated attempts do not create additional distinct case credit.

## Integration and remaining work

The three modified tracked sources still matched root commit `6b4964ff65c2cd8b904d5974382cb6c241e2c378` before integration. The new helper names were absent at root. This patch does not edit `fixture.cc`, the SQLite helper, the native loader, the case catalog or any workflow.

The workflow must prepare the outside parent before invoking the runner. Root already added this command to `.github/workflows/demo-tests.yml`:

```powershell
New-Item -ItemType Directory -Path (Join-Path $env:RUNNER_TEMP 'panelreply-windows-component-evidence') -Force | Out-Null
```

Windows CI must run the evidence harness and the unchanged native suite after integration. Verify the new journal transport, final completion receipt and artifact source bindings. Preserve all prior component failures and do not interpret a synthetic harness result as a native pass.

## Boundary of this repair

The outside parent and its ancestors are trusted. Node path snapshots and held descriptors do not prove an atomic boundary against a hostile parent or reparse race. The helper verifies held bytes before close and named identity, type, links, mode and size afterward. It does not claim a hostile-writer byte guarantee after the final handle closes.

Windows may update final write timestamps when the last writing handle closes. Timestamp changes alone after close therefore do not fail an otherwise matching identity and size. Microsoft documents this behavior in [File Times](https://learn.microsoft.com/en-us/windows/win32/sysinfo/file-times).

The Node child transport follows the installed Node 24 runner and the [Node test API](https://nodejs.org/docs/latest-v24.x/api/test.html). A close exception remains failure and is not retried using the same numeric descriptor. Other descriptors still close, and created artifacts stay available for diagnosis.

[Evidence and source bindings](evidence/windows-component-output-2026-11-24.json)
