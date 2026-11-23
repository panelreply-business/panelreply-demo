# Windows SQLite and restore publication prerequisites

This is a read-only follow-up to the inactive native storage component. It adds
no application integration, native execution, accepted platform or passing
product case. The first component remains subject to its Windows CI results.

## Findings

The native directory component cannot yet act as a complete adapter for
`node:sqlite`. SQLite opens paths and creates files itself. Node 24.22.3's
`src/node_sqlite.cc` passes `SQLITE_OPEN_URI` and a null VFS argument both when
opening a `DatabaseSync` connection and when opening a backup destination.
The inspected source blob is `a0a13c3537e7ae95ae1bf535ec9b50b2469e78a5`.
[Pinned Node source](https://github.com/nodejs/node/blob/v24.22.3/src/node_sqlite.cc).

Node's pinned `sqlite3.h` identifies SQLite 3.54.1 and source ID
`2026-10-16 14:45:20 555e07ef33f69a0957d24d8e555b702464a131d6f1607f4c3c1e4551e8e6ca76`.
The matching SQLite release tag resolves to Git commit
`57520227c95396ce39ba6ecaac8d475b78dd3964`. Its Win32 VFS uses ordinary
path-based `CreateFileW` calls with null security attributes for file and shared
memory creation. It shares read and write access. The VFS file blob is
`8c6b258094b1b0c72648f01e55fcdeea9f62fe36`.
[Pinned Node header](https://github.com/nodejs/node/blob/v24.22.3/deps/sqlite/sqlite3.h),
[matching SQLite Win32 VFS](https://github.com/sqlite/sqlite/blob/57520227c95396ce39ba6ecaac8d475b78dd3964/src/os_win.c).

The complete bundled Node amalgamation was not retrieved successfully, so this
assessment does not claim a byte-for-byte comparison of its Win32 section with
upstream SQLite. Actual runtime version, source ID, compile options and resulting
file descriptors must be captured in the Windows experiment.

There are two separate compatibility questions. The default owner can be a group
SID from the process token rather than `TokenUser`. Also, inheriting a private
parent's ACE does not establish the component's required explicit, protected
child DACL. `SE_DACL_PROTECTED` controls inheritance of the descriptor on which
it is set. A token default DACL is an ACL, not a descriptor with that protection
bit. These are reasons to measure actual created files before integration, not
permission to relax the existing checks.
[Token owner](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-token_owner),
[descriptor control](https://learn.microsoft.com/en-us/windows/win32/secauthz/security-descriptor-control),
[token default DACL](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-token_default_dacl).

Precreating `workspace.sqlite` alone does not cover later file creation. WAL,
SHM and rollback journals have separate lifecycles. SQLite can also use
temporary files for statement work, sorting and `VACUUM`. The existing backup
and restore implementation runs `VACUUM`, so a three-suffix check alone is not
the complete Windows data boundary. Turning journaling off would remove crash
recovery and is outside this design.
[SQLite temporary files](https://www.sqlite.org/tempfiles.html),
[SQLite WAL](https://www.sqlite.org/wal.html).

The component's relative-handle create test also cannot establish the behavior
of a later path-based SQLite open. A retained parent handle is not proof that an
attribute-only reparse change cannot redirect another pathname lookup. Keep
that lifetime requirement separate from the component's own returned handle.
[CreateFile sharing](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-createfilew),
[reparse mutation rights](https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-fsa/4aeefef8-92c3-4abc-af7a-a610caf8a165).

## Bounded next experiment

After the first component compiles and its controls work, use a new synthetic
fixture on the same observed local NTFS volume. No product startup or customer
data is needed.

1. Record actual Node executable hash, SQLite version/source ID/compile options,
   process `TokenUser`, `TokenOwner`, token default DACL and fixture volume.
2. Create the main file through the native private-create primitive. Record its
   independent descriptor and file identity before passing its path to SQLite.
3. Open the pinned `DatabaseSync`, enter WAL mode, hold a transaction, and inspect
   the live database, WAL and SHM using independent handles. Record the native
   validator's result without modifying any descriptor. Commit, checkpoint,
   close, reopen and compare logical rows and file lifecycles.
4. Use a separate database to observe a real rollback journal while a write
   transaction remains open, then abort the fixture process and verify recovery
   using the original SQLite behavior. Keep any incompatible owner or ACL as a
   failing/incomplete requirement.
5. Observe temporary-file behavior for a bounded backup/`VACUUM` workload. A
   private, process-local temporary root can confine this experiment, but it
   does not prove that the current application already has that configuration.
6. Review actual path-replacement and reparse behavior before selecting any
   adapter architecture. No post-creation ACL repair may substitute for private
   creation.

If default creation cannot satisfy the required file boundary, a custom VFS is
one architecture to investigate. Node's URI flag could select a named VFS, but
registering it into Node's own SQLite instance is a separate binding question.
Public Node-API handles are not SQLite connection handles. Do not assume that
Windows `node.lib` exports SQLite internals. Do not enable `allowExtension` or
replace the storage implementation without a reviewed design and tests.

## Restore publication

Current POSIX restore creates an exclusive destination in mode 0300, installs
the validated database and authenticated product marker, then publishes mode
0700. Normal product startup rejects the earlier mode. The marker and database
must both be complete, private regular files with single links before startup.
This behavior appears in `workspace/backup.cjs`, `workspace/products.cjs` and
`workspace/file-safety.cjs`.

The first Windows component's created-root lease retains `DELETE` access and
blocks a competing lease while it is open. That is a live-process property.
Process exit closes the handle. It cannot be the only incomplete-restore
barrier, because an interrupted restore must still be refused after restart.

Two bounded publication designs remain candidates for review. Neither has been
implemented or accepted.

| Candidate | Needed proof |
| --- | --- |
| Build the complete private directory under a staging name, then publish a same-parent directory rename with replacement disabled | The same held source and destination-parent handles must determine the operation. A competitor must survive unchanged. Root mutation, open-child handles, process exit and cleanup must leave the requested destination absent or fully valid. |
| Create a new directory with a persistent staging DACL that normal startup refuses, then publish only that same newly created object after verification | The creation handle must retain its required access. The staging descriptor must survive restart, prevent normal startup and remain private. Publication must never adopt or change an existing unrelated object. |

`FILE_RENAME_INFO` documents a directory handle for relative target resolution
and failure when replacement is disabled and the target exists. Those API
properties support the first candidate, but they do not by themselves prove the
entire restore protocol or power-loss durability.
[File rename information](https://learn.microsoft.com/en-us/windows/win32/api/winbase/ns-winbase-file_rename_info).

File flushing needs a handle with write access. A volume-wide flush requires
administrator authority and is outside this work. `MOVEFILE_WRITE_THROUGH` is
not a reason to silently replace the current directory-fsync checks with a
claim of equivalent durability. Process-termination tests must be described as
process-termination tests.
[FlushFileBuffers](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-flushfilebuffers),
[MoveFileEx](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-movefileexw).

The recovery limit is currently 64 MiB, while the first native primitive handles
at most 1 MiB. A later bounded file/stream interface and its size/error cases are
also required. Keep source authentication, product binding, disabled restored
passwords, revoked sessions and no-overwrite behavior unchanged throughout that
work.

## Decision

Keep application integration disabled. First obtain the native component's
Windows results. Then use the observations above to select a SQLite and restore
design. No account, privilege, machine-policy, production-data or release action
is required for this assessment.
