# OCR benchmark and resource verification

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
