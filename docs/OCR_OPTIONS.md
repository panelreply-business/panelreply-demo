# Local OCR decision and verification

Date: 2026-11-19. Scope: the existing private, local PanelReply workspace.

## Decision

Use an optional Tesseract 5 executable installed on the same machine as the private workspace. The Node adapter adds no application package, provider account, API key or per-image API charge. It uses the machine's CPU and memory. Public demos and paid services remain disconnected.

The implementation reads printed text and prepares review candidates from explicit labels. It does not identify electrical compatibility, certify ratings, fill missing specifications, identify a manufacturer from a logo, or verify that a component can be installed. A person must compare every value with its source.

The marketing demonstration remains synthetic. Real OCR belongs to the authenticated workspace and is available only when the local engine and English model pass the readiness check.

## Options compared

These are engineering tradeoffs for this repository. Accuracy and latency comparisons between engines have not been measured on an authorized set of panel photographs.

| Option | Accuracy evidence | Cost | Latency and privacy | Deployment and maintenance |
| --- | --- | --- | --- | --- |
| Browser Tesseract.js | Wraps Tesseract in WebAssembly. Its project does not change the recognition model to improve accuracy. No PanelReply browser benchmark exists. [1] | No paid OCR API. Device CPU, memory and asset delivery still have costs. | Images could stay on the device if every worker, model and core asset is hosted locally. Device speed and first model load would affect timing. This is an inference, not a measurement. | Requires worker/core/language assets and CSP review. Default remote asset locations must be replaced for an offline flow. Not implemented. [2] |
| Server-local Tesseract 5 | Six synthetic fixtures tested below. Real panel photographs remain NOT TESTED. Image skew, noise and resolution affect results. [3] | No per-image provider charge. Uses existing local compute and storage. | Local process. No OCR network request. Measured fixture times below apply only to this machine and input set. | Selected. Requires a maintained native Tesseract 5 installation and English data. One OCR child per application process. |
| Google Cloud Vision | No PanelReply comparison run. No accuracy claim. | Standard Text Detection and Document Text Detection list the first 1,000 monthly units free, then USD 1.50 per 1,000 units through 5 million. A feature applied to an image is a unit. Other cloud costs may apply. [4] | Images leave the workspace. Google's online operations policy describes in-memory processing without disk persistence and says content is not used to train Vision models. Provider policy and region still need review before use. Network latency not measured. [5] | Would require approved billing, credentials, quotas, privacy review and retry handling. Not activated. |
| Amazon Textract Detect Document Text | No PanelReply comparison run. No accuracy claim. | The official US West (Oregon) example lists USD 0.0015 per page for the first 1 million pages, then USD 0.0006. Region and account terms must be checked before approval. [6] | Images leave the workspace. No network latency, retention or region validation performed for PanelReply. | Would require approved billing, credentials, service permissions, quotas and a separate provider adapter. Not activated. |

No free allowance authorizes provider activation or guarantees a zero bill. The implementation uses only local Tesseract. Pricing above was checked for this decision and is not PanelReply customer pricing.

## Supported flow

1. Authenticate through the existing workspace.
2. Create or reopen a panel project.
3. Save a supported source image through the project's private upload endpoint.
4. Request local OCR for that saved source.
5. Review raw recognized text and unreviewed candidate fields.
6. Correct the fields, save rows explicitly and review them against the image.
7. Export saved values through the existing panel CSV boundary.

The OCR adapter returns candidates. It does not save rows or mark them reviewed. The API attaches the source identifier and rechecks the session and project version after OCR completes. An expired session or stale project must not receive a successful save or stale OCR result.

## Adapter contract

`workspace/ocr.cjs` exports these production interfaces:

```js
inspectImage(buffer)
// { mime: 'image/png' | 'image/jpeg', width, height, bytes }

await getOcrStatus()
// { available, engine: 'tesseract', version: string | null, language: 'eng', reason? }

await recognizeImage(buffer, { signal })
// {
//   engine: 'tesseract', engineVersion, rawText,
//   candidates: [{ partNumber, manufacturer, description,
//     confidence: { partNumber, manufacturer, description },
//     reviewStatus: 'unreviewed', warnings: [] }],
//   warnings: [], durationMs
// }
```

`parseTsv` supports isolated parser tests. `createOcrService` supports injected process-failure tests. Neither receives arbitrary executable names, filenames, command options or environment variables from HTTP input.

### Input and process bounds

