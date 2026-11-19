# Record export and local recovery

This stage adds a business-record download, encrypted local backups, restore to a new directory and operator password recovery. It keeps both public demos suspended. It does not provision a hosted workspace, send messages, activate AI or change any real account during development.

The tools are intended for the existing local workspace on Linux or WSL with Node.js 22.18 or later. CI verifies Node 22 on Ubuntu. Native Windows/macOS operation, offsite storage, backup scheduling and a production recovery-time target remain unverified or unimplemented.

## Three separate operations

| Operation | Purpose | Access and result |
| --- | --- | --- |
| Export records | Read or retain one business's reviewed records | The signed-in owner downloads JSON containing that business's profile, leads, conversations and audit metadata. No passwords or session credentials. This file is not encrypted and is not a restorable workspace backup. |
| Encrypted backup and restore | Recover the local workspace database | An operator with filesystem access supplies a separate backup passphrase through stdin. All businesses in that database are covered. Restore requires a new destination and password recovery before sign-in. |
| Reset an owner password | Regain access to an existing local owner | An operator supplies the existing username and a new password through stdin. The operation revokes that owner's sessions, records an audit event and preserves other owners and customer records. |

## Export business records

1. Sign in to the workspace.
2. Open the inbox and select Export records.
3. Save the JSON attachment. The UI identifies that it contains customer details and conversations.

The export is a snapshot of saved server records. Unsaved edits in the current form are preserved on the page but are not included in the download. Saving edits and downloading records are separate actions. An export failure retains those edits and offers a retry. Session expiry redirects to sign-in.

The export endpoint is `GET /api/export`. It uses the authenticated business, not a business identifier supplied in the URL. Its versioned envelope identifies `panelreply-business-export`, version 1, with an export timestamp, profile and leads. The filename follows `panelreply-records-YYYY-MM-DD.json`. Responses are not cached.

It excludes password hashes, sessions, CSRF tokens, login counters and other businesses. It also excludes standalone opt-out records not attached to a lead. Opt-out persistence is fully preserved by the encrypted database backup. There is no JSON import endpoint and the download does not claim to reconstruct accounts or the entire workspace.

## Create an encrypted backup

Keep the backup passphrase in a password manager outside the archive. The tools cannot recover a forgotten passphrase. It must contain 15–128 characters without control characters. Passwords and passphrases are never accepted as command-line arguments or environment variables.

Create an owner-only recovery directory once:

```bash
PANELREPLY_RECOVERY_DIR="$HOME/.local/share/panelreply-recovery"
mkdir -p -m700 "$PANELREPLY_RECOVERY_DIR"
```

Existing directories must already have mode 0700 and belong to the current user. The tools reject broader access instead of changing it. Source, archive and restore paths must be absolute and must not contain symbolic links.

Create an archive with a new filename:

```bash
read -r -s -p 'Backup passphrase: ' PANELREPLY_BACKUP_PASSPHRASE
printf '\n'
printf '%s\n' "$PANELREPLY_BACKUP_PASSPHRASE" | node scripts/workspace-backup.cjs create \
  --data-dir "$HOME/.local/share/panelreply" \
  --output "$PANELREPLY_RECOVERY_DIR/first-backup.prbk"
unset PANELREPLY_BACKUP_PASSPHRASE
```

The source database must exist and match the supported workspace schema. A misspelled path cannot create an empty workspace and report a backup. The output file must not exist. This also prevents a retry from overwriting the last archive.

The tool uses SQLite's backup API to capture committed data, including data in the write-ahead log. It validates the snapshot's integrity, foreign keys, business relationships and application records. It removes sessions and login-throttle records from the copy. The original database, passwords, sessions and records remain unchanged.

The archive uses AES-256-GCM with a random 16-byte salt, 12-byte nonce and 16-byte authentication tag. A fixed scrypt configuration derives its 32-byte encryption key: N=32768, r=8, p=3, with a 64 MiB memory bound. The authenticated binary header identifies the archive/schema versions, timestamp, length and fixed algorithm identifiers. Archive data and header must authenticate before restore writes a plaintext database.

The local database size limit is 64 MiB. Size validation covers SQLite page count and page size, including committed WAL content, the snapshot and the final archive. This local implementation uses bounded memory during encryption and decryption. Large databases require a separate reviewed backup design.

Files are created with owner-only access. Publication refuses an existing output. Temporary plaintext snapshots remain inside a private working directory and cleanup runs on handled completion/failure. A process crash or filesystem failure still requires operator review of private temporary files. This application does not encrypt the live SQLite database at rest.

## Restore into a new directory

Use a destination that does not exist, even as an empty directory. Restore never replaces the original database or an existing folder.

