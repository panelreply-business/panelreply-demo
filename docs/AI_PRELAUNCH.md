# Conversational assistance: pre-launch boundary

This work continues the existing private workspace. It does not activate a language-model service, read an API credential, send a message, book an appointment or expose a public endpoint. The normal workspace remains in deterministic mode.

## Implemented boundary

`workspace/assistant.cjs` separates the following concerns:

| Component | Authority |
| --- | --- |
| Conversation input | Existing `conversation.validateState` and message/transcript limits |
| Safety and opt-out | Existing deterministic checks execute before any provider |
| Provider context | Immutable current draft, bounded conversation history and this business's approved facts |
| Generation | Injected `generate(context, { signal })` function with a declared `fake` or `external` kind |
| Extraction validation | Exact output keys, six allowed fields, evidence grounding, field-specific checks and bounds |
| Conflict handling | Prior values remain until explicit correction or a direct clarification answer |
| Reply composition | Application templates and approved business answers, never arbitrary model-authored text |
| Persistence | Existing authenticated Save request route, validation, consent and idempotency |
| Human review | Editable request draft, explicit clarification fields and accurate no-booking/no-message wording |
| Failures | Bounded requests, cancellation, unchanged previous fields and a visible unavailable result |

The optional historical server in `server.cjs` already contains a three-field provider transport. It uses a different demo access model and has no private-workspace persistence. Reusing that public/demo endpoint directly would weaken the workspace boundary. The new workspace therefore uses a provider-independent injection point. `workspace/assistant-provider.cjs` implements a disabled Responses transport for the new strict contract. No second account system was introduced.

## Provider contract

```js
const assistant = createConversationOrchestrator({
  provider: null // default: no provider call
})

// Isolated synthetic tests can inject:
const assistantForTest = createConversationOrchestrator({
  provider: { kind: 'fake', generate: async (context, { signal }) => proposal }
})
```

`previewMessage(message, state, profile, options)` retains the existing `{state, replies}` contract and adds `assistance: {mode, code}`. Modes are `deterministic`, `fake-provider`, `external-provider` and `unavailable`.

`options.scope` comes from the authenticated server session. It is never sent to the provider. `options.safetyHeld` and `options.suppressed` come from the authenticated business storage and are evaluated before generation. `options.signal` cancels work on disconnection. `options.isCurrent` rechecks that the request still belongs to the active session. `cancel(scope)` discards a pending turn or reset. `close()` cancels all pending generation and prevents new provider work.

External mode also requires an explicit `allowExternal: true` constructor argument. `workspace/assistant-config.cjs` prepares the approved server injection. It requires explicit execution and data-transfer approval, a server-supplied credential and model, an injected fetch implementation, and a complete durable usage policy. Normal server startup supplies no configuration. Environment variables cannot enable the provider. Provider selection, secrets, approved spending limits, data handling and any actual external call require separate owner approval.

### Disabled Responses transport

`createResponsesProvider` requires an explicit approval flag, server-supplied key, model identifier and injected fetch implementation. It does not read environment variables, credential files or global fetch. The normal application never constructs this transport.

The transport posts only to the fixed `https://api.openai.com/v1/responses` endpoint. Redirects and unexpected response URLs are rejected. Requests use `store: false`, a strict output schema, no tools and a 2,048-token output limit. The adapter rebuilds instructions/schema from trusted code, validates the incoming context, streams at most 128 KiB of response bytes, requires valid UTF-8 and passes the bounded structured proposal through the independent validator. Refusals, incomplete output, tool calls and malformed envelopes fail closed. Errors omit transport diagnostics and credentials. Timeouts and aborts cancel response reading. There are no retries.

Optional schema `uniqueItems` and string-length constraints are enforced locally rather than being sent as unverified model-specific schema extensions. All object properties remain required and every object rejects additional properties. A supported model still needs an approved live compatibility test.

