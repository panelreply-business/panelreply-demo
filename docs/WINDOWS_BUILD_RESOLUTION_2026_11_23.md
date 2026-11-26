# Windows build command resolution

## Observed failure

Run87 tests committed `9264d2a3575889c6b39140554fc767caf6e6a7ad`. The separate Windows component job fails before native compilation. PowerShell resolves two Node installations and the script reads their combined `.Source` values as one executable name. Invoking that nonexistent combined path fails before the Node version/hash check.

The runner preserves all 15 native methods as NOT_RUN, zero native passes and one build/loader infrastructure error. Its eight report/provenance harness checks pass on Windows. Artifact digest, size, archive paths and all 192 committed source files were verified. [Source-bound evidence](evidence/windows-native-component-run87.json).

## Correction

The builder requests all matching applications in execution precedence order, selects the first one, then reads its single source path. Node, CMake and tar use the same explicit resolution. The selected Node executable must still match the pinned version and file hash. CMake version, observed compiler/SDK, dependency hashes, generated targets and before/after identity checks remain unchanged. A pin mismatch fails rather than selecting another executable.

This correction changes command resolution. It does not change the native component, its 15 methods, strict ACL checks, existing product code or Windows support claim. Source review passes; actual corrected-source Windows compilation and execution remain required. The missing-build record is retained.

Microsoft documents execution-precedence ordering for `Get-Command -All` in [Example12](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/get-command?view=powershell-7.5#example-12-get-all-instances-of-the-notepad-command). The observed job failure, not an assumption about every PowerShell environment, establishes the multiple-path condition here.
