# Windows empty-DACL fixture candidate

## Observed result

Run 89 compiled and executed the existing 15 Windows component methods on Windows 10.0.20348, x86_64, Node 24.22.3. It recorded 13 PASS and 2 FAIL, with no skipped, cancelled or missing methods. Recursive fixture cleanup recorded EPERM. Neither result is changed by this investigation. The component remains outside both applications and earns zero product-goal credit.

The two failures now identify the same native operation and error:

| Existing method | Operation that failed | Observed reason |
| --- | --- | --- |
| `WNS.root_security_rejection` | `create-dir` for the empty-DACL directory, during its metadata report | `Could not inspect fixture path (Windows 5)` |
| `WNS.child_security_and_hardlink_rejection` | `info` for the empty-DACL child file | `Could not inspect fixture path (Windows 5)` |

The report identifies commit `7d71fe4475cf777b447c2de3f0340de786f6544e`, Git tree `2fd8a6cad252d806b29e6d1dfcb52d0efc2b3f18` and unchanged source digest `991af22d5c66708b55d1d7e01ce739a9dbab28e27c9e1f89c7f04cf5ecad6b8c`. The [evidence record](evidence/windows-empty-dacl-candidate-2026-11-23.json) preserves all 15 outcomes, both complete failure messages, the cleanup error, artifact hashes and the downloaded report digest.

The metadata-open failures do not establish that the product accepted an unsafe DACL. The recursive cleanup error names the disposable root, without a trace identifying the exact failing libuv operation.

## Hypothesis and source evidence

Microsoft documents that `CreateFile` without `FILE_FLAG_OVERLAPPED` opens for synchronous I/O. Its native `NtCreateFile` contract requires `SYNCHRONIZE` when either synchronous-I/O option is selected. An object's owner has implicit `READ_CONTROL` under the access-check rules, but that does not grant `SYNCHRONIZE`. These contracts support testing an asynchronous metadata handle with the same explicit access masks. They do not prove which desired-access mask Windows used internally in the observed failing `CreateFileW` call. That causal hypothesis remains unconfirmed until native execution supplies the missing evidence. [I/O mode](https://learn.microsoft.com/en-us/windows/win32/fileio/synchronous-and-asynchronous-i-o), [native open contract](https://learn.microsoft.com/en-us/windows/win32/api/winternl/nf-winternl-ntcreatefile), [owner access rules](https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-dtyp/4f1bbcbb-814a-4c70-a11e-2a5b8779a6f9).

The pinned Node 24.22.3 source has a related constraint. Its bundled libuv unlink/rmdir path opens with `FILE_READ_ATTRIBUTES | DELETE`, reparse/backup flags and no `FILE_FLAG_OVERLAPPED`. The inspected file has Git blob `4092de0ab31e5628d628fd2c3f0ea3c75c0d6803`. This is source evidence, not a trace of run 89 cleanup. [Pinned Node/libuv source](https://github.com/nodejs/node/blob/v24.22.3/deps/uv/src/win/fs.c).

Microsoft's file-access algorithm permits `DELETE` through the parent's `FILE_DELETE_CHILD` permission and `FILE_READ_ATTRIBUTES` through the parent's `FILE_LIST_DIRECTORY` permission. It still applies sharing checks. `GetSecurityInfo` requires `READ_CONTROL` for the queried owner/DACL, and `FileDispositionInfo` needs `DELETE`. These contracts support a fresh cleanup handle after product checks, without changing the fixture ACL or retaining a deletion handle during the security test. [File-access algorithm](https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-fsa/82b364ce-6d7b-422f-8d88-4db32eea809a), [security query](https://learn.microsoft.com/en-us/windows/win32/api/aclapi/nf-aclapi-getsecurityinfo), [delete disposition](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-setfileinformationbyhandle).

## Candidate changes

`openMetadata` adds `FILE_FLAG_OVERLAPPED` to both existing opens. The first still requests `READ_CONTROL | FILE_READ_ATTRIBUTES`. Its access-denied fallback still requests only `READ_CONTROL`. Sharing and reparse flags remain the same.

The disposable helper gains `remove-empty`. It runs only after the product rejection assertions. It opens a fresh handle with query rights plus `DELETE`, then verifies the original recorded volume/file ID, canonical path, type, owner, protected present empty DACL, lack of reparse/read-only attributes and a single link for a regular file. Every verification and the delete disposition use that same handle. The helper requests no data access, ACL write, owner change or privilege adjustment. It emits its complete metadata result only after the disposition succeeds. The parent verifies absence through an accessible parent-directory listing after the helper exits and closes its handle.

The two existing methods register cleanup before creating the fixture, retain the creation metadata, and compare complete metadata before and after the unchanged product rejection checks. A wrong-file-ID cleanup attempt must fail with Windows 13 and leave the object unchanged before the correct cleanup attempt. Its result is recorded before the assertion, preserving a failing control.

If creation never supplies its original identity, cleanup may report a confirmed absence. A present object or an unresolvable metadata query causes a cleanup failure. The helper never adopts an object found later at the same path. This means a continuing metadata failure remains a cleanup blocker.

The product still must reject with `UNSAFE_DACL` or `NATIVE_OPEN_FAILED` with Windows 5. A sharing violation, including Windows 32, cannot satisfy the assertion. No `DELETE` handle survives into those product checks. The atomic create-fixture JSON correction remains byte-for-byte unchanged.

## Verification and remaining work

The detached candidate is based on `5cead3344fc2615d699e68d606f38da399d21348`. Only the fixture and its existing Windows suite change. `storage.cc`, the 15-method catalogue, builder, workflow and application code remain unchanged. Root reviewed and applied the source patch alongside the separate query-only process-token helper without conflict.

| Check | Result |
| --- | --- |
| `node --test tests/windows-storage-evidence.harness.cjs` | 9 PASS, 0 FAIL, 0 SKIP |
| JavaScript syntax and whitespace checks | PASS |
| Source digest before/after the harness run | Identical: `b56f449785321bd459bb3d8a2ecb793ca822260eb1b1450eb5866c7c95838fcf` |
| Existing native method IDs | Same 15 IDs, same order |
| Candidate Windows compilation and execution | NOT RUN locally |
| New product-goal passing executions | 0 |

These nine portable harness passes verify reporting behavior. They do not establish native compilation, successful metadata opens, cleanup or product security acceptance.

The next Windows run must preserve all 15 results and demonstrate actual owner/DACL/identity observations before and after both product rejections, wrong-identity cleanup refusal, successful same-identity disposition and independently observed absence. Any metadata or cleanup failure must remain a failure with its native reason. The existing fixture root must remain an ordinary canonical local NTFS path. Alias, reparse, identity or path mismatches fail closed. This helper is for owned disposable fixtures, not general cleanup or application storage activation.
