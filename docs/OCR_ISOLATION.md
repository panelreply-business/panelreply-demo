# Restricted OCR worker

Date: 2026-11-20.

## Status

The required worker policy and native verifier are implemented. Policy/adapter unit tests pass. Actual OS isolation is BLOCKED in the current development environment. Its first unprivileged bubblewrap attempt failed when creating a network namespace with `NETLINK_ROUTE: Operation not permitted`. That attempt was not repeated. No privileged command, namespace setting, host security policy or deployment configuration was changed.

The six native deny tests are NOT TESTED locally. The script is prepared for an authorized Linux CI runner that permits unprivileged user namespaces. A passing result on CI would apply to that runner. The intended hosting environment still needs its own verified boundary before customer uploads.

CI run 67 also returned BLOCKED with zero native deny cases. Its `isolation_unavailable` reason and null engine version establish that the first wrapped engine-version probe failed. They do not establish a host namespace denial. The packages installed successfully, but the adapter discarded the failure stderr. A worker configuration, mount, loader or seccomp problem remains possible. [Run 67 evidence](evidence/ocr-isolation-run67.json) preserves that indeterminate result.

The CI verifier now observes the same readiness attempt and retains at most 4 KiB of stderr per fixed probe stage, plus exit code/signal and safe launch error codes. It runs no extra command or retry. Explicit namespace-denial messages may confirm a host blocker. Known launcher/configuration errors and `SIGSYS` return FAIL. Other unavailable states remain BLOCKED with the cause marked unconfirmed. No generic `isolation_unavailable` result alone establishes an external blocker.

The existing private local application continues to use resource limits by default. A process limit is not OS isolation. No public service or integration was enabled.

## Explicit mode

The internal factory accepts:

```js
const service = createOcrService({ isolation: 'required' });
```

This option is not accepted from HTTP input. It wraps readiness, pixel normalization, initial OCR and orientation fallback. It never retries without isolation. Missing bubblewrap, unsupported architecture, denied namespaces, failed seccomp setup or a failed engine probe make OCR unavailable. Manual entry remains available. A successful readiness response only means the configured worker can launch its fixed dependencies. It does not replace the native deny tests.

The existing `resource-limits` mode remains explicit in the factory implementation. Changing application hosting or deployment configuration is outside this change.

## Policy

- Linux x86_64 only. The factory rejects a root caller and unsupported platforms for required isolation.
- Fixed `/usr/bin/bwrap`, launched through the existing `/usr/bin/prlimit` limits. No shell, executable selection, path selection or environment inheritance from an HTTP request.
- Separate required user, PID, network, IPC, UTS and cgroup namespaces. No `try` namespace options and no shared-network fallback.
- UID/GID 65534 inside the worker, dropped capabilities, a new session and `--die-with-parent`.
- A read-only `/usr` runtime, fixed library symlinks, namespace-local `/proc`, minimal `/dev` and an empty read-only root. The repository, private database, home directory and host temporary files are not mounted.
- The normalizer gets only its fixed script mounted at `/app/ocr-preprocess.py`. Python runs with `-I -B` and fixed arguments. Input and output use pipes.
- A fixed x86_64 seccomp filter blocks socket operations, process creation, identity changes, cross-process access, namespace/mount changes, kernel modules, keyrings, io_uring and other listed privileged interfaces. Other architectures and the x32 ABI are killed rather than interpreted using the wrong syscall numbers.
- All existing address-space, CPU, file, descriptor, image, output, wall-time, concurrency, cancellation and shutdown limits remain.

The filter is a targeted deny policy combined with namespaces and read-only mounts. It is not a syscall allowlist, a dependency vulnerability scan or proof against every native-library exploit. Keep Tesseract, Leptonica, Python, Pillow, bubblewrap and the host kernel maintained. Do not assume the policy works on a host where it has not been tested.

## Native verification

Install test dependencies only on an authorized disposable runner. Do not use `sudo` to run the verifier, a setuid/setgid bubblewrap binary, privileged containers or changes to kernel namespace policy to force a passing result.

```bash
node scripts/test-ocr-isolation.cjs /tmp/panelreply-ocr-isolation.json
```

The verifier uses only checked-in synthetic labels and a newly created synthetic host-only canary. It makes no connection to any address. It checks six cases:

1. The host-only canary is unreadable and writes to the runtime/root mounts fail with `EROFS`.
2. The network namespace differs from the parent. Creating IPv4, IPv6 or Unix sockets fails with `EPERM`.
3. The worker has UID/GID 65534, zero effective capabilities, no-new-privileges, active seccomp, denied identity changes/forks and the exact process limits.
4. The actual normalizer and Tesseract process a synthetic label inside the required worker.
5. Cancellation leaves neither the wrapper nor its recorded namespace child alive when the operation returns.
6. Timeout leaves neither process alive when the operation returns.

The canary is deleted after the tests. A dependency or namespace restriction returns `BLOCKED`, exit 2, with zero deny cases claimed. Failed assertions return `FAIL`, exit 1. All six cases must pass to return `PASS`, exit 0. CI must preserve the result JSON and distinguish BLOCKED from PASS.

## Primary implementation references

- [Bubblewrap policy and namespace options](https://github.com/containers/bubblewrap/blob/main/bwrap.xml)
- [Bubblewrap project security scope](https://github.com/containers/bubblewrap)
- [Linux seccomp filter behavior and limitations](https://docs.kernel.org/userspace-api/seccomp_filter.html)

These describe the mechanisms. The native verifier supplies the environment-specific evidence. Neither source alone establishes that this PanelReply configuration has run successfully.
