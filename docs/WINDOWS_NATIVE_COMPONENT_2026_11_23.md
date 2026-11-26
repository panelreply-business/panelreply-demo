# Inactive Windows private storage component

## Status

This milestone adds a native component and its adversarial test runner. Neither
product imports it. The existing POSIX checks, fixed product entrypoints, SQLite
startup and restore publication remain unchanged.

Actual Windows compilation and native cases are pending. Local validation used
Linux x86_64 with Node 24.22.3. Eight evidence-harness cases passed. JavaScript
syntax checks passed. Those results establish the report and provenance checks,
not Windows storage behavior. No Windows product cases or release-counter
executions are added by this milestone.

The earlier read-only feasibility assessment is preserved without modification
in [WINDOWS_NATIVE_STORAGE_ASSESSMENT_2026_11_23.md](WINDOWS_NATIVE_STORAGE_ASSESSMENT_2026_11_23.md)
and [its captured evidence](evidence/windows-native-storage-assessment-2026-11-23.json).
That assessment proposed later product evidence. The current decision is narrower:
this component uses a standalone artifact, with `releaseCredit: false` and
`productPassing: 0`, until application integration and its acceptance requirements
have passed.

## Component boundary

`workspace/native/windows-storage/storage.cc` exposes two entrypoints:
`createPrivateDirectory(absolutePath)` and `openPrivateDirectory(absolutePath)`.
Both return a lease with `inspect`, `createFile`, `inspectFile`, `readFile` and
`close`. File operations are limited to 1 MiB. Parents must exist already.

Creation is exclusive. It supplies the current process user's SID and a
protected owner-only DACL to the native creation call. Existing unsafe objects
are refused. The component never changes their owner or permissions. The initial
scope accepts exactly one explicit full-access ACE for that user, with the
expected directory inheritance flags. It does not claim compatibility with
every Windows ACL that might otherwise be safe.

The implementation opens a fixed local NTFS volume, checks persistent ACL
support, and retains each path component. Relative one-component opens and
creation use `NtCreateFile` with a held `RootDirectory`. Validation checks
ownership, DACL protection, object type, reparse state, volume/file identity and
regular-file link count. Read and validation use the same file handle.

Directory handles include `FILE_LIST_DIRECTORY` so their access participates in
sharing checks. They omit write and delete sharing. Metadata access alone would
not establish that boundary. Attribute access still has separate semantics, so
the tests attempt the exact attribute-only reparse mutation. The documentation
does not treat sharing flags as proof that reparse mutation is impossible.

A newly created directory lease retains `DELETE` access for rollback through
that same handle. Another lease cannot traverse that newly created root until
the creation lease closes. The component does not close and reopen the handle
to downgrade it. Failure cleanup reports `CREATE_CLEANUP_FAILED` if deletion
cannot be confirmed. A pending probe exception becomes its cause rather than
hiding that cleanup failure. Binding failures also attempt rollback and close
the lease.

These checks do not claim resistance to the owning account or an administrator
changing security descriptors with their own authority. `GetSecurityInfo` is a
snapshot. Application integration still needs a reviewed pathname lifetime
boundary for all operations that later reopen paths.

## Normal and probe artifacts

CMake compiles `storage.cc` twice with the same operation implementation and
compiler settings. Only `panelreply_windows_storage_probe.node` defines
`PANELREPLY_STORAGE_TEST_PROBE=1`. Its `createFile` accepts a third callback.
The normal artifact rejects that argument, exposes no additional API, and uses
a different opaque receiver tag. The native tests verify those boundaries.

The first probe callback runs after the last lease validation, immediately
before the relative open. The second reports the returned child handle's
canonical volume path, file identity and length before any payload write or
cleanup. Input bytes are copied before either callback. A callback that throws
or closes its lease cannot continue through an invalid directory handle.

A separate fixture process retains source and redirect directory handles before
the mutation. It enumerates those handles and inspects existing children through
a private local pipe. It has no observer operation that creates or changes
filesystem data. Its observations are saved before native cleanup can erase a
redirected creation. An access or sharing failure is never counted as proof of
absence. If mutation or another positive control is unavailable, the case is
incomplete and the component report cannot pass.

These two cases are marked `testInstrumented: true`. They do not become normal
binary executions simply because the same C++ operation source is used.

## Native case scope

The catalog contains 15 methods. Fixture variants and assertion loops do not add
cases. The runner records every catalog entry, including `NOT_RUN` when build,
loader or NTFS setup prevents execution.

| Method | Required observation |
| --- | --- |
| `WNS.private_create_roundtrip` | Native private creation, independent owner/DACL/file identity, Unicode names, binary bytes and bounded reads |
| `WNS.exclusive_create_preserves_existing` | Existing roots/files survive retries, created-root lease exclusivity and successful reopen after close |
| `WNS.root_security_rejection` | Null, empty, unprotected and extra-grant roots are refused without permission or identity changes |
| `WNS.different_owner_rejection` | A different token-assignable owner is refused without an ownership change |
| `WNS.child_security_and_hardlink_rejection` | Unsafe file DACLs and two names for one file cannot return private bytes |
| `WNS.path_and_argument_boundaries` | Device, remote, stream, traversal and invalid Unicode names cannot create artifacts |
| `WNS.held_parent_rename_barriers` | Each disposable held ancestor refuses rename, then permits it after close |
| `WNS.attribute_only_reparse_countertest` | Working unleased `FILE_WRITE_ATTRIBUTES` control plus the actual held-lease result |
| `WNS.existing_reparse_paths_rejected` | Root, intermediate and child junction refusal preserves target bytes |
| `WNS.concurrent_exclusive_publication` | Two real processes produce exactly one complete file |
| `WNS.anonymous_io_denial` | The observed anonymous SID reads an explicitly allowed control, receives access denied for the private file, and restores the original identity |
| `WNS.concurrent_writer_read_refusal` | A real writer handle prevents protected read until it closes |
| `WNS.lease_receiver_close_and_worker_cleanup` | Invalid/closed receivers refuse operations and worker teardown releases rename barriers |
| `WNS.instrumented_relative_create_race` | The post-validation mutation, returned child handle and both independent directories are observed before payload write or cleanup |
| `WNS.instrumented_probe_cleanup_and_isolation` | Callback exceptions/lease closure clean up, input mutation cannot change saved bytes, and normal/probe APIs stay separate |

