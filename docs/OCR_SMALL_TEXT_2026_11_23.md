# OCR small-text verification — November 23, 2026

The candidate pipeline exactly matches 285 of the same 310 synthetic images. The reproduced baseline matches 277. Eight previously nonexact images now match, with no regression among the 277 baseline matches. All 263 expected blank fields remain blank. Native execution errors and automatic-review violations are zero.

The strict all-image extraction gate remains FAIL. Twenty-five images still need manual correction. These are synthetic extraction measurements, not 310 passing tests or a real-photograph accuracy estimate. The committed source still needs CI verification before it can replace the previous release checkpoint.

[Machine-readable evidence, source hashes, screening and all per-image outcomes](evidence/ocr-small-text-2026-11-23.json).

## Change

The normalizer measures horizontal ink bands using pixel intensities. It uses an Otsu threshold only to measure foreground rows, chooses the minority intensity group for dark or inverted labels, ignores bands under three pixels high, and takes the lower median height of the remaining bands. It never reads expected answers, fixture names, part catalogues or recognized text.

When that median is 3–15 pixels, the normalizer enlarges the temporary image by two with Lanczos interpolation. It does so only when the result remains within the existing 6000-pixel side and 16-million-pixel limits. It retains the existing conditional median noise filter. The recorded metadata distinguishes noise filtering (`applied`) from enlargement (`rescaleFactor`). The readiness contract is `median3-small-text-v2`.

The application validates the measurements, scale selection, output size, PNG structure and resulting dimensions before OCR. Unexpected metadata or pixels fail closed. All stages retain the existing memory, CPU, descriptor, output and shared wall-time limits. Original stored image bytes do not change. Values, punctuation, case and confusable characters are never repaired by string substitutions. Every candidate remains unreviewed.

Fifteen nonblank downsampled images triggered enlargement in the full set. Nine images changed extracted field values. Eight became exact. The ninth, `confusable--downsample`, gained the correct manufacturer but retained its part-number error.

[Tesseract's image-quality guidance](https://tesseract-ocr.github.io/tessdoc/ImproveQuality.html) identifies rescaling as a possible recognition aid. The threshold and conditional rule above are this project's measured heuristic. The guidance does not establish accuracy on these images or on real photographs.

## Results

| Measurement | Reproduced baseline | Candidate |
| --- | ---: | ---: |
| Exact images | 277/310 | 285/310 |
| Known part numbers exact / missing / wrong | 197 / 1 / 21 | 197 / 1 / 21 |
| Known manufacturers exact / missing / wrong | 206 / 5 / 8 | 215 / 4 / 0 |
| Known descriptions exact / missing / wrong | 229 / 0 / 0 | 229 / 0 / 0 |
| Blank-field false positives | 0/263 | 0/263 |
| Native errors / review violations | 0 / 0 | 0 / 0 |
| Median / p95 / maximum time per image | 213 / 431 / 779 ms | 218 / 427 / 831 ms |
| Total measurement time | 75,204 ms | 76,843 ms |

Both runs used Tesseract 5.5.0 and the same system Pillow normalizer. The generator used Pillow 13.0.0. The manifest SHA-256 is `9cb1e68c4dee1a83a7a14fa1735917cba117a145cec57067e148799baf897601`, matching the prior local dataset. Every image hash was rechecked after the candidate run. The separately generated CI dataset has different recorded font hashes and must remain a separate measurement.

Baseline pipeline SHA-256: `6ea83a79dde4d68f4edb26717bedfb0aa1261684f848e6dd29ceddf4550e6fdd`.

Candidate pipeline SHA-256: `b4d3c0e7e486ec10b15416bccee186adfdf0786a661b2adf6130b34e2500d731`.

Timings shared a development machine with other work. They do not establish a speed improvement, regression or hosting capacity. Native memory samples and individual process outcomes remain in the evidence record.

## Rejected experiments

Uniform 2× and 3× enlargement were screened on all 33 original failures plus clear-serif and small-font controls, totaling 61 images. Each recovered ten failures, but 2× enlargement regressed one passing control and 3× enlargement regressed two. Both global defaults were rejected. The retained pixel-based rule then received the full unchanged 310-image replay.

The remaining 25 failures comprise 18 confusable-character cases, four abbreviated-label recognition cases, two part-number punctuation cases and one letter-case difference. They remain visible for review. No fixture expectations, unknown-field rules or all-image acceptance threshold changed.

## Verification

- 92 OCR, benchmark-accounting, isolation-policy and diagnostic unit cases PASS, zero failures or skips.
- Nine native fixture/failure cases PASS, zero failures.
- Twelve native resource, lifecycle and normalizer cases PASS, zero failures or blocked cases. Four new cases execute the actual normalizer for dark/inverted small bands, blank/punctuation/large-band exclusions, dimension boundaries and pixel-count boundaries. Their recognition adapter verifies pixel geometry and does not claim OCR accuracy.
- Required OS isolation remains unresolved. No privileged retry or unbounded fallback was attempted.
- Representative photographs remain NOT TESTED.

Reproduce from the repository root with the recorded native dependencies and fonts:

```bash
node --test tests/ocr.test.cjs tests/ocr-benchmark.test.cjs tests/ocr-isolation.test.cjs tests/ocr-isolation-diagnostics.test.cjs
node scripts/test-ocr-fixtures.cjs
node scripts/test-ocr-resource-limits.cjs
python3 tests/fixtures/panels-benchmark/generate.py /tmp/panelreply-ocr-benchmark
node scripts/benchmark-ocr.cjs /tmp/panelreply-ocr-benchmark /tmp/panelreply-ocr-candidate.json
```

The benchmark command separates measurement completion from `accuracyGate`. A completed run with 285 exact images still reports `accuracyGate: FAIL`. Keep source, engine, font and image hashes with any further comparison.
