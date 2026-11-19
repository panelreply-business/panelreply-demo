# PanelReply / Ringkeep

A sample walkthrough of an electrical contractor intake flow: collect a job description, ZIP code and callback timing, then show a contractor review summary.

[Open the demo](https://panelreply-demo.onrender.com/) · [Repository](https://github.com/panelreply-business/panelreply-demo) · [Corrections and tests — PR #1](https://github.com/panelreply-business/panelreply-demo/pull/1)

## What this project currently does

- Demonstrates an intake conversation using sample messages.
- Provides a sample request, manual message entry and reset controls.
- Shows a callback summary and simulated contractor status changes.
- Demonstrates STOP/START and hazard-review behavior. The corrected implementation is in PR #1.

This is a static HTML, CSS and JavaScript demo. It does not receive real calls or SMS, send messages or alerts, dispatch electricians, store customer requests, create customer accounts, book appointments or process payments. Use sample information when trying it.

## Live site and tested revision

Status recorded on November 18, 2026:

| Version | Status |
| --- | --- |
| [Published Render site](https://panelreply-demo.onrender.com/) | Serves application commit `100030c7976f60dba483510a233cdc8ce95d5097`. Browser checks found opt-out, hazard and long-message layout defects in that version. |
| [Draft PR #1](https://github.com/panelreply-business/panelreply-demo/pull/1) | Contains corrections and the automated test suites. Those application changes have not been merged or deployed. |
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

To use the corrected demo and test files while PR #1 remains unmerged:

```sh
git fetch origin
git switch audit/fix-intake-safety-20261118
```

Serve the files with Python:

```sh
python -m http.server 8000 --bind 127.0.0.1
```

Open [http://127.0.0.1:8000](http://127.0.0.1:8000). Stop the server with Ctrl+C. The demo itself needs no build, API keys or application dependencies.

## Run the tests

The test files are on `audit/fix-intake-safety-20261118` until PR #1 is merged. Switch to that branch before using these commands.

### Logic checks

Requires Node.js 22 or later. No Node package installation is required.

```sh
node --test tests/demo.test.cjs
```

### Logic and live-site checks

The live checks make read-only GET requests to the public Render site:

```sh
node --test tests/demo.test.cjs tests/live-smoke.test.cjs
```

### Browser checks

Requires Python 3.12 and Playwright:

```sh
python -m pip install -r tests/browser-requirements.txt
python -m playwright install --with-deps --only-shell chromium
python tests/browser_test.py
```

The browser suite serves a temporary copy of `index.html` and `robots.txt` over localhost HTTP and uses the actual app controls, script, stylesheet and content security policy. It checks:

- Sample and manual intake, invalid input and native form validation.
- Opt-out phrases, STOP/START, safety holds and reset.
- Keyboard navigation and activation.
- Display of text that resembles HTML.
- Reset on reload, empty localStorage/sessionStorage and no document cookies.
- Layout and long-message wrapping at 320, 390, 768 and 1280 pixels.

External browser requests are blocked and fail the test. These checks use synthetic messages and send no calls, SMS or email.

Screen-reader support, physical devices, other browser engines and production integrations remain outside the verified coverage.

## Automated checks

The workflow in PR #1 runs the logic, live GET and Chromium suites on pull-request updates and pushes to `main`. It also defines manual dispatch and a daily schedule at 13:15 UTC.

The GitHub daily schedule becomes active after the workflow reaches the default branch. The separately configured ChatGPT daily audit is independent of that workflow.

## Repository contents

| Path | Purpose |
| --- | --- |
| `index.html` | Static application, styles and interaction logic |
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

## Audit records

- [Release audit](https://github.com/panelreply-business/panelreply-demo/blob/audit/fix-intake-safety-20261118/docs/RELEASE_AUDIT.md)
- [Browser retest and reproduction evidence](https://github.com/panelreply-business/panelreply-demo/blob/audit/fix-intake-safety-20261118/docs/BROWSER_RETEST_2026-11-18.md)
- [Pull request for the corrected demo](https://github.com/panelreply-business/panelreply-demo/pull/1)

Before customer use, the project needs a verified telephony/SMS backend, durable consent and suppression, authentication, customer isolation, owner notifications, recovery paths and end-to-end integration tests.
