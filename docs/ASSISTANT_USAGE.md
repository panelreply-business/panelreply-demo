# Assistant configuration and durable accounting

The workspace starts in deterministic mode. Normal startup reads no provider credential and makes no provider request. Browser input, a business profile and environment variables cannot activate the external adapter.

## Explicit configuration boundary

`workspace/assistant-config.cjs` prepares an external configuration only when an operator supplies both authorization flags, an explicit credential, an exact model name, an injected transport and all usage limits. `startWorkspace` accepts only the actual frozen configuration produced by that module. A copied or inherited object is rejected before opening a database. The direct provider argument accepts synthetic providers only.

The configuration tests use a fake credential string and a transport that must never run. They establish configuration behavior, not actual model compatibility. The existing Responses adapter has mock transport coverage. First real-provider evaluation remains BLOCKED until the owner approves the provider, model, data transfer and a finite budget. Follow [the synthetic and real-provider procedure](AI_PRELAUNCH.md).

Do not put a real credential in source, a URL, the browser, a report, a fixture or a shell command. An eventual approved operator must supply it in memory through the selected host's secret mechanism. No host secret mechanism is connected here.

## Durable ledger

Schema 3 stores one `assistant_usage` record for each reserved generation attempt. A trusted server callback binds the reservation to the authenticated business and owner. The client cannot select its business, policy, attempt digest or monetary values.

The record contains an opaque ID, actor/business IDs, a session-scoped request digest, timestamps, status, input byte count, output-token ceiling and conservative reservation amount. It contains no message, answer, credential or session token.

The orchestrator reserves after deterministic STOP/safety controls, completed-request cache, pending-request deduplication and process limits. A repeated pending or cached request uses one reservation. A repeated attempt after process restart cannot spend again with the same session and fingerprint. A new session is still subject to the same business totals.

Reservation and completion use SQLite transactions. Separate connections compete atomically for per-minute, per-day, lifetime and active-call allowances. The ledger keeps failed, cancelled, timed-out and abandoned attempts charged. It never interprets an error as a refund.

The statuses are `pending`, `succeeded`, `failed`, `cancelled`, `timeout` and `abandoned`. A settled record cannot change its terminal outcome. An abandoned record remains charged. A 60-second lease bounds abandoned concurrency reservations. The in-process active slot also remains held until an abort-ignoring adapter actually settles. Hosted crash/failover behavior still needs selected-host testing.

`GET /api/assistant/usage` returns only the current business's totals and outcome counts. It uses the existing authentication and session pin. No administrative override or client-facing budget edit is added.

## Limits

| Limit | Implementation |
| --- | --- |
| Provider context | At most 96 KiB of serialized context |
| Requested output | Fixed maximum 2,048 tokens |
| Per-minute attempts | Required trusted value, 1–60 |
| Per-day attempts | Required trusted value, 1–10,000 |
| Lifetime attempts | Required trusted value, at most 50,000 |
| Active reservations | Required global and business limits, at most four |
| Ledger size | 50,000 rows across the database, then fail closed |
| External monetary reservation | Positive integer micro-unit amount per attempted call |
| Daily/lifetime monetary allowance | Required positive bounds that contain the per-call reservation |

The injected fake-provider policy reserves zero money. External configuration rejects that zero-money policy.

These monetary entries are conservative reservations, not measured provider charges or invoices. A hard invoice-spend claim requires an approved model, current provider pricing, verified token accounting and an upper-bound calculation for the fixed context/output ceilings. None of those real-provider billing claims has been verified. The code's attempt limits do not by themselves establish an accurate currency budget.

UTC defines the accounting day. A backwards or nonrepresentable server clock fails closed. All dates displayed in an owner report can use the owner's timezone without changing the ledger boundary.

## Failure behavior

- If reservation fails, no provider request starts. The previous customer fields remain unchanged.
- If a provider fails or returns invalid output, the attempt remains recorded and the proposal does not enter the draft.
- If completion storage fails, the result is withheld. Its unfinished reservation remains charged.
- Session expiration, logout and owner reset prevent a pending result from reaching the browser. Settlement still uses the server-captured actor.
- Stored phone opt-outs and safety holds apply even when a phone first appears in the current message. A concurrent restriction is checked again before returning the result.
- A safety event with a known phone is retained even when the owner has not saved the request. Deleting the request or transcript cannot remove that restriction.

## Backups and operating decisions

Encrypted backups include usage records, deletion receipts and contact restrictions. Restoration keeps the snapshot's usage charges. It disables passwords and removes sessions until explicit owner recovery.

An older backup cannot contain later usage or deletion events. Before enabling a restored workspace, reconcile all later reservations, deletions and contact restrictions. The snapshot does not provide time-travel protection or an offsite accounting service. An approved host needs a durable external reconciliation mechanism and an operator runbook. Those operations remain BLOCKED.

Executed ledger, API, adversarial and backup cases are linked from [remediation verification](REMEDIATION_VERIFICATION.md). They do not activate a provider or prove model quality.
