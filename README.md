# PanelReply / Ringkeep

A sample walkthrough of an electrical contractor intake flow: collect a job description, ZIP code and callback timing, then show a contractor review summary.

This feature branch adds intake from one message and an optional server-side AI adapter. It builds on the safety corrections in PR #1. The published site has not received this branch, and live AI is not activated.

[Open the demo](https://panelreply-demo.onrender.com/) · [Repository](https://github.com/panelreply-business/panelreply-demo) · [Corrections and tests — PR #1](https://github.com/panelreply-business/panelreply-demo/pull/1)

## What this project currently does

- Demonstrates an intake conversation using sample messages.
- Provides a sample request, manual message entry and reset controls.
- Shows a callback summary and simulated contractor status changes.
- Demonstrates STOP/START and hazard-review behavior. The corrected implementation is in PR #1.

The default app is a static HTML, CSS and JavaScript demo. An optional Node server can connect the intake form to OpenAI after configuration and cost approval. Neither mode receives real calls or SMS, sends messages or alerts, dispatches electricians, saves customer requests to a database, creates customer accounts, books appointments or processes payments. Use sample information when trying it.

## Intake and AI feature

The candidate accepts this in one message:

> I need an EV charger installed in my garage. My ZIP is 48315. Call me Friday after 4 pm.

It collects the job, ZIP and callback preference, then asks only for missing information. Details can arrive in a different order. A correction such as `Actually the job ZIP is 48084` preserves the job and timing. Conflicting ZIPs require confirmation.

- Static mode uses a local parser and labels itself `Demo parsing`. It makes no AI requests.
- AI mode uses `POST /api/intake` on the same origin. The server keeps the OpenAI key out of the browser.
- The model extracts source text into fields. Replies and safety handling remain controlled by application code.
- Invalid or unavailable AI responses fall back to local parsing, with that change shown on screen.
- STOP, safety holds and reset take precedence over a late AI response.
- The page shows the extracted summary for review. Extraction is not a guarantee that every message will be understood.

[AI design, configuration, test status and booking boundaries](docs/AI_INTAKE.md)

## Appointment status

Appointment booking is NOT IMPLEMENTED. Callback timing is a customer preference, not a checked calendar slot. `Booked by contractor` changes a sample label only. It does not create a calendar event, reserve a time, notify anyone or check for conflicts.

Real booking needs a connected calendar or booking system, contractor working hours, service area and job-duration rules, customer/contact details, availability checks, a verified event write, and cancellation/rescheduling handling. Confirmation must follow a successful booking write. AI extraction alone does not provide those functions.

## Live site and tested revision

Status recorded on November 18, 2026:

| Version | Status |
| --- | --- |
| [Published Render site](https://panelreply-demo.onrender.com/) | Serves application commit `100030c7976f60dba483510a233cdc8ce95d5097`. Browser checks found opt-out, hazard and long-message layout defects in that version. |
| [Draft PR #1](https://github.com/panelreply-business/panelreply-demo/pull/1) | Contains corrections and the automated test suites. Those application changes have not been merged or deployed. |
| `feature/ai-assisted-intake-20261118` | Adds bundled intake and a gated AI adapter on top of PR #1. See the feature audit for current evidence. Not deployed. |
| Tested revision `4a967ca11f9ba3e64988e53ac83b9fe95b44d6ef` | Passed 35 logic checks, 3 live-site GET checks and 11 Chromium browser scenarios: 49 checks, zero failures or skips. |
| Customer pilot | NO-GO. Production integrations and operational controls remain unimplemented in this inspected repository. |

[Verified passing run](https://github.com/panelreply-business/panelreply-demo/actions/runs/44428320361)

The live GET checks verify availability, sample disclosures, robots.txt and content security policy integrity. They do not prove the published app contains the corrections. After an approved deployment, retest the published app before marking its behavioral defects resolved.

## Try the demo

1. Open [panelreply-demo.onrender.com](https://panelreply-demo.onrender.com/).
2. Select `Run the sample request` to see the example flow.
3. Select `Reset tour` to start again.
4. Enter a sample job description, a five-digit ZIP and callback timing.
5. Try the STOP/START buttons or change the sample contractor status.

The published version currently has the defects listed above. These controls simulate a workflow and do not contact anyone.

## Run locally

Clone the repository:

```sh
git clone https://github.com/panelreply-business/panelreply-demo.git
cd panelreply-demo
```

To use this candidate and its tests while the changes remain unmerged:

```sh
git fetch origin
git switch feature/ai-assisted-intake-20261118
```

Serve the files with Python:

```sh
python -m http.server 8000 --bind 127.0.0.1
```

Open [http://127.0.0.1:8000](http://127.0.0.1:8000). Stop the server with Ctrl+C. The checked-in static demo needs no API keys or application dependencies.

To serve the optional backend with AI disabled:

```sh
node server.cjs
```

Open [http://localhost:10000](http://localhost:10000). `/health` reports whether AI is configured and always reports booking disabled. Enabling live AI is a separate, approved configuration step described in the feature document.

After changing `src/intake.js` or `src/demo.js`, regenerate the inline bundle and its content security policy hashes:

```sh
node scripts/build-demo.cjs
node scripts/build-demo.cjs --check
```

## Run the tests

The commands below apply to `feature/ai-assisted-intake-20261118` until the feature is merged.

### Logic checks

Requires Node.js 22 or later. No Node package installation is required.

```sh
node --test tests/demo.test.cjs tests/intake.test.cjs tests/server.test.cjs
```

### Logic and live-site checks

The live checks make read-only GET requests to the public Render site:

```sh
node scripts/build-demo.cjs --check
node --test tests/*.test.cjs
```

### Browser checks

Requires Python 3.12 and Playwright:

```sh
python -m pip install -r tests/browser-requirements.txt
python -m playwright install --with-deps --only-shell chromium
python tests/browser_test.py
python tests/intake_browser_test.py
```

The browser suite serves a temporary copy of `index.html` and `robots.txt` over localhost HTTP and uses the actual app controls, script, stylesheet and content security policy. It checks:

- Sample and manual intake, invalid input and native form validation.
- Opt-out phrases, STOP/START, safety holds and reset.
- Keyboard navigation and activation.
- Display of text that resembles HTML.
- Reset on reload, empty localStorage/sessionStorage and no document cookies.
- Layout and long-message wrapping at 320, 390, 768 and 1280 pixels.

External browser requests are blocked and fail the test. These checks use synthetic messages and send no calls, SMS or email.

The AI browser suite intercepts same-origin intake requests with fixtures. The server unit suite injects a fake provider. `server-http.test.cjs` exercises the real HTTP boundary over localhost with a fake provider. None of these tests calls OpenAI or establishes live model accuracy. The HTTP and browser suites require an environment that permits listening sockets and Chromium.

Screen-reader support, physical devices, other browser engines and production integrations remain outside the verified coverage.

## Automated checks

The feature workflow runs the logic, fake-provider server, live GET and Chromium suites on pull requests targeting `main` or an `audit/` branch, and pushes to `main`. It also defines manual dispatch and a daily schedule at 13:15 UTC. Live model calls are not part of the scheduled tests.

The GitHub daily schedule becomes active after the workflow reaches the default branch. The separately configured ChatGPT daily audit is independent of that workflow.

## Repository contents

| Path | Purpose |
| --- | --- |
| `index.html` | Static page with a generated inline bundle and CSP hashes |
| `src/` | Shared intake parser and browser controller |
| `scripts/build-demo.cjs` | Bundle generation and integrity check |
| `server.cjs` | Optional gated AI adapter and restricted file server |
| `.env.example` | Disabled-by-default configuration example, without secrets |
| `robots.txt` | Crawler exclusion directive |
| `README.md` | Project overview, links and operating instructions |
| `tests/` | Logic, live GET and browser tests, available in PR #1 |
| `.github/workflows/demo-tests.yml` | Automated checks, available in PR #1 |
| `docs/` | Findings, reproduction steps and test evidence, available in PR #1 |

## Render configuration

The connected `panelreply-demo` service is a static site. Its configured build command is:

```sh
mkdir -p public-demo && cp index.html robots.txt public-demo/
```

Publish directory: `public-demo`. Only the two application files are published by this command. The README, tests and audit documents remain repository documentation.

The last inspected configuration had automatic deployment disabled. Changes to application code require a reviewed deployment and a live retest.

The current Render static site cannot execute `server.cjs`. AI requires a separate approved web-service deployment, server environment variables and a chosen model with an approved spending limit. No service was provisioned and no real OpenAI requests were made for this implementation.

## Audit records

- [Release audit](https://github.com/panelreply-business/panelreply-demo/blob/audit/fix-intake-safety-20261118/docs/RELEASE_AUDIT.md)
- [Browser retest and reproduction evidence](https://github.com/panelreply-business/panelreply-demo/blob/audit/fix-intake-safety-20261118/docs/BROWSER_RETEST_2026-11-18.md)
- [Pull request for the corrected demo](https://github.com/panelreply-business/panelreply-demo/pull/1)

Before customer use, the project needs a verified telephony/SMS backend, durable consent and suppression, authentication, customer isolation, owner notifications, recovery paths and end-to-end integration tests.

