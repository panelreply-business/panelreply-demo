# Contractor workspace redesign

Released and verified November 18, 2026, America/Detroit.

The user requested more testing and a more professional, realistic website. This update builds on the AI intake work in [PR #2](https://github.com/panelreply-business/panelreply-demo/pull/2), which is now merged. The earlier AI-only revision `1cd08e89928e881e11261239067f84ae5143e3d6` remains historical evidence for that stage.

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

## Final automated evidence

[CI run 44436345651](https://github.com/panelreply-business/panelreply-demo/actions/runs/44436345651) passed for final source revision [`23e2c38746c13e096dc74221c94ab6ca6e733173`](https://github.com/panelreply-business/panelreply-demo/commit/23e2c38746c13e096dc74221c94ab6ca6e733173), including the navigation correction.

PR #2 merged as `4db01f6ae2e02620487e297f87d28f0c4ca2fe8a`. The tested source and merge commit have identical tree `f443598d481d099b08cb116caf34f06be9754542`. The [main-branch workflow](https://github.com/panelreply-business/panelreply-demo/actions/runs/44436556064), job `135266767594`, also completed 149 cases after the merge, with zero failures or skips. Both runs verified the same application tree. The table below shows the per-run breakdown, not a combined count.

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

The exact desktop and mobile screenshots from the final CI revision were viewed and inspected. They show synthetic request data in the rendered workspace.

An earlier screenshot review found the mobile `Connections` label wrapping before its final `s`. The CSS correction keeps navigation words intact while allowing navigation items to wrap as needed. The final mobile screenshot confirms that the word no longer splits. The corrected revision also passed all automated suites.

The visual review covered the workspace structure, conversation and request cards, readability, control spacing and mobile stacking. It does not establish physical-device or Safari behavior.

[Published workspace screenshot](evidence/workspace-live-2026-11-18.jpg)

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

## Published release and live verification

Render deployment `dep-dbv4veek1f9s73bfb85g` became LIVE at `2026-11-19T01:24:16Z`, which is November 18 at 8:24 PM America/Detroit. It deployed merge commit `4db01f6ae2e02620487e297f87d28f0c4ca2fe8a` to [panelreply-demo.onrender.com](https://panelreply-demo.onrender.com/).

The first reload after deployment returned an older cached page. A version query showed the new release, and the canonical root URL was then verified to serve the new workspace. The workspace heading read `Customer requests`. The delivered script and style CSP hashes matched the expected source, and the page retained `data-ai-enabled="false"`.

The following paths were exercised through the actual published page using sample messages:

| Live check | Result | Observed behavior |
| --- | --- | --- |
| Bundled job, ZIP and callback timing | PASS | The page collected all three fields from one message |
| ZIP correction | PASS | The corrected ZIP replaced the earlier ZIP while preserving the job and timing |
| Copy request summary | PASS | The clipboard contained the exact corrected summary |
| `Please don’t send me any more texts` | PASS | Intake entered the STOP state |
| `Please unsubscribe me` | PASS | Intake entered the STOP state |
| Street address containing `12 Main Street` | PASS | The address did not become callback timing |
| `Not Friday, Monday after 4` | PASS | The timing preference retained its negation |
| `ZIP 48315–1234` | PASS | The page requested clarification and reduced confirmed progress to 2 of 3 |
| Sparking outlet, then START | PASS | The safety hold activated and START did not clear it |
| Reload and reset | PASS | The page cleared its sample state |
| Sample request button | PASS | The sample flow completed |
| START after an ordinary STOP | PASS | Normal intake could resume when no safety hold existed |
| `Booked by contractor` label | PASS | The page explicitly stated that no calendar event was created |

These live checks establish the listed behavior for the published demo. They do not establish AI accuracy, emergency triage completeness, durable opt-out enforcement or customer booking.

## Current acceptance status

| Area | Status | Limit |
| --- | --- | --- |
| Final source at `23e2c38746c13e096dc74221c94ab6ca6e733173` | PASS | 149 automated cases, zero failures or skips |
| Desktop and mobile screenshot inspection | PASS | Final rendered screenshots inspected, including the navigation correction |
| Published front-end and listed live browser paths | PASS | Deployed merge commit and canonical website verified |
| Live model quality | BLOCKED | Separate API configuration and spending approval required |
| Customer calls/SMS, calendar booking and durable customer data | NOT IMPLEMENTED | No customer integrations activated by the redesign |
| Customer pilot | NO-GO | Production integrations and operational controls remain incomplete |

## Release scope and history

The release used the existing Render static service. Its build publishes only `index.html` and `robots.txt`. The page retains `data-ai-enabled="false"`. No new account, paid AI call, hosting service, billing change or customer contact was needed for this front-end release.

The earlier safety corrections in PR #1 merged at `184ec8d6214747966b687d126dc6619afeea2ca8`. Their [49-check baseline](https://github.com/panelreply-business/panelreply-demo/actions/runs/44428320361) is historical evidence. The [earlier workspace run 44435263388](https://github.com/panelreply-business/panelreply-demo/actions/runs/44435263388) passed 149 cases for `b52105a8a5a69c259b4392d224ea785c255615b1` before the navigation correction. The final run above supersedes it for release verification.

Before this release, the inspected live application was `100030c7976f60dba483510a233cdc8ce95d5097`. That prior deployment snapshot is historical. It no longer describes the verified published workspace.

The release did not activate the server-side AI endpoint or turn callback preferences into appointments. `Booked by contractor` remains a sample status label. Calendar availability checks, event creation, customer confirmations and durable records remain separate work.
