# AI intake candidate

Status recorded November 18, 2026, America/New_York.

This feature builds on `audit/fix-intake-safety-20261118` at `7d63a6b355e8d8fe2febaead1498d07bd08c94c7`. The published Render app still uses application commit `100030c7976f60dba483510a233cdc8ce95d5097`. Changes here are not evidence of a production fix.

## Problem and resulting behavior

The previous intake required the job, ZIP and callback timing in three separate messages. A complete paragraph became the job description, and the next step still asked for a ZIP. This is a confirmed medium defect in the demo flow.

The candidate collects supplied fields from one message, accepts different ordering, retains previous fields and asks for missing information. Explicit corrections replace the intended field. Conflicting ZIPs remain unresolved until the user supplies a ZIP. Timing stays a preference, not a booking.

Try these sample messages:

```text
I need an EV charger installed in my garage. My ZIP is 48315. Call me Friday after 4 pm.
Actually the job ZIP is 48084
Call me Monday after 5 pm instead
```

The first message completes the three-field callback summary. The second changes only the ZIP. The third changes the timing. None creates an appointment or contacts a customer.

## Components

| Component | Behavior |
| --- | --- |
| `src/intake.js` | Deterministic extraction, field merging, missing-field checks and STOP/safety detection shared by browser and server |
| `src/demo.js` | UI state, same-origin AI request, visible fallback and cancellation of stale results |
| `scripts/build-demo.cjs` | Embeds the source into the static page and regenerates script/style hashes |
| `server.cjs` | Serves the demo, health and restricted intake endpoint. Calls the Responses API only when configured and authenticated |

The local parser is not AI. The model is used only for extraction. Application code generates the follow-up questions and enforces STOP, safety holds and the no-booking boundary. No model tools are configured.

## Live activation requirements

The existing Render service is a static site. It cannot keep an API key on a request-processing server or run the new Node endpoint. The implementation remains disabled until a web-service deployment and API use are approved and configured.

Required settings:

| Setting | Requirement |
| --- | --- |
| `AI_DEMO_ENABLED` | Exactly `true`. Default is disabled |
| `OPENAI_API_KEY` | Server-side secret, never committed or sent to the browser |
| `OPENAI_MODEL` | Explicitly selected model supporting Responses structured outputs |
| `DEMO_ACCESS_TOKEN` | 32–256 non-whitespace characters. Shared test access, not customer authentication |
| `PUBLIC_ORIGIN` | Exact HTTPS origin without a trailing slash. HTTP allowed only for localhost |
| `AI_MAX_REQUESTS_PER_PROCESS` | Explicit cap of 1–1000 attempted provider requests. Example defaults to 0, which disables AI |
| `PORT` | Defaults to 10000. The server binds to `0.0.0.0` |

After approval, the owner can configure server secrets through the hosting platform. Do not paste API keys into chat, source code, screenshots or browser form fields. The browser form accepts only the separate demo access code.

For an approved local configuration with Node 22 or later:

```sh
node --env-file=.env server.cjs
```

The `.env.example` file contains no active credentials. `.env` and local variants are ignored by git. AI remains unavailable when any activation condition fails.

## Request and failure handling

`POST /api/intake` accepts a message of at most 500 characters plus the three current fields. It requires JSON, the configured origin and a bearer demo code. It rejects unknown fields, invalid input and bodies over 8 KB. The server exposes no configuration or source-file route.

Known STOP/START and hazard inputs bypass the provider. A bundled opt-out and hazard retain both protections. The browser also processes these before starting an AI request.

The provider request uses a strict JSON schema, `store:false`, a 1024-token output limit and a 12-second server timeout. The endpoint has no automatic retries, allows two concurrent provider calls and at most ten attempts per minute, and counts failed attempts against its cap. Requests already disconnected before provider processing do not make a call. A later disconnect aborts the pending request, although cancellation does not establish that a provider attempt was free.

The adapter rejects incomplete, refused, malformed or unexpected tool output. Non-null extracted strings must appear verbatim in the latest message. ZIP extraction also has deterministic checks against conflicting ZIPs, phone numbers, prices, street numbers, wattage and ZIP+4. Numeric-only job descriptions and ZIP-shaped timing are rejected. These controls reduce errors but do not prove semantic accuracy.

The browser shows failures and uses local parsing. It does not label fallback output as an AI success. Reset and STOP invalidate pending results, so a late response cannot refill a cleared conversation or resume opted-out intake.

## Data and cost limits

