# OCR host evidence output boundary, version 2

## Review finding

Independent review found that version 1 checked the output path with a lexical `path.relative` comparison. An outside directory alias pointing into the repository could pass that check. A dangling leaf could also evade `existsSync` before exclusive creation rejected it later.

The reviewer reproduced the alias acceptance without creating a report or running a native verifier. This was a defect in the inactive observation wrapper's CLI boundary. It is not evidence of a production write or customer-data exposure.

The original eight-file patch remains frozen as `185838b1725fa4dba1514bab8b806d2679f44ef423f28bca0f30e397fe60164a`. Its 144-test log, development source record and zero-attempt build-failure observation remain unchanged. They describe version 1 and do not verify this correction.

## Corrected sequence

Output preparation now completes before source observation, host reads or a verifier attempt.

1. Validate an absolute JSON destination and reject `release-` leaf names.
2. Resolve the existing parent from the raw input spelling with native `realpath`. A symlink followed by `..` is not normalized before filesystem resolution.
3. Resolve the repository and reject either direction of canonical directory overlap.
4. Reject every existing leaf entry with `lstat`, including a dangling symlink.
5. Create the leaf exclusively, mode 0600, and retain the opened file descriptor.
6. Recheck canonical parent/root paths and identities, plus the held file and named leaf identities, before observation and before writing.
7. Write and synchronize through the held descriptor. Recheck identity, link count and byte count, then close it.
8. Return and emit the report only after write verification and close succeed.

No report write reopens its destination by pathname. A replaced leaf cannot redirect a write through the held descriptor. A parent or leaf change observed by the checks fails the operation.

A failed output operation preserves its primary error. Descriptor-close errors remain separate. The CLI reports whether a file was created, writing began, the write was verified and the descriptor closed. It does not delete a path after a possible replacement. A retained empty or partial file is not completed evidence.

## Parent trust and race limits

The output parent must be a trusted CI temporary directory. These checks are not an atomic security boundary against an actor who can rename or replace that parent concurrently.

A parent changed between validation and opening can leave an empty entry at an unconfirmed location before the following check fails. Moving the held file or its parent during writing can make the final check fail after bytes were written. The wrapper reports failure and retained-output state. It does not claim that every such concurrent write was prevented or that cleanup succeeded.

Those limits do not excuse the original static alias bug. An alias that already resolves into the repository is rejected before creation, source collection or verifier execution.

## Validation on the corrected source

Forty diagnostics harness cases passed with zero failures, skips, cancellations or todos. This includes the original nine cases, twenty version 1 cases and eleven new output-boundary regressions. No new product case receives goal credit.

The new cases cover repository aliases, raw alias/parent traversal, unavailable parents, dangling and existing leaves, ordinary outside output, held-descriptor writing, parent and leaf replacement, primary errors with close failures, and preservation of retained outputs. Native filesystem resolution supplies the traversal oracle so the portable harness does not assume POSIX junction semantics on Windows.

Five local CLI preflight checks also rejected a repository alias, alias/parent traversal, missing parent, looping parent and dangling leaf. They created no repository report and ran no native verifier. A separate ordinary outside destination completed the explicit failed-build reporting path. It preserved six NOT_RUN cases, zero attempts, dirty development source and a matching stdout/file payload after close.

Commands:

```sh
node --test tests/ocr-isolation-diagnostics.test.cjs
node scripts/observe-ocr-isolation.cjs /tmp/panelreply-ocr-build-failure-observation-v2.json --build-outcome failure
```

The second command exercises failed-build reporting. It exits one and runs zero native cases. The CLI preflight fixture commands are recorded in the version 2 evidence.

Evidence:

- `docs/evidence/ocr-host-output-development-v2-2026-11-23.json`
- `docs/evidence/ocr-host-output-harness-v2-2026-11-23.log`
- `docs/evidence/ocr-host-output-cli-v2-2026-11-23.json`
- `docs/evidence/ocr-host-output-build-failure-v2-2026-11-23.json`

The host context reader, workflow matrix, dependency build, six native assertions, application files and counting policy are unchanged from version 1. Root's earlier 9,261-test integrated run belongs to its earlier source and is not reused as verification of version 2. Independent review and committed-source CI remain separate checks.
