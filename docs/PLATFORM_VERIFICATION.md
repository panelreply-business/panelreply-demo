# Platform verification record

Date: 2026-11-19. Scope: draft PR8 on `feature/interactive-dual-product-site`.

This is the historical redesign milestone record. Later code, XLSX support, browser-engine coverage and the current Render configuration are tracked in [development progress](DEVELOPMENT_PROGRESS.md) and [release acceptance](RELEASE_ACCEPTANCE.md). Historical results below have not been relabeled as tests of newer code.

## Historical verified result

[Run 61](https://github.com/panelreply-business/panelreply-demo/actions/runs/44535177854) passed at application commit `370d158fb8c7dbf3daf74fe8798df4cc85e61c94`: 590 checks PASS, zero failures and three public application checks BLOCKED by intentional owner suspension. The 590 count comprises 406 Node/HTTP cases, 175 Chromium cases and nine actual native OCR cases. It excludes the three blocked checks.

The redesigned site, private panel workflow and corrected failure paths are verified by this run. The follow-up evidence commit records these results and screenshots without changing application/test source. PR8 stays in draft. Main and public deployments remain unchanged.

| Area | Status | Evidence |
| --- | --- | --- |
| Node logic, database, API, real HTTP and security regression | PASS | 406 cases, zero failures in run 61. Three separate public application skips. |
| Existing demo, intake, inbox, recovery and export browser suites | PASS | 105 Chromium cases: 11 + 42 + 12 + 31 + 9. |
| Dual-product marketing browser flows | PASS | 27 Chromium cases in run 61. |
| Private panel projects, images, OCR, CSV and failure paths | PASS | 24 Chromium cases in run 61. |
| Dashboard and panel responsive/interaction checks | PASS | 19 Chromium cases in run 61. Includes 360, 390, 430, 768, 1024 and 1440 px. The marketing dialog also passed an 844×390 landscape subcase. |
| Actual local OCR in CI | PASS | Nine cases, zero failures. Tesseract 5.3.4/English. Six synthetic labels and three native failure paths. 10/10 known fields matched; 2/2 missing/conflicting fields stayed blank. |
| Generated historical demo and CSP | PASS | `node scripts/build-demo.cjs --check` in CI and local verification. |
| Screenshot inspection | PASS | Twelve actual Chromium captures from run 61 reviewed: desktop/mobile homepage, parts demo, guided dialog, inbox, dashboard and private panels. Screenshot inspection covers captured states only. |
| Render configuration | PASS | Read-only inspection: both services suspended, auto-deploy off, PR previews off. |
| Public application flows | BLOCKED | Three legacy checks intentionally blocked by suspension. Separate offline guards confirm both suspended responses. |
| Real job-site OCR accuracy | NOT TESTED | Synthetic fixture measurements only. |
| Safari, Firefox, actual phones and assistive-technology audit | NOT TESTED | Current browser evidence is Chromium at the stated viewport sizes. No complete WCAG conformance claim. |
| Production Core Web Vitals | NOT TESTED | CI loopback navigation timings are not a production performance score. |
| Live AI/provider checks | BLOCKED | No live provider is activated or authorized. The private workspace uses deterministic parsing and approved saved answers. Existing fake-provider tests remain available. |
| XLSX, live messaging/calendar booking, deletion/retention and hosted operations | NOT IMPLEMENTED | No working integration or feature is claimed for these gates. A customer pilot has not started. |

Local HTTP listeners and local Chromium execution are unavailable in this execution environment. Real HTTP and browser checks run in the existing GitHub Actions workflow against temporary loopback servers and synthetic data. No public listener or customer integration is used.

## Completed UX refinement

Implemented and verified in the final application source:

- Original panel/reply SVG mark with dark/light variants, reused by website, login and private workspace.
- Optional guided sample-label walkthrough, predetermined-row reveal, Skip/Escape, reduced-motion behavior and preserved edits on replay.
- Confirmation before removing edited/reviewed demo rows or populated private project rows.
- Missing-core-field indicators in the private parts table.
- Native image selection and drag-and-drop with type/size/count validation, explicit Save, selection clearing and an indeterminate progress state during actual read/save work.
- Tablet navigation-height correction, full-width phone project fields and project-preserving Exports navigation.

Local verification of this refinement: 397 pure Node checks PASS, zero failures; nine actual Tesseract 5.5.0 cases PASS; generated-demo/CSP check PASS; JavaScript syntax and Python compilation PASS. These local checks are not additional cases to add to a later full CI total.

Run 61 passed all browser suites: the existing 105 cases, marketing 27, panels 24 and platform 19. The 844×390 landscape subcase also passed in the existing dialog method and does not add another method to the count. Image-selection feedback, explicit-save progress, private preview, interrupted-upload retry, row confirmation, missing-field guidance, project-preserving navigation and the guided demonstration are now verified.

## Defects and verification

| Priority | Reproduction | Correction | Current verification |
| --- | --- | --- | --- |
| Medium | Change only whitespace in a note/part, interrupt PATCH, then retry. Trimmed comparison could match the old saved data. | Compare exact corrected strings, normalizing only the documented project-name trim. | PASS in run 59 interrupted-update regression. |
| Medium | Leave business A open, sign in as business B in another tab, then retry/read A's screen. | Pin authenticated frontend requests to the current session, clear stale state, retain independent server tenant checks. | PASS in run 59 API, client-state and browser cases. |
| Medium | Create a project beyond capacity and receive 409. | Only a `version_conflict` on a saved project opens conflict recovery; quota failures retain an editable draft. | PASS in run 59. |
| Medium | Fail the first session read before readiness, then retry. | Enable retry after the operation ends even if bootstrap never completed. | PASS in run 59. |
| Medium | View marketing parts at 360/390/430/768 px. The last header's screen-reader text used the viewport as its positioning container. | Contain the accessible label within the table scroller. Do not hide whole-page overflow. | PASS in runs 58 and 59 at all six requested widths. |
| Medium | Open any authenticated page at 761–880 px. The desktop sidebar minimum height survived the topbar breakpoint. | Reset sidebar height/min-height at the 880 px breakpoint. | PASS in run 60 at the requested viewport widths. |
| Medium | Open `/panels?project=ID`, then choose Exports. The full navigation URL discarded the selected ID. | Use in-page project/export anchors. Explain export selection when arriving from another page. | PASS in run 60. |
| Low | On phones the project name and notes inherited two columns while losing their full-row spans. | Give panel metadata fields full width and stack them on mobile. | PASS in run 60 responsive geometry assertions. |
| Low | Private mobile navigation labels extended outside the visible horizontal strip. | Wrap navigation into a grid with 44 px targets. | PASS in runs 58 and 59; visual captures inspected. |
| Low | UI limits differed from backend part-number/notes limits; blob image previews conflicted with CSP. | Align field lengths and use authenticated same-origin source image URLs. | PASS in run 59 boundary and image-preview cases. |
| Medium | Lose a successful image-save response, then choose Retry image save. The shared dropzone used `aria-disabled`, which also marked the retry unavailable. | Keep disabled state on each native input/button. Use a visual data attribute on the shared dropzone, retaining its busy state. | Reproduced in run 60; correction PASS in run 61. |
| Low | Choose an unsupported, empty or oversized file. Clearing the native file input mutates its live FileList before the error message checks the count. | Capture the multiple-file condition before clearing selection. | Reproduced in run 60; correction PASS in run 61. |

## Reviewed screenshots

All images below come from run 61, application commit `370d158fb8c7dbf3daf74fe8798df4cc85e61c94`. They contain synthetic records only. They are actual Chromium screenshots, not mockups or a public deployment. Four unchanged marketing captures matched the previously inspected images byte-for-byte. The changed captures were inspected individually. [Capture dimensions and SHA-256 provenance](evidence/platform-captures.json).

| Surface | Desktop | Mobile |
| --- | --- | --- |
| Homepage | [1440px](evidence/platform-marketing-desktop-home.jpg) | [390px](evidence/platform-marketing-mobile-home.jpg) |
| Parts demonstration | [1440px](evidence/platform-marketing-desktop-parts.jpg) | [390px](evidence/platform-marketing-mobile-parts.jpg) |
| Guided sample dialog | [Desktop dialog](evidence/platform-marketing-desktop-walkthrough.jpg) | [Mobile dialog](evidence/platform-marketing-mobile-walkthrough.jpg) |
| Unified dashboard | [1440px](evidence/platform-dashboard-1440.jpg) | [360px](evidence/platform-dashboard-360.jpg) |
| Private panel workspace | [1440px](evidence/platform-panels-1440.jpg) | [360px](evidence/platform-panels-360.jpg) |
| Existing request inbox | [1440px](evidence/platform-intake-desktop.jpg) | [360px](evidence/platform-intake-mobile.jpg) |

The responsive checks also cover 390, 430, 768 and 1024 px where the screenshot table does not include a capture. Tables scroll inside their containers. No whole-page horizontal overflow is hidden to manufacture a pass. The tests check control bounds, navigation height, form stacking, keyboard access and meaningful interactions.

### Measured CI navigation observations

| Page/capture | DOM content loaded | Load event | Resource entries |
| --- | --- | --- | --- |
| Dashboard 1440 px | 24 ms | 27 ms | 8 |
| Dashboard 360 px | 23 ms | 27 ms | 8 |
| Panels 1440 px | 31 ms | 31 ms | 9 |
| Panels 360 px | 33 ms | 35 ms | 9 |

These measurements came from the Navigation Timing API in CI against a loopback server. They are not public-site latency, Core Web Vitals, a Lighthouse score or a real-device benchmark. No frontend framework, remote font, analytics tag or third-party browser script was added.

## CI history and test-fixture corrections

- [Run 57](https://github.com/panelreply-business/panelreply-demo/actions/runs/44525448956), commit `1ad5a10472402540e6d3a4722db1a43e6c8462cc`: 400 Node/HTTP, 105 existing browser and nine native OCR cases passed. The 21-method marketing suite reported five failed subchecks and one fixture error. One responsive method had four failed widths. A second mobile method hit the same overflow. These were not five separate application defects. Panel/platform browser stages did not run after that failure.
- [Run 58](https://github.com/panelreply-business/panelreply-demo/actions/runs/44526917145), commit `95c6ad4fe4c57ca1a14653ae44ad650fbb3a015d`: marketing 21 and platform 18 passed. Panel 20 passed with one fixture error. The server returned the expected 401, but the test tried to read its response body after navigation released it.
- [Run 59](https://github.com/panelreply-business/panelreply-demo/actions/runs/44529305704), commit `5b17352854bd84c5519020666383af93fe9a054a`: all 574 executed checks passed, zero failures, three intentional public blocks.

- [Run 60](https://github.com/panelreply-business/panelreply-demo/actions/runs/44533037007), commit `f5186d323cf4561385263780071528a766654d08`: 587 PASS, one failed panel assertion, two panel errors and three intentional public blocks. The errors included the unavailable retry above and a new test polling string blocked by CSP. The image polling now uses an arrow function, matching the existing CSP-compatible browser pattern. The CSP is unchanged.

- [Run 61](https://github.com/panelreply-business/panelreply-demo/actions/runs/44535177854), commit `370d158fb8c7dbf3daf74fe8798df4cc85e61c94`: 590 PASS, zero failures and three intentional public blocks. All 24 panel cases passed after the image-input corrections. The image polls both use CSP-compatible function predicates. All 27 marketing cases, including the landscape subcase, and all 19 platform cases also passed.

The download-failure fixture was corrected to install its throwing replacement without returning the replacement function to Playwright. The stale-session fixture now captures the real response through `route.fetch()` before forwarding that unchanged response. Neither change weakens an application assertion. The session fixture still requires 401/session_changed, redirect and cleared private state.

Independent new browser suites run after a sibling failure when Chromium installed successfully. Any failing test still fails the workflow. This exposes more evidence without hiding errors.

## Review gate

GO for code/design review and local evaluation. The first development milestone is complete and verified on the draft branch. A customer pilot or public deployment remains NO-GO. Main and both suspended Render services remain unchanged. Merge and public exposure require separate owner approval.

Remaining work: authorized real-photo OCR benchmarking, hosted private access/storage, native-process resource isolation, deletion/retention, offsite restore objectives, account recovery operations, reviewed legal text/pricing and separately approved live integrations. XLSX remains evaluated and deferred. A callback preference is not an appointment.
