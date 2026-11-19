# PanelReply sample walkthrough

This repository contains a static, sample-only product tour for an electrical contractor intake workflow.

It does **not** receive real calls or text messages, send SMS, dispatch technicians, persist customer records, create real customer accounts, book appointments, or process payments.

## Test the walkthrough

Requires Node.js 22 or later. No package installation or secrets are needed.

```sh
node --test tests/demo.test.cjs
# Also check the public Render demo with safe GET requests:
node --test tests/*.test.cjs
```

The unit tests execute the actual inline JavaScript in a mocked document and check its CSP script/style hashes. The separate live smoke tests make read-only HTTP GET requests to the published Render demo. GitHub Actions runs the Node checks and real Chromium browser checks on pull requests and main-branch changes, and daily on the default branch once merged. An open PR update runs once instead of once for the push and again for the PR.

Browser checks require Python 3.12 and Playwright:

```sh
python -m pip install -r tests/browser-requirements.txt
python -m playwright install --with-deps --only-shell chromium
python tests/browser_test.py
```

The browser suite serves a temporary copy of the same two published files over localhost HTTP. It uses the app's real buttons, forms, stylesheet and CSP. It tests input validation, keyboard controls, opt-outs, safety holds, reset, text injection, page reload, and layouts at 320, 390, 768 and 1280 pixels. All attempted external browser requests fail the test. It sends no calls, SMS or email.

These checks do not establish screen-reader compatibility, other browser-engine support, an API, telecommunications, compliance, payments, customer identity or multi-tenant security. Live smoke checks do not verify that unmerged changes are deployed.

## Deployment

The connected Render service, `panelreply-demo`, is configured as a static site. Its build command publishes `index.html` and `robots.txt`. Changes in this pull request should remain unmerged until tests pass and someone reviews the live sample wording.

See [release audit](docs/RELEASE_AUDIT.md) for readiness and blockers.