The wire contract was checked against the official [Responses create reference](https://developers.openai.com/api/reference/resources/responses/methods/create) and [Structured Outputs guide](https://developers.openai.com/api/docs/guides/structured-outputs) on November 19, 2026. `store: false` does not establish a zero-retention policy. Provider data controls require review before any approved customer use.

The provider returns only:

```json
{
  "changes": [{
    "field": "requestedWorkDate",
    "value": "Saturday",
    "evidence": "Can you do Saturday",
    "operation": "set"
  }],
  "clarify": [],
  "answerTopics": [],
  "intent": "continue"
}
```

Allowed change fields are `customerName`, `phone`, `job`, `zip`, `callbackWindow` and `requestedWorkDate`. The value and evidence must appear in the latest message. Phone formatting is normalized only after validation. Questions about coverage, prices or hours cannot supply a ZIP or a work date. A new value cannot silently overwrite an existing value. Locally detected contradictions remain clarification requirements.

The output cannot set tenant IDs, consent, safety holds, opt-outs, request status, appointment status, tools, URLs or reply text. Unknown keys and malformed data reject the entire proposal. Business answers come from the approved current-business facts. The API rechecks the profile version after an awaited provider call and rejects a response if the approved facts changed.

The fixture flow preserves a 200-amp panel-upgrade request while collecting ZIP `48315`, a requested Saturday, a phone and a name in later messages. Saturday remains a preference. The application says the contractor must confirm availability.

## Resource and concurrency limits

- Default timeout: 6 seconds, configurable up to 15 seconds in code.
- Default active calls: 2, configurable up to 4 in code.
- At most 10 attempted calls per minute per process.
- Default lifetime allowance: 100 attempts per process, configurable up to 1,000.
- Failed attempts count toward the allowance. There are no automatic provider retries.
- Raw structured JSON response limit: 16 KiB. Field, list and transcript limits apply independently.
- One in-flight turn per session scope. A newer turn, STOP, safety hold, reset, shutdown or disconnection cancels the older turn.
- Identical in-flight retries share one provider call. A bounded 128-entry, 15-minute in-memory result cache supports a lost-response retry.
- Cache keys include the validated fields, transcript and approved facts. Sessions do not share cached results.
- An adapter that ignores cancellation retains its active slot until it settles. A timeout cannot silently create unlimited background calls.

The authenticated API now adds a durable ledger in `workspace/usage.cjs`, through the existing store and backup schema. It binds each reservation to the server-authenticated business and actor. A request hash includes the session scope and context fingerprint. Database transactions enforce configured per-minute, per-day, lifetime, concurrent and monetary-reservation limits. Attempts and their reserved allowance remain recorded after failures, cancellation, timeouts and restarts. A repeated recorded request cannot silently create a second attempt after its in-memory cache has been lost.

The orchestrator receives a trusted per-run `options.usage` object:

```js
{
  reserve({ fingerprint, inputBytes, outputTokenLimit }) { return { id } },
  finish(id, status) { /* synchronous durable settlement */ }
}
```

Local safety/consent controls, cache hits, identical pending retries and process-limit rejections create no new reservation. The ledger receives a fingerprint, byte count and 2,048-token output allowance, not the conversation, credentials or business facts. A failed reservation prevents generation. A failed settlement discards the proposed result. An abort-ignoring adapter retains its active slot and unsettled reservation until it actually exits. The caller can receive a timeout before that settlement occurs.

The ledger records `succeeded`, `failed`, `cancelled` and `timeout` outcomes. A reservation cancelled before the scheduled generation starts still consumes its allowance. This conservative accounting does not refund failed work. Reserved monetary allowance is an operator-configured upper bound, not measured billing or an assertion about current model prices. The owner must approve and validate the policy against the selected provider before any real call. Root integration tests cover the database, authenticated API and restart behavior separately from the component hook tests below.

## Executed component and evaluation evidence

This remediation was verified locally on November 20, 2026. The original 49 fixtures remain unchanged. The separate `tests/fixtures/assistant/remediation-corpus.json` adds 285 cases. Each added case has an ID, category, intent, risk and synthetic-data source. The additions cover distinct request scopes, field roles, state transitions, trust-boundary violations and failure branches. They are not generated permutations of a single successful sentence.

| Check | Status | Measured result |
| --- | --- | --- |
| Seven-file focused regression run | PASS | 646 tests, 0 failures, 0 skipped |
| Expanded conversation evaluation | PASS | 334 scenarios, 374 turns, 0 failing scenarios |
| Exact six-field comparisons | PASS | 2,196 comparisons |
| Prior-context preservation | PASS | 331 provider-context comparisons |
| Clarification turns | PASS | 22 assertions |
| Rejected/unavailable proposal turns | PASS | 115 assertions that prior fields remain unchanged |
| Other explicit protection/reply checks | PASS | 129 assertions |
| Provider calls in the evaluation | PASS | 333 local fake calls, 0 real calls |
| Generated demo and CSP | PASS | Regenerated root `index.html`, source/hash check passed |
| Actual model extraction and answer quality | BLOCKED | No authorized real-provider evaluation |

The 646 tests include `workspace-assistant`, `assistant-provider`, `assistant-adversarial`, `assistant-evaluation`, `workspace-conversation`, `intake` and `demo`. The 334 evaluation scenarios are included in that total. They must not be added again. The Responses transport still has 31 mock HTTP cases. An external-mode wording test uses an in-memory function only. Its provider kind label does not make it a real network test.

Reproduce this boundary with:

```bash
node --test --test-reporter=tap tests/workspace-assistant.test.cjs tests/assistant-provider.test.cjs tests/assistant-adversarial.test.cjs tests/assistant-evaluation.test.cjs tests/workspace-conversation.test.cjs tests/intake.test.cjs tests/demo.test.cjs
node scripts/evaluate-assistant.cjs
node scripts/build-demo.cjs --check
```

The evaluator reports each passing scenario and each individual failure with its ID and category. It rejects duplicate IDs and duplicate new fixture definitions. Each case has explicit expected fields, clarification flags, safety/consent state and assistance mode. Selected cases additionally assert provider call counts, error codes, required replies and forbidden claims. Malformed-output cases test recovery on the following turn. Cancellation/session cases assert that the original draft remains unchanged. Mode, limits and timing in these reports describe local synthetic execution only.

### Added scenario coverage

| Category | Added cases |
| --- | ---: |
| Electrical service scopes | 30 |
| Preserving all supplied work details | 8 |
| Multi-turn field context | 18 |
| Corrections | 19 |
| Conflicts | 14 |
| Negation | 8 |
| Missing or wrong-role information | 12 |
| Multiple work requests | 11 |
| Approved, absent and unrelated business answers | 38 |
| Scheduling and recalled details | 16 |
| Human review and summaries | 13 |
| Electrical safety | 14 |
| Consent and opt-outs | 13 |
| Message and output injection | 22 |
| Malformed output followed by recovery | 30 |
| Provider, session, retry and limit failures | 11 |
| Input bounds | 5 |
| Mode disclosure | 3 |
| Total added | 285 |

The 49 preserved cases cover the original panel upgrade, EV, lighting, generator, outlet, fan, detector, bundled information, correction, business answer, handoff, injection and control paths. Existing component tests cover actual simultaneous pending requests, cross-business cache separation, resets, stale sessions and late results. New component tests cover durable-hook reservation/settlement, pending and completed retry deduplication, storage failures, timeout/cancellation, stored safety holds and STOP flag tampering.

These results verify application orchestration and deterministic protections against predefined responses. They do not measure a language model's extraction accuracy, contextual relevance, repetition rate, real latency or production reliability. Meeting the synthetic scenario target does not complete the AI product.

## Confirmed remediation defects and verification

| Severity | Reproduction | Correction | Verification |
| --- | --- | --- | --- |
| Medium | A proposed job retained `panel upgrade` but dropped the supplied rating or another electrical work clause. | Compare all independently recognized electrical-work content against the proposal. Incomplete scope is rejected with prior values retained. | Eight scope-omission cases and multiple-request cases. |
| Medium | Valid requests for plural `outlets` or `circuits` failed the singular electrical-word gate. | Accept the supported electrical nouns in singular and plural form. | Distinct outdoor-outlet and kitchen-circuit cases. |
| Medium | A provider omitted business answer topics, handoff or summary intent. | Compose supported questions and explicit review requests from the message using deterministic application wording. | Approved-answer omission, human-review and summary cases. |
| Medium | The provider selected a business topic, handoff or summary unrelated to the message. | Validate topic/intent relevance before accepting a proposal. | Unrelated-topic, false-handoff and unsolicited-summary cases. |
| Medium | `Will saving my request book an appointment?` returned only the privacy answer. | Process every recognized question topic, including privacy and booking, without one suppressing the others. | Named mixed-question regression and corpus case. |
| High | Clearing only the draft STOP flag left an unchanged STOP in history but could resume assistance. | Re-derive the last STOP/START control from customer history. Stored phone restrictions remain independently authoritative. | Flag-tampering case plus START and stored-suppression regressions. |
| High | A caller with a stored phone safety hold cleared client fields/history. | Apply the authenticated API's `safetyHeld` guard before generation. | Deterministic hold, START and zero-provider/zero-reservation component checks. Store/API tests cover durable lookup. |
| High | `The wire is glowing` or `I smell burnt plastic at the outlet` missed the shared hazard guard. | Add bounded component/odor phrases before any provider call. | Two corpus cases, three direct parser cases and routine-negative regressions. |
| High | `Do not call me` did not trigger contact suppression. | Recognize explicit calling withdrawal alongside existing messaging withdrawal. | Calling opt-out corpus, four direct parser cases and zero-provider/zero-reservation checks. |
| Medium | `The circuit label number is 48315` became a job ZIP. | Exclude equipment/account identifiers before accepting an unlabelled five-digit location. Explicit ZIP labels remain supported. | Wrong-role corpus, four identifier cases and mixed equipment/ZIP regression. |

The first expanded run exposed eight failing scenarios. Seven were implementation failures across the fixes above, including two plural-scope cases. The eighth fixture had 501 characters while claiming to test the 500-character boundary. Its input was corrected to exactly 500, with the existing size limit retained. The final expanded run passes all 334 cases. Broader tests preserve routine detector/fire-alarm work, water-heater circuits, hot-tub controls and callback timing restrictions.

Prior boundary fixes remain covered: sole-field follow-up ordering, explicit correction of unresolved issues, profile-version changes during generation, grounded negation, compressed-response lengths and cancellation of a late provider body. These finite tests do not establish recognition of every possible hazard or phrase.

## First real-provider evaluation procedure

Status: BLOCKED until the owner explicitly authorizes this evaluation. No step below was executed against a real provider during this remediation.

1. Obtain approval for the provider, exact model identifier, synthetic data transfer, maximum number of attempts, maximum monetary allowance and evaluation window. Review the provider's current prices, model/schema support and data controls using its official documentation. Do not infer authorization from approval of code changes or the synthetic suite.
2. Supply the credential through a server-only secret source. Do not put it in Git, a browser form, fixture, screenshot or test report. Keep both Render services suspended. Use the existing local/private workspace with an isolated synthetic business and temporary authorized data directory.
3. Prepare the configuration through `prepareExternalAssistant` with explicit execution/data-transfer approvals, the selected model, an injected fetch implementation and the owner-approved usage policy. Use the fixed Responses endpoint. Keep tools, automatic retries and live customer integrations disabled. The output-token ceiling remains 2,048 and the timeout cannot exceed 15 seconds.
4. Run the deterministic component, API and corpus suites first. Test the configured limit with fake transport, including restart and duplicate-attempt rejection. Confirm zero external calls before the approved evaluation begins. Check that no real customer records or other business data can enter the test context.
5. Run one approved synthetic smoke request through the authenticated API. Verify the real response envelope, strict output shape, field evidence, model compatibility, cancellation behavior and durable reservation. If schema/authentication/model errors occur, stop and classify the failure. Do not repeatedly retry paid calls while guessing configuration.
6. After the smoke check, execute a bounded selection of genuinely model-facing conversations from the corpus. Start with a panel upgrade collected across turns, bundled EV details, explicit correction, conflicting ZIPs, approved/unknown pricing, a scheduling question and multiple work items. Expand only within the approved allowance. Provider-output corruption fixtures remain injected transport tests, not prompts that pretend to measure model quality.
7. Compare all six fields, ambiguity flags, required answers and forbidden claims for each turn. Inspect the preserved history and ensure safety/STOP cases make zero provider calls. Record individual scenario IDs, exact model identifier, code revision, timestamp, attempts, reservation totals and measured real latency. Never label the reserved allowance as the actual provider bill. Record actual provider usage/cost only if independently available and verified.
8. Keep any failed scenario as a regression fixture, document its input and expected behavior, fix application defects where feasible, and re-run affected synthetic tests before another approved real call. Do not weaken evidence grounding, safety, consent, session or tenant checks to increase model pass rates.
9. End the evaluation by removing the injected configuration and confirming normal deterministic mode. Report PASS/FAIL for executed real cases, BLOCKED for approval-dependent cases, and NOT TESTED for cases not run. A smoke pass proves only that specific request/model/configuration combination. Owner review is still required before any live customer integration, deployment or spending expansion.

The synthetic evaluator intentionally cannot activate a real transport through an environment variable or command-line switch. Its `realProviderCalls` value is zero by construction. A future approved real evaluation must use a separately reviewed runner and the same authenticated API/configuration boundary, with its own evidence record.

## Remaining acceptance gates

| Gate | Status | Evidence or blocker |
| --- | --- | --- |
| Deterministic workspace, strict output and context protections | PASS | Focused tests and unchanged original fixtures |
| At least 300 meaningful synthetic conversations | PASS | 334 scenarios, 0 failures |
| Responses transport | PASS | 31 mock HTTP cases, inactive by default |
| Durable usage hook in the orchestrator | PASS | Reservation, settlement, deduplication, cancellation and failure tests |
| Durable database/API usage enforcement | PASS | Root integration evidence is recorded in the acceptance matrix and remediation report |
| Full updated application regression and browser checks | NOT TESTED | Pending the root integration run for this remediation revision |
| Actual provider/model compatibility | BLOCKED | Owner-approved real call required |
| Actual model quality and real latency | BLOCKED | Authorized representative real-provider evaluation required |
| Hosted operations and approved spending policy | BLOCKED | Selected host, budgets and owner approval required |
| Live messaging, calendar booking and human handoff delivery | BLOCKED | Separate approved integrations required |

The draft can record a request for contractor review. It does not contact a person. Callback windows and requested work dates remain preferences. Free-text generation and provider-suggested tools/actions remain excluded from the trusted output path. This is prepared and tested application infrastructure, not a live-AI launch.

## Historical integration checkpoint

[Run66](https://github.com/panelreply-business/panelreply-demo/actions/runs/44634698683) verified the earlier source revision `17223d6`. Its four synthetic conversation browser scenarios passed in Chromium, Firefox and WebKit against the private HTTP/SQLite server. That historical result does not verify the new remediation revision. Current root-run CI, HTTP and browser evidence must be recorded separately.
