# Windows SQLite observation tool — November 23, 2026

## Output-path review finding

Root reproduced a lexical path-boundary defect in this inactive observer on November23. An outside symlink alias resolving into the repository passes argumentsFor. The reproduction called only the argument parser, created no report/journal and executed no native code. [Recorded evidence](evidence/windows-sqlite-output-alias-2026-11-23.json).

Before workflow integration, canonicalize report/journal containment, retain exclusive output handles, check parent/leaf identity and document the trusted-parent limit. The existing12 passing harness checks do not cover or repair this finding. The observer remains inactive, with zero Windows executions and zero product-goal credit.

## Status and scope

This is an inactive diagnostic. It does not enable either PanelReply product on Windows, replace private-storage checks, or establish storage-adapter acceptance.

The eight native Windows scenarios have not run in this worktree. Twelve Linux evidence/protocol harness checks passed with no failures, skips or cancellations. Their product-test credit is zero. An explicit failed-build invocation preserved all eight scenarios and all 72 planned phases as NOT_RUN.

The source base is `9264d2a3575889c6b39140554fc767caf6e6a7ad`. The leaf evidence records the six changed code hashes and the source manifest. No workflow, product, storage policy or release-counter file changed.

## Observation matrix

| Main database creation | Journal mode | Endings |
|---|---|---|
| SQLite creates the main file | DELETE | Explicit commit/close and forced process termination |
| SQLite creates the main file | WAL | Explicit commit/close and forced process termination |
| Component creates an empty private main file | DELETE | Explicit commit/close and forced process termination |
| Component creates an empty private main file | WAL | Explicit commit/close and forced process termination |

Each scenario uses a new component-created private directory on an observed fixed local NTFS volume with persistent ACL support. The existing volume selector checks actual filesystem metadata and does not assume that the runner's temporary drive is NTFS.

The child uses pinned Node `DatabaseSync`, fixed synthetic SQL and 32 rows with 1,536-character payloads. It records the actual SQLite version/source ID and PRAGMA values. FULL synchronous mode, a bounded cache, in-memory temporary storage and disabled WAL auto-checkpointing make the requested files observable without introducing application data or arbitrary SQL. Each observed file must remain below the component's 1 MiB bound.

The parent records the directory and `observation.sqlite`, `-wal`, `-shm` and `-journal` at prepared, opened, committed-baseline and open-transaction boundaries. It then records explicit commit/close or forced termination, followed by a separate reopen, integrity check, exact row fingerprint and close. The forced-termination case must recover the prior committed baseline and exclude its pending changes. A normal or missing exit cannot qualify as a crash observation.

SQLite documents the separate rollback-journal and WAL recovery paths. These scenarios observe process termination only. They do not test machine failure or power loss. See [SQLite WAL](https://www.sqlite.org/wal.html) and [SQLite journal file format](https://www.sqlite.org/fileformat2.html#the_rollback_journal).

## Native metadata and process identity

Existing fixture `info` queries provide actual file identity, volume, size, owner SID, SDDL, protected-DACL state and ACL presence. The report keeps the native SDDL. A bounded parser adds an inheritance summary only for ordinary six-field ACEs. Unknown ACL syntax remains UNPARSED. Null and inherited DACLs remain observations, without being accepted as private storage.

After close or termination, the unchanged normal component performs its strict file inspection. The report distinguishes accepted files, policy rejections and metadata/inspection errors. It never changes permissions to obtain a different result.

The only native change adds `process-token PID [expectedCreationFiletime]` to the test fixture executable. It requests `PROCESS_QUERY_LIMITED_INFORMATION` and `TOKEN_QUERY`. A retained process handle supplies PID, creation FILETIME and image path. Token queries retain separate user/default-owner SIDs, elevation, token ID and ModifiedId. The helper refuses another user or a changed creation identity, brackets token reads with ModifiedId checks, and closes process/token handles on every path.

The fixed child synchronously queries its own PID before sending readiness through its owned IPC channel. While the child pauses, the parent independently queries that exact ChildProcess PID with the captured creation FILETIME and checks the pinned executable file. It repeats the identity check before commands and the requested termination. Cleanup still targets the original ChildProcess object when a protocol or identity query fails. There is no process-name search, debug privilege, impersonation, token modification, ACL repair or account creation.

These observations describe the fixed child's primary token. They do not measure arbitrary thread impersonation or establish standard-user acceptance when the runner uses an elevated token. Executable hashes identify files, not mapped process pages. STILL_ACTIVE alone is not used as universal liveness proof. The paused IPC protocol, creation identity and owned child lifecycle supply the additional context.

Primary references:

- [OpenProcessToken](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-openprocesstoken)
- [QueryFullProcessImageNameW](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-queryfullprocessimagenamew)
- [GetProcessTimes](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-getprocesstimes)
- [TOKEN_OWNER](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-token_owner)
- [TOKEN_STATISTICS](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-token_statistics)

## Evidence and failure handling

The report format is `panelreply-windows-sqlite-observation-v1`. Scenario/phase statuses are OBSERVED, ERROR and NOT_RUN. Even a complete report keeps `acceptance: NOT_ESTABLISHED`, `releaseCredit: false` and `productPassing: 0`. It does not use a release-report filename or format.

The existing loader verifies the source, pinned Node image, toolchain, headers and native artifacts before execution. The parent rechecks source/build identity afterward. Only the normal addon and fixture executable are used. The probe addon is not loaded.

Completed and partial observations survive later failures. Missing phases retain a reason. Process/image identity failures remain distinct from file/SQLite observations. Cleanup receives a record even when build or NTFS selection prevents execution. An unverified child/lease cleanup retains its fixture and makes the report incomplete.

Protocol bounds include 10-second startup, 6-second command phases, 45-second child lifetimes, 3-second exit waits, a 180-second monotonic run deadline, 64 KiB per output stream/message, 16 IPC messages per child, 32 token observations per child and a 16 MiB observation-log limit. Only the harness's own ChildProcess can be terminated. Metadata queries use the existing 5-second native-helper timeout. No blind retries occur.

The 15 existing component method identities and strict `storage.cc` bytes remain unchanged. The token helper does not modify empty-DACL fixtures, metadata opening, observer race code, application imports or the builder's command-resolution changes.

## Verification and next step

The final peer run passed all 12 harness cases on Linux. Cases include outcome retention, PID/creation/image/token mismatch rejection, inherited/null-DACL observation, failed-build records, DELETE/WAL commit and process-termination recovery, and cleanup after protocol/identity rejection. The native helper received a separate source review. No native Windows execution or compilation of this new helper occurred locally.

Run the diagnostic only after the current component build and relevant fixture prerequisites have been verified on Windows. It needs a fresh build identity for the integrated source and a new output path. Application integration, custom VFS work, complete sidecar recreation, temporary files, restore publication, standard-user privacy and power-loss acceptance remain open.

```text
node --test tests/windows-sqlite-observation.harness.cjs
node scripts/observe-windows-sqlite.cjs --build-directory ABSOLUTE_BUILD_DIRECTORY --output ABSOLUTE_OUTPUT_DIRECTORY/windows-sqlite-observation.json
```

Use `--build-failed` to record every planned scenario as NOT_RUN when the build did not complete. The harness's real SQLite protocol controls run on Linux. Other hosts report those controls as skipped, without Windows acceptance credit. No workflow is added by this patch.
