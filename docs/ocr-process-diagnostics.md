# Native OCR process observations

## Recorded failure

[Run 93](https://github.com/panelreply-business/panelreply-demo/actions/runs/45255176264) tested commit `6b4964ff65c2cd8b904d5974382cb6c241e2c378`, merge `d60938fd6f772daa427a9c4fa483dba45cf036c8`, and source manifest `13df01f3f697ec9f586a62de9e8ca3203d4692c9f877a9c924f629f4c2195603` with 202 source files.

The Ubuntu 26.04 worker passed engine and normalizer readiness. It ran six native checks. Five passed. The network case failed with `true !== false`. Ubuntu 24.04 still returned `BLOCKED` at the bubblewrap loopback setup stage and ran zero native cases.

The network case calls `workerAssertions`. Its Python namespace and socket assertions execute before the expected TSV is returned. The verifier then checks the returned part number, one injected process, a recorded namespace PID, the wrapper close event, wrapper PID absence, and native PID absence. The recorded `true !== false` narrows this failure to one of the two PID-absence assertions. The report does not identify which one failed. This is an inference from the immutable source and report. It does not establish whether the observed PID belonged to an executing process, a zombie, or a reused PID.

The complete native case remains `FAIL`. Its earlier steps do not receive separate product passes. The native observations remain outside the release counter.

## Existing lifetime behavior

`workspace/ocr.cjs` settles its process promise on the direct child's `close` event. Cancellation and timeout send `SIGKILL` to that direct child and await close. Service shutdown aborts the service lifetime and awaits the tracked process promises. This change preserves that implementation.

Node 24.22.3 documents `close` after process termination and stdio closure. It also documents PID reuse as a reason that a later signal can address a different process. Linux signal zero checks existence and permission. A PID can still refer to a terminated process that has not been reaped. The kernel exposes state and start-time fields through proc. These facts justify collecting more evidence. They do not establish the cause of run 93's failure.

Primary references

- [Node 24.22.3 child-process events and PID reuse](https://r2.nodejs.org/docs/latest-v24.x/api/child_process.html)
- [Linux kill system call](https://man7.org/linux/man-pages/man2/kill.2.html)
- [Linux proc PID stat fields](https://man7.org/linux/man-pages/man5/proc_pid_stat.5.html)
- [Linux 7.0 proc filesystem and PID reuse limits](https://docs.kernel.org/7.0/filesystems/proc.html)

## Added observations

`scripts/ocr-process-diagnostics.cjs` records two roles for an injected worker: the direct wrapper and the PID returned by bubblewrap. It captures selected fields from `/proc/<pid>/stat` when each role is registered and after its existing liveness probe. It also records wrapper spawn, exit, and close timing.

Each proc read has an 8,192-byte content limit, one extra byte for overflow detection, and at most four read calls. A case has at most two registered roles and one recorded probe per role. Each opened descriptor receives one close attempt. Invalid PIDs and unsupported platforms do not open a path. The reader uses a fixed proc path, read-only flags, no-follow where available, and no blocking file open. A generated proc file's advertised size does not replace the actual byte limit.

The report retains PID, parent PID, process group, session, process state, start ticks, proc device/inode, and relative timing. It omits the command name, arguments, environment, raw proc text, and unrelated processes. Errors use a fixed code list. Missing or inaccessible fields stay `UNAVAILABLE`.

The liveness operation still makes the original single signal-zero probe. Only `ESRCH` returns false. Presence remains true even when proc reports a zombie or different identity fields. Permission errors remain errors. Observation failures cannot change that result. No wait, retry, terminating signal, namespace setting, mount, seccomp rule, or application runtime change is added.

The observations are snapshots. Reading proc can affect scheduling. Matching start ticks and inode fields do not provide the atomic identity guarantee of a pidfd. A later passing run with these observations does not establish that this diagnostics change repaired process cleanup.

## Local verification

Ten new synthetic observer harness cases passed. The complete affected diagnostics file passed 53 cases with zero failures, cancellations, skips, or todo outcomes. Those 53 include the ten new cases. They are excluded harness checks and add no product-counter credit.

The checks cover proc parsing and redaction, byte and read-call bounds, fixed paths, descriptor closure, inaccessible fields, changed identities, lifecycle limits, single signal-zero behavior, permission errors, and preservation of native case outcomes. The harness uses fake PIDs, filesystem operations, and signal probes. Importing the verifier no longer runs its CLI, so the case reporter can be exercised without a native worker.

All six native case bodies and their security assertions are byte-identical to commit `6b4964f`. The application runtime, isolation policy, host wrapper, host-context reader, workflow, milestone policy, and release collectors also retain their bytes. Actual process observations remain pending the next source-bound native CI execution.
