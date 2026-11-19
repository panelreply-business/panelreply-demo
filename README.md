# PanelReply / Ringkeep

A contractor intake workspace that answers common questions from saved information and turns sample customer messages into a callback summary. It collects the electrical work, job ZIP and callback preference, shows missing or conflicting details, and keeps the conversation available for review.

[Static demo](https://panelreply-demo.onrender.com/) · [AI server preview](https://panelreply-ai.onrender.com/) · [Repository](https://github.com/panelreply-business/panelreply-demo)

## Current status: public demos intentionally offline

The owner asked to take both demos offline while development continues. On November 18, 2026, both existing Render services were suspended without deleting them. Their public URLs now show `This service has been suspended by its owner.` Auto-deploy remains off.

Continue code review, offline tests and fake-provider checks. Do not resume, deploy, republish or create another public preview without the owner's explicit approval. Live application checks are BLOCKED during this intentional shutdown, not evidence of a defect to repair. The recurring audit has been updated to preserve this instruction.

[Suspension evidence and testing policy](docs/OFFLINE_MODE.md)

## Previous release: question answering

Published November 18, 2026 at 10:37 PM America/New_York to both demo links. [PR #4](https://github.com/panelreply-business/panelreply-demo/pull/4) is merged. The release passed 209 checks: 144 Node/HTTP/live GET checks and 65 Chromium checks, with zero failures or skips. The merge commit passed CI as well.

The published chat was checked through its controls. It answered questions, recalled the supplied ZIP, preserved job details when hours or coverage were queried, and handled mixed questions and callback requests. Both deployments serve commit `9e4bac0169e7d27942686cbb0a13f1e5003d378b`.

| Area | Current status |
| --- | --- |
| Saved question answers and intake integrity | PASS — verified in CI and on both published demos |
| Live AI extraction | BLOCKED — API-key setup and approved usage remain pending |
| Live model-generated question answers | NOT IMPLEMENTED — saved answers are used |
| Contractor prices, hours, services and coverage | NOT IMPLEMENTED as verified facts — the app states that confirmation is needed |
| Appointment booking, customer messaging and durable customer records | NOT IMPLEMENTED |
| Demo review | GO |
| Customer pilot | NO-GO |

[209-check CI run](https://github.com/panelreply-business/panelreply-demo/actions/runs/44452485870) · [Merge CI](https://github.com/panelreply-business/panelreply-demo/actions/runs/44452662673) · [Release evidence and reproduction steps](docs/QUESTION_ANSWERS.md)

## Previous AI server preparation

The Node web service is deployed at https://panelreply-ai.onrender.com/. PR #3 passed 153 automated checks and was merged. Render deployed that tested application, and its health route and sample intake were checked through the browser. The live page still reports `Demo parsing. AI is not connected on this page.`

Live AI remains BLOCKED pending secure API-key setup, verified available credits or an approved spending allowance, and a real provider-backed test. No OpenAI request has been made. The static demo remains available at its existing URL.

[153-check CI run](https://github.com/panelreply-business/panelreply-demo/actions/runs/44448007795) · [Activation changes — PR #3](https://github.com/panelreply-business/panelreply-demo/pull/3) · [Deployment evidence and remaining gates](docs/LIVE_AI_SETUP.md)

## Previous static demo release

The contractor workspace was published on November 18, 2026 at 8:24 PM America/Detroit. The canonical website was then checked through its controls.

| Area | Status |
| --- | --- |
| Final tested source | PASS — revision `23e2c38746c13e096dc74221c94ab6ca6e733173` completed 149 automated checks, with zero failures or skips |
| Desktop and mobile visual review | PASS — final screenshots were inspected. The mobile `Connections` label no longer splits within the word |
| Published website | PASS — Render deployed merge commit `4db01f6ae2e02620487e297f87d28f0c4ca2fe8a` in deployment `dep-dbv4veek1f9s73bfb85g` |
| Live front-end behavior | PASS — bundled intake, corrections, clipboard copying, opt-out, safety holds, reset and the sample booking disclosure were exercised on the published page |
| Live AI | BLOCKED — AI remains disabled pending API configuration and approved spending |
| Customer messaging, calendar booking and durable customer records | NOT IMPLEMENTED |
| Customer pilot | NO-GO — production integrations and operational controls remain incomplete |

[Final 149-check run](https://github.com/panelreply-business/panelreply-demo/actions/runs/44436345651) · [Main-branch CI](https://github.com/panelreply-business/panelreply-demo/actions/runs/44436556064) · [Release evidence and live checks](docs/WORKSPACE_REDESIGN.md)

PR #2 is merged. The tested source and deployed merge commit have the same tree, `f443598d481d099b08cb116caf34f06be9754542`. The published workspace and content security policy matched the expected application, and `data-ai-enabled="false"` remained in place. This is a front-end demo release. It does not activate the model or customer integrations.

The earlier [49-check baseline](https://github.com/panelreply-business/panelreply-demo/actions/runs/44428320361) and the earlier 149-check candidate run remain historical evidence in the audit records.

## What the workspace does

- Answers common questions using saved information and the current request details.
- Keeps business-hours, pricing and coverage questions from changing the job, ZIP or callback preference.
- Presents a conversation panel and a request detail card with a consistent desktop and mobile layout.
- Accepts the job, ZIP and timing in one message or in a different order.
- Shows confirmed-field progress and asks for missing information.
- Retains the job and timing when the ZIP is corrected.
- Keeps conflicting details marked for confirmation instead of treating the request as ready.
- Shows collection, clarification, STOP, safety-hold and callback-ready states.
- Provides a character counter, sample request and reset controls.
- Keeps the latest reply in view after a message is sent.
- Copies a request summary on demand, with manual selection if clipboard permission is unavailable.
- Shows which integrations are disconnected and what the sample status controls mean.

Try this sample message:

> I need an EV charger installed in my garage. My ZIP is 48315. Call me Friday after 4 pm.

Then try `Actually the job ZIP is 48084`. The ZIP changes without replacing the other collected fields. Each message can contain up to 500 characters.

The website is a sample workspace. It does not receive real calls or SMS, send messages or alerts, dispatch electricians, save customer requests to a database, create customer accounts, book appointments or process payments. Page state resets on reload. Use sample information when trying it.

## Questions and request details

The chat can answer questions without starting over or changing the information already supplied. It can also collect details and answer a question from the same message.

Try:

```text
What details do you need?
I need an EV charger installed. How much does it cost?
My ZIP is 48315. Do you serve that area?
What ZIP did I give you?
Does this book an appointment?
```

Question replies use saved information and are labelled `Saved answer`. They do not call an AI provider. Unknown topics get an explicit limitation. These replies are not unrestricted AI chat.

No contractor services, hours, prices, service area, contact details or qualifications have been supplied and verified. The app states that those facts need confirmation. It does not invent them. Approved public business answers belong in `src/business-info.js`; each entry stays unavailable until it has both a nonempty answer and `verified: true`. Never put credentials or customer information in that public file.

Pure questions preserve field progress and unresolved clarification. Mixed messages keep explicitly stated details while excluding information mentioned only in a question. STOP and safety holds take precedence. A polite callback request such as `Can you call me Friday after 4 pm?` still records a preference.

[Question handling, defects and verification](docs/QUESTION_ANSWERS.md)

## AI and appointment boundaries

Static mode uses a local parser and labels itself `Demo parsing`. It makes no AI requests.

The optional Node server can connect `POST /api/intake` to OpenAI after configuration and cost approval. The server keeps the API key out of the browser. The model extracts source text into fields, while application code controls replies, saved question answers, opt-out handling and safety holds. Informational question clauses are excluded from model extraction. Invalid or unavailable AI responses visibly fall back to local parsing. STOP, safety holds and reset take precedence over late AI responses. Enabling this extraction adapter does not provide unrestricted AI-generated answers.

Appointment booking is NOT IMPLEMENTED. Callback timing is a customer preference, not a calendar slot. `Booked by contractor` changes a sample label only. It does not create an event, reserve a time, check availability or notify anyone.

Real booking needs a connected calendar, working hours, timezone and job-duration rules, customer details, availability checks, a verified booking write, and cancellation/rescheduling handling. The app must confirm an appointment only after the booking system accepts it.

[AI configuration, data limits and booking requirements](docs/AI_INTAKE.md)

## Try the website

1. Open [panelreply-demo.onrender.com](https://panelreply-demo.onrender.com/).
2. The workspace heading should read `Customer requests`.
3. Select `Run the sample request`, or enter a sample job, ZIP and callback preference.
4. Review the request details and confirmed-field progress.
5. Try a correction, STOP/START or `Copy request summary`.
6. Use `Reset tour` to clear the page.

The status selector and simulated missed-call button demonstrate a workflow. They do not contact anyone.

## Run locally

Clone the repository:

```sh
git clone https://github.com/panelreply-business/panelreply-demo.git
cd panelreply-demo
```

The released workspace source and its tests are on `main`.

The checked-in static page needs no API key or application dependency installation. Serve it with Python:

```sh
python -m http.server 8000 --bind 127.0.0.1
```

Open [http://127.0.0.1:8000](http://127.0.0.1:8000). Stop the server with Ctrl+C.

To serve the optional backend with AI disabled, use Node.js 22 or later:

```sh
node server.cjs
```

Open [http://localhost:10000](http://localhost:10000). `/health` reports AI readiness and booking disabled. Live AI activation is a separate configuration step described in the AI document.

After changing `src/intake.js`, `src/demo.js` or the page stylesheet, regenerate the bundle and content security policy hashes:

```sh
node scripts/build-demo.cjs
node scripts/build-demo.cjs --check
```

## Run the tests

### Offline logic and server checks

Requires Node.js 22 or later. No Node package installation is required. These tests inject fake provider responses and do not call OpenAI:

```sh
node --test tests/demo.test.cjs tests/intake.test.cjs tests/questions.test.cjs tests/server.test.cjs
```

### Full Node, HTTP and live GET checks

This command includes the localhost HTTP boundary test and read-only GET checks that both public Render URLs remain owner-suspended:

```sh
node scripts/build-demo.cjs --check
PANELREPLY_EXPECT_PUBLIC_OFFLINE=true node --test tests/*.test.cjs
```

Offline mode requires HTTP 503 and Render's owner-suspension text from both URLs, and rejects app markup. Network failures, redirects or unexpected responses fail these checks. The three checks that need the public app running are explicitly skipped as `BLOCKED: public demos intentionally offline`. All local application, HTTP and browser tests remain active. Only remove this mode after the owner approves reopening the demos.

### Browser checks

Requires Python 3.12, Playwright and an environment that permits Chromium and listening sockets:

```sh
python -m pip install -r tests/browser-requirements.txt
python -m playwright install --with-deps --only-shell chromium
python tests/browser_test.py
python tests/intake_browser_test.py
python tests/ui_browser_test.py
```

The suites serve copied application files over localhost and exercise the real controls, styles, script and content security policy. They cover:

- Manual and bundled intake, corrections, invalid input and native form validation.
- Saved answers, current-request recall, mixed questions and details, and preservation of fields and clarification state.
- Address, electrical-rating and extended-ZIP edge cases.
- Opt-out phrases, STOP/START, safety holds and reset.
- Simulated AI success, malformed output, failures and late-response cancellation.
- Confirmed-field progress, request status and character counts.
- Clipboard success, permission denial and stale completion after reset.
- Conversation scrolling, skip navigation and keyboard access.
- Touch targets, long-message wrapping and layout from 320 to 1440 pixels.
- Text scaling to 200% and rendered text/control contrast.
- Text resembling HTML, empty browser storage and no retained state after reload.

External browser requests are blocked and fail the test. AI responses are fixtures. The HTTP suite injects a fake provider. Passing these checks verifies tested application behavior, not live model accuracy or functioning customer integrations.

For local visual review, save synthetic desktop and mobile screenshots:

```sh
PANELREPLY_CAPTURE_DIR=/tmp/panelreply-previews python tests/ui_browser_test.py
```

The UI suite can also emit review images to CI logs when `PANELREPLY_EMIT_PREVIEWS=1` is set. The images contain sample data only.

Physical devices, Safari, other browser engines and assistive-technology testing remain outside the verified coverage. Automated keyboard and contrast checks do not establish complete accessibility conformance.

## Automated checks

The workflow on `main` runs the logic, fake-provider server, live GET and three Chromium suites for supported pull requests and pushes to `main`. It also defines manual dispatch and a daily schedule at 13:15 UTC. The separate ChatGPT audit schedule is independent. A configured schedule is not evidence that a particular future run completed.

Live model calls are not part of scheduled tests. The audit distinguishes verified branch fixes from published behavior and uses PASS, FAIL, BLOCKED, NOT IMPLEMENTED or NOT TESTED according to evidence.

## Repository contents

| Path | Purpose |
| --- | --- |
| `index.html` | Workspace markup, styles and generated inline bundle |
| `src/` | Shared intake parser and browser controller |
| `src/business-info.js` | Approved public business answers, empty and unverified by default |
| `src/questions.js` | Saved question answers and request recall, without provider calls |
| `scripts/build-demo.cjs` | Bundle generation and CSP integrity check |
| `server.cjs` | Optional gated AI adapter and restricted file server |
| `.env.example` | Disabled configuration example without credentials |
| `robots.txt` | Crawler exclusion directive |
| `tests/` | Logic, HTTP, live GET and browser regression suites |
| `.github/workflows/demo-tests.yml` | Automated verification workflow |
| `docs/` | Findings, reproduction steps and verification evidence |

## Render configuration

The connected `panelreply-demo` service is a static site. Its inspected build command is:

```sh
mkdir -p public-demo && cp index.html robots.txt public-demo/
```

Publish directory: `public-demo`. Only those two application files are published. Repository documentation, tests and server code are not served by this command.

Automatic deployment was disabled at inspection. The November 18 front-end release was deployed and checked on the canonical website. Future releases must verify the final source revision and retest the published page. The static page keeps `data-ai-enabled="false"`.

The static service cannot execute `server.cjs`. A separate free-plan Node web service, `panelreply-ai`, now runs that server with AI disabled. It uses `node scripts/build-demo.cjs --check` to build, `node server.cjs` to start, Node 22, the Ohio region and automatic deployment disabled. See [the activation record](docs/LIVE_AI_SETUP.md) for the deployed revision, test results and credential gate.

## Audit records

- [Workspace redesign and 149-check evidence](docs/WORKSPACE_REDESIGN.md)
- [Question answers and intake-integrity correction](docs/QUESTION_ANSWERS.md)
- [Live AI activation setup and verification](docs/LIVE_AI_SETUP.md)
- [AI intake design and earlier test evidence](docs/AI_INTAKE.md)
- [Release audit](docs/RELEASE_AUDIT.md)
- [Browser retest and reproduction evidence](docs/BROWSER_RETEST_2026-11-18.md)
- [Safety corrections — PR #1](https://github.com/panelreply-business/panelreply-demo/pull/1)
- [Workspace and AI intake — PR #2](https://github.com/panelreply-business/panelreply-demo/pull/2)

Before customer use, the project still needs verified telephony/SMS, durable consent and suppression, authentication, customer isolation, owner notifications, recovery paths and end-to-end integration tests.
