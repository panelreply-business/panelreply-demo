# Windows empty-DACL native-open candidate

## Result

Run 91 still recorded 13 native passes and two failures. Both failures occurred while the fixture tried to reopen an empty-DACL object for metadata. They happened before the product's empty-DACL rejection checks. Cleanup also failed. Adding `FILE_FLAG_OVERLAPPED` to `CreateFileW` did not resolve these failures.

This candidate changes one fixture source file. It requests the needed rights through `NtOpenFile`. Windows compilation and execution remain pending. The nine existing portable evidence checks pass, but they do not compile or run the native fixture.

Application integration remains disabled. The change receives no product-test credit.

## Preserved run 91 evidence

The retained report is from run `45248305894`. It reports source commit `26cf9a6fe503cf11b8e1fa515bf4a67c57ef90fe` and source manifest `14b0b86f595e026f78d666674a1133d7dcde072fd7a66c9784e780e0bc1740da`. The manifest stayed unchanged during execution.

| Case | Observed result |
| --- | --- |
| `WNS.root_security_rejection` | `create-dir` created the empty-DACL directory but its metadata reopen failed with Windows error 5. The helper did not return a creation identity. Cleanup retained that unresolved state. |
| `WNS.child_security_and_hardlink_rejection` | The creation handle returned metadata, but a later `info` reopen failed with Windows error 5. The cleanup wrong-ID control also failed at open with error 5, before the expected identity rejection with error 13. |
| Overall fixture cleanup | `fixtureCleaned` was false, with an `EPERM` infrastructure error. |

The [candidate record](evidence/windows-empty-dacl-native-candidate-2026-11-23.json) retains the raw report and observation hashes, both failed method records, cleanup errors and the prior fixture binary identity. The earlier [OVERLAPPED candidate](WINDOWS_EMPTY_DACL_2026_11_23.md) and its results remain unchanged.

Windows error 5 does not identify the access bit that caused rejection. The prior runs did not observe an internal `CreateFileW` access mask. The implicit-`SYNCHRONIZE` explanation remains unproved.

## Candidate boundary

Microsoft documents an explicit desired-access mask for [NtOpenFile](https://learn.microsoft.com/en-us/windows/win32/api/winternl/nf-winternl-ntopenfile). Its [native file-open contract](https://learn.microsoft.com/en-us/windows/win32/api/winternl/nf-winternl-ntcreatefile) distinguishes security queries, attribute queries and synchronization rights. [GetSecurityInfo](https://learn.microsoft.com/en-us/windows/win32/api/aclapi/nf-aclapi-getsecurityinfo) permits an owner to request `READ_CONTROL` for owner and DACL queries.

The fixture now uses these fixed native masks.

| Operation | Requested access | Mask |
| --- | --- | --- |
| Metadata open | `READ_CONTROL` and `FILE_READ_ATTRIBUTES` | `0x00020080` |
| Security-only fallback after access denial | `READ_CONTROL` | `0x00020000` |
| Cleanup open, after product checks | `READ_CONTROL`, `FILE_READ_ATTRIBUTES` and `DELETE` | `0x00030080` |

All three opens target existing objects. They use `FILE_OPEN_REPARSE_POINT` and share read, write and delete access. They request no generic rights, `SYNCHRONIZE`, synchronous I/O option or backup intent. They do not change a security descriptor, token, privilege or host policy.

The helper converts the existing bounded local absolute path into a native object name. It rejects nonlocal path forms. This remains a fixture for controlled disposable paths. It does not replace the production adapter's path checks or establish protection from a hostile parent directory.

Only a native access-denied result from the first metadata open permits the `READ_CONTROL` fallback. Missing attribute or identity observations remain missing. Every existing owner, DACL, identity, type, link-count and unchanged-object assertion remains in place. Opening a handle alone cannot make those tests pass.

## Failure and cleanup behavior

The fixture retains each failed native open's raw status and requested mask alongside its mapped Windows error. The mapping uses Microsoft's [RtlNtStatusToDosError](https://learn.microsoft.com/en-us/windows/win32/api/winternl/nf-winternl-rtlntstatustodoserror) contract. It does not reinterpret a sharing error as a DACL rejection.

Microsoft's [I/O status-block documentation](https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/wdm/ns-wdm-_io_status_block) requires pending I/O to be distinguished from a completed call. This helper has no synchronization right. If an open returns `STATUS_PENDING`, it writes a bounded failure and calls `ExitProcess(2)` before returning from the stack-backed request. It does not wait on the query handle or treat pending state as success. [ExitProcess](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-exitprocess) has a documented DLL-detach deadlock limit. The existing five-second parent invocation timeout must retain any such timeout as a test failure.

Cleanup still opens a fresh handle after the product rejection checks. It validates the original recorded volume/file identity, canonical path, type, link count, owner and protected empty DACL through that same handle. Only then does it set deletion disposition, which requires [DELETE access](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-setfileinformationbyhandle). It does not retain a DELETE handle during product checks, repair an ACL, clear attributes or adopt a later pathname query as the original creation identity.

The wrong-ID cleanup control still must return error 13 and preserve the object. The matching-ID cleanup still must return unchanged metadata and leave the object absent from its parent listing after the helper exits.

## Source and verification

The candidate is based on `1562c8ea0326b31f34386925ac55f44f9f9328b1`.

- Previous fixture SHA-256 is `63bb6e4541156e58634004190f121938fa550395c17fda55a588ab3523995084`.
- Candidate fixture SHA-256 is `fed3df76677eb0dbd432d88adf967f352527741f29129fcd6594fbd64a5469d6`.
- Candidate source manifest is `c81a7ccbeb48bfe6135eaac4bd009f284f4fc35730e9e847bf408bde19058202`, covering 200 source files.
- `storage.cc`, the process-token observation helper, native test bodies, all 15 native method IDs, builder, workflow and acceptance rules remain unchanged.
- The independent source review found no concrete rights, path-length, handle-lifetime or assertion-bypass defect. It did not compile or execute the candidate.

The portable command was:

```text
node --test tests/windows-storage-evidence.harness.cjs
```

It recorded nine passes, zero failures and zero skips under Node 24.22.3. These are existing evidence and failure-propagation checks. They receive no additional portfolio credit.

The next required evidence is a source-bound Windows build and execution of all 15 unchanged native cases. Keep both prior failures open until metadata, unchanged-object rejection, wrong-ID refusal, matching-ID cleanup and final cleanup all pass. A later native-open pass would still not identify the unobserved internal access behavior of the earlier Win32 call.
