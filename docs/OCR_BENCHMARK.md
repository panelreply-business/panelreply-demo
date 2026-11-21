# OCR benchmark and resource verification

## 2026-11-20 remediation result

The current pipeline exactly matched 277 of the same 310 synthetic images. The verified `36b2bf30990eb164f6327e1eaa71e1386432da4f` baseline matched 253. All 57 original nonexact cases were inspected. Twenty-four now match exactly. Thirty-three still need manual correction. None of the 253 previously exact images regressed. All 263 expected blank fields stayed blank. No native execution error or automatic-review violation occurred.

The strict all-image extraction gate remains FAIL. These are synthetic stress measurements, not 310 passing OCR tests or a real-photo accuracy claim.

| Measurement | Reproduced baseline | Current pipeline |
| --- | --- | --- |
| Images matching every expected field | 253/310 | 277/310 |
| Known part numbers: exact / missing / wrong | 177 / 13 / 29 of 219 | 197 / 1 / 21 of 219 |
| Known manufacturers: exact / missing / wrong | 190 / 19 / 10 of 219 | 206 / 5 / 8 of 219 |
| Known descriptions: exact / missing / wrong | 210 / 15 / 4 of 229 | 229 / 0 / 0 of 229 |
| Blank-field false positives | 0/263 | 0/263 |
| Native errors / review violations | 0 / 0 | 0 / 0 |
| Median / p95 / maximum image time | 245 / 394 / 823 ms | 325 / 827 / 1,919 ms |
| Total run time | 79,771 ms | 120,492 ms |
| Largest observed native child RSS/high-water | 39,526,400 bytes | 73,342,976 bytes |

Native memory was sampled from the spawned children's Linux `/proc` status every 10 ms. This is an observed lower bound, not an exact kernel peak or the sum of concurrent descendants. All 314 baseline child processes and 660 current child processes had samples and closed. The two current OCR passes and normalizer run sequentially. Node parent memory/CPU remain separate in the reports. Timings shared a development machine with other tests. They are not controlled performance comparisons or hosting guarantees. The extra image check and occasional orientation pass add work.

Both runs used Tesseract 5.5.0. The normalizer uses fixed `/usr/bin/python3` with system Pillow 11.1.0. Dataset generation used Pillow 13.0.0 and the original recorded fonts. The manifest SHA-256 remains `9cb1e68c4dee1a83a7a14fa1735917cba117a145cec57067e148799baf897601`. Every original image hash was checked before recognition and checked again after the final run. The generator and input files were not changed.

The frozen pipeline SHA-256 is `6ea83a79dde4d68f4edb26717bedfb0aa1261684f848e6dd29ceddf4550e6fdd`. Its definition and individual source hashes are recorded in the evidence. The engine-module hash recorded by the running benchmark matches the final source.

