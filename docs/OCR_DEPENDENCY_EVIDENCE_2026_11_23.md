# OCR dependency evidence and rejected experiments

Recorded November 23, 2026. Metadata patch based on `e711d15d418406969631202642c9d055b47afca5`.

## Result

The benchmark now records the English and orientation model files, TSV configuration, and fixed native executable hashes. It discovers the model directory from the existing engine language probe. It does not infer model identity from the engine version.

The complete frozen production replay remains 289 exact images out of 310. All 263 expected blank fields remain blank. There are zero native errors and zero review violations. Accuracy remains `FAIL`.

All extracted fields, raw text, warnings, processing metadata, and exact/nonexact results match the prior deskew run. No extraction source or installed model changed. The metadata observer added zero OCR processes. All 660 observed children closed.

The machine-readable record is [ocr-dependency-2026-11-23.json](evidence/ocr-dependency-2026-11-23.json). It contains all 310 production field outcomes, dependency snapshots, verifier results, and the rejected experiments. The prior complete processing evidence remains in [ocr-deskew-2026-11-23.json](evidence/ocr-deskew-2026-11-23.json).

## Evidence contract

`scripts/ocr-dependency-evidence.cjs` observes the native processes already created by the service. It preserves the child object, arguments, environment, output streams, and lifecycle. It does not launch another readiness probe or alter production settings.

The observer records successful fixed-engine `--list-langs` output. It validates the absolute data-directory banner and complete language list. Missing, failed, malformed, truncated, or unobserved output leaves the directory and dependent hashes unavailable. A version string alone cannot establish a model hash.

Before and after image measurement, it hashes:

- `/usr/bin/prlimit`, `/usr/bin/tesseract`, and `/usr/bin/python3`
- `eng.traineddata` and, when reported, `osd.traineddata`
- `configs/tsv` under the observed data directory

File reads use fixed-size chunks and a 64 MiB per-file ceiling. The collector resolves package symlinks, checks regular-file identity and metadata around each read, and withholds a hash if a file changes during collection. Requested and resolved paths remain visible. An absent optional OSD language remains `NOT_REPORTED` with a null hash.

Invocation profiles retain the actual arguments, resource limits, working directory, and selected non-secret execution settings. Their SHA256 excludes invocation counts. Probe histories and command profiles have capture limits. A capture limit leaves identity blocked.

The benchmark writes `dependencyEvidence` and a separate `identityGate`.

| Identity gate | Meaning | CLI result |
|---|---|---|
| `PASS` | Required file identities are available and match at both boundaries, with consistent observed directory and settings | Measurement proceeds |
| `BLOCKED` | One or more required identities cannot be established | Writes measurements, exits 2 |
| `FAIL` | A model, configuration, executable, observed data directory, or execution setting changed | Writes measurements, exits 1 |

An unavailable native engine also produces a saved blocked report with zero image measurements. Native errors or review violations still fail the command. `accuracyGate` remains independent of dependency identity.

These are pre/post file snapshots. They do not attest every file open during the run or identify every shared library and Python package. File collection timing stays outside recognition latency and parent CPU timing.

## Observed native identities

The production engine reported `/usr/share/tesseract-ocr/5/tessdata/`, English and OSD. Tesseract reported version 5.5.0. The normalizer reported Pillow 11.1.0. All six file hashes matched independent `sha256sum` reads.

| Dependency | SHA256 |
|---|---|
| English model | `7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2` |
| OSD model | `9cf5d576fcc47564f11265841e5ca839001e7e6f38ff7f7aacf46d15a96b00ff` |
| TSV configuration | `59d079bb75d8b3d7c839a3564580cb559e362c93a9d70f234e421c0c3e767e04` |
| Tesseract executable | `74b76a5b994adcc18be362bf64ed5118082b2401d5d9a35242e92fc4c62e2b4b` |
| Resource limiter | `06275e616ca2b721482aeb564260489be3fdc6d5f86836b4a78e96485845f060` |
| Python executable, resolved to `python3.13` | `889c603f0d17cb54060951bcf4c4f9b8c9ebd9e52b392c70209bbb9755d797d9` |

The frozen dataset manifest SHA256 is `9cb1e68c4dee1a83a7a14fa1735917cba117a145cec57067e148799baf897601`. All 310 image hashes were checked again after measurement. The extraction pipeline SHA256 remains `65b6a4d7bce19baabc5ea5480c19bbb159dd1fe9f9551b6691c28dcf923836b4`.

The replay observed median/p95/max recognition times of 279/564/998 ms and 97,584 ms total measurement time. Dependency collection took 94 ms. The sampled child-memory high water was 73,338,880 bytes. Sampling every 10 ms gives an observed lower bound. These observations came from a shared host and do not establish a speed improvement or hosting SLA.

