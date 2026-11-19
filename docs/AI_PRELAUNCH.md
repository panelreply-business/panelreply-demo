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

`options.scope` comes from the authenticated server session. It is never sent to the provider. `options.signal` cancels work on disconnection. `options.isCurrent` rechecks that the request still belongs to the active session. `cancel(scope)` discards a pending turn or reset. `close()` cancels all pending generation and prevents new provider work.

External mode also requires an explicit `allowExternal: true` constructor argument. No environment variable automatically enables it. The production entry point does not supply a provider or this argument. Provider selection, secrets, usage budgets, data handling and any actual external call require separate owner approval.

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

These in-memory limits reset on process restart and are not a durable usage or spending ceiling. A hosted live provider needs persistent per-business budgets and transport-level resource controls before customer use.

## Executed component and evaluation evidence

Local checks for this work:

| Check | Result |
| --- | --- |
| `tests/workspace-assistant.test.cjs` | 94 PASS, 0 FAIL |
| `tests/assistant-evaluation.test.cjs` | 49 named conversation scenarios PASS, 0 FAIL |
| Existing `tests/workspace-conversation.test.cjs` | 34 PASS, 0 FAIL |
| Combined three-file run | 177 PASS, 0 FAIL |
| `tests/assistant-adversarial.test.cjs` from independent review | 11 PASS, 0 FAIL |
| `tests/assistant-provider.test.cjs` using mock HTTP only | 31 PASS, 0 FAIL |
| `tests/assistant-api.test.cjs` independently reviewed initial integration | 9 PASS, 0 FAIL in an in-process HTTP-handler/real-SQLite fixture |

The API tests exercise authentication, Origin, CSRF, session pins, normal save/idempotency, session expiry/revocation during generation, simultaneous STOP/safety holds, tenant-scoped context, changed business facts and disconnected requests. They do not open a real HTTP listener. The root verification record tracks subsequent integration changes and CI/browser results.

The latest seven-file focused run passed 323 cases with zero failures. It combined the assistant, provider, adversarial, evaluation, existing conversation, existing demo and intake suites. This includes the shared hazard corrections and generated demo/CSP check. It is not an additional 323 cases to add to a full CI total.

Run the standalone evaluation with:

```bash
node scripts/evaluate-assistant.cjs
```

The checked-in corpus is `tests/fixtures/assistant/corpus.json`. The executed run contained 49 scenarios and 52 turns, 312 exact field checks, 47 context checks, six clarification cases and six invalid-output recovery cases. It made 47 deterministic fake calls and zero real-provider calls. The evaluator emits its measured elapsed time, but that timing measures local orchestration, not model latency.

The corpus includes panel upgrades, EV chargers, lighting, generators, troubleshooting, outlet work, multiple jobs, normal smoke-detector work, bundled contact details, corrections for all six fields, invalid phones, conflicting names/ZIPs/dates, all eleven business-question categories, handoff, summaries, injection attempts, malformed/empty responses, STOP and electrical hazards. Adversarial field provenance, timeouts, rate/cap behavior, cancellation, late responses, resets, session changes and retries are covered by the component suite.

These results verify the contract and deterministic protections against predefined responses. They do not measure a language model's field extraction accuracy, contextual relevance, repetition rate or production reliability. The requested 300–500 model-quality scenarios remain a later evaluation target. Increasing the fake corpus with trivial wording variations would not establish that evidence.

## Defects found while building the boundary

| Finding | Correction | Regression |
| --- | --- | --- |
| The no-booking disclosure followed the missing-field question, so a short next reply lost its single-field context. | Keep the targeted question as the final assistant message. | Context-only name and timing follow-up tests. |
| A fallback parser's existing issue could block a valid later natural-language correction. | Separate fresh-message ambiguity from unresolved prior issues. Preserve unrelated issues. | Natural name correction and direct confirmation tests. |
| A pending provider could return business facts that were revoked during generation. | API checks profile version before returning the result. | Changed-business-facts API regression. |
| Five independently reproduced proposals used real text for the wrong field or converted negation into a positive request. | Bind recognized values to the independent parser, anchor name/phone cues to their value and reject negated/unavailable clauses. | Five independent adversarial grounding cases. |
| Explicit fire, excessive heat and water around electrical parts could miss the existing hazard detector. | Add bounded electrical-component patterns before generation. Regenerate the static demo and CSP. | Four independent provider-bypass tests, eight positive and six routine-negative shared-parser tests. |
| A valid compressed provider response could fail a wire-length comparison against decoded Fetch bytes. | Apply exact Content-Length equality only to identity encoding and retain the decoded stream-size bound for every encoding. | Independent compressed-response regression. |
| An abort-ignoring transport could return a new response stream after timeout cleanup finished. | Cancel the late body before acquiring its reader. | Independent late-response cancellation regression. |

The conversation-composition and field-grounding issues were found and fixed before committing this boundary. The hazard phrases were confirmed omissions in the existing shared detector. The new patterns preserve routine panel upgrades, fire-alarm/smoke-detector work, water-heater circuits and hot-tub controls. Finite keyword tests do not establish recognition of every possible hazard description.

## Remaining acceptance gates

| Gate | Status |
| --- | --- |
| Default deterministic workspace | Implemented, existing tests retained |
| Strict orchestration, context and fake-provider failure handling | Component and in-process API evidence above |
| Actual HTTP and browser flow for the new adapter | Reported separately in the current release verification record |
| Concrete Responses transport | Implemented and verified through 31 mock HTTP cases, not activated |
| Real-provider/model selection and credentials | Not activated, approval required |
| Actual model response quality and representative 300–500-scenario evaluation | BLOCKED by real-provider authorization |
| Durable per-business cost limits and hosted provider operations | NOT IMPLEMENTED |
| Live messaging, calendar booking and real human handoff delivery | NOT IMPLEMENTED, separate approval and integrations required |

The current assistant can record a request for human review in the draft. It does not contact a person. Free-text generation and provider-suggested actions are intentionally excluded from the trusted output path. This is a prepared conversational integration boundary, not a live-AI launch claim.
