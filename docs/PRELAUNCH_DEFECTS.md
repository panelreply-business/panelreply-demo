# Pre-launch defect register

Date: 2026-11-19. This register covers the work after baseline `41e31a8`. [Development progress](DEVELOPMENT_PROGRESS.md) is the authoritative current status. A regression test demonstrates its stated case, not absence of every possible defect. [Historical platform defects](PLATFORM_VERIFICATION.md) remain recorded separately.

## Confirmed code defects

The following corrections are in `c5a47542d665a7d5ffb202e1cde4669c85512243`. The updated local suite passed 638 Node/SQLite/in-process API tests. Actual HTTP and browser verification is recorded in the progress document after CI completes.

| ID | Priority | Reproduction and impact | Correction | Regression evidence |
| --- | --- | --- | --- | --- |
| AI-01 | Medium | Ask one missing-field question, append a booking disclaimer, then answer with a bare name or time. The parser loses the last-question context. | Keep the targeted question last without removing the disclaimer. | `workspace-assistant.test.cjs` context-only replies. |
| AI-02 | Medium | Submit a valid natural correction while a prior field issue remains. A stale issue blocks the correction. | Separate current ambiguity from prior issues and preserve unrelated unresolved fields. | Natural name correction and direct confirmation cases. |
| AI-03 | Medium | Supply a proposal using actual electrical-job words as a name, a part-number-shaped number as a phone, or a work date as a callback window. Substring presence alone accepts the wrong field. | Bind proposals to field-specific evidence and independent parser cues. | Three independent grounding cases in `assistant-adversarial.test.cjs`. |
| AI-04 | Medium | Propose panel work after a customer says they do not need it, or Saturday after they say Saturday is unavailable. | Reject negated and unavailable clauses as positive field evidence. | Two independent negation regressions. |
| AI-05 | High | Describe fire inside a panel, a hot outlet or hot breaker box. Existing hazard patterns can miss the immediate electrical context. | Add bounded electrical-context patterns before provider generation. Preserve normal fire-alarm, smoke-detector, water-heater and hot-tub requests. | Four independent no-provider hazard cases plus eight positive and six routine-negative shared-parser cases. |
| AI-06 | Medium | Start generation using approved business facts, revoke those facts before the provider resolves, then receive the old answer. | Recheck the saved profile version after the await and return `profile_changed` without the obsolete response. | In-process API reproduction returned 200 before correction and 409 after correction. |
| AI-07 | Medium | Invoke the handler for a connection already marked aborted. Installing a later abort listener misses the event and starts generation. | Check the current abort/destroyed state before provider or OCR work. | API reproduction changes from one provider call to zero. |
| AI-08 | Medium | Return a valid compressed provider envelope through a Fetch-compatible transport. Wire Content-Length differs from decoded body length and a valid response is rejected. | Use exact length equality for identity encoding only. Always enforce the decoded stream limit. | Independent compressed-response regression and 31 mock-transport cases. |
| AI-09 | Low | Let an injected transport ignore cancellation and resolve its body after timeout cleanup. The late stream remains open. | Cancel a late body before acquiring its reader. | Independent late-response cancellation regression. |
| OCR-01 | Medium | Process the cropped multiple-component fixture with conflicting part numbers/manufacturers but one description. The description attaches to an unknown component. | Blank candidate fields when multiple core fields conflict, retaining the raw text for review. | Unit regression and actual native benchmark replay. |
| OCR-02 | Medium | Process the noisy conflicting-manufacturer fixture where OCR adds a leading bullet to one label. The second manufacturer is missed. | Recognize one bullet/hyphen before an otherwise exact field label, preserving value characters and ambiguity. | Unit regression and native replay; manufacturer remains blank. |
| XLSX-01 | Medium | Export literal OOXML escape-looking text, including `x005F_`, and read it through openpyxl. Reader normalization can alter a saved identifier. | Use bounded inline rich text for affected literals with token boundaries between text runs. | Exact independent readback and original-file LibreOffice import. Cross-application resaving limits remain documented. |

The 11 independent AI adversarial cases and 31 transport cases passed after the final fixes. These overlap the full suite and must not be added again to its count. The external transport remained disabled throughout verification.

## Test fixture correction

QA-01, Medium: all four assistant browser cases initially shared one process-wide ten-call/minute allowance. Their combined calls could exhaust the quota before the STOP case. A pure fake-provider sequence reproduced `assistant_limit` and an empty phone before STOP. Each browser scenario now restarts only its synthetic server. The real database remains in place and production quotas are unchanged. This corrects fixture independence, not an application quota defect. Actual browser results belong in the current progress record.

The browser reset scenario uses a 300 ms fake-provider delay. The deterministic component/API cancellation cases provide stronger evidence that cancellation occurred while generation was pending. Do not use the timing-based browser case alone to claim that guarantee.

## First browser run corrections

Run64 passed 645 Node/HTTP checks, 179 Chromium cases outside XLSX and four of seven XLSX cases. It exposed three callback errors before their browser assertions. Playwright cannot annotate a builtin `list.append` handler. Each is now wrapped in a Python lambda. All three corrected callbacks passed a local check through Playwright's actual mapping code. The browser rerun remains required.

Firefox found a medium marketing interaction defect: the first invalid quantity blurred while clicking Export, displaying error content above the button and moving its hit target. Blur painting now defers when focus moves directly to Export. The click handler still validates and focuses the invalid field. The existing browser test retains its focus assertion and additionally checks that the click was delivered.

Three Firefox geometry checks measured 44 px controls as 43.99998474121094 or 43.99993896484375 px. The checks now compare at 0.001 CSS-pixel precision while retaining the 44 px requirement. This is a test measurement correction, not a larger touch-target design change. The new XLSX button is also included in the same responsive assertion. No full browser verification is claimed until the next CI completes.

## Unresolved findings and approval boundaries

| ID | Priority | Evidence | Status / next action |
| --- | --- | --- | --- |
| OPS-01 | High | Both Render services repeatedly report `not_suspended`. Run64's GET-only guards independently returned HTTP 200 for both URLs instead of the required 503. | FAIL. The latest brief prohibits state changes without new owner approval. Obtain approval to restore suspension, then verify configuration and public responses. No state change was attempted here. |
| OCR-QUALITY | Medium | Local candidate benchmark exactly matches all expected fields in 253/310 unique synthetic images. 57 cases remain nonexact. Missing/rotated/noisy/cropped inputs have recorded failures. | FAIL accuracy gate. Keep every candidate unreviewed and require source comparison. Use the failure corpus for further measured changes. Representative job-site quality remains untested. |

Actual model quality, representative photographs, hosted recovery, retention/deletion, durable provider budgets, physical-device/assistive-technology checks and live integrations are incomplete requirements, not defects declared fixed by these local tests. See [release acceptance](RELEASE_ACCEPTANCE.md).

No critical vulnerability or cross-business exposure was observed in the executed checks. This statement is limited to their coverage. The active public configuration remains a high-priority release blocker.
