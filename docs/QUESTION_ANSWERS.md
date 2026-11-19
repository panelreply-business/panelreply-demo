# Question answers and intake integrity

Recorded November 18, 2026, America/New_York.

The owner requested that the chat answer questions as well as collect job details. The existing adapter only extracted fields. Turning that adapter on would not have added question answering.

## Confirmed medium defect

Business questions were interpreted as customer facts. The defect is reproducible in the prior source at `9eb541dc1a82835d01eb17887ea1e369563f57a0`.

| Message | Prior behavior | Intended behavior |
| --- | --- | --- |
| `Are you open Friday?` | Stored `Are you open` as a job and `Friday` as timing | Answer the hours question without changing the request |
| `Do you service 48084?` | Changed a previously supplied ZIP to `48084` | Treat the number as queried coverage, not a job ZIP |
| `How much does it cost to install an EV charger?` | Stored the pricing question as a job | Answer the pricing question without inventing a quote or job |
| `I need an EV charger installed. Do you service 48084?` | Polluted the job description and stored the queried ZIP | Keep the stated job and answer coverage separately |

To reproduce on the prior revision, open the chat, send `Install lights. ZIP 48315. Call Monday after 4 pm.`, then send `Are you open Friday?` or `Do you service 48084?`. The prior version changed the request instead of answering. The correction must preserve the original fields and any unresolved clarification.

Review of the feature branch found three related cases before release. Each was classified medium because it could corrupt or omit request details:

- `I have a question. Do you service 48084?` treated the introduction as a job. A question introduction must not become a customer fact or trigger a provider call.
- `Can you call me tomorrow about whether you serve 48084?` treated the coverage ZIP as the job ZIP. Keep the explicit callback preference while excluding the embedded coverage question from extraction.
- `What are your hours` followed by a newline and `Install lights in 48315. Call me Friday.` discarded the imperative job and ZIP. Preserve the new detail clause while answering the hours question.

The first feature CI run also found a browser-test fixture error: reading `inner_text()` from the collapsed summary produced an empty expected value. The corrected test reads `text_content()`, checks it contains the supplied ZIP, and then asserts that a question leaves it unchanged. The actual page retained the details in that run.

## Changes

- The shared parser separates informational question clauses from supplied details before ZIP, timing or job extraction.
- Ordinary non-question messages preserve their original text. Explicit callback requests remain preferences.
- The browser answers questions from a saved-information module. A question alone does not advance intake, clear ambiguity or repeat a ready event.
- Mixed messages retain the stated details, answer the question and ask for any missing fields.
- The extraction endpoint bypasses the provider for pure questions. Mixed extraction requests exclude question clauses, and question-derived model fields are rejected.
- Business information is separate from customer messages. The 11 public business-fact categories default to empty and unverified.
- Known app behavior and the current request can be explained. Unverified business facts and unknown topics receive an honest limitation.
- STOP, safety holds and cancellation retain precedence. Reset prevents late extraction and associated question answers from refilling the conversation.

## Supported answers

The saved answers cover the intake process, required fields, bundled messages, corrections, current job/ZIP/callback preference, opt-out controls, reset, page-state retention, messaging and booking boundaries.

Business topics include services, pricing, estimate terms, hours, coverage, contact details, qualifications, emergency availability, permits, warranty and payment terms. These are not asserted until the corresponding approved fact is supplied. The code never treats a customer's question as a source of business facts.

Examples such as `What ZIP did I give you?` use the current request. If the ZIP is awaiting clarification, the answer says it needs confirmation. A callback preference is never described as a booked appointment.

## Limits

This is saved-answer functionality with local English question recognition. It is not a language model and does not provide unrestricted answers or electrical repair instructions. Unrecognised questions receive a limitation. Further language and phrasing coverage can be added through regression cases.

Live AI remains disabled pending the owner's credential choice, secure setup and verified credits or approved spending. No real provider calls are part of this change. No calls, SMS, email, notifications, calendar events or customer database records are created.

## Verification

| Check at preparation | Status | Evidence |
| --- | --- | --- |
| Original corruption reproduced | FAIL on prior source | Seven new parser cases failed before the correction |
| Offline controller, parser, saved-answer and server checks | PASS | 140 tests, zero failures or skips after the review fixes |
| Generated bundle and content security policy | PASS | Source and generated hashes match |
| Chromium test syntax | PASS | Python compilation succeeded |
| Full HTTP and Chromium execution | NOT TESTED locally | Must run in GitHub Actions |
| Deployed question answering | NOT TESTED at preparation | Requires the tested release and a live page check |
| Live model answers | NOT IMPLEMENTED | Saved answers are used; the optional model adapter remains extraction-only |

The regressions cover the original field corruption, empty and complete requests, mixed messages, natural question variants, polite callback requests, current-request recall, unverified/configured business facts, multiple topics, unknown questions, unresolved ZIP conflicts, STOP, hazards, model-output rejection and cancellation.

The full suite runs Node logic tests, a real HTTP boundary with a fake provider, safe live GET checks and Chromium tests. Provider responses are fixtures. Local Chromium and listening sockets are unavailable in the development sandbox, so browser and HTTP execution must complete in GitHub Actions. Release status and deployment evidence are recorded after those checks.
