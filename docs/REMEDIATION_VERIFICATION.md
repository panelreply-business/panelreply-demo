# Engineering remediation verification

Working checkpoint, November 19, 2026. The same development branch and draft PR8 are retained. Main and both suspended Render services are unchanged. This document will receive the exact committed source and CI results after the candidate completes integration testing.

## Preserved baseline

At the start of this pass, all 163 tracked files matched commit `36b2bf30990eb164f6327e1eaa71e1386432da4f`. The prior application source was `17223d6b972cc4bd3e58e9412964d237cbc0eeb9`. Run66 attempt 2 reran only the two suspension guards after owner-approved suspension. Its 1,096 application passes carried forward from attempt 1.

The unchanged local baseline was reproduced: 638 Node/SQLite/in-process API checks passed, zero failed and zero skipped. It deliberately excluded public checks and the two HTTP test files. The unchanged 310-image OCR baseline reproduced 253 exact images and 57 nonexact images.

## Implemented in this pass

- Expanded the curated conversation corpus from 49 to 334 scenarios. The original 49 fixture bytes are unchanged. The additional 285 include explicit category, intent, risk and synthetic-source metadata.
- Corrected dropped job qualifiers, plural electrical scope, omitted question topics, unsupported intents, historical STOP handling, explicit calling opt-outs, two missed hazard phrases and equipment numbers accepted as ZIP codes.
- Added durable usage reservations, configured attempt/allowance limits, schema-3 accounting, actor-bound API integration and explicit external-configuration preparation. Actual provider activation remains disabled.
- Added versioned, tenant-scoped, idempotent deletion of requests, conversations, panel projects and source images. Added typed confirmation and same-request retry in the existing private interface.
- Retained opt-outs and minimal safety-hold digests across deletion, restart and recovery. Added unsaved-preview safety-hold persistence.
- Added schema-3 backup validation and recovery tests. Old-archive reconciliation remains an operator gate.
- Measured OCR orientation and conditional image normalization against every unchanged image. Rejected unmeasured or regressing alternatives. Original source images and required human review remain intact.
- Added a required restricted OCR worker option and native deny verifier. It never falls back from required isolation. Local namespace restrictions are documented. Actual CI/selected-host results are separate gates.
- Added a bounded 12-client synthetic HTTP workload and new deletion-browser cases for Chromium, Firefox and WebKit. These need the candidate's CI run.

## Current executed evidence

- The final applicable local Node suite passed 1,117 tests, zero failures and zero skipped, in 40.129 seconds. It excludes actual HTTP/browser/public checks. [Source hashes and logs](evidence/remediation-local-verification.json).

- 17 focused durable-ledger/configuration checks passed before integration.
- 39 deletion and assistant API checks passed.
- 334/334 fake-provider scenarios passed, with 374 turns, 2,196 field comparisons, 331 context comparisons and 333 fake calls. Zero real calls.
- Nine independent ZIP/XML/openpyxl workbook fixtures passed.
- The schema-3 storage/recovery drill passed five workflow groups. It retained 204 projects, 301 requests and five source images. Every logical table matched after restore, and the source database stayed unchanged.
- The first combined local run had 1,060 PASS and five failures because the DOM fixture had not loaded the new shared deletion script. The harness now loads the shipped component, supports native-dialog state and passes all six client-state cases. No application assertion was removed.
- Independent review reproduced and corrected provider-timeout outcome misclassification, cross-field correction cues, lost deletion uncertainty and transcript-limit restriction loss. The final independent API review passed 20 cases. The separate correction/deletion review passed 23 cases. Before-fix reproductions are preserved.

Counts above overlap. Do not add focused checks, scenario comparisons or repeated workload operations to a test-suite total.

## Verification still running

The combined local Node suite is complete. The browser/HTTP CI run, native isolation check and committed-source evidence publication remain pending at this checkpoint. Implemented code does not receive a final verification claim before those results arrive.

## Execution boundary disclosure

The assigned environment had previously denied local listener/browser execution, so this pass routes those checks to CI. An independent reviewer nevertheless made two actual loopback attempts for the shutdown case: an initial cookie-fixture failure on port 35851 and a corrected pass on port 44495. Both used synthetic data and no external endpoint. This was outside the intended no-retry boundary. The case has been moved into the CI HTTP file and will not be retried locally. No permission, namespace or host security setting was changed. Its original evidence is preserved separately and is not counted as an offline unit check.

## Release decision

NO-GO for public release or live customer/provider use. The strict synthetic OCR gate remains FAIL, actual model quality is BLOCKED, representative photographs are NOT TESTED, and hosted isolation/offsite recovery/operations need approved environments. Review of code and isolated synthetic tests can continue. No merge or deployment follows from a passing CI run.