Anonymous IO is a bounded alternate-token experiment. It does not prove a second
ordinary account's SQLite ownership or sidecar behavior. The helper creates no
accounts and changes no privileges or machine policy. It performs impersonation
synchronously and terminates if `RevertToSelf` fails. Missing capabilities and
failed controls cannot become passes.

## Reproduce on the standard Windows runner

Use Node 24.22.3 x64 and PowerShell 7. The builder requires Visual Studio 2022,
the v143 toolset, CMake 3.27 or later and the installed Windows SDK
10.0.26100.0. It refuses ambient compiler, include/library and CMake overrides.

```powershell
pwsh scripts/build-windows-storage.ps1 -OutputDirectory "$env:RUNNER_TEMP/panelreply-windows-storage-build"
node scripts/run-windows-storage.cjs --build-directory "$env:RUNNER_TEMP/panelreply-windows-storage-build" --output "$env:RUNNER_TEMP/panelreply-windows-component-evidence/windows-storage-component.json"
```

The build directory must be new and outside the checkout. If the build fails,
run the second command with `--build-failed`. It writes all 15 `NOT_RUN` outcomes
and the infrastructure failure, then exits nonzero. An unexpected or duplicate
method creates an accounting failure while preserving known observed outcomes.

The runner queries ordinary temporary directory candidates and records the
actual volume. It creates disposable data only after observing fixed local NTFS
with persistent ACL support. It does not assume that D: or `RUNNER_TEMP` uses
NTFS. No ACL repair is performed during cleanup. A cleanup failure remains an
infrastructure failure.

The builder pins the Node executable, headers archive and Windows import library
to hashes published in the official 24.22.3 release. It compares the downloaded
manifest and dependency bytes with those pins. SDK selection uses
`-A x64,version=10.0.26100.0`, and both CMake's observed SDK and generated projects
must match. The identity includes actual compiler/CMake/tar hashes, unpacked
header identities, generated project hashes, source manifest and all three
native artifacts. The loader verifies those records before loading the module.
The runner verifies them again after execution and fails on change.

The report, log, JSONL observations, build identity, configured toolchain,
generated projects, dependency manifests and native binaries belong in the
standalone `windows-storage-component-evidence-*` artifact. They must not enter
the `release-*` collection or the 10,000/20,000 product-execution counter.

The portable evidence harness can run with:

```sh
node --test tests/windows-storage-evidence.harness.cjs
```

## Remaining gates

1. Compile and run this exact source on the standard Windows runner. Review all
   15 outcomes, positive controls, independent observations and cleanup results.
2. Establish the relative-root/reparse boundary on actual Windows/NTFS. A source
   review, instrumented failure after cleanup, or missing mutation control alone
   cannot establish it.
3. Prove owner-SID and protected DACL behavior for Node SQLite's own database,
   WAL, SHM and journal creation under the actual token. Include concurrent
   connections, path lifetime, checkpoints, failures and restart.
4. Design and verify no-overwrite restore staging/publication, interruption
   recovery, file flushing, disabled restored credentials and revoked sessions.
   Process restart does not establish power-loss durability.
5. Integrate the adapter only after those boundaries pass, then run fixed
   callback and manual spreadsheet workflows on Windows. Native OCR remains
   Linux-only and fail-closed. Preserve all other release and physical-device
   gates.

## Primary sources

- [Official Node 24.22.3 release hashes](https://nodejs.org/en/blog/release/v24.22.3)
- [CMake exact SDK platform selection](https://cmake.org/cmake/help/latest/variable/CMAKE_GENERATOR_PLATFORM.html)
- [CMake SDK fallback policy](https://cmake.org/cmake/help/latest/policy/CMP0149.html)
- [NtCreateFile](https://learn.microsoft.com/en-us/windows/win32/api/winternl/nf-winternl-ntcreatefile)
- [CreateFile sharing and security](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-createfilew)
- [MS-FSA sharing checks](https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-fsa/8c0e3f4f-0729-49f4-a14d-7f7add593819)
- [MS-FSA reparse mutation rights](https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-fsa/4aeefef8-92c3-4abc-af7a-a610caf8a165)
- [Protected DACL control](https://learn.microsoft.com/en-us/windows/win32/secauthz/security-descriptor-control)
- [GetSecurityInfo](https://learn.microsoft.com/en-us/windows/win32/api/aclapi/nf-aclapi-getsecurityinfo)
- [Anonymous impersonation](https://learn.microsoft.com/en-us/windows/win32/api/securitybaseapi/nf-securitybaseapi-impersonateanonymoustoken)
- [RevertToSelf](https://learn.microsoft.com/en-us/windows/win32/api/securitybaseapi/nf-securitybaseapi-reverttoself)
- [Announced Windows runner D: ReFS transition](https://github.com/actions/runner-images/issues/15315)
