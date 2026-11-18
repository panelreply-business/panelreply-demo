# PanelReply / Ringkeep release audit

Audit date: 2026-11-18. Scope: `panelreply-business/panelreply-demo` and the connected Render `panelreply-demo` static site. This document does not claim to inspect other repositories or external services.

## Verified environment

- The GitHub repository is public and the branch `audit/fix-intake-safety-20261118` is available for corrections.
- The Render service publishes only `index.html` and `robots.txt` using a static-site build command. Auto-deployment is disabled.
- The last inspected Render deployment was marked live, dated 2026-11-17. A successful deploy is not a verified functional end-to-end test.
- No connected Render web services, Postgres instances, or Key Value instances were returned during the audit. This does not establish the state of other hosting accounts or third-party providers.
- The website visibly labels the flow as sample data and states that it does not send communications, store customer requests, or book appointments.

## Confirmed code issues and corrections proposed in this branch

| Severity | Finding | Reproduction | Change | Validation |
| --- | --- | --- | --- | --- |
| High | Electrical hazard keywords such as smoke, arcing, electric shock, and exposed live wire did not trigger safety handoff. | Enter each phrase in the customer message field of the original sample. | Expand the urgent-message matcher and retain human-review pause. | Regression tests exercise multiple hazard phrases. |
| Medium | Punctuation-only job descriptions or callback times advanced intake. | Enter `!!!` at the initial job or timing stage in the original sample. | Require meaningful alphanumeric content for timing and alphabetic content for job descriptions. | Negative-input and valid-flow tests. |
| Medium | The screen did not make an urgent safety hold or STOP state clear. | Enter urgent text or STOP and look at the step heading in the original demo. | Update title, step, and summary to disclose safety hold and STOP. | State and display tests. |
| Medium | Several demo messages suggested that data or alerts were genuinely saved. | Simulate call, complete intake, or send more details. | Clarify that the events exist only on this page and no messages or alerts are sent. | Disclosure tests. |
| Medium | No repeatable regression test suite or automated checks existed in the inspected repository. | Inspect original repo contents and combined check status. | Add dependency-free Node tests and a GitHub Actions workflow. | GitHub Actions passed 27 of 27 tests including live smoke checks on 2026-11-18; verify again after later changes. |

The demo does not implement durable opt-out, sending, alerting, dispatch, or storage. The STOP/START state applies only to the currently opened sample page. The keyword list is not a substitute for trained emergency handling.

## Test inventory

| Area | Status | Notes |
| --- | --- | --- |
| GitHub read/write | PASS | Branch and commits created successfully |
| Render prior build | PASS | Last recorded deployment was live |
| Static demo input logic | PASS | Node regression suite passed in GitHub Actions for audit branch; browser behavior not independently tested |
| CSP hash and no demo network I/O | PASS | CSP and mocked browser logic tests passed; full security review remains required |
| Browser desktop/mobile layout | NOT TESTED | CSS media query exists; visual QA still required |
| Live website uptime | PASS (point-in-time) | GitHub Actions fetched HTTP 200 from the public demo and robots.txt on 2026-11-18; not an availability guarantee |
| Real inbound/missed calls | NOT IMPLEMENTED HERE | No telephony backend in this repository/deployment |
| Real SMS and per-sender STOP/START | NOT IMPLEMENTED HERE | Needs consent, delivery and suppression records |
| AI reply quality / fallback | NOT IMPLEMENTED HERE | No model integration in inspected demo |
| Owner alerts and human handoff | NOT IMPLEMENTED HERE | Simulated labels only |
| Customer authentication/onboarding | NOT IMPLEMENTED HERE | No account or tenant lifecycle |
| Persistent data, authorization, auditing | NOT IMPLEMENTED HERE | Requires backend, storage and access control |
| Concurrency and high load | NOT TESTED | Static single-browser sample is not multi-customer |
| Billing and subscription events | NOT IMPLEMENTED HERE | No billing system in inspected demo |
| Real-world consent/privacy compliance | NOT TESTED | Requires complete operational design and review |

## Release decision

**NO-GO for a live customer pilot.** The GitHub changes address the demo, not the missing production service.

Before a pilot:

1. Keep the Node regression suite passing on the PR and manually test desktop/mobile and accessibility.
2. Decide on the service architecture, database, telephony/SMS provider, AI behavior, and customer onboarding process.
3. Build persistent consent and opt-out tracking; never assume a missed call alone authorizes SMS.
4. Implement webhook authentication, tenant isolation, authorization, data retention, rate limits, retries and idempotency.
5. Implement real owner notifications and a human emergency escalation path with verified delivery and fallback.
6. Use sanctioned test numbers and synthetic customer data for end-to-end phone/SMS tests. Obtain separate approval before sending or paying for anything.
7. Exercise failure scenarios, concurrency, message delivery, cancellation, privacy, billing, and recovery before pilot approval.

No production deployment, paid service creation, external customer contact, or real communications were authorized or performed as part of this branch.
