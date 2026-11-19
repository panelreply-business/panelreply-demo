# Contractor workspace redesign

Prepared November 18, 2026, America/Detroit.

The user requested more testing and a more professional, realistic website. This update builds on the AI intake candidate in PR #2, previously verified at `1cd08e89928e881e11261239067f84ae5143e3d6`.

## Interface changes

- Replace the tour layout with a contractor workspace, navigation, conversation panel and request detail card.
- Preserve PanelReply's green and amber identity with a light app canvas, readable labels and consistent controls.
- Show the electrical work, ZIP and callback preference in separate rows.
- Count confirmed fields. A conflicting ZIP reduces the confirmed count until it is resolved.
- Show request status for collection, clarification, STOP, safety hold and callback readiness.
- Add a character counter and a conversation empty state.
- Keep the latest conversation entry in view after sending a message. Preserve the reading position for incoming content when the user has scrolled back.
- Add Copy request summary. Show success only after the clipboard write completes. If permission is denied, open and select the summary for manual copying.
- Keep navigation targets, keyboard focus, mobile controls and text resizing usable.
- Show the current AI, messaging and calendar connection status. No invented customer totals, bookings, reviews or performance claims are displayed.

This remains a sample workspace. The redesign does not activate AI, customer messaging, storage or booking. The optional AI adapter is unchanged apart from the shared parser safeguards described below.

## Confirmed defects found by the additional tests

| Priority | Reproduction | Correction and regression evidence |
| --- | --- | --- |
| Medium | `Replace the panel at 12 Main Street. ZIP 48315.` completed intake because the address became timing | Street numbers and electrical ratings no longer become callback times. A real time later in the same sentence still works. Parser and browser regression added |
| Medium | `ZIP 48315–1234`, `ZIP 48315 1234` and other dash spellings accepted the first five digits | Extended ZIP spellings require clarification. Parser, server validation and browser coverage added |
| Medium | `Not Friday, Monday after 4` put `Not` into the job and lost the negation in timing | Preserve the negation with the timing preference and avoid inventing a job. Parser and browser coverage added |
| High for future messaging use | `Please don’t send me any more texts` did not pause intake | Recognize explicit no-message wording, including bundled input, without treating `Don’t stop sending me texts` as opt-out. Parser, server bypass and browser coverage added |

The scheduled audit also added polite unsubscribe and opt-out wording while this redesign was in progress. Its code and tests were preserved. The four new parser regression groups failed before correction. All passed afterward. These are corrections in the local parser and deterministic server safeguards, not evidence of live model accuracy.

## Verification

At candidate preparation:

- PASS: 96 offline controller, parser and server checks.
- PASS: generated bundle/CSP integrity and Python compilation.
- NOT TESTED: updated browser layout, clipboard interactions and deployed behavior, pending CI and release verification.
- BLOCKED: live model quality, pending the separate API configuration and spending approval.
- NOT IMPLEMENTED: customer calls/SMS, calendar booking and durable customer data.

The CI workflow runs the existing suites plus `tests/ui_browser_test.py`. UI scenarios cover field progress, clarification, STOP/safety states, character counts, clipboard permission failures and reset races, navigation, touch targets, long messages, 200% text scaling, conversation scrolling and rendered contrast. Preview screenshots use synthetic data and no external assets. All AI responses in tests are fixtures.

Automated browser checks use Chromium. They do not establish physical-device, Safari or screen-reader compatibility.

## Release scope

The front-end release targets the existing Render static service. Its build publishes only `index.html` and `robots.txt`. The static page retains `data-ai-enabled="false"`. This update requires no new account, paid AI call, hosting service, billing change or customer contact.

Before publication, verify the tested revision and review the rendered screenshots. After publication, verify the delivered HTML and CSP, then exercise the request, correction, copy and STOP/safety paths on the live site. A source fix is not marked resolved on the website until that verification completes.
