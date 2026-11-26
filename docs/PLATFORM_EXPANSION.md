# November 23 platform expansion

Status: implemented for the next source-bound PR run. macOS execution is not yet verified. Existing run76 remains historical evidence for its own source.

## New executed scopes requested by the workflow

| Runner | Suites | Limits of the evidence |
| --- | --- | --- |
| `macos-15-intel` | Fixed callback entrypoint in Chromium, Firefox and WebKit | Actual POSIX server and private callback browser workflows. No live provider, messages, calling or calendar booking. |
| `macos-15-intel` | Fixed spreadsheet manual workflow in all three engines | Entry/correction, source image storage, CSV/XLSX, restart, product-bound encrypted recovery and the real unavailable OCR path. No successful native extraction claim. |
| `macos-26` | Portable Node, static client, fixed callback and manual spreadsheet suites in all three engines | Actual Apple Silicon execution is required. Browser engines remain Playwright's bundled engines. Bundled WebKit is not Safari. |

The Apple Silicon job asserts `process.platform === 'darwin'` and `process.arch === 'arm64'` before testing. Each report separately records observed OS, architecture, Node and browser versions, source commit, source manifest and all expected method results. The job runs the independent browser suites once each and preserves every report, including failures.

Selected-product screenshots are retained in separate `preview-*` artifacts for visual review. Apple Silicon captures use separate engine/suite folders. These artifacts never enter the `release-*` test-accounting input. Callback requirements include the 15-method selected suite with its scheduling, follow-up, conflict, retry, export/deletion, keyboard and reflow journeys.

### Run81 screenshot finding

