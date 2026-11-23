# OCR isolation host observations

## Status

This candidate adds evidence around the existing restricted OCR verifier and prepares a comparison on two standard GitHub Linux images. Neither product imports these observation scripts. No production OCR option, worker policy, native case, release policy or product test identifier changes.

The existing Ubuntu 24.04 job keeps its name. Ubuntu 26.04 receives a separate matrix entry. Both use the same pinned non-setuid Bubblewrap source, build arguments, unprivileged verifier and six native assertions. The matrix disables fail-fast so one host does not cancel the other host's evidence.

Native execution on the candidate source has not run. Prior Ubuntu 24.04 failures remain unresolved. This change does not accept Ubuntu 26.04, repair Ubuntu 24.04, select a hosting environment or approve public uploads.

## Why compare host defaults

GitHub lists both `ubuntu-24.04` and `ubuntu-26.04` as standard x64 runner labels. Its standard public-repository runner table describes their use as free. This project remains a public repository. No paid runner, service purchase or settings change is part of this experiment.

Ubuntu's 25.04 release notes describe a `bwrap-userns-restrict` AppArmor profile that permits sandbox setup and then restricts capabilities inside the sandbox. That documented change motivates observing a later supported host image with its defaults. It does not prove that AppArmor caused any captured PanelReply failure or that a particular profile exists, is loaded or attaches on either GitHub runner.

Primary references checked November 23, 2026:

- [GitHub-hosted runner labels and public-repository terms](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)
- [Ubuntu 25.04 AppArmor changes](https://documentation.ubuntu.com/release-notes/25.04/#apparmor-profile-for-bwrap)
- [GitHub's Ubuntu 26.04 image inventory](https://github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu2604-Readme.md)

The report records the actual OS, kernel, architecture and available image labels. A changing online image inventory is not substituted for those observations.

## One native execution

`scripts/observe-ocr-isolation.cjs` launches only the existing `scripts/test-ocr-isolation.cjs`, through the running Node executable, with fixed arguments, no shell and ignored stdin. It does not launch an additional Bubblewrap probe.

The wrapper requires a dependency build outcome. The workflow always runs the observation step after the build step, including a failed or skipped build. A failed, cancelled, skipped or unknown build produces FAIL evidence with all six cases NOT_RUN and zero verifier attempts. Finding an existing `/usr/bin/bwrap` does not allow that binary to run after a build failure.

A clean-source preflight is also required before launching the verifier. A dirty or unavailable source produces FAIL evidence and zero attempts.

With a successful build and clean source, one verifier attempt runs. There is no retry. The wrapper retains at most 128 KiB of stdout and 4 KiB of stderr. It does not include raw child stderr in the report. Invalid JSON, output overflow, launch errors, termination and a four-minute deadline cannot become a passing result. Overflow or timeout requests termination only of the child created by this wrapper. No PID search or unrelated process termination occurs.

A native PASS requires the original six distinct case names, six passing results, zero failures, no privileged retry and exit code zero. BLOCKED retains the verifier's zero-case result and exit code two. Native FAIL remains FAIL. The workflow preserves its existing warning-only job handling of BLOCKED, but the artifact continues to say BLOCKED and cannot count as isolation acceptance.

## Source and dependency binding

The wrapper records the complete source manifest, commit, tree, digest and cleanliness before and after the verifier. Unavailable, dirty or changing source fails the evidence. It uses the existing source-evidence collector and leaves the collector's counting policy unchanged.

The fixed `/usr/bin/bwrap` path is opened read-only with `O_NOFOLLOW`. One held handle provides metadata before and after a bounded read. A changed file identity, nonregular file, oversized file or read error cannot produce a valid binary observation. A native PASS also requires the same observed executable identity and SHA-256 before and after execution. Hashing bytes is not a signature check, loaded-memory attestation or proof of authenticity.

The installed dependency remains pinned to upstream commit `2a76602a8c71f36c1527cf9fc3417d9149822e0c`. The workflow continues to install mode 0755 and reject setuid/setgid bits. No AppArmor package, profile, reload command, namespace setting, seccomp setting or capability grant is added.

## Bounded host fields

`scripts/ocr-isolation-host-context.cjs` reads only these fixed files. It rejects caller-selected paths. Every content read stops at its byte ceiling plus one overflow-detection byte. Truncated input is unavailable, not partially accepted.

| Input | Limit | Retained information |
| --- | ---: | --- |
| `/usr/lib/os-release` | 8 KiB | `ID`, `VERSION_ID`, `BUILD_ID` |
| `/proc/self/status` | 16 KiB | Five capability masks, `NoNewPrivs`, `Seccomp`, `Seccomp_filters` |
| `/proc/self/attr/current` | 512 bytes | A bounded label with an optional single terminating NUL |
| Four fixed namespace sysctl files | 32 bytes each | Valid numeric values only |
| AppArmor enabled parameter | 16 bytes | An observed `Y`, `N`, `0` or `1` |
| Loaded AppArmor profile listing | 64 KiB | Only bounded `bwrap` or `unpriv_bwrap` names and modes |
| `/usr/bin/bwrap` | 8 MiB | File identity, size and SHA-256, without binary content |

The observer performs `lstat` on three fixed profile filenames under `/etc/apparmor.d`. It reports file, symlink or other type without following the target or reading the profile body. Every such observation keeps `attachment: NOT_ESTABLISHED`.

The only environment values retained are bounded `ImageOS` and `ImageVersion` runner labels. No environment dump, hostname, account name, process list, audit log or profile-directory scan is collected.

Missing, denied or malformed fields stay UNAVAILABLE with fixed error codes. Missing data never means a control is disabled. A profile file does not prove loading or attachment. A parent Node process label, capability mask or seccomp state does not prove the worker state. The unchanged native assertions check the actual worker.

Host context does not alter the native outcome. Available-looking context cannot promote BLOCKED or FAIL. Missing context cannot erase an otherwise valid native result. Source and executable binding remain separate evidence requirements.

## Evidence and counting

Each host uploads `ocr-isolation-host-<os>-attempt-<attempt>`, outside the `release-*` artifact pattern. The JSON sets `releaseCredit: false` and `productPassing: 0`. An observed native result applies only to that test host. It does not satisfy a different operating system, production host, physical-device gate or either product's release decision.

The existing nine diagnostic tests remain unchanged. Twenty added diagnostic cases cover read limits, fixed paths, whitelisted fields, redacted errors, missing-data semantics, NUL handling, held-file identity, source changes, case/exit validation, one-attempt behavior, output/time bounds, build failures and nonpromotion of native outcomes. Their existing test file remains classified as harness evidence. No new product case receives numeric-goal credit.

Validation commands:

```sh
node --test tests/ocr-isolation-diagnostics.test.cjs tests/ocr-isolation.test.cjs tests/release-evidence.test.cjs
node scripts/observe-ocr-isolation.cjs /tmp/panelreply-ocr-build-failure-observation.json --build-outcome failure
```

The second command verifies only the source-bound build-failure reporting path. It executes zero native cases and must exit one. Its local dirty-source state remains explicit. It is not a native-isolation test.

The development evidence JSON records the final source hashes, test log digest, workflow checks and local build-failure observation. Native CI, root review and a committed source remain outstanding until their own reports exist.
