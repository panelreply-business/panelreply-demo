# Windows fixture failure diagnostics

## Actual run88 result

The command-resolution repair compiled all three native artifacts on Windows 2022 using pinned Node 24.22.3, MSVC 19.44.35230.0, SDK 10.0.26100.0 and CMake 3.31.6. Root verified the ZIP digest/paths, all 193 committed source entries, downloaded binary/project hashes, build identity, header manifest and configured toolchain. [Verified record](evidence/windows-native-component-run88.json).

The component executes all 15 methods: 12 PASS and 3 FAIL, with no skips. Cleanup records EPERM. These isolated component outcomes earn zero product-goal credit and neither application imports the component.

Two methods stop while creating or inspecting empty-DACL fixtures. The native helper writes a JSON reason to stdout and exits 2, but the process wrapper previously retained only the generic command failure. The exact native failure reason is absent from run88. Empty access-control behavior and cleanup remain unresolved. Do not infer that the component accepted unsafe storage or that a specific Windows API failed.

The instrumented root mutation succeeds. Native creation refuses with 1921, no opened-child probe occurs, both independent held-directory enumerations complete with no child, and the target child is absent with not-found 2. The test rejects the source lookup's 1921 because its diagnostic list contains only 2, 3, 1920. The independent enumerations, not the source lookup error, establish absence.

## Candidate correction

- Preserve a helper's structured exit 2 reason and Windows code in the thrown error. An explicit allowFailure caller can inspect it. A required-success caller still fails. Malformed, oversized, missing-code or invalid-code output never converts failure to success.
- Complete create-fixture metadata before writing any JSON prefix. A metadata exception produces one error record rather than partial success JSON followed by an error.
- Record 1921 as an allowed refused source lookup only after every existing complete source/target enumeration, target-not-found and no-child assertion. Keep the root reparse rejection and native operation refusal.

Microsoft documents 1921 as ERROR_CANT_RESOLVE_FILENAME. It describes unresolved name resolution, not proof that a child does not exist. [Primary error-code reference](https://learn.microsoft.com/en-us/windows/win32/debug/system-error-codes--1700-3999-).

No application code, storage.cc security check, ACL, cleanup policy, release requirement or workflow changes. The 15 native method IDs remain.

## Local verification and next evidence

The source manifest is `991af22d5c66708b55d1d7e01ce739a9dbab28e27c9e1f89c7f04cf5ecad6b8c` across 193 files, based on `1322d0630d377d9fe769dc15543321cb5f5fe373`.

All nine component-evidence harness checks pass, including the new failure-preservation contract. Malformed and invalid native reports remain failures. JavaScript syntax and diff checks pass. No native execution occurs locally. [Source-bound local record](evidence/windows-fixture-diagnostics-2026-11-23.json).

Next Windows CI must reproduce the exact empty-DACL reason, preserve the original three failures and cleanup error, and verify the diagnostic correction. A repeat pass alone cannot repair the unresolved fixture lifecycle. A retained creation/cleanup handle may be needed, but no ACL repair or privilege change is part of this candidate.

## Run89 outcome

Committed `5cead334` compiles with verified native identities and executes 13 PASS/two FAIL methods. The instrumented race test now passes with all independent absence requirements. Both empty-DACL fixture failures report Could not inspect fixture path (Windows 5). Cleanup EPERM remains. A synchronous metadata-open access hypothesis requires further native investigation. No storage or ACL policy changes. [Verified artifact](evidence/windows-native-component-run89.json).
