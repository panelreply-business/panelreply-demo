# Private contractor workspace

This stage adds a standalone, authenticated contractor inbox with saved requests and approved business answers. It runs on the local loopback interface. It does not deploy, resume or replace either suspended Render demo.

## Scope

| Capability | Behavior |
| --- | --- |
| Contractor access | A local owner signs in to one business. No public signup, default account or shared demo password exists. |
| Business profile | Business name and 11 answer categories. An answer is usable only after the owner confirms it. Empty and unconfirmed answers remain unknown. |
| Customer preview | Authenticated owner preview, deterministic parsing and saved answers. It is not a public intake channel or a live AI agent. |
| Saved requests | SQLite stores the reviewed contact, job, ZIP, callback window, requested work date, conversation, notes and change metadata. |
| Contact permission | A recorded callback request is separate from the existence of a phone number. This workspace sends nothing. |
| Status | New, Needs review, Contacted and Closed. No Booked status exists. Contacted records a contractor's manual action. |
| Restrictions | STOP persists against a known phone for that business. A safety hold remains under review. START, reset and status edits cannot clear these restrictions. |
| Public services | Both existing Render demos remain intentionally suspended. Auto-deploy remains off. |

Live AI, inbound calls/SMS, outbound messages, notifications, calendar availability, appointment booking and billing are not implemented in this workspace. The existing optional AI adapter is a separate application and is not imported here.

## Local setup

Use Node.js 22.18 or later with its built-in `node:sqlite` module. No application dependencies or API keys are needed. SQLite is an experimental Node API in the Node.js 22 line, so this development stage should stay on the tested runtime until another runtime is verified.

The database directory must be an absolute path, owned by the current operating-system user, with owner-only permissions. The app creates a missing directory with mode 0700 and a database with mode 0600. It rejects existing directories with broader access and paths containing symlinks. Use a directory outside the repository. Database files are ignored by Git as a second safeguard.

An operator can create the local owner from a terminal. The password goes through stdin. It is not accepted in arguments, environment variables or logs.

```bash
read -r -s -p 'Choose a password of at least 15 characters: ' WORKSPACE_ADMIN_PASSWORD
printf '\n'
printf '%s\n' "$WORKSPACE_ADMIN_PASSWORD" | node scripts/workspace-admin.cjs \
  --data-dir "$HOME/.local/share/panelreply" \
  --business 'Your business name' \
  --username owner
unset WORKSPACE_ADMIN_PASSWORD
```

The CLI creates a new business and its owner together. It cannot add a second owner to an existing business or change an account's password. Do not use it as a password reset tool. Usernames are unique across the local database.

Start the workspace:

```bash
WORKSPACE_DATA_DIR="$HOME/.local/share/panelreply" node workspace-server.cjs
```

Open `http://127.0.0.1:10001/login`. Use the owner username and chosen password. Stop the server with Ctrl+C. Restart with the same data directory to reopen saved records. There is no test account in a new database.

For another local port, set both values consistently:

```bash
PORT=10002 \
WORKSPACE_ORIGIN=http://127.0.0.1:10002 \
WORKSPACE_DATA_DIR="$HOME/.local/share/panelreply" \
node workspace-server.cjs
```

The startup entry point rejects non-loopback origins and binds only 127.0.0.1. Changing `HOST` does not expose it. A separate deployment design, approval and validation are required for hosted access. Do not change the Render start command to publish this local development server.

## Operator flow

1. Sign in. Review the empty inbox.
2. Open Business profile. Enter only confirmed facts. Tick the confirmation box separately for each answer that may be used.
3. Open Customer preview. Use synthetic details while testing.
4. Enter the request in one message, or enter separate labelled details.
5. Review every collected field. Confirm the contact permission actually recorded for that request.
6. Select Save request. The server returns the saved record before the UI reports success.
7. Open View saved request. Review the conversation, update notes and use a permitted status.
8. Reload or restart the application and check the same saved record.

Example synthetic message:

```text
My name is Jamie Stone. My phone is 586-555-0101. I need an EV charger installed. ZIP 48315. Call me Monday after 4 pm. I need the work done Friday.
```

The callback window is Monday after 4 pm. The requested work date is Friday. Neither reserves an appointment. The phone number alone does not establish permission to contact someone.

Try these follow-ups:

```text
Actually the job ZIP is 48084.
What ZIP did I give you?
What are your business hours?
Do you serve 48315?
What day did I request the work?
Does this book an appointment?
```

Question-only text must not alter the supplied request. Conflicting values remain marked for review. Supported explicit labels include `Name:`, `Phone:`, `Job:`, `ZIP`, `Callback:` and `Work date:`. The parser does not promise unrestricted natural-language understanding. Use the review form when a phrase is ambiguous.

## Persistence and contact restrictions

Draft details and transcript live in the current page until Save request. Reloading clears the unsaved draft. The server processes preview messages but does not store each ordinary draft turn as a lead.

