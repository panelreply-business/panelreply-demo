# Windows storage component review

Review date: 2026-11-23

Reviewed worktree: `/workspace/scratch/8f544d546bb7/panelreply-windows-storage`

This is a read-only source and test-design review. It executed no Windows component cases, changed no native permissions, and edited no product or root-checkout files. It supplies zero test-goal credit. Neither product imports this component.

## Findings corrected by the author

1. The empty-DACL child test accepted only `UNSAFE_DACL`. `inspectFile()` requests attribute and synchronization access before it can inspect the descriptor, so an empty DACL can correctly deny that native open. Root and child refusal assertions now accept `UNSAFE_DACL` or `NATIVE_OPEN_FAILED` with Win32 error 5. Other native errors cannot stand in for a DACL denial. The existing owner, descriptor and identity comparisons remain.
2. The rejected-root directory assertion compared two immediate reads after the operation. It now captures the parent listing before the rejected open and compares the result afterward.
3. The existing-reparse test tried to create a nested directory while its parent still held the creation lease's `DELETE` access. The new traversal does not share delete access and would conflict with that lease. The test now closes the target creation lease after writing its proof file, before creating the nested directory. This preserves the component's stated creation-lease exclusivity.

The first finding follows Microsoft's distinction between [empty and null DACLs](https://learn.microsoft.com/en-us/windows/win32/secauthz/null-dacls-and-empty-dacls) and the separate requested access rights in [NtCreateFile](https://learn.microsoft.com/en-us/windows/win32/api/winternl/nf-winternl-ntcreatefile). The third follows the [bidirectional sharing checks](https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-fsa/8c0e3f4f-0729-49f4-a14d-7f7add593819). These are source-level findings, not observed Windows outcomes.

## Earlier runtime findings

The retained directory mask now includes `FILE_LIST_DIRECTORY`. The rename case attempts each disposable held ancestor, requires refusal while held, and requires a successful rename of the same object after closing the lease.

The code and tests do not claim that sharing freezes reparse state. The attribute-only fixture requests `FILE_WRITE_ATTRIBUTES`, uses an empty directory, and attempts `FSCTL_SET_REPARSE_POINT`. It requires a successful unleased control before evaluating the leased case. A mutation detected by the component remains distinct from a blocked mutation. If the required control is unavailable, the case remains skipped and cannot satisfy the runner's all-cases-success condition. Microsoft specifies attribute-write access as an alternative for this [FSCTL](https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-fsa/4aeefef8-92c3-4abc-af7a-a610caf8a165).

New-object cleanup now checks the same-handle disposition operation. Its failure surfaces as `CREATE_CLEANUP_FAILED` with the Windows error. Final directory validation and subsequent JS binding/lease-registration failures are covered by that cleanup path. A failed existing-directory binding only closes the lease and does not delete the existing directory. If a probe exception is already pending, a cleanup failure takes precedence and retains that exception as its cause. The code does not report successful rollback when deletion was refused.

The author also moved the ACE SID-size bound ahead of `EqualSid` and requires space for the SID header before validation. I reviewed that additional source hunk. No further concrete defect was found in these reviewed paths.

## Deterministic mutation observer

The first probe callback runs after the last lease validation and immediately before the relative native open. It forces the actual attribute-only root mutation. There is no intervening attribute revalidation that would remove the intended window. The liveness check after the callback only prevents use of a closed lease.

If the native open returns a handle, the second callback receives that handle's observed identity, canonical path and size before payload writing and before cleanup. The test requires the observed file to remain inside the original source directory and the redirect target to contain no child, including an empty transient child. An observation assertion is not accepted as the expected native refusal.

The observer process retains both source and target directory handles before mutation. Its handles share read, write and delete. Its filesystem operations inspect metadata, enumerate the retained directories to completion, and open an existing child. It never creates, deletes or writes the observed child. Its own output uses a private local pipe. The fixed fixture and existing source retain separate identities.

