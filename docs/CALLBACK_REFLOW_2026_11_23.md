# Callback enlarged-text reflow

## Verified run86 outcome

Committed `13b8741` passes the complete 15-method selected callback suite in Chromium, Firefox and WebKit on Linux and Intel Mac. The enlarged-text journey retains 320px geometry, doubled root/body/control fonts, request-control bounds, draft-disable/discard behavior, native Tab/ShiftTab and visible focus assertions. Linux and Mac WebKit both pass. This closes the recorded reflow/focus failure for those source/platform scopes. [Verified final record](evidence/callback-scheduling-run86.json).

The earlier failures and candidate reasoning below remain historical evidence. This result does not establish physical devices, native Safari or forced-colors operation.

## Reproduced failure

[Run84](https://github.com/panelreply-business/panelreply-demo/actions/runs/45225565320)
tests source `7a0a93aee098918de7bac251fc7eb929ffec16f3`. Both fixed callback
WebKit jobs pass 14 methods and fail the same enlarged-text method. At a 320px
viewport and observed 200% root, body and control text, the document becomes
521px wide on Linux and 443px on Intel Mac. The preceding control/grid minimum
changes did not repair this failure. [Recorded geometry](evidence/callback-reflow-run84.json).

An anonymous `form-field span-two` stays 248px wide but has 485px of scrollable
content on Linux and 407px on Mac. That overflow propagates to the form and
document. The trace lacks the descendant control ID. The permission select is
a source-based inference, not an identified element in this trace. Native or
anonymous control contents may contribute without an outward-overflow box.
The Linux Requests
heading has a separate defect: the Refresh button ends at 356.45px. Clipping
the whole form or page would conceal that action.

## Run85 result and next candidate

The select-only `overflow: hidden` change on committed `76db2d6` does not
repair Linux WebKit. Run85 still records a 521px document at a 320px viewport,
with the same anonymous 248px field and 485px scroll width. It records no
select-specific appearance or descendant control ID. Mac WebKit passes those
earlier geometry assertions but the method later fails its focus probe, so
that journey still earns no pass. [Source-bound final result](evidence/callback-scheduling-run85.json).

The next candidate gives the real `#lead-permission` select `appearance: none`
inside a block-sized wrapper, retains control-only overflow containment and
adds a border caret. The closed control follows CSS sizing while its option
popup, keyboard, disabled and focus semantics remain those of a real select.
The font stays doubled. No form/page clipping or custom list widget is used.
The help text is now linked with `aria-describedby`. The Requests and Callback
queue headings continue to wrap their action when it cannot fit beside the
title. Actual Linux and Mac browser verification is pending.

Review also found that the existing `select:focus { outline: none }` rule
outranks the generic focus-visible rule. The styled permission select now has
an explicit focus-visible outline. It does not depend only on box-shadow,
which forced-colors mode removes. The journey checks native Tab in both
directions and a visible solid outline after keyboard focus returns to the
menu. Forced-colors behavior still needs its own browser observation.

The existing browser method retains the 320px document-width assertion and
measures actual doubling of the root, body and five control fonts. It now
also requires the Refresh action and all five controls to remain on screen.
While the task draft exists, the request fields must remain disabled. After
discarding the unsaved task, the queue and its Refresh action must fit the
screen and no callback task may exist. Returning to the request at the same
doubled font must enable both request fields, then native keyboard Tab must
move from the labelled permission menu to Internal notes.
These assertions extend one existing journey. They do not add cases to the
execution target.

Failure-only diagnostics now identify the descendant control of each reported
form field. They also record bounded geometry, computed appearance and box
sizing for visible inbox controls, including controls whose own boxes do not
overflow. They do not log field values, change the page or filter an assertion.

Run85 exposed an error in the first added focus probe on `76db2d6`: it tried
to focus the intentionally disabled request fields before resolving the task
draft. The Mac Chromium trace identifies the Internal notes textbox as
disabled. The correction above moves that probe after discard and verifies
both the locked and unlocked states. It retains the font, viewport, control
bounds and keyboard requirements. Changed-source browser execution is pending.

The local environment has no usable pinned Playwright browser. The reviewed
change remains NOT TESTED in a browser until the next committed-source CI
run. A stylesheet edit or syntax check does not close either WebKit failure.

## Primary implementation references

WebKit bug 284644 describes the same class of symptom: long select-option
content contributes horizontal scrolling in flex/grid despite the visible
control respecting its width. It documents select-only overflow containment.
Its historical resolved status does not establish the identity of the current
WebKit 26.5 defect.

- [WebKit issue and reproductions](https://bugs.webkit.org/show_bug.cgi?format=multiple&id=284644)
- [WebKit control clipping correction](https://github.com/WebKit/WebKit/commit/6896a514b489)
- [WebKit layout-overflow follow-up](https://github.com/WebKit/WebKit/commit/1c6579f366d2)
- [CSS UI4 native appearance behavior](https://www.w3.org/TR/css-ui-4/#appearance-switching)
- [CSS forced-colors properties](https://www.w3.org/TR/css-color-adjust-1/#forced-colors-properties)

The engine corrections describe keeping a control's contents from contributing
outside scrollable overflow. This supports a repair at the control boundary.
Actual Linux and Mac browser results remain the acceptance evidence.
