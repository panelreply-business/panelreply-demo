# Callback text preservation

November 23, 2026. Candidate based on `e711d15d418406969631202642c9d055b47afca5`.

## Reproduced defect

Owner creation accepted an unpaired UTF-16 code unit in the business name. Request creation also accepted one in a transcript message. SQLite replaced the code unit with U+FFFD while each operation reported success. An exact request retry returned the altered transcript. This violated the saved-text contract.

The shared text validator now rejects ill-formed UTF-16 before a write. The existing archive request-notes predicate applies the same rule to notes held in JSON. Task-note and spreadsheet validators already enforced this rule.

The change preserves valid surrogate pairs, combining characters, non-Latin text and a deliberately supplied U+FFFD. It changes no schema and rewrites no stored values. Previously replaced characters remain as stored because the original discarded code unit cannot be recovered.

Existing backup validators reuse shared request/profile validation. An authenticated archive containing escaped unpaired UTF-16 in those fields or request notes now fails `invalid_database` before a restored database is published. Valid earlier text remains compatible. The source database remains unchanged after rejection.

## Verification

The same five regressions produced four failures and one valid-Unicode recovery pass before the repair. All five pass after the repair. The full store/API/backup regression passes 68 cases with zero failures, skips or cancellations. The focused five overlap those 68 and must not be added to that count.

The cases verify rejected owner creation, unchanged profile/account/audit records, unchanged request versions/transcripts/restrictions, JSON-escaped API input, successful retry after rejection, exact JSON export, encrypted recovery/reopen of valid Unicode, and malformed archive rejection without publishing a destination. The valid transcript includes 1,000 paired supplementary characters at its 2,000 UTF-16-unit limit.

A separate agent reviewed the runtime predicates and regression scope without finding a concrete defect. Browser behavior, physical devices, hosted operation and a full integrated-source regression are not established by this focused result.

The [source-bound record](evidence/callback-text-integrity-2026-11-23.json) preserves runtime and file hashes, commands, the original failures and complete test logs. Run the focused regression with:

```sh
node --test tests/workspace-store.test.cjs tests/workspace-api.test.cjs tests/workspace-backup.test.cjs
```

## Next independent work

Request/lifecycle chronology and revision bounds are a separate confirmed defect. A backward clock can update a request before its creation timestamp, and unchecked increments can exhaust a live revision. Suppression/safety fan-out needs the same review. Those paths are not changed by this Unicode patch.