After refusal and cleanup, complete retained-handle enumeration proves source and target absence. A failed relative child lookup is recorded separately and is not treated as absence. The target also has a separate path-based absence check. A blocked mutation yields incomplete evidence rather than a race pass.

This design covers the stated single-component create window. It does not itself establish the live NTFS result. The actual pinned Windows run must still provide the observations.

## Probe isolation and callback reentrancy

Only the probe target defines `PANELREPLY_STORAGE_TEST_PROBE`. The normal source path has a two-argument `createFile()` interface and contains no compiled callback branch. The normal and probe leases use different native receiver tags. The native case checks extra-argument rejection without callback invocation and rejects cross-artifact receivers.

Payload bytes are copied before either callback can mutate the input Buffer. Both callback phases check that the lease remains live before using its retained handles. A callback that closes the lease after file creation reaches same-handle cleanup. A callback that throws preserves its exception when cleanup succeeds. The reviewed case covers throwing, closing and input mutation at the relevant phases.

These are source-level observations about separate build targets. Actual artifact separation remains tied to the build and loader hashes. Probe cases are marked instrumented and do not claim to observe the unmodified binary's execution.

## Anonymous IO boundary

The fixture opens the experiment parent before impersonation, then performs fresh relative child opens and actual reads under the observed anonymous token. The control grants Anonymous Logon access explicitly. The private file was created by the component, moved within the volume without changing its protected descriptor, and checked for the same identity afterward.

The case requires the anonymous SID, a successful control read, private `ACCESS_DENIED`, restoration of the original SID, and a successful owner read afterward. The process restores impersonation on normal and exception exits. If restoration fails it terminates, matching Microsoft's [RevertToSelf guidance](https://learn.microsoft.com/en-us/windows/win32/api/securitybaseapi/nf-securitybaseapi-reverttoself). The explicit control grant avoids assuming that an anonymous token contains Everyone, which Microsoft [does not guarantee](https://learn.microsoft.com/en-us/windows/win32/api/securitybaseapi/nf-securitybaseapi-impersonateanonymoustoken).

That test can establish only the observed anonymous-token file-access boundary. It does not establish isolation from the owner, an administrator, a token with backup privileges, another ordinary user account, or a future SQLite process. No such broader acceptance is claimed here.

## Reviewed source identities

| File | SHA256 |
| --- | --- |
| `workspace/native/windows-storage/storage.cc` | `63fce31b69e259603aeb08f016254b3a56cd62e89133c4b35861ef2d7edd84f8` |
| `workspace/native/windows-storage/fixture.cc` | `b56123b707ea00bfe7e4546510626905b4e1786726e6dc88aa5a9e4406adcff5` |
| `tests/windows-storage.windows.cjs` | `dd3bb0090215e807d4df9ae7ad2d29f57254d9feb23bd3db563f560a69e3836c` |
| `tests/windows-storage-cases.cjs` | `f70d254ae8fdf7cc19c17ab2a6e2e1e07ae01a762a92ac87871c76c21a7d07d4` |
| `tests/windows-storage-support.cjs` | `2c6c331978fa761141fb7d29e57f09c3ae0cc72f642d5a6fc5c0eb35ba48a3b9` |
| `tests/windows-storage-child.cjs` | `03073e93bfa36113a6af2c566668e1a906fc6a229309ab53e81fb677baecb16e` |
| `workspace/native/windows-storage/CMakeLists.txt` | `d7c1fe48c54e79bbc26ffb446da6131116af1910263875ddb94d26d846be564e` |
| `workspace/native/windows-storage/README.md` | `378ab9087070c5b5dcaea8df4ec92c4d367475d3ef8f6c510992ff34a80369a8` |

The catalog contains 15 native methods, including two instrumented methods. None was executed in this review. Required Windows execution, unavailable controls, SQLite sidecars, restore publication and ordinary second-account acceptance remain outside this review. Application integration remains disabled.