Opt-outs are the exception. When STOP is submitted with a known valid phone, the server saves the restriction immediately. Reset, refresh, START and a new lead for that number cannot remove it. STOP before a phone is known stays in the draft transcript. If a phone is supplied later in that draft or at save time, the server applies the restriction then. Resetting an unknown-phone unsaved draft cannot associate its earlier opt-out with a future unrelated phone.

Opt-outs are scoped to the business and normalized phone. They do not expose the record to another business. The lead's effective contact permission is checked when it is read, so an earlier saved lead for the same phone reflects a later opt-out.

Safety language in the job or customer transcript places the request under a hold. A later field edit cannot remove it. This is a limited keyword safeguard, not an emergency classification service. No dispatch occurs.

The server requires complete name, US phone, job and five-digit ZIP before saving. Timing fields are optional. A lead without recorded callback permission starts under Needs review. New and Contacted require permission and no opt-out. Closed is allowed without permission, but a safety hold must remain under Needs review.

## Isolation and request integrity

- Every profile, lead, conversation and audit lookup uses the business from the authenticated session. A client cannot choose a business with a request field.
- Cross-business lead reads and changes return 404.
- Passwords use scrypt. Session tokens contain 32 random bytes and only their SHA-256 digests are stored. Password hashes and session tokens are not returned in lead/profile responses.
- Cookies are HttpOnly and SameSiteStrict. The HTTPS handler uses a Secure `__Host-` cookie. The loopback development entry point uses HTTP with a separate local cookie name.
- Mutations require the exact configured Origin. Authenticated mutations also require a session-derived CSRF token. GET requests do not change customer records.
- Sessions expire after 30 minutes of inactivity or 8 hours in total. Sign-out revokes the stored session.
- Failed sign-ins are throttled by username and source address. The same generic failure message is used for absent accounts and incorrect passwords.
- HTML/JS/CSS routes are allowlisted. The server never exposes its source directory, data directory, environment files or arbitrary filesystem paths.
- Dynamic text is rendered as text. The content security policy does not permit inline scripts or remote scripts.
- Save uses an idempotency key. Retrying the same accepted request returns the same lead. Reusing the key for different details returns 409.
- Profile and lead edits use a version number. A stale update returns 409. The UI preserves the local draft for review.
- Writes use SQLite transactions, foreign keys, WAL mode and full synchronous commits. Audit entries record action metadata, version and changed field names without copying secrets into logs.

## Limits and failures

| Limit | Value |
| --- | --- |
| Incoming preview message | 500 characters |
| Conversation | 60 entries, 2000 characters per entry, 20000 characters total |
| JSON body | 192 KiB |
| Customer name | 120 characters |
| Business name | 100 characters |
| Job or notes | 2000 characters each |
| Callback or work date | 200 characters each |
| Business answer | 1000 characters |
| Phone | US ten-digit format, normalized to +1 |
| ZIP | Five digits |

A request failure does not show a saved state. A retry keeps its identifier until the payload changes or a save succeeds. Authentication expiry requires sign-in again. The browser keeps no customer records or session tokens in localStorage.

This is a single-process local workspace. Shared hosting, encrypted backups and a restore drill, password recovery, retention/export/deletion flows, pagination and operational monitoring remain future work. Filesystem owner-only access does not encrypt the database at rest. No production durability, recovery-time or service-level claim is made.

## Test commands

Pure logic, storage and mocked-request tests can run without opening a network listener:

```bash
node scripts/build-demo.cjs --check
node --test tests/demo.test.cjs tests/intake.test.cjs tests/questions.test.cjs tests/server.test.cjs tests/workspace-conversation.test.cjs tests/workspace-store.test.cjs tests/workspace-api.test.cjs
```

Full CI also runs real HTTP tests, the existing browser suites and the private workspace browser suite. The workspace tests create only temporary synthetic accounts and files. They block browser requests to external destinations and never call an AI provider, calendar, phone or SMS service.

```bash
WORKSPACE_HTTP_TESTS=1 PANELREPLY_EXPECT_PUBLIC_OFFLINE=true node --test tests/*.test.cjs
python tests/browser_test.py
python tests/intake_browser_test.py
python tests/ui_browser_test.py
python tests/workspace_browser_test.py
```

The three public application checks stay BLOCKED while the demos are suspended. Two safe GET guards verify that both URLs still return their owner-suspended response. Intentional suspension is not repaired by deployment.

See [verification and remaining gates](PRIVATE_WORKSPACE_VERIFICATION.md) for the exact tested revision, results, reproduced defects and release decision.

## References

- [Node.js 22 SQLite documentation](https://nodejs.org/download/release/v22.21.0/docs/api/sqlite.html)
- [OWASP session management guidance](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)
- [Public offline instruction and evidence](OFFLINE_MODE.md)