[Run81](https://github.com/panelreply-business/panelreply-demo/actions/runs/45210035769) on the workflow-corrected candidate exposed a screenshot harness conflict with the workspace's CSP. In [Intel Mac callback WebKit](https://github.com/panelreply-business/panelreply-demo/actions/runs/45210035769/job/137816051081), the queue and scheduling journeys reached their optional capture calls, which emitted inline-stylesheet violations. The console assertions correctly failed those cases. A separate inline-font test injection also failed and is addressed by the application test follow-up.

Inspection of the installed Playwright 1.62.0 bundle confirms the cause. `inPagePrepareForScreenshots` inserts a `body {}` style when `syncAnimations` is true, before the early return for unchanged styles, caret and animations. WebKit's `shouldToggleStyleSheetToSyncAnimations()` returns true. Executing that preparation function with no screenshot style and both `hideCaret` and `disableAnimations` false still inserts the style. Changing screenshot options alone cannot prevent it.

The follow-up capture helper records `PANELREPLY_PREVIEW_UNAVAILABLE` for WebKit and returns from the optional artifact capture only. Every business, geometry, accessibility and console-error assertion continues. Chromium and Firefox captures retain `animations="allow"` and `caret="initial"`. No CSP allowance, error filter, browser fallback or test skip is introduced. The already-captured failed-run WebKit images remain diagnostic artifacts, not clean execution evidence. Actual verification of the corrected source requires its subsequent CI run.

The workflow uses standard labels only. GitHub's [runner reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners) lists `macos-15-intel` as Intel and `macos-26` as arm64. It identifies standard runner use for public repositories as free. No larger runner, billing setting or public service is configured.

## Spreadsheet scope

The production OCR launcher uses Linux process limits and fixed `/usr/bin/prlimit` and `/usr/bin/tesseract` paths. Installing a different OCR executable on macOS would not satisfy that contract.

`spreadsheet-manual` reuses the existing six non-OCR selected spreadsheet cases with their original case IDs. It does not run or relabel the Linux extraction case. Two cases in [macos_product_browser_test.py](../tests/macos_product_browser_test.py) add:

- Actual engine unavailability, disabled OCR controls and a rejected direct OCR request, with saved rows, source and version unchanged. Manual corrections and CSV export continue to work.
- Product-bound encrypted backup and restore through the shipped commands. The restored server rejects the prior session and disabled password, then preserves the project and source image bytes after an operator password reset. Callback routes remain denied.

Test fixtures use the runner-owned temporary workspace. They do not select macOS's `/var` symlink as a private data root. Production no-symlink, owner and permission checks remain unchanged.

## Accounting and remaining gates

The [milestone policy](test-milestones.json) adds 16 explicit automated requirements, bringing the automated inventory to 46. It retains all seven prior manual gates until source-bound evidence and acceptance review resolve their exact scope. It leaves the active target and first-goal achievement date unchanged.

The counter recognizes `spreadsheet-manual` only for an actual macOS report with the fixed spreadsheet deployment mode. That suite cannot satisfy the full `spreadsheet` requirement. Reused methods remain one distinct case across platforms and one execution per actual case/platform configuration. Scheduling and task Node tests belong to the callback product ledger. Evidence-harness tests remain excluded from the product test goal.

Windows private-server workflows, native macOS OCR, actual Safari, physical iPhone/iPad/Android and full assistive-technology testing remain open. The ARM workflow may also remain unexecuted if a standard runner is not assigned. A queued job is not a pass. The prior unassigned macOS15 ARM jobs remain in their historical reports.

### ARM runner assignment checkpoint

The November 23 review found [run81's `macos-26` job](https://github.com/panelreply-business/panelreply-demo/actions/runs/45210035769/job/137816051203) still queued, with `runner_id: 0`, an empty runner name and no executed steps. The [run74 jobs](https://github.com/panelreply-business/panelreply-demo/actions/runs/44784712205) requested `macos-15`. Their four ARM jobs now have a cancelled conclusion, also with no assigned runner or steps. Neither run supplies ARM test evidence. The cause of the assignment failure remains unconfirmed.

GitHub's [standard runner reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners) lists `macos-15`, `macos-26`, `macos-latest` and `xcode-27` as free arm64 labels for public repositories. The [image inventory](https://github.com/actions/runner-images/blob/main/README.md) maps `macos-latest` to the macOS26 ARM image, so it is not a separate verified capacity option. `macos-15` already has the unassigned observations above. The [`xcode-27` image](https://github.com/actions/runner-images/blob/main/images/macos/xcode-27-arm64-Readme.md) runs macOS27 and is labelled a public preview. It changes the operating-system and preview scope and has no repository execution evidence.

Keep the `macos-26` acceptance gate and its unexecuted status. This review changes no label, requests no paid runner, repeats no unavailable job and cancels no gate. A runner assignment followed by complete source-bound test reports is still required. Other authorized development can continue while this infrastructure blocker remains open.

## Local preparation results

- `node --test tests/release-evidence.test.cjs`: 83 harness tests passed, zero failures or skips. These do not count toward the product goal.
- Python compilation passed for the new suite and modified runner.
- `python tests/release_platform_runner.py --suite spreadsheet-manual --list --output /tmp/panelreply-macos-manual-collected.json` collected eight methods. Collection executes no browser tests.
- YAML parsing and milestone validation passed. The selected-product matrix contains twelve jobs. The Apple Silicon job has no paid label.

The local environment's known browser launch restriction was not retried or bypassed. Native macOS verification must come from the committed CI candidate.

## Daily execution constraint

The new full workflow will run from the existing pull request when verified source changes are committed. The currently deployed default-branch schedule still tests its older workflow and source. Branch-only workflow changes cannot replace that scheduled definition without a default-branch change.

The existing workflow also declares `workflow_dispatch`. A dispatch on the development branch can verify that branch without a production merge when an authorized dispatch interface is available. The current GitHub connector exposes failed-job reruns but no workflow-dispatch operation. Do not create empty commits, rerun successful jobs for counts, alter the default branch or claim a default-branch scheduled run verifies this development source.

## Next verification

1. Commit the coherent callback, OCR and platform candidate on the existing development branch.
2. Inspect every new macOS and ARM job, including all expected reports and observed architecture.
3. Repair any actual failures and rerun only as needed to verify those repairs.
4. Aggregate the matching source reports and retain earlier failures under their original source.
5. Review the remaining manual Mac/ARM gate definitions against the actual executed scope. Full Mac OCR, Safari and physical-device claims require their own evidence.
