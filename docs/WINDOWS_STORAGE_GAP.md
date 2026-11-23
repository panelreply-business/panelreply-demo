# Native Windows storage gap

Status: NOT VERIFIED. This investigation changes no supported-platform claim or release requirement.

Both private product entrypoints use `openProductStore()` in `workspace/products.cjs`. It checks the data directory before creating a binding marker or opening SQLite. The shared `workspace/file-safety.cjs` requires POSIX `0700` directories and `0600` or `0400` files. Its owner check uses `process.getuid()` when available.

[Node 24 documentation](https://nodejs.org/docs/latest-v24.x/api/fs.html) states that directory creation modes are unsupported on Windows and `chmod` cannot distinguish owner, group and other permissions. [`process.getuid()`](https://nodejs.org/docs/latest-v24.x/api/process.html#processgetuid) is unavailable there. [Node 24.22.3's bundled Windows implementation](https://github.com/nodejs/node/blob/v24.22.3/deps/uv/src/win/fs.c) derives permission bits from the read-only attribute, repeats them across permission classes and reports UID/GID as zero. Some non-symlink reparse points can be retried as ordinary files.

The exact directory-mode check therefore prevents native Windows startup. Bypassing that check would remove permission protection and leave no Windows ownership validation. This finding comes from source inspection and primary documentation, not a private-server execution on Windows.

## Current standalone candidate

The inactive [native component](WINDOWS_NATIVE_COMPONENT_2026_11_23.md) now has 15 adversarial methods, source/provenance review and a separate standard Windows CI job. Eight local evidence-harness checks pass. Native compilation and actual methods remain pending. Neither product loads it, so the startup gap described above remains.

The creation lease's DELETE handle is only a live-process barrier. A crash closes it, so it cannot replace persistent incomplete-restore refusal. Ordinary SQLite Win32 creation also needs direct ownership/DACL and WAL/SHM/journal observations under the pinned runtime. Do not relax the existing product checks or infer those boundaries from a protected parent alone. [Integration evidence](evidence/windows-component-integration-2026-11-23.json).

## Required adapter

Start with local NTFS storage and fully qualified local paths. Reject remote paths, device namespaces, alternate data streams, unsupported volumes and reparse points. Preserve refusal to change the permissions or owner of an existing unsafe path.

- Compare the current token's user SID with the object owner. Read the DACL through an open handle using [GetSecurityInfo](https://learn.microsoft.com/en-us/windows/win32/api/aclapi/nf-aclapi-getsecurityinfo). Require owner access and reject grants to other principals. A [null DACL grants access](https://learn.microsoft.com/en-us/windows/win32/secauthz/null-dacls-and-empty-dacls).
- Supply a private security descriptor when creating a new directory or file. Do not create a broadly accessible object and restrict it afterward. Check [persistent ACL support](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-getvolumeinformationw).
- Inspect reparse attributes, file identity and link count through handles. [CreateFileW](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-createfilew) supplies reparse and sharing controls. Keep validation relevant until use without preventing SQLite sidecar cleanup.
- Validate each protected child. Windows [file access rules](https://learn.microsoft.com/en-us/windows/win32/fileio/file-security-and-access-rights) do not make a private parent sufficient protection for every existing child.

A bounded PowerShell/.NET metadata probe can establish behavior. Full support needs a reviewed native helper or Node-API boundary for exclusive creation, handle checks and publication. An [icacls](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/icacls) grant or inheritance command alone does not establish the complete DACL. No helper, service, privilege change or permission exception was installed during this investigation.

## Code and verification sequence

1. Add the Windows adapter behind `workspace/file-safety.cjs`. Test owner/DACL rejection, null and empty DACLs, broad inherited and explicit grants, actual second-identity denial, links, reparse points, path aliases and replacement races.
2. Route new database and marker creation through it in `workspace/store.cjs` and `workspace/products.cjs`. Verify private WAL/SHM/journal creation, restart, simultaneous product initialization and cross-product refusal.
3. Adapt `workspace/backup.cjs`. Current product restore uses `0300` until both database and marker are complete, then publishes with `0700`. Windows needs an equivalent state that both apps refuse before publication. Prove no overwrite, every interruption stage, single-link final files, cleanup, file flushing, disabled restored passwords and revoked sessions.
4. Run the private callback journeys and manual spreadsheet storage/correction/source/CSV/XLSX journeys on actual Windows CI. Keep source, architecture and dependency evidence. Seeded records are workload data, not additional tests.

The fixed Linux OCR launcher remains a separate Windows gap. Manual spreadsheet passes cannot establish native extraction or worker isolation. A Windows browser using a Linux or WSL backend also cannot establish native Windows server support. Keep the existing Windows private-product gate open until its required workflows have reproducible evidence.
