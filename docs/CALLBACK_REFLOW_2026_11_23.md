# Callback enlarged-text reflow

## Reproduced failure

[Run84](https://github.com/panelreply-business/panelreply-demo/actions/runs/45225565320)
tests source `7a0a93aee098918de7bac251fc7eb929ffec16f3`. Both fixed callback
WebKit jobs pass 14 methods and fail the same enlarged-text method. At a 320px
viewport and observed 200% root, body and control text, the document becomes
521px wide on Linux and 443px on Intel Mac. The preceding control/grid minimum
changes did not repair this failure. [Recorded geometry](evidence/callback-reflow-run84.json).

The contact-permission field stays 248px wide but has 485px of scrollable
content on Linux and 407px on Mac. That overflow propagates to the form and
document. Its select does not appear as an outward-overflow box, so native or
anonymous control contents are the inferred source. The Linux Requests
heading has a separate defect: the Refresh button ends at 356.45px. Clipping
the whole form or page would conceal that action.

## Candidate repair

Only the closed `#lead-permission` select gets `overflow: hidden` and
`text-overflow: ellipsis`. This constrains the control's own closed text. Its
native appearance, option list, font size, enabled state and focus behavior
remain. The Requests and Callback queue headings wrap their action onto a
new line when it cannot fit beside the title.

The existing browser method retains the 320px document-width assertion and
measures actual doubling of the root, body and five control fonts. It now
also requires the Refresh action and all five controls to remain on screen.
At doubled text, native keyboard Tab must move from the labelled permission
menu to Internal notes. After discarding the unsaved task, the queue and its
Refresh action must also fit the screen and no callback task may exist.
These assertions extend one existing journey. They do not add cases to the
execution target.

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

The engine corrections describe keeping a control's contents from contributing
outside scrollable overflow. This supports a repair at the control boundary.
Actual Linux and Mac browser results remain the acceptance evidence.
