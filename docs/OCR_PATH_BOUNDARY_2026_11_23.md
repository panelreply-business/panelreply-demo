# OCR required-mode path boundary

Date: 2026-11-23

Base commit: `76db2d67702c2eee57185e06221257e1083e522e`

## Reproduced defect

The required worker mounts the host `/usr` tree read-only. The original OCR factory did not receive the opened store directory or compare that mount with private data, repository or home paths. A protected directory equal to `/usr`, beneath it, or containing it therefore passed simulated required-mode readiness. A successful readiness cache also survived a private-path symlink being redirected into `/usr`.

The server supplied no private-directory context. Its storage path validation checked ownership, permissions and links, but did not prohibit an operator-owned directory beneath `/usr`. Such an installation could contradict the documented mount exclusion. This report establishes the missing preflight and incorrect factory acceptance. It does not claim an observed native data leak.

The reproductions use the actual OCR factory and startup functions. Native subprocess transport is simulated. Temporary directories and symlinks use the real filesystem. The tests explicitly inject account lookup failures, an `EACCES` error and canonical repository/script name projections where changing an installed path or host account would otherwise be required. No test writes into `/usr`, changes privileges, or starts bubblewrap.

## Repair

- The server passes `path.dirname(store.filename)` from the already-opened store to its OCR factory. Callback startup still creates no OCR service. Spreadsheet and combined integration startup retain their existing resource-limits mode.
- Required mode derives the loaded repository, environment-derived home and OS account home internally. Callers cannot replace those roots through extra factory options.
- The private directory, both homes, repository and runtime mount must be existing directories. Raw inputs must be absolute, nonempty, well-formed strings without NUL bytes. Native `realpath` resolves the original input before lexical path normalization could change symlink-plus-`..` semantics.
- Missing leaves, dangling links, link loops, inaccessible paths and nondirectory components return `isolation_path_context_unavailable`. There is no guessed-parent fallback.
- Equal, ancestor and descendant overlaps with the canonical runtime mount return `isolation_path_overlap`. Comparison uses directory boundaries, so a separate `/usr-adjacent` name does not overlap `/usr`.
- The one intended normalizer-file bind must resolve to the regular file `workspace/ocr-preprocess.py` beneath the canonical loaded repository. A redirected bind is refused.
- Checks precede cached readiness reuse and every child launch, including the dependency probe. A final check also precedes successful readiness. A private Symbol carries the fixed path reason through version and normalizer error handling, so an intervening path failure stays a configuration failure.
- Resource-limits mode returns before filesystem or account inspection. Existing version, namespace, seccomp, process, output, deadline and cancellation gates remain in place. No mount, fallback or public configuration option was added.
- The native verifier creates its synthetic private directory before readiness, supplies it to every required-mode service and removes it in an outer `finally`, including early readiness failure. Path failures classify as FAIL with zero native denial cases, while existing namespace-denial classifications stay unchanged.

## Reproducible verification

The clean baseline source manifest was `208410e4ed9dde46a4e72ec4b163a5c4dfe0c45ff45e214dd1e65f9029ead6cd`.

The final test files were copied without changes to a separate checkout of the base commit. Its source manifest, including those regression tests but excluding the repair, was `77c395f56247f7c97f8edbbf242172117d6d7e91df88eed3f003cd83b48ab9fa`.

| Selection | Passing | Failing | Skipped | Duration |
| --- | ---: | ---: | ---: | ---: |
| Final focused tests on unchanged runtime | 157 | 14 | 0 | 507.045 ms |
| Same focused tests with repair | 171 | 0 | 0 | 580.068 ms |
| Affected regression with loopback HTTP enabled | 294 | 0 | 0 | 5,920.580 ms |

All runs had zero cancellations and TODOs. Fourteen baseline failures comprised eleven factory/path counterexamples, the new combined-start context assertion, the strengthened existing spreadsheet-start assertion and one diagnostic classification case. The valid-path, adjacent-prefix and resource-limits controls already passed on the baseline.

There are fifteen new product test methods and one new harness-only method. Existing required-mode tests now supply an existing synthetic directory. Test counts above overlap and must not be added together. The diagnostics file remains excluded from product-goal credit by the existing collector. No native isolation case or benchmark case receives credit from this work.

Focused command:

```bash
node --test --test-reporter=tap tests/ocr-path-boundary.test.cjs tests/ocr.test.cjs tests/ocr-isolation.test.cjs tests/ocr-isolation-diagnostics.test.cjs tests/product-config.test.cjs
```

Affected regression command:

```bash
WORKSPACE_HTTP_TESTS=1 node --test --test-reporter=tap tests/ocr-path-boundary.test.cjs tests/ocr.test.cjs tests/ocr-isolation.test.cjs tests/ocr-isolation-diagnostics.test.cjs tests/product-config.test.cjs tests/product-boundaries.test.cjs tests/panel-api.test.cjs tests/workspace-http.test.cjs
```

The affected run includes real loopback sockets, startup/shutdown, authentication and saved-data assertions. It does not launch the required OCR worker. Syntax checks also passed for both changed OCR modules and the native verifier. `git diff --check` passed.

The candidate source manifest stayed `12bcbc9106163c54baff86e1e685fdec4aef2e31b6fb82c2264a598f11facc32` before and after the affected run. [The evidence record](evidence/ocr-path-boundary-2026-11-23.json) preserves commands, source hashes, log hashes, baseline failure names and the new method outcomes.

Platform peer review found no concrete defect in runtime canonicalization, bidirectional containment, normalizer identity, trusted server context, per-stage checks or error classification. That review was read-only and did not repeat tests or run native commands. Root integration and its final source-bound regression remain separate gates.

## Remaining limits

Required mode now rejects installations, private directories or home paths overlapping `/usr`. All context directories must already exist and be resolvable. The existing store rejects linked path components independently. The fixed normalizer file remains the sole intentional repository-file mount.

This preflight assumes a trusted, stable host filesystem. It does not pin path handles or stop concurrent privileged topology changes. [Node documents](https://nodejs.org/docs/latest-v24.x/api/fs.html#fsrealpathpath-options-callback) that canonical names are not unique through hard links and bind mounts. The guard does not prove the absence of those aliases or private content already copied into `/usr`. Such host and mount configuration remains outside its proof.

The current environment's denied namespace result remains BLOCKED, with zero native denial cases and an unconfirmed external-blocker classification for its observed `Failed RTM_NEWADDR` message. That attempt was not repeated. The six native tests must still run on an authorized host under the unchanged policy. The verifier's modified cleanup path was reviewed and syntax-checked, not executed natively here.

Extraction, frozen labels, model files and expected answers were not changed. No accuracy benchmark was rerun or promoted. The documented remaining OCR accuracy and real-image acceptance gates remain open. This repair does not approve hosting, deployment or release.
