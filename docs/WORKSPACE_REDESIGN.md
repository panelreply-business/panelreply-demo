# Contractor workspace redesign

Prepared November 18, 2026, America/Detroit.

The user requested more testing and a more professional, realistic website. This update builds on the AI intake work in [PR #2](https://github.com/panelreply-business/panelreply-demo/pull/2), previously verified at `1cd08e89928e881e11261239067f84ae5143e3d6`.

## Interface changes

- Replace the tour layout with a contractor workspace, navigation, conversation panel and request detail card.
- Preserve PanelReply's green and amber identity with a light app canvas, readable labels and consistent controls.
- Show the electrical work, ZIP and callback preference in separate rows.
- Count confirmed fields. A conflicting ZIP reduces the confirmed count until it is resolved.
- Show request status for collection, clarification, STOP, safety hold and callback readiness.
- Add a character counter and a conversation empty state.
- Keep the latest conversation entry in view after sending a message. Preserve the reading position for incoming content when the user has scrolled back.
- Add `Copy request summary`. Show success only after the clipboard write completes. If permission is denied, open and select the summary for manual copying.
- Keep navigation targets, keyboard focus, mobile controls and text resizing usable.
- Show AI, messaging and calendar connection status without inventing customer totals, bookings, reviews or performance claims.

This remains a sample workspace. The redesign does not activate AI, customer messaging, durable storage or booking. The optional AI adapter retains its activation gates and gains the shared parser safeguards described below.

## Confirmed defects found by the additional tests

| Priority | Reproduction | Correction and regression evidence |
| --- | --- | --- |
| Medium | `Replace the panel at 12 Main Street. ZIP 48315.` completed intake because the address became timing | Street numbers and electrical ratings no longer become callback times. A real time later in the same sentence still works. Parser and browser regression added |
| Medium | `ZIP 48315–1234`, `ZIP 48315 1234` and other dash spellings accepted the first five digits | Extended ZIP spellings require clarification. Parser, server validation and browser coverage added |
| Medium | `Not Friday, Monday after 4` put `Not` into the job and lost the negation in timing | Preserve the negation with the timing preference and avoid inventing a job. Parser and browser coverage added |
| High for future messaging use | `Please don’t send me any more texts` did not pause intake | Recognize explicit no-message wording, including bundled input, without treating `Don’t stop sending me texts` as opt-out. Parser, server bypass and browser coverage added |

The scheduled audit also added polite unsubscribe and opt-out wording while this redesign was in progress. Its code and tests were preserved. The four new parser regression groups failed before correction and passed afterward. These are corrections in the local parser and deterministic server safeguards, not evidence of live model accuracy.

The conversation now has a bounded scrolling area. Sending a message follows the latest reply, while incoming content preserves an earlier reading position unless the user was already near the bottom. A Chromium regression sends enough messages to overflow the list, then verifies that the newest reply remains visible within the conversation and the list ends within two pixels of the bottom.

## Verified candidate evidence

[CI run 44435263388](https://github.com/panelreply-business/panelreply-demo/actions/runs/44435263388) completed successfully for revision [`b52105a8a5a69c259b4392d224ea785c255615b1`](https://github.com/panelreply-business/panelreply-demo/commit/b52105a8a5a69c259b4392d224ea785c255615b1). Job: `135262413779`.

| Suite | Result | Passing cases |
| --- | --- | ---: |
| Node controller/parser/server checks, real HTTP boundary and live GET checks | PASS | 100 |
| Existing Chromium intake, keyboard and layout suite | PASS | 11 |
| Bundled intake, edge cases and simulated AI Chromium suite | PASS | 26 |
| Workspace controls, accessibility and responsive Chromium suite | PASS | 12 |
| Total | PASS | 149 |

There were zero failures and zero skips. The 100 Node cases include 96 offline checks, one real localhost HTTP boundary case with a fake provider, and three read-only checks of the live Render site. Generated bundle/CSP integrity also passed. The browser suites contain 49 cases in total.

All AI responses used by these tests are fixtures. The tests make no paid model requests and send no application calls, SMS or email. Live GET checks do not prove that the redesigned application is deployed.

## Visual review

Desktop and mobile screenshots from the successful CI run were viewed and inspected. They show synthetic request data in the rendered workspace.

The review found a mobile navigation label wrapping between `Connection` and its final `s`. The prepared CSS correction keeps navigation words intact while allowing navigation items to wrap as needed. That correction is later than the revision listed above, so its final CI and visual recheck remain PENDING in this record. Do not treat the earlier passing run as verification of an untested later edit.

The visual review covered the workspace structure, conversation and request cards, readability, control spacing and mobile stacking. It does not establish physical-device or Safari behavior.

## Reproduce the UI checks

```sh
python -m pip install -r tests/browser-requirements.txt
python -m playwright install --with-deps --only-shell chromium
python tests/browser_test.py
python tests/intake_browser_test.py
python tests/ui_browser_test.py
```

The new workspace suite covers:

- Confirmed-field progress, details arriving out of order and reset.
- Conflicts that reduce progress until the correct field is supplied.
- STOP and safety-hold status priority.
- Character counts, message limits and accessible descriptions.
- Clipboard success, denied permission and late completion after reset.
- Conversation scrolling after new messages.
- Skip navigation and real section targets.
- Touch targets and gated AI controls on mobile.
- Long details at 320, 390, 768, 1280 and 1440 pixels.
- Text scaling to 200% at mobile and desktop widths.
- Rendered text and control contrast of at least 4.5:1 for the selected task controls and labels.

Optional review images:

```sh
PANELREPLY_CAPTURE_DIR=/tmp/panelreply-previews python tests/ui_browser_test.py
```

`PANELREPLY_EMIT_PREVIEWS=1` emits desktop and mobile JPEGs to CI logs for review. The capture uses only synthetic data and does not load external assets.

Automated browser checks use Chromium. Keyboard, labels and contrast coverage do not establish complete accessibility conformance. Physical devices, Safari, other browser engines and assistive-technology testing remain NOT TESTED.

## Current acceptance and release status

| Area | Status | Limit |
| --- | --- | --- |
| Tested candidate at `b52105a8a5a69c259b4392d224ea785c255615b1` | PASS | 149 automated cases, zero failures or skips |
| Desktop and mobile screenshot capture and inspection | PASS | Both rendered screenshots were viewed and inspected |
| Mobile navigation word wrapping in the inspected revision | FAIL | A word split across lines. The CSS correction is prepared and awaits its final recheck |
| Final candidate after the navigation correction | NOT TESTED | New CI and visual evidence must be recorded |
| Published redesign and live behavioral verification | NOT TESTED | No deployment is claimed by this preparation record |
| Live model quality | BLOCKED | Separate API configuration and spending approval required |
| Customer calls/SMS, calendar booking and durable customer data | NOT IMPLEMENTED | No customer integrations activated by the redesign |
| Customer pilot | NO-GO | Production integrations and operational controls remain incomplete |

At inspection, [the Render website](https://panelreply-demo.onrender.com/) served application commit `100030c7976f60dba483510a233cdc8ce95d5097`. This snapshot must be replaced or supplemented with the actual release revision and live evidence after publication. It is not a claim that the current website contains these changes.

## Release scope

The earlier safety corrections in PR #1 were merged at `184ec8d6214747966b687d126dc6619afeea2ca8`. PR #2 now targets `main`. The [earlier 49-check baseline](https://github.com/panelreply-business/panelreply-demo/actions/runs/44428320361) remains historical evidence for that stage. No live deployment is claimed by the merge status.

The planned front-end release targets the existing Render static service. Its build publishes only `index.html` and `robots.txt`. The page retains `data-ai-enabled="false"`. This update requires no new account, paid AI call, hosting service, billing change or customer contact.

Before publication, verify the final candidate and its screenshots. After publication, verify the delivered HTML and CSP, then exercise intake, corrections, copy and STOP/safety paths on the live site. Source fixes are not marked resolved on the website until that verification completes.

The release must not activate the server-side AI endpoint or represent callback preferences as appointments. `Booked by contractor` remains a sample status label. Calendar availability checks, event creation, customer confirmations and durable records remain separate work.
