# PanelReply design and interaction decisions

Date: 2026-11-19. Development surface: draft PR8, `feature/interactive-dual-product-site`. This is an implementation record, not a production-readiness or accessibility certification.

## Identity and hierarchy

The site retains the split desktop hero. Its headline and contractor-specific explanation sit beside two sample workflow actions, so both products are visible before scrolling. A centered hero was considered but would put more of the product preview below the headline. This is a design decision, not an A/B-test result.

The PanelReply mark combines a geometric panel face, structured rows and a reply shape. It replaces the earlier letter-P tile. `design-preview/mark.svg` and `mark-on-dark.svg` use the dark-surface treatment. `mark-on-light.svg` supplies the light-surface treatment. All use a 40×40 SVG viewBox without fonts or external references. The private server serves the same repository assets through explicit static aliases, rather than maintaining a second logo implementation.

Visible wordmarks provide the accessible brand name. Adjacent logo images use empty alternative text to avoid repeating that name. The SVG also serves as the favicon.

## Tokens and components

| Purpose | Treatment |
| --- | --- |
| Foundation | Dark navy `#08121F`, sidebar `#0B1829` |
| Surfaces | Slate/navy `#132236` and `#1C3048`; white/light spreadsheet and task surfaces |
| Main accent | Blue for primary actions, selected navigation and focus; white button text uses the darker blue treatment |
| Primary text | Light text on navy, dark ink on task surfaces |
| Secondary text | Muted blue-gray with explicit labels and adequate space |
| Typography | System sans-serif stack, no font download; tabular numbers; monospace where part identifiers benefit |
| Layout | Constrained marketing container, responsive split hero, distinct product work areas, persistent desktop sidebar |
| Mobile navigation | Wrapping navigation with 44 px targets; no clipped horizontal strip |
| Tables | Light data surface, direct edits, visible review state, contained horizontal scrolling |
| Focus | Visible outlines, semantic links/buttons, labeled controls, native dialogs and file picker |
| Feedback | Loading text, live status messages, validation errors, empty states, retry controls and unsaved-change guards |

The marketing site explains and demonstrates. The authenticated workspace prioritizes reviewing records, correcting parts and saving work. Shared branding does not merge their data or authentication boundaries.

## Demonstration contract

The marketing demo uses synthetic data in memory. It makes no external request, writes no browser storage, accepts no account credential and sends no message. Pricing, pilot interest and legal views explain their current review status. There are no fabricated customer testimonials or usage statistics.

The optional panel walkthrough shows:

1. A fictional sample label.
2. Three predetermined rows, revealed in 180 ms increments.
3. A return to the editable parts table.
4. The existing corrected-data CSV download.

The interface says that it does not analyze the image or run OCR. Progress counts rows actually displayed. Skip cancels the timer. Reduced motion reveals the rows immediately. Escape closes the dialog and returns focus. Replaying the guide does not overwrite edits or request records. The table remains usable without starting the guide.

Edited or reviewed demo rows require confirmation before removal. Private project rows with content also require confirmation, and the user must still save to change the stored project. Unknown component fields remain blank. A review mark records a user's review, not component authenticity or electrical compatibility.

## Image selection and processing

The private source area accepts a native file selection or a drop of one PNG/JPEG, up to 2 MiB. Client feedback rejects unsupported types, empty files, oversized files and multiple-file drops. The server independently validates image structure, dimensions, business ownership and quotas.

Selection stays on the device until Save image. The progress indicator is indeterminate during actual reading/saving. It does not invent upload percentages. A saved image can be viewed through the existing authenticated same-origin endpoint. Local Tesseract processing is separate from the marketing demonstration and requires an available approved local engine.

No CSP allowance, third-party resource, live integration or application dependency was added for these interactions.

## Verification and remaining scope

The browser suites exercise keyboard tabs, form errors, demo reset, corrected CSV content, formula-prefix protection, reduced motion, dialog focus, replay preservation, image selection, private save/retry behavior and responsive geometry. Requested widths are 360, 390, 430, 768, 1024 and 1440 px. See the current [verification record](PLATFORM_VERIFICATION.md) for actual results, failures and screenshots.

Chromium evidence does not establish Safari/Firefox, physical-device or screen-reader compatibility. WCAG 2.2 AA is a target, not a certified outcome. Production Core Web Vitals and real job-site OCR accuracy remain unmeasured. No unsupported performance or recognition claim belongs in marketing copy.
