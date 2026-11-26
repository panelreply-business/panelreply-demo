# Native compatibility milestone — November 23, 2026

## Source and verification

Base commit is `7fec73b7ca7fe323accaf22eb99e11d905f698b3`. Final manifest is `13df01f3f697ec9f586a62de9e8ca3203d4692c9f877a9c924f629f4c2195603` across 202 executable/test/workflow/policy files.

The full local run passes 9,290 checks on the preceding manifest `f7b7f63a97676605e133568cbe8ff4da2fe9d84320f79e3e5048aa1777d6a317`: 9,109 product cases and 181 excluded harness cases. All 9,105 prior product IDs remain. Four new policy/model cases and three new sysfs harness cases account for the difference. The run has no failures, skips, TODO, cancellations or infrastructure errors.

The Windows workflow selection check then exposes a filter error: 25 tests run instead of the intended 19. `--test-skip-pattern` selects exactly 19 passing tests. Only workflow bytes change after the full run. Separate Safari 19 and Windows 34 harness passes, and the corrected 19 selection, receive no product/native credit. Full committed CI remains required. [Exact source-bound record and preserved initial selection](evidence/native-compatibility-root-integration-2026-11-23.json).

## Changes and limits

| Area | Change | Required next evidence |
| --- | --- | --- |
| Windows fixture | Exact NtOpenFile rights avoid implicit generic/synchronous access. Metadata, original identity, security and cleanup checks remain. | Compile with recorded toolchain and run all fifteen original native methods plus cleanup. |
| SQLite observation output | Canonical outside parent, exclusive held descriptors, bounded journal, identity and closure checks. | Portable Windows harness and later eight-scenario native observation after component prerequisites. |
| OCR sysfs observation | Ignore metadata-size hint only for the fixed AppArmor field, retaining actual byte and identity bounds. | Actual host observations. No inferred value or profile attachment. |
| OCR seccomp | Denied exact zero-extended FIOCLEX returns EACCES. All ioctl calls remain denied. | Restricted normalizer readiness and all six denial cases on each host. |
| Safari | Native click/Escape/Actions and bounded after-failure file reads. Original six journey bodies and final assertions remain. | Installed Safari success with trusted events, persistence and original downloads. |

The CPython fallback is a source-supported hypothesis. Local model tests cannot establish which syscall failed on the runner. A later Safari diagnostic cannot identify an unrecorded original exception. The output guards require a trusted parent and do not establish atomic hostile-parent protection or Windows ACL isolation.

No application imports the storage component or observers. The workflow prepares the component evidence parent and runs the portable SQLite observer harness. It does not run native SQLite observation. Host profiles, privileges, test-count policy and the six native OCR denial requirements remain unchanged.

## Related evidence

- [Windows exact-access fixture](WINDOWS_EMPTY_DACL_NATIVE_2026_11_23.md).
- [SQLite output boundary](WINDOWS_SQLITE_OUTPUT_BOUNDARY_2026_11_23.md).
- [Sysfs read correction](evidence/ocr-host-sysfs-size-2026-11-23.json).
- [OCR denied-FIOCLEX compatibility](OCR_FIOCLEX_COMPATIBILITY_2026_11_23.md).
- [Native Safari Actions](NATIVE_SAFARI_ACTIONS_2026_11_23.md).
- [Independently verified final run91](evidence/run91-independent-verification-2026-11-23.json).

Both products remain separate NO-GO decisions. Native execution and the remaining release requirements determine readiness.
