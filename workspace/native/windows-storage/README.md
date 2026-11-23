# Windows private storage component

This component is under development. Neither application imports it. The
existing POSIX storage requirements remain active.

The first scope is a local NTFS directory lease with private creation and bounded
same-handle reads. It does not integrate SQLite, sidecars, backup publication or
restore. Passing these component cases cannot establish Windows product support.

## API

`createPrivateDirectory(absolutePath)` exclusively creates the final component.
Every parent must already exist. `openPrivateDirectory(absolutePath)` checks an
existing private directory. Neither call changes an existing object's owner or
DACL. Both return an opaque lease.

- `inspect()` returns the observed root SID, DACL, identity and volume metadata.
- `createFile(name, bytes)` creates a new owner-only child file with at most 1 MiB.
- `inspectFile(name)` validates an existing owner-only, single-link regular file.
- `readFile(name, maximumBytes)` validates and reads the same handle, up to 1 MiB.
- `close()` closes all retained directory handles. Repeated close is harmless.
  Other calls on a closed lease reject.

The created-directory lease retains delete access for same-handle cleanup if
creation validation fails. This first scope is exclusive: another lease cannot
open that newly created root until the creation lease closes. There is no
close/reopen downgrade. Cleanup failures surface as `CREATE_CLEANUP_FAILED`, with
the Windows error code, because a new private artifact may remain.

Paths must be fully qualified DOS paths on an observed fixed local NTFS volume.
The component rejects device and remote paths, streams, traversal, aliases and
reparse points. Child names are single components. The component accepts only
the protected owner-only ACL shape created by this stage. Broader safe Windows
ACL compatibility needs its own review before application integration.

## Handle boundary

The initial volume root is opened once. Subsequent components and children use
the documented user-mode `NtCreateFile` relative `RootDirectory` interface.
Creation supplies the private security descriptor with exclusive `FILE_CREATE`.
The creation call returns the handle, so there is no create-then-reopen window.
Every child operation rechecks retained ancestor handles and the root ACL.

Directory sharing excludes write and delete sharing. This is not a claim that
reparse changes are impossible. Windows attribute access is outside sharing
restrictions. Tests must attempt attribute-only `FSCTL_SET_REPARSE_POINT`, prove
the unleased control, and distinguish blocked replacement from detected mutation.
Relative-root behavior during a concurrent reparse change remains a required
boundary to establish before any application integration.

The separate `_probe.node` artifact compiles the same operation source with
`PANELREPLY_STORAGE_TEST_PROBE`. Only that binary accepts a third `createFile`
callback. It reports an immutable event immediately before the relative open and
an actual child-handle identity/path event before payload writes. A separate
read-only observer process retains source and redirect directory handles. Probe
cases carry `testInstrumented: true` in their evidence. They are not observations
of the unmodified runtime. The normal artifact has no hook and rejects that extra
argument. Throwing or closing the lease inside a test callback must clean up
through the created handle without invalid native access.

No module function changes process privileges, token identity, local accounts,
machine policy or permissions on existing objects. Alternate-token IO belongs
only in the disposable fixture process, which must restore identity or exit.

## Sources

- [NtCreateFile and relative directory handles](https://learn.microsoft.com/en-us/windows/win32/api/winternl/nf-winternl-ntcreatefile)
- [CreateFile sharing and security descriptors](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-createfilew)
- [Handle-based security inspection](https://learn.microsoft.com/en-us/windows/win32/api/aclapi/nf-aclapi-getsecurityinfo)
- [Reparse mutation access rights](https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-fsa/4aeefef8-92c3-4abc-af7a-a610caf8a165)
- [Runner D: ReFS change starting November 30, 2026](https://github.com/actions/runner-images/issues/15315)

The test runner must select and observe a local NTFS fixture root. It must not
assume the checkout or runner temporary volume uses NTFS. Build output and fixture
data stay outside the source checkout. Source and dependency hashes accompany
the actual Windows report. Unavailable native execution is not a passing case.

The current build commands, 15-case catalog, evidence rules and remaining
integration gates are recorded in
[the component milestone](../../../docs/WINDOWS_NATIVE_COMPONENT_2026_11_23.md).
The standalone report carries zero product/release credit. The eight portable
evidence-harness checks are separate from native Windows execution.
