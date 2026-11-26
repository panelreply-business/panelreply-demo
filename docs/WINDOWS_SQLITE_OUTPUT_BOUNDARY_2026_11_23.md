# Windows SQLite observer output boundary — November 23, 2026

## Scope

This correction is based on `1562c8ea0326b31f34386925ac55f44f9f9328b1`. It changes only the inactive observer's artifact handling and its development harness. No workflow invokes this observer. No native Windows scenario has run for this correction. Product-test credit is zero.

The original parser accepted an outside symlink alias whose target was the repository. It then created the journal by pathname, reopened that pathname for each append, and created the report after observation. The [original read-only reproduction](evidence/windows-sqlite-output-alias-2026-11-23.json) remains unchanged. It created no output and made no native attempt.

## Output contract

The observer requires an absolute JSON output path with a parent that already exists outside the repository. It rejects a parent inside the repository or an ancestor of the repository. It rejects `release-` filenames, malformed strings, control characters, relative paths and unavailable parents.

The parent is resolved from the raw output spelling before any normalization can remove a symlink followed by `..`. The canonical parent and repository identities are recorded. The existing `artifacts/` exception is removed. Repository searches found no workflow or other caller using that exception for this inactive observer.

Both the report and derived `.observations.jsonl` name must be unused. `lstat` checks reject existing entries, including dangling links, before either file is created. Exclusive creation checks the names again at open time. The journal also opens with append mode. Both descriptors stay open through collection and writing. Writes never reopen their pathnames.

Output preparation happens before source capture, native loading, fixture creation or owned-child startup. The implementation rechecks the raw and canonical parents, repository identity, named and held file identities, link count, mode, expected byte size and timestamps. Report and journal writes use their held descriptors, flush, and check identity and size afterward. Final verification checks both files and closes both handles before stdout can report saved evidence.

The journal retains its 16 MiB ceiling. A would-be overflow fails before writing it. Each successful append records its UTF-8 byte length in the expected prefix and updates a SHA-256 digest. The report includes `journalEvidence`. Its digest describes the verified appended prefix and must be compared with the retained journal after download. A final journal mismatch makes the report incomplete. It cannot become a successful observation or release acceptance.

## Failure evidence and limits

The error state distinguishes `NOT_CREATED` from `CREATED_RETAINED` for each file. It records verified bytes, whether writing started, whether the write verified, whether the file failed verification, and whether the descriptor closed. A close failure on one handle does not prevent attempting to close the other. The original collection or write error remains primary.

The implementation never deletes a pathname after an identity failure. It can retain an empty report when journal creation fails. It can retain a partial journal after a write fails. If the report's own identity still verifies, it can preserve an incomplete result describing a failed journal. If report writing or final verification fails, stdout makes no saved-evidence claim. Structured stderr keeps the output state and the failure code.

This boundary requires a trusted CI output parent. It does not provide atomic protection from every concurrent parent mutation. A parent swapped during open can leave an empty entry at a location that has not yet passed the recheck. A held inode moved during writing can cause the final check to fail after bytes were written. The state reports retained output and never claims that such bytes were removed or never reached the repository. The bounded checks detect tested mutations and prevent later writes through a replaced leaf name.

The Linux harness does not establish Windows reparse-race, filesystem or DACL behavior. Opening with mode `0600` is not proof of a private Windows DACL. Those native acceptance questions remain open. No host setting, permission repair, privilege change or retry is introduced.

## Verification

The local Node 24.22.3 harness passed 25 cases with zero failures, skips, cancellations or TODOs. The original 12 cases remain intact. Thirteen added cases cover canonical aliases and parent traversal, missing parents, existing and dangling leaves, exclusive-create collisions, two retained descriptors, journal bounds and digest, parent and leaf replacements, final journal verification, partial writes and cleanup after an error. The original portable SQLite protocol cases use only owned synthetic child processes on Linux. They do not load the Windows component.

Five actual CLI preflights failed before native collection. They covered a repository alias, raw alias/parent traversal, a missing parent, an unresolvable parent and a dangling journal leaf. All five produced no repository output. The ordinary outside-parent `--build-failed` path retained a source-bound report with eight scenarios and 72 phases marked `NOT_RUN`, an empty journal, no native identity, and both descriptors closed. Its journal digest matches the empty file. The explicit failed-build option is a reporting-path check, not an attempted native build.

The source manifest binds this candidate to 201 source files. Only the observer, its harness and the new output helper differ from the 200-file committed base. The native scenario function, protocol helper, child process implementation, component methods, native code, workflow, application source and milestone policy retain their committed bytes.

Evidence:

- [Correction ledger](evidence/windows-sqlite-output-correction-2026-11-23.json)
- [Harness log](evidence/windows-sqlite-output-harness-2026-11-23.log)
- [CLI checks](evidence/windows-sqlite-output-cli-2026-11-23.json)
- [Failed-build report](evidence/windows-sqlite-output-build-failure-2026-11-23.json)

Reproduce the portable harness from this source:

```text
node --test tests/windows-sqlite-observation.harness.cjs
```

Use a new, existing outside directory and an unused filename for a reporting-path check:

```text
node scripts/observe-windows-sqlite.cjs --build-directory ABSOLUTE_MISSING_BUILD_DIRECTORY --output ABSOLUTE_OUTSIDE_DIRECTORY/windows-sqlite-observation.json --build-failed
```

The expected result is exit code 1, `INCOMPLETE`, zero observed scenarios and eight `NOT_RUN` scenarios. It grants no acceptance or product-test credit.

## Next steps

Complete independent source review. Verify the current component build and fixture prerequisites on Windows. Then run the output-boundary harness on Windows and inspect report/journal identity and digest there before integrating the native SQLite observer. Preserve every incomplete result. The separate component runner's output parser and the SQLite storage-adapter acceptance requirements remain separate work.
