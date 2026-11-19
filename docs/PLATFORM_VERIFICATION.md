# Platform verification record

Date: 2026-11-19. Scope: draft PR8 on `feature/interactive-dual-product-site`.

## Verified platform baseline

[Run 59](https://github.com/panelreply-business/panelreply-demo/actions/runs/44529305704) passed at commit `5b17352854bd84c5519020666383af93fe9a054a`: 574 checks PASS, zero failures, and three public application checks BLOCKED by intentional owner suspension. The 574 count includes 400 Node/HTTP cases, 165 Chromium cases and nine actual native OCR cases. It excludes the three blocked checks.

The next UX refinement is implemented and locally checked below. Its new browser states must pass CI before that refinement is called verified. No merge or deployment is authorized by this record.

| Area | Baseline status | Evidence |
| --- | --- | --- |
| Node logic, database, API, real HTTP and security regression | PASS | 400 cases, zero failures in run 59. Three separate public application skips. |
| Existing demo, intake, inbox, recovery and export browser suites | PASS | 105 Chromium cases: 11 + 42 + 12 + 31 + 9. |
| Dual-product marketing browser flows | PASS | 21 Chromium cases in run 59. |
| Private panel projects, images, OCR, CSV and failure paths | PASS | 21 Chromium cases in run 59. |
| Dashboard and panel responsive/interaction checks | PASS | 18 Chromium cases in run 59. Includes 360, 390, 430, 768, 1024 and 1440 px. |
| Actual local OCR in CI | PASS | Nine cases, zero failures. Tesseract 5.3.4/English. Six synthetic labels and three native failure paths. 10/10 known fields matched; 2/2 missing/conflicting fields stayed blank. |
| Generated historical demo and CSP | PASS | `node scripts/build-demo.cjs --check` in CI and local verification. |
| Baseline screenshot inspection | PASS | Actual Chromium desktop/mobile marketing, inbox, dashboard and panel captures reviewed. A further tablet issue found by code review is recorded below. Screenshot inspection covers captured states only. |
| Render configuration | PASS | Read-only inspection: both services suspended, auto-deploy off, PR previews off. |
| Public application flows | BLOCKED | Three legacy checks intentionally blocked by suspension. Separate offline guards confirm both suspended responses. |
| Real job-site OCR accuracy | NOT TESTED | Synthetic fixture measurements only. |
| Safari, Firefox, actual phones and assistive-technology audit | NOT TESTED | Current browser evidence is Chromium at the stated viewport sizes. No complete WCAG conformance claim. |
| Production Core Web Vitals | NOT TESTED | CI loopback navigation timings are not a production performance score. |
| XLSX, live AI/messaging/booking, customer pilot and hosted operations | NOT IMPLEMENTED | Not activated or claimed by this branch. |

Local HTTP listeners and local Chromium execution are unavailable in this execution environment. Real HTTP and browser checks run in the existing GitHub Actions workflow against temporary loopback servers and synthetic data. No public listener or customer integration is used.

## UX refinement checkpoint

Implemented after the verified baseline:

- Original panel/reply SVG mark with dark/light variants, reused by website, login and private workspace.
- Optional guided sample-label walkthrough, predetermined-row reveal, Skip/Escape, reduced-motion behavior and preserved edits on replay.
- Confirmation before removing edited/reviewed demo rows or populated private project rows.
- Missing-core-field indicators in the private parts table.
- Native image selection and drag-and-drop with type/size/count validation, explicit Save, selection clearing and an indeterminate progress state during actual read/save work.
- Tablet navigation-height correction, full-width phone project fields and project-preserving Exports navigation.

Local verification of this refinement: 397 pure Node checks PASS, zero failures; nine actual Tesseract 5.5.0 cases PASS; generated-demo/CSP check PASS; JavaScript syntax and Python compilation PASS. These local checks are not additional cases to add to a later full CI total.

New browser coverage is implemented but NOT TESTED until the next CI run: 27 marketing cases, 24 panel cases and 19 platform cases. These replace the prior suite counts of 21, 21 and 18 respectively. Existing 105 browser cases remain intact.

## Defects and verification

| Priority | Reproduction | Correction | Current verification |
| --- | --- | --- | --- |
| Medium | Change only whitespace in a note/part, interrupt PATCH, then retry. Trimmed comparison could match the old saved data. | Compare exact corrected strings, normalizing only the documented project-name trim. | PASS in run 59 interrupted-update regression. |
| Medium | Leave business A open, sign in as business B in another tab, then retry/read A's screen. | Pin authenticated frontend requests to the current session, clear stale state, retain independent server tenant checks. | PASS in run 59 API, client-state and browser cases. |
| Medium | Create a project beyond capacity and receive 409. | Only a `version_conflict` on a saved project opens conflict recovery; quota failures retain an editable draft. | PASS in run 59. |
| Medium | Fail the first session read before readiness, then retry. | Enable retry after the operation ends even if bootstrap never completed. | PASS in run 59. |
| Medium | View marketing parts at 360/390/430/768 px. The last header's screen-reader text used the viewport as its positioning container. | Contain the accessible label within the table scroller. Do not hide whole-page overflow. | PASS in runs 58 and 59 at all six requested widths. |
| Medium | Open any authenticated page at 761–880 px. The desktop sidebar minimum height survived the topbar breakpoint. | Reset sidebar height/min-height at the 880 px breakpoint. | Implemented. New geometry assertions await CI. |
| Medium | Open `/panels?project=ID`, then choose Exports. The full navigation URL discarded the selected ID. | Use in-page project/export anchors. Explain export selection when arriving from another page. | Implemented. New navigation regression awaits CI. |
| Low | On phones the project name and notes inherited two columns while losing their full-row spans. | Give panel metadata fields full width and stack them on mobile. | Implemented. Existing responsive cases now assert geometry; CI pending. |
| Low | Private mobile navigation labels extended outside the visible horizontal strip. | Wrap navigation into a grid with 44 px targets. | PASS in runs 58 and 59; visual captures inspected. |
| Low | UI limits differed from backend part-number/notes limits; blob image previews conflicted with CSP. | Align field lengths and use authenticated same-origin source image URLs. | PASS in run 59 boundary and image-preview cases. |

## CI history and test-fixture corrections

- [Run 57](https://github.com/panelreply-business/panelreply-demo/actions/runs/44525448956), commit `1ad5a10472402540e6d3a4722db1a43e6c8462cc`: 400 Node/HTTP, 105 existing browser and nine native OCR cases passed. The 21-method marketing suite reported five failed subchecks and one fixture error. One responsive method had four failed widths. A second mobile method hit the same overflow. These were not five separate application defects. Panel/platform browser stages did not run after that failure.
- [Run 58](https://github.com/panelreply-business/panelreply-demo/actions/runs/44526917145), commit `95c6ad4fe4c57ca1a14653ae44ad650fbb3a015d`: marketing 21 and platform 18 passed. Panel 20 passed with one fixture error. The server returned the expected 401, but the test tried to read its response body after navigation released it.
- [Run 59](https://github.com/panelreply-business/panelreply-demo/actions/runs/44529305704), commit `5b17352854bd84c5519020666383af93fe9a054a`: all 574 executed checks passed, zero failures, three intentional public blocks.

The download-failure fixture was corrected to install its throwing replacement without returning the replacement function to Playwright. The stale-session fixture now captures the real response through `route.fetch()` before forwarding that unchanged response. Neither change weakens an application assertion. The session fixture still requires 401/session_changed, redirect and cleared private state.

Independent new browser suites run after a sibling failure when Chromium installed successfully. Any failing test still fails the workflow. This exposes more evidence without hiding errors.

## Review gate

The verified platform baseline is suitable for code/design review. The UX refinement remains pending its own full CI and screenshots. A customer pilot or public deployment remains NO-GO. Main and both suspended Render services remain unchanged. Merge and public exposure require separate owner approval.
