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

The unit tests execute the actual inline JavaScript in a mocked document and check its CSP script/style hashes. The separate live smoke tests make read-only HTTP GET requests to the published Render demo. The GitHub Actions workflow runs both test files on pull requests, changes to the audit branch, and daily on the default branch once merged.

The automated tests do not verify real browser rendering, screen-reader support, an API, telecommunications, compliance, payment operations, customer identity, or multi-tenant security.

## Deployment

The connected Render service, `panelreply-demo`, is configured as a static site. Its build command publishes `index.html` and `robots.txt`. Changes in this pull request should remain unmerged until tests pass and someone reviews the live sample wording.

See [release audit](docs/RELEASE_AUDIT.md) for readiness and blockers.
