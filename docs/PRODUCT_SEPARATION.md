# Independent callback and spreadsheet programs

Decision date: November 20, 2026. The callback program and spreadsheet program have separate entrypoints, data directories, cookies, routes and release decisions. They remain in this repository and on the existing draft PR8. Shared authentication, storage and recovery code stays shared.

December 31, 2026 is the first release target. The owner has not chosen which program releases first or the second release date. Run the [daily checklist](DAILY_QUALITY_CHECKLIST.md) through December 20, then assess each program for real-world testing. A date or test count does not activate a program, provider, customer trial or paid service.

[Callback acceptance](CALLBACK_RELEASE_ACCEPTANCE.md) and [spreadsheet acceptance](SPREADSHEET_RELEASE_ACCEPTANCE.md) are separate decisions. [Test milestones](TEST_MILESTONES.md) define the shared 10,000 target and conditional increase to 20,000. Shared cases count once in the portfolio total.

## Fixed startup configuration

| Setting | Callback | Spreadsheet |
| --- | --- | --- |
| Entrypoint | `node callback-server.cjs` | `node spreadsheet-server.cjs` |
| Data directory | `CALLBACK_DATA_DIR` | `SPREADSHEET_DATA_DIR` |
| Port | `CALLBACK_PORT`, default `10001` | `SPREADSHEET_PORT`, default `10002` |
| Origin | `CALLBACK_ORIGIN`, default `http://127.0.0.1:10001` | `SPREADSHEET_ORIGIN`, default `http://127.0.0.1:10002` |
| Home after sign-in | `/` | `/panels` |
| Local session cookie | `PanelReplyCallbackLocalSession` | `PanelReplySpreadsheetLocalSession` |
| HTTPS handler cookie | `__Host-PanelReplyCallbackSession` | `__Host-PanelReplySpreadsheetSession` |

Each entrypoint fixes its product in code. Generic `PORT`, `WORKSPACE_ORIGIN`, `WORKSPACE_DATA_DIR`, `PRODUCT` and `WORKSPACE_PRODUCT` do not select or configure these entrypoints. Requests and browser state cannot switch products. If a product port changes, its explicit origin must match. For example:

```bash
CALLBACK_PORT=11001 \
CALLBACK_ORIGIN=http://127.0.0.1:11001 \
CALLBACK_DATA_DIR="$HOME/.local/share/panelreply-callback" \
node callback-server.cjs
```

Both entrypoints bind `127.0.0.1` and accept only a matching loopback HTTP origin. The HTTPS cookie names describe the shared handler's tested HTTPS behavior, not a hosted entrypoint. Cookies retain HttpOnly, SameSite=Strict and path `/`. HTTPS cookies also require Secure and omit Domain. Separate names prevent the two localhost ports from replacing each other's cookie.