- Static mode makes no AI requests and keeps sample state in page memory.
- AI mode sends the current sample message and collected fields to OpenAI. Use synthetic data during testing.
- This app does not write a customer database or persist the access code, intake or opt-out state across reloads.
- `store:false` is not a zero-retention guarantee. Provider data controls need review before customer use.
- The request cap and rate limit are in memory. They reset on process restart and apply separately to each instance. They are not a durable billing ceiling.
- The shared test code is a demo gate. Customer authentication, tenant isolation, durable suppression, durable budgets and audit logs are not implemented.
- No paid API request, new hosting resource, production deployment or customer communication was performed for this candidate.

## Appointment booking

Booking is NOT IMPLEMENTED. The app records free-text timing and a sample status. It has no calendar credentials, availability query, appointment table, booking endpoint or calendar event creation. `Booked by contractor` only changes the label on the page, and the page states that no calendar event was created.

Before real booking can pass acceptance:

1. Select the contractor calendar or booking system and establish authorized access.
2. Define working hours, timezone, job duration, travel buffers and service area.
3. Collect and validate the required customer/contact and site details.
4. Offer availability from the booking system, not from model guesses.
5. Recheck a selected slot and create the event with duplicate/conflict protection.
6. Confirm only after the booking system returns a verified event ID.
7. Test cancellation, rescheduling, timezones, duplicate submissions and provider outages.

AI can help collect the request. Booking requires the separate transactional workflow above.

## Evidence and acceptance status

[CI run 44432478293](https://github.com/panelreply-business/panelreply-demo/actions/runs/44432478293) passed on November 18, 2026 at 7:52 PM America/New_York. Tested feature revision: `d5a16f9bc4a6499196cabd27243cf33be201db8e`. Chromium version: `151.0.7922.34`. There were 121 passing test cases, no failures and no skips.

| Suite | PASS count |
| --- | ---: |
| Browser controller, generated content and CSP logic | 44 |
| Shared intake parser | 17 |
| Server configuration, request and provider-response guards | 24 |
| Real HTTP boundary with a fake provider | 1 |
| Read-only live Render GET checks | 3 |
| Existing Chromium flow, access and layout scenarios | 11 |
| Bundled intake and simulated AI Chromium scenarios | 21 |
| Total | 121 |

| Area | Status | Evidence or limit |
| --- | --- | --- |
| Local parsing, controller and server checks | PASS | 85 offline cases and generated bundle/CSP integrity verified locally and in CI |
| Real HTTP boundary and Chromium scenarios | PASS | 1 HTTP case and 32 browser scenarios passed on the GitHub runner, using synthetic data and fake provider responses |
| Live Render availability and static disclosures | PASS | 3 read-only GET checks. These do not establish that this candidate is deployed |
| Live Render behavior after this change | NOT TESTED | Candidate not deployed |
| Live model quality and supported model configuration | BLOCKED | API key, model selection, server deployment and cost approval required |
| Calendar booking, calls/SMS and customer persistence | NOT IMPLEMENTED | No integrations or durable backend exist for these functions |
| Customer launch | NO-GO | Live AI, booking and production controls remain outside verified coverage |

All model responses used by the automated tests are fixtures. Passing these tests establishes adapter and application behavior for the tested inputs, not OpenAI accuracy or a functioning booking integration.

The first CI attempt, [44432326216](https://github.com/panelreply-business/panelreply-demo/actions/runs/44432326216), passed all 89 Node/HTTP checks but failed one browser assertion. The previous test expected the old ZIP heading after a rejected ZIP+4 input. The candidate correctly requested clarification. The assertion now checks the clarification heading, empty ZIP and five-digit ZIP prompt. The subsequent full run passed both browser suites. No application check was removed or disabled.

## Defects corrected during this feature review

| Priority | Reproduction | Correction |
| --- | --- | --- |
| Medium | Send the job, ZIP and timing in one message to the old flow | Extract all supplied fields, then ask only for missing fields |
| Medium | Complete intake, then send `Actually the job ZIP is 48084` | Strip correction/location scaffolding without replacing the job |
| Medium | Supply conflicting ZIPs, then provide only a timing correction | Keep ZIP clarification pending until a ZIP is confirmed |
| High | Send `No more texts. My ZIP is 48315.` or `STOP. My breaker is melting.` | Honor opt-out clauses within bundled input and retain safety hold separately |
| Medium | Fake model returns the same ZIP as job, ZIP and timing | Reject impossible field types, then show local fallback |
| Medium | Client is already disconnected when provider processing begins | Check connection state before counters and provider call |

Each correction has a regression test. Candidate fixes must be deployed and retested before any live issue is marked resolved.

## Primary references

- [OpenAI structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses)
- [OpenAI Responses create API](https://developers.openai.com/api/reference/resources/responses/methods/create)
- [OpenAI API authentication](https://developers.openai.com/api/reference/overview/)
