# OCR response integrity

## Result

The spreadsheet client now validates an extraction response before making its candidates available. The unchanged client accepted a result naming another project. It also installed candidates before rendering warnings, so a malformed warning list caused an error while leaving the Add action enabled.

The same eight regression cases were 2 PASS / 6 FAIL before and 8 PASS after. The final affected selection passed 167 cases, with zero failures, skips or cancellations. Its source manifest stayed unchanged during execution. These are client-state, API, store and OCR-adapter checks. No browser or native OCR execution occurred in this milestone.

Base commit: `1322d0630d377d9fe769dc15543321cb5f5fe373`.

Machine-readable evidence, exact case identities, source hashes, retained mismatch details and execution logs are in [the evidence record](evidence/ocr-response-integrity-2026-11-23.json).

## Failure and repair

The first counterexample returns otherwise valid candidate data with another project ID. Previously, the client accepted the response and replaced its source ID with the requested source ID. A user could then add those candidates to the current project's draft.

The second starts with valid candidates, holds a re-extraction response, then returns a warnings object instead of a list. Previously, the client assigned `ocrResult` and showed the result before attempting to spread the warnings. Rendering threw, but the final control update enabled Add against the already-installed candidates.

The repair captures the requested project, image and revision before the asynchronous call. It validates every field consumed by the extraction view and Add action before installing the result. It prepares warning nodes before installation. Invalid data keeps Add disabled, leaves saved corrections unchanged and allows another extraction attempt.

The existing operation lock prevents navigation while extraction waits. The regression attempts navigation during that wait, then verifies that rejected re-extraction cannot leave either old or malformed candidates addable. No save, upload or idempotency command changes.

## Actual response contract

| Consumed data | Required behavior |
| --- | --- |
| Project identity | Match the requested and still-current project |
| Source identity | Both response and candidate match the requested image, which remains in the current project |
| Revision | Equal the submitted revision |
| Candidate count | Zero or one |
| Candidate fields | Complete string fields, valid Unicode, maximum 120 part-number / 120 manufacturer / 500 description UTF-16 units |
| Review state | `unreviewed` |
| Confidence | Complete three-field object, each value null or finite from 0 through 100, with null required for blank values |
| Raw text | String with valid Unicode and permitted text controls, at most 20,000 UTF-16 units |
| Warnings | Lists of text strings before rendering, bounded by the adapter's raw-text ceiling plus three field warnings |

The revision rule follows the current API. It checks equality before recognition and again after recognition yields. A changed revision returns a conflict rather than a later-version success response. The parser returns either an empty candidate array or one candidate. Orientation fallback replaces the complete result rather than combining candidates.

The validator leaves unused engine and processing metadata alone. Empty output and an all-blank ambiguous candidate remain valid. It does not fill unknown fields, substitute characters, infer compatibility or mark a row reviewed. A positive case preserves Unicode and whitespace through explicit Add and Save, including a blank manufacturer and null confidence.

All prior client regression bodies remain byte-for-byte unchanged. Eight cases were added. Their focused runs overlap the 167-case selection and must not be added to it as extra product executions for this source.

## Retained quality investigation

No OCR engine, parser, preprocessing, model or frozen expected answer changed in this delta. All 310 retained image hashes were checked without running recognition.

The previous local production measurement remains 289 exact images out of 310, with all 263 expected blank fields preserved. It used dataset SHA256 `9cb1e68c4dee1a83a7a14fa1735917cba117a145cec57067e148799baf897601` and pipeline SHA256 `65b6a4d7bce19baabc5ea5480c19bbb159dd1fe9f9551b6691c28dcf923836b4`. That is retained historical evidence, not a new measurement of this commit.

| Remaining mismatch group | Images | Evidence |
| --- | ---: | --- |
| Confusable part characters | 18 | OCR confuses letters and digits in the identifier |
| Abbreviated labels | 2 | `MFR` is read as `MER`, or label colons are read as periods |
| Part-number spacing | 1 | OCR inserts a space after an underscore |

The previously rejected PSM 7 screen gained no cases and regressed six. PSM 13 gained one and regressed 34. Both used an 82-image screen. The complete alternative-model run remained 289/310, with three gains and three regressions. Those experiments do not support a new production change. They were not repeated. This milestone pursued the reproduced response-integrity defect instead of repairing ambiguous identifier characters or adding another speculative experiment.

## Reproduction and remaining work

Run the affected selection from the repository root:

```bash
node --test tests/platform-client-state.test.cjs tests/ocr.test.cjs tests/panel-api.test.cjs tests/panel-store.test.cjs
```

For the before comparison, use the final client-state test file with the five recorded client scripts from the base commit. The evidence preserves the exact script hashes, command, eight case IDs and failure output. The final eight-case test file is identical in both comparisons.

An independent reviewer checked the runtime contract and the asynchronous re-extraction case without editing files or repeating tests. Root integration, full source-bound regression and browser CI remain separate checks. OCR accuracy remains FAIL. Representative approved photographs and required native isolation remain unfinished. This repair changes no host policy, provider use, deployment or release approval.
