# OCR descriptor-flag compatibility — November 23, 2026

## Status

This candidate changes a denial error code for one fixed ioctl request. Every ioctl remains denied. It does not add a permitted syscall, change namespace or mount arguments, change process limits, alter a host control, or add a retry.

The candidate is based on `1562c8ea0326b31f34386925ac55f44f9f9328b1`. Seven policy tests and 137 related OCR, path and diagnostic tests passed locally with no failures, skips, cancellations or TODOs. Four policy cases are new. No native Python startup, namespace worker or native isolation assertion ran during this investigation or correction. Native acceptance remains pending CI.

## Observed failure and source evidence

[Run 91, Ubuntu 26.04](https://github.com/panelreply-business/panelreply-demo/actions/runs/45248305894/job/137950843637) passed the fixed bubblewrap version probe, Tesseract version probe and Tesseract language probe. The fixed normalizer then exited 2. Its bounded diagnostic reported `EPERM` while Python opened `/app/ocr-preprocess.py`. The wrapper recorded one verifier attempt and zero completed native denial cases. The source and installed bubblewrap hashes remained stable before and after that attempt.

The [image-specific runner manifest](https://github.com/actions/runner-images/blob/ubuntu26/20261116.202/images/ubuntu/Ubuntu2604-Readme.md) matches the observed image version `20261116.202.1` and lists system Python 3.14.4. This is image documentation. The failing artifact does not capture the actual Python executable hash or version output.

Tagged [CPython 3.14.4 main.c](https://github.com/python/cpython/blob/v3.14.4/Modules/main.c) opens the script through `Py_fopen`. Tagged [fileutils.c](https://github.com/python/cpython/blob/v3.14.4/Python/fileutils.c) then makes the file descriptor non-inheritable through `set_inheritable` with its raising path enabled. On supported Unix builds, that path tries `ioctl(FIOCLEX)` first. It falls back to `fcntl` for `EACCES` or `ENOTTY`, and for the applicable `EBADF` case. `EPERM` returns an error. The script-launch path prints the file-open error and returns 2.

The old filter returns `EPERM` for every ioctl, including the close-on-exec request. That source path can therefore produce the observed failure even if opening the mounted script itself succeeds. CPython 3.13.0 uses the same descriptor-flag path through its earlier function name. The finding is not attributed to a new Python 3.14 behavior.

This is a source-backed explanation, not an observed syscall trace. The failure artifact does not establish the worker's AppArmor label or the exact denied operation. A profile file on the host does not establish attachment to the worker. The [preserved read-only analysis](evidence/ocr-fioclex-readonly-analysis-2026-11-23.json) records that distinction and binds the fetched tagged sources by SHA-256. The original Ubuntu 24.04 namespace failure is not reclassified or repaired by this change.

## Policy decision

[Linux's x86_64 syscall table](https://github.com/torvalds/linux/blob/v7.0/arch/x86/entry/syscalls/syscall_64.tbl) identifies ioctl as syscall 16. The [Linux request constants](https://github.com/torvalds/linux/blob/v7.0/include/uapi/asm-generic/ioctls.h) identify `FIOCLEX` as `0x5451`. The [seccomp data layout](https://github.com/torvalds/linux/blob/v7.0/include/uapi/linux/seccomp.h) places the request in argument 1, whose low and high words are at offsets 24 and 28 for the supported little-endian x86_64 ABI.

The new branch runs after both existing ABI guards. It checks syscall 16, a zero high request word and the exact low word `0x5451`. Only that match returns `SECCOMP_RET_ERRNO | EACCES`. Every other ioctl request returns the existing `EPERM` result. `FIONCLEX`, terminal/device requests and high-word variants remain denied with `EPERM`.

| Input | Previous decision | Candidate decision |
|---|---|---|
| Unsupported audit architecture or x32 ABI | Kill process | Kill process |
| Native x86_64 ioctl, full request `0x5451` | Deny with `EPERM` | Deny with `EACCES` |
| Other native x86_64 ioctl request | Deny with `EPERM` | Deny with `EPERM` |
| Other native x86_64 syscall | Existing policy | Same policy |

[The kernel documentation](https://docs.kernel.org/userspace-api/seccomp_filter.html) states that the errno return action does not execute the syscall. The change supplies a fallback-recognized denial. CPython can then use `fcntl(F_GETFD)` and `fcntl(F_SETFD)` through the already-existing allowed decision. Untrusted code could already call those permitted fcntl operations. No ioctl operation becomes available.

For every non-ioctl syscall, the new jump skips the request branch without changing the accumulator. Evaluation continues through the original denial list and final allow instruction. The list of 66 denied syscall numbers remains byte-for-byte the same in source. Namespace arguments, worker UID/GID, capability dropping, seccomp delivery, process limits and fixed normalizer invocation are unchanged.

## Verification

The test fixture retains the previous 1,112-byte emitted policy, bound to source commit `1562c8e` and SHA-256 `7760783e3ecbc4fde6c8ff7953dfac5a9a6490c0a9c60e81bb6bcd601925cb19`. The candidate emits 1,168 bytes. Its decision interpreter reads a 64-byte seccomp data structure, including the argument words used by the new branch.

The four added test cases cover separate risks:

- Every request from 0 through 65,535 remains an errno denial. Only `FIOCLEX` receives `EACCES`. Nonzero high words, other 32-bit values, `FIONCLEX`, and descriptor/third-argument controls verify the exact request boundary.
- Candidate decisions match the frozen prior bytecode across syscall values 0 through 1,024 plus ABI and integer boundary values, except for the one documented errno change. The allowed/denied result never changes. Both fixed engine invocations use the candidate bytes.
- Unsupported audit architectures and x32 syscall encodings still reach the kill decision before request matching. Unsupported emission architectures remain rejected.
- A model of the tagged CPython descriptor-flag code shows the old `EPERM` path failing and the new denied-ioctl `EACCES` path reaching the already-permitted fcntl operations. This is a source model, not a native Python execution.

The 65,536 request assertions are one test case. They are not recorded as 65,536 passing tests. The other comparison loops are also assertions within their named cases. The candidate's seven policy cases passed. The three related test files passed another 137 cases. Forty of those related cases belong to the excluded diagnostic harness. No local goal count is booked by this correction record.

Commands:

```text
node --test tests/ocr-isolation.test.cjs
node --test tests/ocr.test.cjs tests/ocr-path-boundary.test.cjs tests/ocr-isolation-diagnostics.test.cjs
```

[The correction ledger](evidence/ocr-fioclex-compatibility-2026-11-23.json) binds the candidate source, frozen baseline, logs and preserved analysis. [Policy output](evidence/ocr-fioclex-policy-2026-11-23.log) and [related regression output](evidence/ocr-fioclex-regressions-2026-11-23.log) retain the executed case names and totals.

## Remaining native gate

The six native verifier bodies and their assertions remain unchanged. The next exact-source CI result must establish normalizer readiness and all six cases on the tested host. A new failure remains a failure or blocked result according to the existing verifier classification. This candidate does not establish success on Ubuntu 26.04, fix Ubuntu 24.04, select a production host, or approve customer uploads.
