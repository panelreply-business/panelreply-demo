# Platform verification record

Date: 2026-11-19. Scope: draft PR8 on `feature/interactive-dual-product-site`.

## Current checkpoint

The first CI run found a marketing layout defect and a browser-fixture error. Corrections are saved for the next run. No merge or deployment is authorized by this record.

| Area | Status | Evidence |
| --- | --- | --- |
| Pure Node regression and new platform checks | PASS | 391 cases, 0 failures in the final combined local run on Node 24.22.3. This includes the existing 282-case pure baseline and 109 new design, panel, OCR and client-state cases. |
| Generated historical demo and CSP hashes | PASS | `node scripts/build-demo.cjs --check` |
| Actual local Tesseract | PASS | Nine cases, 0 failures: six synthetic labels and three native failure paths. Tesseract 5.5.0/English. 10/10 known fixture fields matched. 2/2 missing/conflicting fields remained blank. |
| HTTP routes and complete CI regression | PASS | Run 57 passed 400 Node/HTTP cases with 0 failures and 3 intentional offline skips. |
| Marketing browser flows | FAIL | Run 57 executed 21 methods and reported 5 failed subchecks plus 1 fixture error. Corrections await rerun. |
| Panel browser flows | BLOCKED | Run 57 stopped before this step. 21 cases are ready for the next run. |
| Unified platform responsive browser checks | BLOCKED | Run 57 stopped before this step. 18 cases cover 360, 390, 430, 768, 1024 and 1440 px. |
| Visual screenshot inspection | NOT TESTED | Captures will be taken in the passing CI browser run and reviewed. |
| Render offline configuration | PASS | Read-only connector inspection shows both services suspended, auto-deploy off and PR previews off. |
| Public application flows | BLOCKED | Three legacy checks intentionally blocked by owner suspension. |
| Real job-site OCR accuracy | NOT TESTED | Only synthetic fixture measurements exist. |
| XLSX, live AI, messaging, booking and hosted customer pilot | NOT IMPLEMENTED | Not activated or claimed by this branch. |

Local HTTP listeners and local Chromium execution are unavailable in this workspace. Those checks run in the existing GitHub Actions workflow with a temporary loopback server and synthetic data. No public listener or customer integration is used.

## Confirmed defects corrected before first CI

| Priority | Finding and reproduction | Correction | Verification |
| --- | --- | --- | --- |
| Medium | A whitespace-only notes/parts correction followed by an interrupted PATCH could match a trimmed old response and falsely report saved. | Compare exact saved strings, normalizing only the documented project name trim. Retry the original update when values differ. | Browser regression prepared. |
| Medium | A saved project could remain in the editor while a retry accepted a different signed-in business in the same browser session. | Pin authenticated frontend requests to the current session, clear stale client state, retain server tenant checks. | PASS in pure API/client-state tests. Real browser regression pending. |
| Medium | A new-project capacity 409 could be described as a version conflict and offer to reload a nonexistent project. | Only `version_conflict` on a saved project opens conflict recovery. Keep capacity errors editable. | PASS in client-state regression. Browser verification pending. |
| Medium | A failed initial session load disabled its own retry button. | Retry remains available after the operation finishes, even before initial readiness. | Browser regression prepared. |
| Low | UI field lengths disagreed with the server's part-number and row-notes limits. | Align128-character part numbers and1000-character row notes. | Browser boundary regression prepared. |
| Low | Blob-based image previews conflicted with the existing image CSP. | Use authenticated same-origin source URLs and retain the CSP. | Browser source-image regression prepared. |

## First CI findings

[Run 57](https://github.com/panelreply-business/panelreply-demo/actions/runs/44525448956), commit `1ad5a10472402540e6d3a4722db1a43e6c8462cc`, passed 400 Node/HTTP checks, 105 existing browser cases and 9 native OCR cases. Three public application checks remained intentionally blocked.

The marketing suite ran 21 methods. One responsive method reported four failed width subchecks, one mobile-control method reported overflow, and one download-fault method errored in its setup. These are not six separate application defects.

- Medium: marketing table accessibility text expanded document width to 909 px at 360/390/430 px and 824 px at 768 px. The last column's absolutely positioned screen-reader label used the viewport as its containing block. Setting the table scroller to `position:relative` contains that label within the existing scrolling area. Page overflow is not hidden. A second reviewer independently matched the failing coordinates to the header layout.
- Low: the fault-injection assignment returned its replacement function, which Playwright invoked immediately. Wrapping the assignment in a function that returns undefined allows the intended click-path failure check to run.
- Low: screenshot review found private mobile navigation labels partly outside the visible strip. The navigation now uses a wrapping grid with 44 px targets. New assertions check every navigation item stays within the viewport.

Independent new browser suites now run after a sibling browser failure when Chromium installation succeeded. The workflow still fails when any test fails. This prevents one UI defect from hiding panel and dashboard results.

The updated browser fixes are implemented, not yet verified. This record will be updated with the next run and inspected captures.

## Review gate

Current result: NO-GO for merge or deployment while new full CI and visual review are pending. Development can continue on the existing draft branch. Both public services must remain suspended. No paid API, account, outbound communication or live calendar has been used.