Use Node 24 for the release evidence runner. The existing private storage rules require an absolute, owner-controlled directory with POSIX permissions. Portable Windows/macOS contract tests do not establish private-server or native-OCR support on those systems. See [platform interpretation](TEST_MILESTONES.md#platform-interpretation).

## Initialize two local owners

Use synthetic details during development. Run these commands from the repository root in Bash. The paths below are separate directories outside the repository.

Initialize callback before creating its owner:

```bash
CALLBACK_DATA_DIR="$HOME/.local/share/panelreply-callback" node callback-server.cjs --init

read -r -s -p 'Callback owner password, 15–128 characters: ' PANELREPLY_CALLBACK_PASSWORD
printf '\n'
printf '%s\n' "$PANELREPLY_CALLBACK_PASSWORD" | node scripts/workspace-admin.cjs \
  --data-dir "$HOME/.local/share/panelreply-callback" \
  --business 'Synthetic Callback Business' \
  --username owner
unset PANELREPLY_CALLBACK_PASSWORD
```

Initialize spreadsheet before creating its owner:

```bash
SPREADSHEET_DATA_DIR="$HOME/.local/share/panelreply-spreadsheet" node spreadsheet-server.cjs --init

read -r -s -p 'Spreadsheet owner password, 15–128 characters: ' PANELREPLY_SPREADSHEET_PASSWORD
printf '\n'
printf '%s\n' "$PANELREPLY_SPREADSHEET_PASSWORD" | node scripts/workspace-admin.cjs \
  --data-dir "$HOME/.local/share/panelreply-spreadsheet" \
  --business 'Synthetic Spreadsheet Business' \
  --username owner
unset PANELREPLY_SPREADSHEET_PASSWORD
```

The password variables above are shell variables, not exported environment variables. Passwords reach the owner CLI only through stdin. Each owner belongs to its own database. No default account or public signup exists.

`--init` creates or verifies the product binding and database without opening a listener. Run it before the generic owner CLI: a database created first without a marker is existing unmarked data and cannot be adopted by a product. Repeating `--init` for the same product preserves its binding. The owner CLI creates a new business and owner. Use the recovery CLI for password resets.

Start each program in its own terminal:

```bash
CALLBACK_DATA_DIR="$HOME/.local/share/panelreply-callback" node callback-server.cjs
```

```bash
SPREADSHEET_DATA_DIR="$HOME/.local/share/panelreply-spreadsheet" node spreadsheet-server.cjs
```

Open `http://127.0.0.1:10001/login` for callback and `http://127.0.0.1:10002/login` for spreadsheet. Ctrl+C stops only that process. Restart with the same product directory to reopen its records. Normal callback startup uses deterministic parsing. Spreadsheet startup creates no conversation orchestrator. Callback startup creates no OCR service.

## Server boundaries

The allowlist in [products.cjs](../workspace/products.cjs) runs before session lookup, request-body reads, provider calls or OCR work. An unavailable route returns 404 for signed-in and anonymous clients. Hiding navigation is an additional UI measure.

| Surface | Callback | Spreadsheet |
| --- | --- | --- |
| Pages, GET/HEAD | `/`, `/preview`, `/login` | `/panels`, `/login`. Authenticated `/` redirects to `/panels` |
| Product scripts, GET/HEAD | `/assets/app.js`, `/assets/preview.js` | `/assets/panels.js` |
| Assistant status and usage, GET | `/api/assistant`, `/api/assistant/usage` | Denied |
| Business facts | GET/PATCH `/api/profile` | Denied |
| Preview | POST `/api/preview` | Denied |
| Requests | GET/POST `/api/leads`, GET/PATCH/DELETE `/api/leads/:id`, DELETE `/api/leads/:id/conversation` | Denied |
| Business-record JSON export | GET `/api/export` | Denied |
| Projects | Denied | GET/POST `/api/panel-projects`, GET/PATCH/DELETE `/api/panel-projects/:id` |
| Project files | Denied | GET `/api/panel-projects/:id/export.csv` and `export.xlsx` |
| Source images | Denied | POST `/api/panel-projects/:id/sources`, GET/DELETE `/api/panel-projects/:id/sources/:sourceId` |
| OCR | Denied | GET `/api/panel-ocr`, POST `/api/panel-projects/:id/sources/:sourceId/ocr` |
| Combined dashboard | Denied | Denied |

Shared routes are GET/HEAD `/health`, `/login` and `/favicon.ico`, GET `/api/session`, and POST `/api/login` and `/api/logout`. Shared asset paths are `/assets/styles.css`, `/assets/platform.css`, `/assets/login.js`, `/assets/deletion.js`, `/assets/brand-mark.svg` and `/assets/brand-mark-light.svg`. Route IDs must match the existing UUID contracts. Existing session, tenant, Origin, CSRF, version and retry checks still apply.

Login, session and health responses include `product` with `id`, `label`, `homePath` and `capabilities`. Callback enables `intake`, `businessFacts` and `assistantUsage`. Spreadsheet enables `panelProjects`, `ocr`, `csvExport` and `xlsxExport`. Both report `liveCalls`, `liveMessages` and `booking` as false. Capabilities identify enabled surfaces. They do not claim model quality, native OCR readiness or release acceptance.

## Data binding and recovery

An initialized directory has mode 0700 and a `product-binding.json` marker with mode 0600. Its canonical content is:

```json
{"format":"panelreply-product-binding","version":1,"product":"callback"}
```

The spreadsheet marker uses `"product":"spreadsheet"`. The server rejects another product's marker, malformed or linked markers, unsafe permissions and unmarked nonempty directories. It does not overwrite a binding, migrate mixed data or move existing records. Direct API construction with a real store also checks the directory binding. The combined integration harness cannot open a product-bound directory.

Use the same shared recovery tool with an explicit product. Create an owner-only archive directory once:

```bash
PANELREPLY_RECOVERY_DIR="$HOME/.local/share/panelreply-product-recovery"
mkdir -p -m700 "$PANELREPLY_RECOVERY_DIR"
```

The following example backs up callback and restores a separate test copy. Both destination paths must be new. Supply a 15–128 character backup passphrase through stdin:

```bash
read -r -s -p 'Backup passphrase: ' PANELREPLY_BACKUP_PASSPHRASE
printf '\n'
printf '%s\n' "$PANELREPLY_BACKUP_PASSPHRASE" | node scripts/workspace-backup.cjs create \
  --data-dir "$HOME/.local/share/panelreply-callback" \
  --output "$PANELREPLY_RECOVERY_DIR/callback-first.prbk" \
  --product callback
unset PANELREPLY_BACKUP_PASSPHRASE

read -r -s -p 'Backup passphrase: ' PANELREPLY_BACKUP_PASSPHRASE
printf '\n'
printf '%s\n' "$PANELREPLY_BACKUP_PASSPHRASE" | node scripts/workspace-backup.cjs restore \
  --backup "$PANELREPLY_RECOVERY_DIR/callback-first.prbk" \
  --data-dir "$PANELREPLY_RECOVERY_DIR/callback-restored" \
  --product callback
unset PANELREPLY_BACKUP_PASSPHRASE
```

For spreadsheet, use `--product spreadsheet`, its own source directory, a new `spreadsheet-first.prbk` archive and a new `spreadsheet-restored` directory. Each product requires its own archive and restore drill.

Product archives use version 2. The existing authenticated encryption protects the product identity as well as the archive metadata. Restore requires the matching product and publishes a validated database and marker before opening the destination's permissions for startup. Wrong or missing product choices fail before plaintext publication. Incomplete interrupted destinations remain preserved and cannot start. Version-1 archives retain strict legacy behavior and stay unbound. They cannot be assigned a product during restore.

Restore removes active sessions and disables copied passwords. Reconcile later deletions, restrictions and usage before restoring access, then use `scripts/workspace-reset-password.cjs` with the restored directory and existing username as described in [owner recovery](RECOVERY.md#reset-an-existing-owners-password). Start the copied product with its own variables, for example:

```bash
CALLBACK_PORT=11001 \
CALLBACK_ORIGIN=http://127.0.0.1:11001 \
CALLBACK_DATA_DIR="$PANELREPLY_RECOVERY_DIR/callback-restored" \
node callback-server.cjs
```

The [product recovery tests](../tests/product-backup.test.cjs) pass locally, including actual startup through both fixed entrypoints after restore. Local recovery does not establish offsite recovery, host durability or an approved operating schedule. [Recovery principles](RECOVERY.md) still apply. Its generic unbound commands describe the historical harness.

## Internal integration harness

`workspace-server.cjs` remains for historical combined integration coverage. It uses `WORKSPACE_DATA_DIR`, `WORKSPACE_ORIGIN` and `PORT` and may expose both modules only with unbound integration data. It is not either product's release entrypoint. The combined dashboard and historical shared-browser tests do not substitute for selected-product journeys.

```bash
WORKSPACE_DATA_DIR="$HOME/.local/share/panelreply-integration" node workspace-server.cjs
```

Use an independent synthetic harness database. Never rename or remove a product marker to make the combined harness accept a product directory.

## Independent release controls and later merger

Record a source manifest, completed platform results, defects, backup/restore evidence and a launch decision for each product. Fixes to shared auth, storage, exports or recovery require the affected checks for both products. A callback approval cannot enable spreadsheet routes or OCR. A spreadsheet approval cannot enable callback or provider work.

Before any release, define its pricing and cost assumptions, activation, rollback, support and monitoring procedure, selected host and recovery objectives. Neither program has an approved or published subscription price. Public services remain under the existing suspension policy. No deployment, merge, provider call, spending, customer contact or customer data follows from these local commands or test results.

A future combined product is a separate decision. First define the user workflow and account relationship. Then design an explicit, backed-up data migration with tenant mapping, restriction/deletion reconciliation and rollback. Validate that migration and the combined permissions on synthetic copies, repeat both product acceptance suites and review the release decision. The current marker, cookies and deny rules are not a migration mechanism and must not be bypassed to create a merger.
