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
| High | Realistic hazard reports such as "breaker is melting", "outlet is overheating", "power line fell in my yard", and "flames coming out of the breaker box" bypassed the safety hold. | Reproduced 8 missed urgent phrases against the earlier branch matcher, then confirmed two failing CI tests before the fix. | Expanded electrical hazard rules and preserved ordinary requests such as smoke detector installation and melting-pot outlet work. | Regression tests and PR CI passed on 2026-11-18. |
| Medium | Natural-language opt-outs such as "Don't text me again", "Stop texting me" and "Remove me from your list" advanced intake instead of pausing replies. | Reproduced six requests incorrectly accepted as job descriptions, and verified non-opt-out examples such as "stop by Thursday". | Recognize explicit unsubscribe intent without interpreting ordinary requests as opt-outs. | Regression tests and PR CI passed on 2026-11-18. |
| Medium | Punctuation-only job descriptions or callback times advanced intake. | Enter `!!!` at the initial job or timing stage in the original sample. | Require meaningful alphanumeric content for timing and alphabetic content for job descriptions. | Negative-input and valid-flow tests. |
| Medium | The screen did not make an urgent safety hold or STOP state clear. | Enter urgent text or STOP and look at the step heading in the original demo. | Update title, step, and summary to disclose safety hold and STOP. | State and display tests. |
| Medium | Several demo messages suggested that data or alerts were genuinely saved. | Simulate call, complete intake, or send more details. | Clarify that the events exist only on this page and no messages or alerts are sent. | Disclosure tests. |
| Medium | No repeatable regression test suite or automated checks existed in the inspected repository. | Inspect original repo contents and combined check status. | Add dependency-free Node tests and a GitHub Actions workflow. | GitHub Actions passed 32 of 32 tests, including 3 live smoke checks and new hazard/opt-out scenarios, on 2026-11-18; verify again after later changes. |

The demo does not implement durable opt-out, sending, alerting, dispatch, or storage. The STOP/START state applies only to the currently opened sample page. The keyword list is not a substitute for trained emergency handling.

## Test inventory

| Area | Status | Notes |
| --- | --- | --- |
| GitHub read/write | PASS | Branch and commits created successfully |
| Render prior build | PASS | Last recorded deployment was live |
| Static demo input logic | PASS | Node regression suite passed in GitHub Actions for audit branch; browser behavior not independently tested |
| CSP hash and no demo network I/O | PASS | Branch hash tests passed, and CI also validated live script/style CSP hashes; full security review remains required |
| Browser desktop/mobile layout | NOT TESTED | CSS media query exists; visual QA still required |
| Live website uptime | PASS (point-in-time) | GitHub Actions fetched HTTP 200 from the public demo and robots.txt and verified live CSP on 2026-11-18; not an availability guarantee |
| Real inbound/missed calls | NOT IMPLEMENTED HERE | No telephony backend in this repository/deployment |
| Real SMS and per-sender STOP/START | NOT IMPLEMENTED HERE | Needs consent, delivery and suppression records |
| AI reply quality / fallback | NOT IMPLEMENTED HERE | No model integration in inspected demo |
| Owner alerts and human handoff | NOT IMPLEMENTED HERE | Simulated labels only |
| Customer authentication/onboarding | NOT IMPLEMENTED HERE | No account or tenant lifecycle |
| Persistent data, authorization, auditing | NOT IMPLEMENTED HERE | Requires backend, storage and access control |
| Concurrency and high load | NOT TESTED | Static single-browser sample is not multi-customer |
| Billing and subscription events | NOT IMPLEMENTED HERE | No billing system in inspected demo |
| Real-world consent/privacy compliance | NOT TESTED | Requires complete operational design and review |


## Follow-up verification — November 18, 2026 (Detroit local)

- Pull request #1 remained open, draft and unmerged. Render pointed to `main` with auto-deployment disabled; latest inspected deployment remained the successful 2026-11-17 `100030c` build.
- Reproduced eight high-priority hazard-intake misses against the earlier branch. Added negative cases, confirmed CI failures, fixed the matcher, and confirmed passing CI.
- Reproduced six common language opt-out misses. Added consent edge cases and ordinary-job counterexamples, then confirmed CI failures before the fix and success after.
- Added a live served-CSP integrity check, covering delivered script, stylesheet, strict network/form policy and noindex metadata.
- Final verified [GitHub Actions run](https://github.com/panelreply-business/panelreply-demo/actions/runs/44426293482): 32 tests passed, 0 failed, commit `4d0b06b768037e301fa8866fbcaaf31b2bbc7fbc`. These are scripted and mock-browser checks, not live phone/SMS tests.
- Render events showed no new deployment or recorded failure after the prior successful deploy. Available logs showed build activity only. The requested HTTP metrics had no data points, so throughput, error rates, and latency could not be measured from them.
- No Render Postgres or Key Value instances were returned in the connected workspace. Real backend capabilities remain unverified or not implemented in this inspected deployment.

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
