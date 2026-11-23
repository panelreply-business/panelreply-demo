# Windows native storage implementation assessment

Assessed on 2026-11-23. Read-only investigation of PanelReply's existing branch and current integration checkout. No production source, workflow, platform claim or release gate changed. No native Windows product execution was performed.

## Decision

Meaningful native adapter work can proceed on the existing standard `windows-2022` CI runner. Start with an actual Node-API storage boundary and its security tests. Do not add a job that only proves the already-known POSIX-mode rejection. Do not enable the private products until the adapter, SQLite integration and publication/recovery stages pass.

The hosted image lists Visual Studio 2022 with its native desktop workload and Windows SDKs. The repository already selects Node 24 and Python 3.12 on standard Windows jobs, and pins Playwright 1.62.0. A new paid runner or service is not a prerequisite. The checked-out repository has no native build project or adapter today. Actual MSVC build and NTFS security execution would occur in CI, not on this Linux development host.

Sources: [runner image inventory](https://github.com/actions/runner-images/blob/main/images/windows/Windows2022-Readme.md?plain=1), [Node 24 addon build interface](https://nodejs.org/docs/latest-v24.x/api/addons.html).

## Existing boundaries

| Boundary | Existing implementation | Work needed |
| --- | --- | --- |
| Private root and children | `workspace/file-safety.cjs` requires POSIX 0700 directories, 0600/0400 regular files, single links, unlinked ancestors and UID ownership where available | Handle-based SID/DACL, reparse/link and identity checks, private creation and lifetime guards |
| Fixed product identity | `workspace/products.cjs` validates the root before exclusive marker creation | Keep marker creation exclusive and private from creation, preserve cross-product refusal and concurrent initializer checks |
| SQLite | `workspace/store.cjs` creates the main file, checks sidecars, then opens `DatabaseSync` by path | Hold a validated path lease through database close, prove private sidecar inheritance and cleanup, close leases on constructor failures |
| Backup and restore | `workspace/backup.cjs` uses exclusive files, hard-link publication, file/directory fsync, and a 0300-to-0700 restore publication step | Native private staging, bounded handle-based IO and publication that refuses incomplete restores, keeps no-overwrite and records flush failures |
| Browser harness | `SelectedProductHarness` calls the fixed entrypoint with `--init` before starting the server | Subprocess and loopback mechanics can be reused after storage works. Preserve real selected-product entrypoints and all console/CSP/external-request guards |
| Manual spreadsheet suite | `MacSpreadsheetProductBrowserTests` rejects non-Darwin hosts. The evidence validator also restricts `spreadsheet-manual` to Darwin | Add a Windows-specific manual suite after the storage gate. Preserve current Mac identities and actual OCR-unavailable behavior |

Node documents that Windows directory mode creation is unsupported and chmod does not distinguish owner/group/other. `getuid()` is absent. Removing those checks would remove the current protection. [Node fs](https://nodejs.org/docs/latest-v24.x/api/fs.html), [Node process](https://nodejs.org/docs/latest-v24.x/api/process.html).

Node's public SQLite constructor accepts a path. The adapter must keep the checked pathname valid while SQLite uses it rather than inspect a handle, close it, then trust a later path open. A PowerShell ACL probe or a short-lived helper cannot by itself supply that lifetime guarantee. [Node 24 SQLite](https://nodejs.org/docs/latest-v24.x/api/sqlite.html).

## Bounded first implementation

Add a Windows-only Node-API module under `workspace/native/windows-storage/`, a small build script under `scripts/`, and real Windows tests. Keeping native source under `workspace/` puts it inside the existing source-evidence manifest. Build outside the checkout and record the compiled module hash as runtime dependency evidence.

Use plain `node_api.h` plus Win32 APIs. A checked-in CMake/MSVC build can use the runner's installed compiler and SDK without introducing a runtime package installer. Supply the exact selected Node version's headers and Windows import library, verify their official checksums, and record their identities. The loader must use a fixed expected artifact location and fail if the module is absent, incompatible or invalid. It must never fall back to permissive JavaScript checks.

Implement these real primitives first, while leaving current product startup behavior unchanged until later integration:

- Validate fully qualified local NTFS paths and persistent ACL support. Reject remote, device, alternate-stream, unsupported-volume and reparse paths.
- Create a private root or child with the final security descriptor supplied during creation. Do not create broadly and tighten later. Never adopt an existing unsafe object by changing its owner or DACL.
- Open and retain handle leases. Read owner and DACL through the handle, validate the current token's user SID, distinguish null/empty DACLs, and reject foreign grants or unsupported ACE shapes. Validate file identity, type and link count. Close handles explicitly and on environment cleanup.
- Protect the checked ancestor/root identities against replacement while allowing the intended SQLite sidecar lifecycle. Tests must establish sharing behavior rather than infer it from successful path opens.
- Provide bounded private file creation/read/flush operations needed for marker and database creation, with no-overwrite behavior and structured failures.

The first useful CI result is a compiled adapter exercising private creation, positive/negative ACL cases, actual second-identity denial, reparse/hard-link rejection, replacement attempts and handle cleanup. Fixture rows and mutation loops are not separate passing cases. Missing capabilities must fail the required component stage, not become silent skips.

Primary API contracts: [GetSecurityInfo](https://learn.microsoft.com/en-us/windows/win32/api/aclapi/nf-aclapi-getsecurityinfo), [CreateFileW](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-createfilew), [null and empty DACLs](https://learn.microsoft.com/en-us/windows/win32/secauthz/null-dacls-and-empty-dacls).

## Prerequisites to resolve before app integration

1. Verify the actual filesystem on the chosen test volume. GitHub announced that Windows D: volumes will switch to ReFS beginning November 30, 2026. This overlaps the requested daily-test period. Select a verified local NTFS root for private fixtures, set TEMP/TMP/TMPDIR consistently for child processes, and record the observed volume. Do not assume that the checkout or RUNNER_TEMP is NTFS. Do not expand the adapter's filesystem policy just to accommodate CI. [GitHub announcement](https://github.com/actions/runner-images/issues/15315).

2. Resolve token owner versus token user for SQLite-created files. Windows' default object owner can be a user or group SID from the token. GitHub documents that its Windows runners run as administrators with UAC disabled. Supplying the user SID when the adapter creates a file does not establish the owner of files SQLite later creates. Verify this under the actual runner and a disposable standard-user fixture. Preserve the user-SID policy. An unsupported token must fail before private data writes, rather than repair ownership after creation or silently accept a group owner. [TOKEN_OWNER](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-token_owner), [hosted runner privileges](https://docs.github.com/en/actions/reference/runners/github-hosted-runners#administrative-privileges).

3. Prove built-in Node 24 SQLite behavior with live guards: WAL/SHM/journal creation, checkpoint/removal, concurrent connections, restart and error cleanup. The current Windows portable suite excludes this real storage path. Passing portable Node or static browser cases cannot stand in for it.

4. Design and review restore publication separately. Normal startup must reject the entire incomplete state until both marker and database are complete. Preserve same-volume/no-overwrite publication, competitor preservation, single-link final files, authenticated archive handling, disabled restored credentials and revoked sessions. Test forced process exit at every stage and recovery after restart. Windows flush APIs need appropriate access rights and explicit error handling. Do not ignore a directory-fsync error or claim power-loss durability from a process-restart test. [FlushFileBuffers](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-flushfilebuffers), [MoveFileExW](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-movefileexw).

## Later product and evidence integration

After the native component, SQLite and recovery stages pass, add actual Windows fixed callback and Windows manual spreadsheet browser suites. Reuse the selected-product harness and existing non-OCR behaviors. Add Windows-specific private recovery and real unavailable-OCR acceptance. Retain source images, manual corrections, CSV/XLSX, tenant separation, scheduling/status/STOP holds, retention/deletion and restored-credential assertions.

Keep the Linux native OCR launcher unchanged. A manual Windows spreadsheet result establishes storage, correction and export only. It does not establish native extraction or worker isolation.

Proposed evidence changes when implemented:

- Record source/policy hashes, actual OS/architecture, exact Node/Python/Playwright/browser versions, runner image version, NTFS volume identity, token class, compiler/SDK/header/import-library identities and addon hash.
- Add a distinct `windows-storage` component suite and its gate. Classify actual security behavior as shared product evidence and provenance-parser checks as harness evidence. Add no success credit for an expected unavailable platform.
- Keep fixed callback reports in the `callback` suite with `deploymentMode: callback`, actual Windows x86_64 and the observed engine/channel. Add the corresponding three Windows bundled-engine requirements only once those jobs execute the real backend.
- Use a distinct `spreadsheet-manual-windows` suite. Require actual Windows and `deploymentMode: spreadsheet` in the aggregator. Add three engine requirements with minimum cases equal to the actual collected methods. Do not weaken the Darwin restriction of existing reports.
- Keep `windows-private-product-workflows` open until its entire storage/recovery/product scope has evidence. Keep physical-device, Safari and native-OCR gates separate.

The code can be authored and reviewed now. The Windows compile/security runs are the required feedback loop. This assessment is a plan for that work, not native-platform acceptance.
