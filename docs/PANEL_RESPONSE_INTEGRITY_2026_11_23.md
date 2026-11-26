# Spreadsheet save-response integrity

Recorded November 23, 2026. This repair builds on the retained uncertain-command changes described in [unconfirmed saves](PANEL_UNCERTAIN_SAVE_2026_11_23.md).

## Reproduced defects

The client previously checked only the rows and sources arrays before adopting a project response. A successful create response missing its name could overwrite the draft and clear its retry command before rendering threw. An update response missing notes could display success after erasing the correction.

Further counterexamples showed that malformed row/source metadata or a valid-shaped response for another project could replace local state. An upload receipt could disagree with its source member or submitted file. These are controlled malformed-response tests, not observed server data corruption.

A separate retry case found false confirmation when an unchanged PATCH failed before committing. The following GET had matching values at the original revision, so the old client displayed success despite no committed update. Direct update and image receipts also accepted an unchanged revision.

## Correction

Before changing state, DOM fields or pending commands, the client validates the complete public project, row and source schema. It applies the existing API text, image, row and source limits, safe revisions, canonical timestamps, explicit review requirements and source references. Valid Unicode, whitespace and blank unknown fields remain exact.

Opening, reloading, updating and reconciling an existing project require the expected project ID. Uploads retain the original project ID and prior source IDs. Their returned source must match its project member, submitted trimmed filename, MIME type and byte count, and must represent a new source. Byte-count agreement checks receipt consistency. Actual source-byte preservation has separate API/browser/recovery assertions.

A malformed response retains the draft and original command. Internal empty drafts use an explicit local path. Create retries preserve the server-assigned project identity and existing changed-after-create replay behavior.

Update readback confirms only matching values at a later revision. Matching values at the original or an older revision retry the frozen PATCH. Update and upload success receipts must advance beyond the submitted revision. Later legitimate replay/readback revisions remain accepted.

## Verification

The response-validation stage ran the same 26 client-state cases against both sources. Its baseline passed 15 and failed 11. The repair passed all 26. Fourteen cases were new and the earlier twelve stayed passing. [Stage evidence](evidence/panel-response-integrity-2026-11-23.json).

The revision-confirmation stage then ran the same final 29 cases. Its baseline passed 26 and failed the three new cases. The repair passed all 29, with no failures or skips. The three cases also cover older revisions and later recovery. [Revision evidence](evidence/panel-revision-confirmation-2026-11-23.json).

These overlapping runs contribute no duplicate goal credit. The final client file contains 21 new cases relative to its original eight: four uncertain-command cases, fourteen response-validation cases and three revision-confirmation cases.

Two actual malformed-response journeys are collected only through the fixed spreadsheet suites: create/update response corruption with exact retry/readback, and inconsistent image-source metadata with exact image retry. Linux spreadsheet now collects nine methods, Mac manual spreadsheet ten, and combined private remains 132. [Collection and independent review](evidence/panel-receipt-browser-collection-2026-11-23.json). They must run on the final committed source before browser acceptance is claimed. The shared client-state checks do not establish browser layout or physical-device behavior.