```bash
read -r -s -p 'Backup passphrase: ' PANELREPLY_BACKUP_PASSPHRASE
printf '\n'
printf '%s\n' "$PANELREPLY_BACKUP_PASSPHRASE" | node scripts/workspace-backup.cjs restore \
  --backup "$PANELREPLY_RECOVERY_DIR/first-backup.prbk" \
  --data-dir "$PANELREPLY_RECOVERY_DIR/restored-check"
unset PANELREPLY_BACKUP_PASSPHRASE
```

Wrong passphrases, modified or truncated archives, unsupported formats, unsupported schemas, invalid records and failed integrity checks return failure. They do not publish a restored database. A racing destination creator is not overwritten or deleted.

The restored copy preserves business/user identities, approved answers, requests, notes, transcripts, audit records, retry identifiers, opt-outs and safety holds. It restores no active session or login-throttle state.

Every restored owner's password is disabled until an operator sets a new one. This prevents an older backup from reactivating a password changed after the backup was created. The restore result explicitly reports that password recovery is required. This change affects the new restored copy only.

## Reset an existing owner's password

For the restored test copy:

```bash
read -r -s -p 'New owner password: ' PANELREPLY_NEW_OWNER_PASSWORD
printf '\n'
printf '%s\n' "$PANELREPLY_NEW_OWNER_PASSWORD" | node scripts/workspace-reset-password.cjs \
  --data-dir "$PANELREPLY_RECOVERY_DIR/restored-check" \
  --username owner
unset PANELREPLY_NEW_OWNER_PASSWORD
```

Use the actual existing username. The command never creates a user, business or database. The password must contain 15–128 characters without line breaks or control characters. It goes through stdin, not arguments, environment variables, browser messages or reports.

The transaction changes the selected owner's password, revokes all of that owner's sessions, clears that username's sign-in throttle and records `owner.password_reset` metadata. Other users, source-address throttles and business records remain unchanged. If the transaction fails, the password, sessions and audit changes roll back together.

Sign-in verifies that the password hash still matches when it creates the session. An old-password check already in progress cannot create a new session after reset commits.

Authenticated writes recheck the original session, business and CSRF token after reading the request body. Preview processing rechecks after awaited work before persisting an opt-out. A request paused while the owner resets access cannot use its earlier session check to finish that write.

This is an operating-system operator tool. It is not an emailed reset link, a public recovery endpoint or a bypass of owner sign-in. The existing bootstrap CLI still only creates a new business and owner.

## Recovery drill

After restore and password reset, start the copied workspace on another loopback port:

```bash
PORT=10002 \
WORKSPACE_ORIGIN=http://127.0.0.1:10002 \
WORKSPACE_DATA_DIR="$PANELREPLY_RECOVERY_DIR/restored-check" \
node workspace-server.cjs
```

Open `http://127.0.0.1:10002/login` and use the new password. Confirm the business profile, request count, one full transcript, notes, statuses and opt-outs. Check that another business's request is unavailable and that an old session cannot open saved data. A safe drill keeps the original workspace available and uses the restored copy for verification.

The CI drill uses synthetic data only. It creates two businesses, saves records and an opt-out, creates an encrypted archive, restores to a fresh directory, verifies old credentials/cookies fail, resets the restored owner's password, starts the restored app, checks it through Chromium and verifies the original still works. An archive file existing on disk is not sufficient proof of recovery.

## Limits and remaining work

- Archives cover the local database. They do not back up external services, a future calendar, files outside that database or future provider configuration.
- Backup creation is manual through the operator CLI. No real-data schedule, cloud copy or offsite retention policy is configured.
- JSON exports contain customer information in plaintext and are separate from encrypted backup archives.
- Recovery to a new directory and password reset are implemented. Hosted self-service account recovery is not implemented.
- Production hosting, offsite storage, retention/deletion policy, restore objectives and operational monitoring still need an approved design and verification.
- The public demos remain suspended. Merging this code does not publish or resume them.

## Verification

See [recovery verification](RECOVERY_VERIFICATION.md) for the exact tested revision, counts, failures, reproduced defects and release decision. The existing private workspace evidence remains in [the prior stage record](PRIVATE_WORKSPACE_VERIFICATION.md).

Implementation references: [Node SQLite backup API](https://nodejs.org/download/release/v22.21.0/docs/api/sqlite.html#sqlitebackupsourcedb-destination-options), [Node authenticated encryption](https://nodejs.org/download/release/v22.21.0/docs/api/crypto.html#deciphersetauthtagbuffer-encoding) and [Node scrypt](https://nodejs.org/download/release/v22.21.0/docs/api/crypto.html#cryptoscryptpassword-salt-keylen-options-callback).