This final measurement follows a required-isolation dependency gate for [CVE-2026-87766](https://ubuntu.com/security/CVE-2026-87766). Required mode now rejects Bubblewrap versions older than upstream 0.12.0 before namespace setup. Its only preliminary read is fixed, bounded `bwrap --version`. The benchmark used the unchanged ordinary resource-limits mode. All 310 extraction, raw-text, warning, review and processing results match the preceding pipeline exactly. The [previous comparison](evidence/ocr-remediation-pre-version-gate.json) and [previous full case outcomes](evidence/ocr-remediation-after-310.json) remain preserved. The version gate does not establish working OS isolation.

### Changes retained

1. Conditional noise normalization. A fixed local Python/Pillow helper counts isolated bright/dark pixels that differ from their eight neighbors. It applies a 3×3 median filter only when at least `max(32, ceil(imagePixels/1000))` isolated pixels are present. The rule uses pixels, not fixture IDs, expected text or known parts. It activated on 16 noisy images in this set. Eleven previously nonexact noisy cases now match. Other images retain their original recognition bytes after existing PNG metadata removal.
2. Orientation fallback. If the first PSM 6 pass returns nonempty text without any explicit labelled candidate and `osd` is installed, one PSM 1 pass may replace that whole result. It never merges fields, replaces an existing partial/ambiguous candidate or repairs characters. This recovered 13 additional exact quarter-turn images. Fourteen fallback results had candidates, one still contained a character error. The fallback was attempted 34 times, including unlabelled inputs that correctly stayed unlabelled.
3. Shared limits. Normalization and both recognition passes share one monotonic 15-second wall deadline and one active-request slot. OCR text passes share 512 KiB of stdout plus stderr. Normalized PNG output has a separate 8 MiB plus 1 KiB header cap. Each child keeps the 1 GiB address-space, 10-second CPU, 64-descriptor and zero regular-file/core-output limits. Ten CPU seconds is a per-child limit, not a claimed ten-second aggregate CPU budget. Cancellation/shutdown kill and reap the active stage before releasing the slot.

Original stored bytes never change. The normalizer returns only a temporary pixel copy. Candidates remain unreviewed and the OCR adapter still does not save rows or replace manual edits. If the fixed Python/Pillow helper is missing or fails its readiness contract, OCR is unavailable. There is no silent fallback to a different measured pipeline.

### Experiments rejected

All 57 failures plus 18 deterministic passing controls were used for screening. The full set was then used to check the promising change. Screening alone was insufficient.

| Experiment | Screening outcome | Decision |
| --- | --- | --- |
| Sauvola thresholding | One gain and one regression | Rejected |
| Adaptive Otsu | Nine gains and one regression | Rejected as a global default |
| 2× scaling | Ten gains and two regressions | Rejected as a global default |
| Unconditional 3×3 median filter | Thirteen gains and no loss among the 18 screening controls | Full set fell to 252/310, with 14 regressions and one false-positive manufacturer. Rejected |
| Median filter plus 2× scaling | Twelve gains and one regression | Rejected |
| Auto-contrast | No change | Not retained |
| Dictionary disabling | No change | Not retained |
| Character substitution, punctuation stripping or catalogue repair | Would alter recognized values without source evidence | Not retained |

The selected noise detector avoided the unconditional filter's control regressions in the full replay. That threshold has not been validated on real panel photographs. No claim is made for glare, wear, camera perspective, handwriting or other unmeasured inputs. [Tesseract's image-quality guidance](https://tesseract-ocr.github.io/tessdoc/ImproveQuality.html) and [segmentation options](https://tesseract-ocr.github.io/tessdoc/Command-Line-Usage.html) informed the experiments. The measured results determined what was retained.

### Remaining 33 cases

The remaining cases fall into five groups, assigning each image to one group: 18 confusable-character cases, five abbreviated-label recognition failures, seven downsample punctuation cases, two other part-number punctuation cases and one letter-case difference. Some images have more than one incorrect field. Do not remove punctuation, substitute `I/1` or `O/0`, or guess a manufacturer to make these cases pass. All remain review-and-correction work.

### Verification and evidence

- 88 OCR, benchmark-accounting, isolation-policy/adapter and diagnostic-observer unit tests PASS, zero failures or skips. The dependency-gate tests use mocked children and do not execute native isolation.
- Nine native fixture/failure cases PASS, zero failures.
- Eight native resource/lifecycle cases PASS, zero failures or blocked cases. These include limits on the normalizer, actual normalizer cancellation, and actual orientation-fallback cancellation.
- Local OS isolation is BLOCKED by the host namespace restriction. The required worker and six-case native verifier are prepared. No local retry, privileged fallback or hosting change was made. See [restricted worker policy](OCR_ISOLATION.md).
- Real photographs are NOT TESTED. The revised Tesseract 5.3.4 CI measurement is recorded separately below, with its distinct font/manifest hashes.

[Remediation summary, all 57 failure investigations, experiments and native-test reports](evidence/ocr-remediation.json). [Full baseline case outcomes](evidence/ocr-remediation-baseline-310.json). [Full current case outcomes](evidence/ocr-remediation-version-gate-310.json).

To repeat against a trusted baseline checkout without editing it:

```bash
node --test tests/ocr.test.cjs tests/ocr-benchmark.test.cjs tests/ocr-isolation.test.cjs tests/ocr-isolation-diagnostics.test.cjs
node scripts/test-ocr-fixtures.cjs
node scripts/test-ocr-resource-limits.cjs
node scripts/benchmark-ocr.cjs /tmp/panelreply-ocr-benchmark /tmp/ocr-before.json /path/to/baseline/workspace/ocr.cjs
node scripts/benchmark-ocr.cjs /tmp/panelreply-ocr-benchmark /tmp/ocr-after.json
```

Use the unchanged generator, recorded Pillow/fonts and matching manifest/image hashes. Runtime prerequisites are Tesseract 5, `eng`, `osd` for orientation, util-linux `prlimit`, and fixed `/usr/bin/python3` with Pillow. These are local test/runtime dependencies. No provider service is activated.

## CI cross-version measurement

[Run68, job136023013605](https://github.com/panelreply-business/panelreply-demo/actions/runs/44656230988/job/136023013605) ran the preceding production pipeline hash `dc631869d414815a492859487225ac56580fb0e744f315a54b8f97f2f6b6fcc5` with Tesseract5.3.4 and system Pillow10.2.0. Its generator used Pillow13.0.0. It reported 277/310 exact cases, zero native errors and zero review violations. Every compact per-image extraction result matched the local final result.

The CI manifest hash is `7067e55235fedf48d3c81653f085841c80cc6632fa012cc821371dd9066e3c2e`. It differs from the local unchanged-input benchmark because the recorded font binary hashes differ. This is a separately generated dataset with the same scenario IDs. It must not be described as the identical local image set. The local 253-to-277 comparison above still uses unchanged image hashes throughout.

CI latency measured 175 ms median, 359 ms p95 and 683 ms maximum, with 61,226 ms for the full measurement. The 10 ms sampler observed 81,207,296 bytes peak native RSS. All 660 observed native processes closed. That sampled memory figure is an observed lower bound and does not sum simultaneous descendants. Different runners and native dependencies prevent treating CI/local timing differences as a product speed improvement.

[CI source, engine, font, manifest, field and process measurements](evidence/remediation-run68-ocr.json). [Per-image cross-version comparison](evidence/remediation-run68-ocr-comparison.json). The strict quality gate remains FAIL and real photographs remain NOT TESTED.

## Historical 2026-11-19 verification

The earlier results below are preserved for traceability. The current measurements above supersede their extraction counts and runtime dependency description.

Date: 2026-11-19. This extends the six clean-label fixtures. It does not establish real-job-site accuracy or authorize customer images.

## Result

The 310-image synthetic benchmark completed before and after two parser corrections. The original source was commit `41e31a8683bbf2e587b4dfcec8c5d2f2a65cffa8`. Both runs used the same generated image hashes, Tesseract 5.5.0/English, DejaVu fonts and Pillow 13.0.0.

| Measurement | Baseline | Corrected source |
| --- | --- | --- |
| Cases matching every expected field | 252/310 | 253/310 |
| Exact part numbers | 177/219 known values | 177/219 |
| Exact manufacturers | 190/219 known values | 190/219 |
| Exact descriptions | 210/229 known values | 210/229 |
| Nonempty values where the expected field was blank | 2/263 blank fields | 0/263 |
| OCR execution errors | 0 | 0 |
| Automatically reviewed candidates | 0 | 0 |
| Median elapsed time per image | 224 ms | 256 ms |
| p95 elapsed time per image | 360 ms | 429 ms |
| Maximum elapsed time per image | 546 ms | 816 ms |
| Total measurement time | 73,451 ms | 83,978 ms |

The strict all-fixture extraction gate is FAIL: 57 images still have a missing or incorrect value. This is a measured limitation, not 310 passing regression tests. The corrections remove the two observed unknown-field false positives. They do not repair ambiguous OCR characters or claim general accuracy gains.

The timing runs shared a development machine with other work. No latency improvement or regression is attributed to the code from these uncontrolled timings. The JSON records Node parent RSS/CPU separately and explicitly excludes native child RSS/CPU.

[Machine-readable comparison, image-set hash, source hashes, field metrics, every case outcome and failure corpus](evidence/ocr-benchmark-prelaunch.json).

## Dataset

Sixteen data scenarios are combined with twenty imaging/layout conditions. Ten byte-identical blank-image variants are removed before scoring, leaving 310 unique image-byte inputs. This is a bounded factorial stress set, not 310 independent customer examples. Both final scored runs used the deduplicated manifest. Earlier exploratory runs of the 320 combinations are not counted again.

- Data: full labels, abbreviated labels, lowercase, reordered fields, leading-zero numbers, O/0 and I/1 character confusion, punctuation, an invented manufacturer, each missing field, conflicting part numbers, conflicting manufacturers, multiple components, unlabelled text and blank images.
- Imaging: three font families, 22/42/64 px text, rotations of +1/+3/-3/90 degrees, horizontal skew, two blur levels, low contrast, inverted colors, deterministic noise, one-third scaling, JPEG quality 35, cropping the last line, tight spacing and wide spacing.
- Crop expectations remove the missing field. Multiple-component ambiguity is expected to remain unknown. Source manufacturers and part identifiers are fictional.

Quarter-turn rotation, noise and downsampling remain the largest failure groups. For example, the baseline exactly matched 2/16 quarter-turn cases, 4/16 noisy cases and 7/16 downsampled cases. Every candidate stays unreviewed even when confidence is high. Raw text and source images remain available for manual correction.

The generator records font checksums, Pillow version and every image SHA-256. Images are generated in a temporary directory, not committed or served as application assets. Different font/rendering versions must be recorded as a different dataset rather than silently compared as identical inputs.

## Confirmed defects corrected

| Priority | Reproduction | Correction | Evidence |
| --- | --- | --- | --- |
| Medium | `multiple-components--crop-last-line`: different part numbers and manufacturers, but one visible description. The parser returned that description against an unknown component. | More than one conflicting core field blanks all candidate values. Raw text remains unchanged for a person to separate components. | Parser regression plus the native image changes from a false positive to an exact unknown result. |
| Medium | `conflicting-manufacturers--noise`: OCR produced a `-MANUFACTURER:` line. The parser ignored it and selected the other manufacturer. | Accept one leading bullet or hyphen before an otherwise exact label. Never alter extracted value characters or infer a label from arbitrary prose. | Parser regression and native replay preserve the conflicting manufacturer as blank. The part-number character error remains visible in the failure corpus. |

## Process bounds and lifecycle

Every native probe and recognition now executes through fixed `/usr/bin/prlimit` and then fixed `/usr/bin/tesseract`, with `shell:false`, sanitized environment and stdin-only image bytes. No HTTP input can select commands, options, limits or paths.

- Address space: 1 GiB hard and soft limit. This is virtual memory, not a measured peak-RAM claim.
- CPU: 10 seconds hard and soft limit.
- Open files: 64.
- Core dumps and regular-file output: zero bytes.
- Existing 15-second wall timeout, 512 KiB combined output limit, one active recognition, image limits and kill/reap behavior remain.
- Missing limiter or engine fails closed. There is no unbounded fallback.
- `createOcrService().shutdown()` and the singleton `shutdown()` cancel readiness and recognition, wait for native close, and reject subsequent recognition. Calls are idempotent.

These are process resource limits. They do not isolate the native decoder from the host filesystem/network and are not a substitute for an approved container/worker boundary and native-library patch policy.

## Verification

- 45 OCR component/process-adapter tests PASS, zero failures.
- Four benchmark-accounting tests PASS, zero failures.
- Existing nine native image/failure cases PASS, zero failures.
- Five additional native resource/lifecycle cases PASS, zero failures.

The five native cases independently check actual Linux ceilings and a rejected allocation beyond the address-space ceiling, rejected regular-file output, a bounded one-second CPU test that is killed/reaped, a native crash with no remaining process, shutdown while actual Tesseract runs, and concurrent recognition rejection. Several assertions belong to the same case. Do not add assertions to the case count. The production CPU ceiling remains ten seconds. The one-second loop is a tightened isolated test setting.

A first version of the resource-test helper used Python's automatic temporary-directory probe. The zero-file-output limit correctly prevented that probe's write. The fixture now chooses `/tmp` explicitly, tests the denied write, and removes its empty test file. No application limit was relaxed.

Reproduce from the repository root:

```bash
node --test tests/ocr.test.cjs tests/ocr-benchmark.test.cjs
node scripts/test-ocr-fixtures.cjs
node scripts/test-ocr-resource-limits.cjs
python tests/fixtures/panels-benchmark/generate.py /tmp/panelreply-ocr-benchmark
node scripts/benchmark-ocr.cjs /tmp/panelreply-ocr-benchmark /tmp/panelreply-ocr-results.json
```

Native commands require local Tesseract 5/English and Linux util-linux `prlimit`. The resource-test helper also needs `/usr/bin/python3`. Dataset generation needs Pillow and DejaVu fonts. No runtime installer, network provider or paid integration is added.

The benchmark CLI reports `MEASURED` separately from `accuracyGate`. Nonexact extraction is recorded as `accuracyGate: FAIL`. Missing local prerequisites return BLOCKED/exit 2. Native execution or review-contract failures return FAIL/exit 1. Completing measurements must never be described as passing extraction accuracy.

## Remaining gates

Representative, authorized noncustomer photographs remain unavailable. Real-photo accuracy is NOT TESTED. Physical-device camera artifacts, glare, wear, perspective, multilingual labels and handwriting require a controlled image set before launch claims. This set includes simple affine skew, not a substitute for all perspective effects.

The current product remains a review-and-correction workflow. It supports zero or one candidate per image and does not identify part compatibility, substitute manufacturer guesses, or certify electrical specifications. A crop/orientation control and a representative-photo benchmark should be considered before improving extraction through heuristics. Hosted process isolation, version patch policy and retention/deletion remain separate release gates.

## CI replay checkpoint

[Run66](https://github.com/panelreply-business/panelreply-demo/actions/runs/44634698683), source 17223d6, independently regenerated 310 unique images and repeated the measurement using Tesseract 5.3.4 in CI. The result remained 253 exact cases, 57 nonexact, zero native execution errors and zero review-contract violations. Median/p95/max processing observations were 113/173/295 ms on that runner. The job completed, but accuracyGate remained FAIL. These timings are not controlled hardware comparisons or a hosting SLA. See the [current machine-readable report](evidence/prelaunch-verification.json).