| Boundary | Enforced limit or behavior |
| --- | --- |
| Input | Node Buffer only. No filename, URL, data URL, SVG, PDF, GIF, HEIC or remote fetch |
| Image size | 2 MiB per image |
| Dimensions | 1–6000 pixels per side and no more than 16 million pixels |
| PNG validation |Signature, chunk lengths, CRCs, dimensions, header format, palette structure, image data and final end marker. Animation and unknown critical chunks rejected |
| JPEG validation |SOI/EOI markers, segment lengths, scan structure and frame dimensions. Supported formats are 8-bit baseline or progressive grayscale/RGB JPEG |
| Native decoding |Tesseract performs the actual pixel decode. Structurally valid but undecodable pixels fail with a generic error |
| PNG metadata |Only header, palette, transparency, image data and end chunks reach the native decoder. Compressed metadata is omitted. The saved private source is not changed |
| Invocation |Fixed `/usr/bin/tesseract`, `shell:false`, stdin image bytes and stdout TSV |
| OCR arguments |`stdin stdout -l eng --oem 1 --psm 6 tsv` |
| Child environment |Only fixed PATH, locale and single-thread settings. No inherited provider credentials or caller-supplied environment |
| Working directory |Filesystem root, not a customer-controlled upload directory |
| Concurrency |One active recognition per Node application process. Additional calls receive 429 |
| OCR duration | 15 seconds after readiness. Timeout or cancellation sends SIGKILL and awaits child close before releasing the slot |
| Readiness |Fixed `--version` and `--list-langs` probes, at most 2 seconds and 16 KiB output each. Requires Tesseract 5 and `eng`. Result cached 60 seconds |
| Process output | 512 KiB combined stdout and stderr. Stderr is counted and discarded, never returned or logged |
| Text |At most 20,000 characters. Excess output fails explicitly |
| Fields |Part number 120 characters, manufacturer 120, description 500. Overlong values remain in bounded raw text and require manual entry |

Readiness has no provider dependency. Missing or unsupported engines return `available:false`. The application can still use manual parts entry and CSV export. There is no simulated OCR fallback.

Source bytes are copied before asynchronous work. Caller changes to the original Buffer cannot replace the validated input while readiness runs. No temporary image or OCR text file is written by the adapter.

These bounds are not an operating-system memory sandbox. A future hosted service would need an approved worker/container resource limit and native dependency patch policy before accepting untrusted public uploads. This phase exposes no public upload service.

### Extraction and confidence

The parser recognizes explicit, separate lines such as:

```text
PART NUMBER: DEMO-1001
MANUFACTURER: SAMPLE COMPONENTS
DESCRIPTION: SYNTHETIC LABEL ALPHA
```

It also accepts explicit `P/N`, `MFR` and `DESC` labels. It preserves recognized values and letter case. It does not repair ambiguous characters from a catalogue or invent absent fields.

This first parser produces zero or one candidate per image. Conflicting repeated labels and multiple labelled fields on one line are treated as ambiguous. The affected value stays blank. Unlabelled text stays available for manual entry. Multiple components in one photograph require separate images or manual entry.

Each field's OCR confidence is the lowest recognized-word confidence on its labelled line, rounded to two decimal places. Unknown confidence is `null`. A score below 80 adds a review prompt. This threshold is a UI attention rule, not a measured correctness probability. Even a score of 100 never changes `reviewStatus` from `unreviewed`.

Raw text is untrusted text. Consumers must use text nodes or textContent, not innerHTML. The parser preserves spreadsheet-like strings for review. The CSV exporter, not the OCR parser, must neutralize formula prefixes and apply CSV escaping to the final corrected values.

### Errors

`OcrError` has `code`, `status` and a static user-facing `message`. It does not include raw stderr, private paths or image content.

| Code | HTTP status | Meaning |
| --- | --- | --- |
|IMAGE_INVALID|400|Unsupported or structurally invalid image |
|IMAGE_TOO_LARGE|413|Byte limit exceeded |
|IMAGE_DIMENSIONS|413|Dimension or pixel limit exceeded |
|OCR_BUSY|429|Another recognition is active |
|OCR_UNAVAILABLE|503|Engine or English model unavailable |
|OCR_CANCELLED|499|Request cancelled |
|OCR_TIMEOUT|504|Recognition time limit exceeded |
|OCR_FAILED|422|Engine could not decode or process the image |
|OCR_OUTPUT_LIMIT|422|Process or text output limit exceeded |
|OCR_OUTPUT_INVALID|422|Malformed TSV or invalid output encoding |

