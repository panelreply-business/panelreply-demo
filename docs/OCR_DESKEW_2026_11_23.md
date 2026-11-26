# OCR deskew verification — November 23, 2026

The candidate production pipeline exactly matches 289 of the same 310 synthetic images. The preceding small-text pipeline matched 285. Four more failures became exact, with no regression among those 285 matches. All 263 expected blank fields stayed blank. Native errors and automatic-review violations are zero.

The strict all-image gate remains FAIL. Twenty-one images still require correction. Representative photographs and required OS isolation remain unresolved. This detached candidate needs committed-source CI verification before replacing the prior release checkpoint.

[Source hashes, native measurements and all per-image before/after results](evidence/ocr-deskew-2026-11-23.json).

## Pixel transformation

The normalizer estimates tilt from pixel geometry. It makes a grayscale analysis copy with at most 650 pixels per side and uses an Otsu split to identify the minority foreground intensity. It measures horizontal foreground concentration across angles from −5° to +5° in 0.25° steps. It applies the selected rotation only when the concentration score improves by at least 10%. Blank images do not produce a candidate angle.

The full temporary image rotates with bicubic interpolation and expanded corner bounds. Rotation happens only if the result remains within 6000 pixels per side and 16 million pixels. Otherwise it retains the original orientation and records `dimension_limit` or `pixel_limit`. The runtime independently calculates the expanded dimensions and validates angle, scores, bounds, metadata and PNG dimensions before recognition. The existing small-text enlargement also checks the dimensions after rotation.

Noise filtering, angle analysis, rotation and enlargement run in the existing single normalizer process. They share the existing 15-second wall deadline with recognition. The 1 GiB address-space limit, ten-second per-child CPU limit, descriptor limit, zero regular-file/core output and bounded stdout/stderr remain. There is no extra process, external service or unconfined fallback in the production pipeline.

Original stored image bytes remain unchanged. No recognized character, punctuation, capitalization, manufacturer or part number receives string repair. Candidate values remain unreviewed. The readiness method is `median3-deskew-small-text-v3`.

[Tesseract's image-quality guidance](https://tesseract-ocr.github.io/tessdoc/ImproveQuality.html) describes skew as a source of recognition errors and suggests aligning text lines. The angle search, 10% threshold and bounds here are this project's implementation. The measurements establish their result only on the recorded inputs.

## Measurements

| Measurement | Prior pipeline | Deskew candidate |
| --- | ---: | ---: |
| Exact images | 285/310 | 289/310 |
| Part numbers exact / missing / wrong | 197 / 1 / 21 | 199 / 1 / 19 |
| Manufacturers exact / missing / wrong | 215 / 4 / 0 | 217 / 2 / 0 |
| Descriptions exact / missing / wrong | 229 / 0 / 0 | 229 / 0 / 0 |
| Blank-field false positives | 0/263 | 0/263 |
| Native errors / automatic-review violations | 0 / 0 | 0 / 0 |
| Median / p95 / maximum time per image | 218 / 427 / 831 ms | 292 / 575 / 1,028 ms |
| Total measurement time | 76,843 ms | 100,354 ms |
| Sampled largest native child RSS/high-water | 73,338,880 bytes | 73,342,976 bytes |

Both measurements used Tesseract 5.5.0, the recorded system Pillow version and identical image bytes. The manifest SHA-256 remains `9cb1e68c4dee1a83a7a14fa1735917cba117a145cec57067e148799baf897601`. All 310 original image hashes were rechecked after the run.

The candidate transformed 45 rotated images. The four gains were `abbreviated--rotate-plus-1`, `abbreviated--rotate-plus-3`, `lowercase--rotate-minus-3` and `punctuation--rotate-minus-3`. The remaining 21 failures comprise 18 confusable-character cases, two abbreviated-label cases and one part-number spacing case. No expected answer or acceptance threshold changed.

Prior pipeline SHA-256: `b4d3c0e7e486ec10b15416bccee186adfdf0786a661b2adf6130b34e2500d731`.

Candidate pipeline SHA-256: `65b6a4d7bce19baabc5ea5480c19bbb159dd1fe9f9551b6691c28dcf923836b4`.

Times were measured on a shared development host with other work. They show the observed cost, not a controlled comparison or hosting capacity guarantee. Native memory samples are a lower bound from Linux `/proc` every 10 ms, not an exact kernel peak or sum of descendants. All 660 observed native processes in each full measurement had samples and closed.

## Verification

- 98 OCR, accounting, isolation-policy and diagnostic unit cases PASS, zero failures or skips. New cases cover independent native geometry values, source preservation, combined transformations, malformed metadata, size ceilings and generic errors for malformed JSON primitives.
- Nine native fixture/failure cases PASS, including timeout and cancellation cleanup.
- Sixteen native resource, lifecycle and geometry cases PASS, zero failures or blocked cases. Existing native normalizer cancellation and shared-deadline tests remain.
- New native geometry cases cover dark and inverted tilted images, preservation of colored evidence at all four original image corners, and dimension/pixel ceiling decisions before allocation.

The dimension-boundary input measured 6000×1500 pixels. The normalizer recognized −3° tilt, retained the original orientation and recorded `dimension_limit`. Its sampled largest native child RSS was 141,586,432 bytes and the observed workflow time was 675 ms.

The pixel-boundary input measured 4000×4000 pixels. The normalizer retained its orientation with `pixel_limit`. Its sampled largest native child RSS was 239,775,744 bytes and the observed workflow time was 1,225 ms. These geometry tests use a recognition adapter to inspect image output. They are not OCR accuracy claims.

Before integration, a separate bounded preprocessing experiment screened 65 images and then all 310. It predicted the same four gains. That screen is recorded separately and is not counted as production verification or additional passing tests. The final measurements above execute the integrated production normalizer and service.

## Reproduction and remaining steps

```bash
node --test tests/ocr.test.cjs tests/ocr-benchmark.test.cjs tests/ocr-isolation.test.cjs tests/ocr-isolation-diagnostics.test.cjs
node scripts/test-ocr-fixtures.cjs
node scripts/test-ocr-resource-limits.cjs
python3 tests/fixtures/panels-benchmark/generate.py /tmp/panelreply-ocr-benchmark
node scripts/benchmark-ocr.cjs /tmp/panelreply-ocr-benchmark /tmp/panelreply-ocr-deskew.json
```

Use the recorded engine, Pillow and font versions. A separately generated CI dataset must retain its own manifest and font hashes. The benchmark distinguishes measurement completion from extraction acceptance and still reports `accuracyGate: FAIL` at 289/310.

Next steps are independent code review, committed-source CI, continued handling of the 21 remaining failures, representative noncustomer photo evaluation, and verification of the selected native isolation environment. Keep public deployment and customer testing blocked pending their separate requirements and owner approval.