The full replay ran from the earlier detached deskew worktree. Its extraction pipeline bytes equal committed `e711d15`, and its benchmark/collector bytes equal this patch. The final accounting changes were tested separately in the detached worktree based on `e711d15`. Source-bound CI remains required after integration.

## Verification and counting correction

The focused command passed 125 tests, with zero failures, skips, cancellations, or TODOs.

```bash
node --test tests/ocr-dependency-evidence.test.cjs tests/ocr-benchmark.test.cjs tests/ocr-isolation-diagnostics.test.cjs tests/release-evidence.test.cjs
```

The 21 new verifier cases cover actual file hashing, empty and multi-chunk files, missing/nonregular/oversized files, changes during hashing, strict banner parsing, unchanged stdout and spawn arguments, failed or excessive probes, absent provenance, model/configuration/binary replacement, optional OSD absence, temporary data-directory changes, execution-setting changes, bounded observation, blocked reports, and goal-count exclusion. A separate agent reviewed the observer and ran the first 20 cases before the accounting-only regression addition. That overlapping run receives no extra goal credit.

The classifier now excludes all four evidence-tooling files in this command from product-goal credit. The aggregate reader rejects attempts to relabel those files as product coverage.

The previous `e711d15` report recorded 9,000 product passes under the earlier classifier. Thirteen of those cases tested evidence tools:

- Five in `tests/ocr-benchmark.test.cjs` tested counters, percentiles, and the process sampler.
- Eight in `tests/ocr-isolation-diagnostics.test.cjs` tested diagnostic observation and host-failure classification.

The comparable corrected count is 8,987 before other product additions. Historical reports remain unchanged. Those tests passed. This is a classification correction, not a new failure. Production OCR/isolation checks and owner-facing backup, recovery, and account operations remain product coverage. The new verifiers, benchmark replay, and experiments in this report receive zero added numeric-goal credit.

## Rejected alternative English model

The official [tessdata_best repository](https://github.com/tesseract-ocr/tessdata_best) was read into a temporary directory. The installed model remained unchanged.

- Upstream commit `e12c65a915945e4c28e237a9b52bc4a8f39a0cec`
- English Git blob `176dc3220de7db34d3b3aecbfa42043a6038348b`
- English SHA256 `8280aed0782fe27257a68ea10fe7ef324ca0f8d85bd2fd145d1c2b560bcb66ba`
- English file size 15,400,601 bytes
- Apache-2.0 license, SHA256 `a6cba85bc92e0cff7a450b1d873c0eaa2e9fc96bf472df0247a26bec77bf3ff9`

Only a temporary pipeline copy received `TESSDATA_PREFIX`. Its directory contained the unchanged installed OSD model and TSV configuration. An initial spot probe lacked the TSV configuration and failed with `OCR_OUTPUT_INVALID`. The missing temporary file was supplied before the recorded complete run. That setup failure is retained and receives no passing credit.

The complete 310-image experiment also scored 289 exact cases. It gained `abbreviated--clear-serif`, `abbreviated--skew-horizontal`, and `confusable--large-64px`. It regressed `confusable--clear-serif`, `confusable--small-22px`, and `punctuation--rotate-90`.

All 263 expected blanks remained blank. Native errors and review violations stayed at zero. Median/p95/max time was 381/742/1,619 ms, with 130,746 ms total and 80,879,616 bytes sampled child-memory high water. These are observations from the same shared environment, not controlled performance attribution.

The model was rejected as a default. It gave no net exact-case gain and lost previously correct outputs. The evidence retains all 310 field outcomes, raw text, gains, and regressions. A later readiness-only probe confirms the temporary model location and file hash. It does not retroactively claim that the new collector ran during the earlier experiment.

## Rejected line segmentation

An 82-image screen used pixel-derived horizontal ink bands, merged nearby components, cropped all foreground pixels, and added a background border. The screen included all 21 remaining failures, font and small-text controls, and the four deskew gains. The experiment used bounded native calls but was not integrated into the production image deadline.

| Segmentation | Exact within the 82-image screen | Gains | Regressions | Decision |
|---|---:|---:|---:|---|
| PSM 7 | 55 | 0 | 6 | Rejected |
| PSM 13 | 28 | 1 | 34 | Rejected |

The baseline was exact on 61 of these 82 images. Neither screen introduced a nonblank value into an expected blank field. Their regressions were sufficient to reject them without a redundant 310-image replay. The source scripts and every screen result are retained in the JSON evidence. Neither screen counts as a passing product test.

## Remaining OCR work

Production still has 21 nonexact images: 18 character-confusion cases, two abbreviated-label cases, and one part-number spacing case. No answer substitution, part-number guessing, compatibility inference, or automatic review approval was added.

The next release evidence must use the committed metadata patch in CI and retain both new fields in the compact report. Required OS isolation and representative owner-approved image acceptance remain separate incomplete gates. The rejected models and segmentation modes remain outside production.