## Storage and retention

The adapter retains no file. The project API stores source bytes in business-scoped SQLite BLOBs alongside project records. It uses the existing owner-only data directory and database permissions. Sources are not published as static files.

The backend allows up to 5 images per project, 200 projects per business and 200 rows per project. A 32 MiB global panel-payload budget covers stored row JSON, project text and source bytes. Each image still has the 2 MiB input limit.

Encrypted backup version 2 includes image BLOBs and panel rows together. Version 1 and version 2 restore remain supported. Restored credentials are disabled and sessions are excluded.

This milestone has no project/source deletion endpoint or automatic retention expiry. Source images remain in the private database and its backups until an operator uses a future documented deletion/retention process. A customer pilot needs an approved deletion and backup-retention policy. The source image may contain metadata even though PNG metadata is stripped from the bytes passed to OCR.

## Reproduction and verification

The checked-in fixtures contain fictional labels generated by `tests/fixtures/panels/generate.py`. Regeneration requires Pillow and the DejaVu Sans font. Running the checked-in tests does not require Pillow.

From the repository root:

```bash
node --test tests/ocr.test.cjs
node scripts/test-ocr-fixtures.cjs
```

The first command uses fake process adapters and needs no Tesseract installation. The second executes the local binary and requires Tesseract 5 plus English model data. If either is absent it prints BLOCKED and exits 2. It does not report a skipped OCR execution as PASS.

For a disposable Ubuntu CI runner, install the OS packages `tesseract-ocr` and `tesseract-ocr-eng` before the second command. This is a test dependency, not permission to modify production or resume a service. No runtime package installer or model download is built into the application.

### Measured local result

Tesseract 5.5.0, Leptonica 1.84.1, English data. No provider calls, HTTP listener or browser process.

- 38 isolated tests passed, 0 failed, 0 skipped.
- 6 synthetic image cases passed.
- 10 of 10 supplied, unambiguous field values matched exactly.
- 2 of 2 missing or conflicting fields remained blank.
- Unlabelled and blank images produced zero candidates.
- 3 native failure cases passed. Timeout and cancellation returned only after the OS reported the child no longer existed. A valid PNG structure with corrupt compressed pixels returned a generic failure.

| Synthetic fixture | Result | Observed elapsed time |
| --- | --- | --- |
|complete.png|PASS|214 ms |
|complete.jpg|PASS|159 ms |
|missing-manufacturer.png|PASS|137 ms |
|conflicting-parts.png|PASS|209 ms |
|unlabelled.png|PASS|127 ms |
|blank.png|PASS|140 ms |

These single-run timings exclude initial engine readiness. They are not throughput, mobile latency, p95 latency or real-panel accuracy measurements. Tests cover clean synthetic printed labels. Glare, blur, perspective, worn labels, handwriting, logos, rotated photographs, multilingual labels and real job-site conditions remain NOT TESTED. No OCR accuracy claim is suitable for marketing from this fixture set.

The native test CLI reports 9 cases: 6 image cases and 3 failure-path cases. Do not count its field comparisons as additional test cases.

## Remaining work

- Collect an owner-approved, labelled image set before claiming practical extraction accuracy.
- Measure field-level errors and exact part-number matches on that set, including unknown and unreadable text.
- Add a reviewable crop/orientation workflow if the evidence shows it is needed.
- Verify native-library versions and resource limits for any approved future hosting environment.
- Define project/source deletion and backup retention before real customer uploads.
- Keep external OCR as a separate approval decision. No automatic provider fallback exists.

## Primary sources

1. [Tesseract.js project and supported scope](https://github.com/naptha/tesseract.js)
2. [Tesseract.js local installation and asset paths](https://github.com/naptha/tesseract.js/blob/master/docs/local-installation.md)
3. [Tesseract image quality guidance](https://tesseract-ocr.github.io/tessdoc/ImproveQuality.html)
4. [Google Cloud Vision pricing](https://cloud.google.com/vision/pricing)
5. [Google Cloud Vision data usage](https://docs.cloud.google.com/vision/docs/data-usage)
6. [Amazon Textract pricing](https://aws.amazon.com/textract/pricing/)
7. [Tesseract command-line usage, TSV and LSTM options](https://tesseract-ocr.github.io/tessdoc/Command-Line-Usage.html)
8. [Tesseract threading guidance](https://tesseract-ocr.github.io/tessdoc/FAQ.html)
