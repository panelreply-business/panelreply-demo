[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$OutputDirectory
)

$ErrorActionPreference = 'Stop'
$Repository = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$NativeSource = Join-Path $Repository 'workspace/native/windows-storage'
$Pins = Get-Content -LiteralPath (Join-Path $NativeSource 'toolchain.json') -Raw | ConvertFrom-Json
$NodeVersion = $Pins.node
$SdkVersion = $Pins.windowsSdk
$RejectedOverrides = @('CL', '_CL_', 'CFLAGS', 'CXXFLAGS', 'LDFLAGS', 'CMAKE_TOOLCHAIN_FILE',
  'CMAKE_GENERATOR', 'CMAKE_GENERATOR_PLATFORM', 'CMAKE_GENERATOR_TOOLSET', 'CMAKE_PROJECT_INCLUDE',
  'CMAKE_PROJECT_INCLUDE_BEFORE', 'CMAKE_CXX_FLAGS', 'INCLUDE', 'LIB', 'LIBPATH', 'VCTargetsPath',
  'VCInstallDir', 'VCToolsInstallDir', 'WindowsSdkDir', 'WindowsSDKVersion')
foreach ($Name in $RejectedOverrides) {
  if (-not [string]::IsNullOrEmpty([Environment]::GetEnvironmentVariable($Name, 'Process'))) {
    throw "The fixed native build does not accept the ambient override $Name."
  }
}
$Destination = [IO.Path]::GetFullPath($OutputDirectory)
if (-not $IsWindows -or [Runtime.InteropServices.RuntimeInformation]::ProcessArchitecture -ne 'X64') {
  throw 'This build requires an actual Windows x64 process.'
}
if (-not [IO.Path]::IsPathFullyQualified($OutputDirectory) -or
    $Destination.StartsWith($Repository + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or
    $Destination -eq $Repository -or (Test-Path -LiteralPath $Destination)) {
  throw 'Use a new absolute build directory outside the source checkout.'
}
$NodeExecutable = (Get-Command node -CommandType Application).Source
$ObservedNode = (& $NodeExecutable -p 'process.versions.node').Trim()
if ($LASTEXITCODE -ne 0 -or $ObservedNode -ne $NodeVersion -or
    (Get-FileHash -LiteralPath $NodeExecutable -Algorithm SHA256).Hash.ToLowerInvariant() -ne $Pins.nodeExecutableSha256) {
  throw "This component build requires the pinned Node $NodeVersion runtime."
}
$SourceBefore = (& $NodeExecutable (Join-Path $Repository 'scripts/test-evidence.cjs') --source | ConvertFrom-Json)
if ($LASTEXITCODE -ne 0) { throw 'Could not capture the source manifest.' }
$CMakeExecutable = (Get-Command cmake -CommandType Application).Source
$TarExecutable = (Get-Command tar -CommandType Application).Source
$CMakeDescription = (& $CMakeExecutable --version) -join "`n"
if ($LASTEXITCODE -ne 0 -or $CMakeDescription -notmatch '^cmake version ([0-9]+\.[0-9]+\.[0-9]+)' -or
    [version]$Matches[1] -lt [version]$Pins.minimumCMake) { throw 'CMake 3.27 or later is required for exact SDK selection.' }
$CMakeVersion = $Matches[1]
$CMakeHash = (Get-FileHash -LiteralPath $CMakeExecutable -Algorithm SHA256).Hash.ToLowerInvariant()
$TarHash = (Get-FileHash -LiteralPath $TarExecutable -Algorithm SHA256).Hash.ToLowerInvariant()
New-Item -ItemType Directory -Path $Destination | Out-Null
$Downloads = New-Item -ItemType Directory -Path (Join-Path $Destination 'dependencies')
$Headers = New-Item -ItemType Directory -Path (Join-Path $Destination 'headers')
$Distribution = $Pins.distribution
$ChecksumsFile = Join-Path $Downloads 'SHASUMS256.txt'
Invoke-WebRequest -Uri ($Distribution + 'SHASUMS256.txt') -OutFile $ChecksumsFile -TimeoutSec 60 -MaximumRedirection 0
if ((Get-Item -LiteralPath $ChecksumsFile).Length -gt 1048576) { throw 'The checksum manifest exceeds its bound.' }
$Checksums = @{}
foreach ($Line in Get-Content -LiteralPath $ChecksumsFile) {
  if ($Line -match '^([a-f0-9]{64})\s+\*?(.+)$') {
    if ($Checksums.ContainsKey($Matches[2])) { throw 'The official checksum manifest repeats an entry.' }
    $Checksums[$Matches[2]] = $Matches[1]
  }
}
$DependencyRecords = @()
foreach ($Dependency in $Pins.dependencies) {
  $Name = $Dependency.name
  if (-not $Checksums.ContainsKey($Name) -or $Checksums[$Name] -ne $Dependency.sha256) {
    throw "The official distribution does not match the reviewed byte pin for $Name."
  }
  $Local = Join-Path $Downloads ([IO.Path]::GetFileName($Name))
  Invoke-WebRequest -Uri ($Distribution + $Name) -OutFile $Local -TimeoutSec 60 -MaximumRedirection 0
  if ((Get-Item -LiteralPath $Local).Length -gt 67108864) { throw 'A native build dependency exceeds its size bound.' }
  $Digest = (Get-FileHash -LiteralPath $Local -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($Digest -ne $Dependency.sha256) { throw "The pinned dependency checksum did not match for $Name." }
  $DependencyRecords += [ordered]@{ name = $Name; url = $Distribution + $Name; path = $Local;
    bytes = (Get-Item -LiteralPath $Local).Length; sha256 = $Digest }
}
& $TarExecutable -xzf (Join-Path $Downloads "node-v$NodeVersion-headers.tar.gz") -C $Headers.FullName --strip-components=1
if ($LASTEXITCODE -ne 0) { throw 'Could not unpack the verified Node headers.' }
$HeaderPath = Join-Path $Headers 'include/node'
if (-not (Test-Path -LiteralPath (Join-Path $HeaderPath 'node_api.h'))) { throw 'The verified archive is missing node_api.h.' }
$HeaderRecords = @()
foreach ($Header in Get-ChildItem -LiteralPath $HeaderPath -Recurse -File | Sort-Object FullName) {
  if (($Header.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $Header.Length -gt 8388608) {
    throw 'An extracted Node header is outside the reviewed file bounds.'
  }
  $HeaderRecords += [ordered]@{ path = $Header.FullName.Substring($HeaderPath.Length + 1).Replace('\', '/');
    bytes = $Header.Length; sha256 = (Get-FileHash -LiteralPath $Header.FullName -Algorithm SHA256).Hash.ToLowerInvariant() }
}
if ($HeaderRecords.Count -lt 1 -or $HeaderRecords.Count -gt 5000) { throw 'The extracted Node header tree has an invalid size.' }
$HeaderManifest = Join-Path $Destination 'headers-identity.json'
ConvertTo-Json -InputObject $HeaderRecords -Depth 4 | Set-Content -LiteralPath $HeaderManifest -Encoding utf8NoBOM
$Build = Join-Path $Destination 'build'
$ConfigureArguments = @('-S', $NativeSource, '-B', $Build, '-G', $Pins.generator, '-A', "x64,version=$SdkVersion", '-T', $Pins.toolset,
  '-DCMAKE_CONFIGURATION_TYPES=Release',
  "-DNODE_HEADERS=$HeaderPath", "-DNODE_IMPORT_LIBRARY=$(Join-Path $Downloads 'node.lib')")
& $CMakeExecutable @ConfigureArguments 2>&1 | Tee-Object -FilePath (Join-Path $Destination 'configure.log')
if ($LASTEXITCODE -ne 0) { throw 'The native component configuration failed.' }
$ObservedToolchainFile = Join-Path $Build 'configured-toolchain.json'
$ObservedToolchain = Get-Content -LiteralPath $ObservedToolchainFile -Raw | ConvertFrom-Json
if ($ObservedToolchain.windowsSdk -ne $SdkVersion -or $ObservedToolchain.generator -ne $Pins.generator -or
    $ObservedToolchain.platform -ne 'x64' -or $ObservedToolchain.toolset -ne $Pins.toolset -or
    $ObservedToolchain.compilerId -ne 'MSVC' -or $ObservedToolchain.cmakeVersion -ne $CMakeVersion) {
  throw 'The configured compiler, platform or SDK differs from the requested toolchain.'
}
$Compiler = $ObservedToolchain.compiler
$CompilerVersion = $ObservedToolchain.compilerVersion
$CompilerHash = (Get-FileHash -LiteralPath $Compiler -Algorithm SHA256).Hash.ToLowerInvariant()
& $CMakeExecutable --build $Build --config Release --parallel 2 2>&1 | Tee-Object -FilePath (Join-Path $Destination 'build.log')
if ($LASTEXITCODE -ne 0) { throw 'The native component compilation failed.' }
$Artifacts = @()
foreach ($Name in @('panelreply_windows_storage.node', 'panelreply_windows_storage_probe.node', 'panelreply_windows_storage_fixture.exe')) {
  $File = Join-Path $Build (Join-Path 'Release' $Name)
  if (-not (Test-Path -LiteralPath $File -PathType Leaf)) { throw "The native build did not produce $Name." }
  $Target = [IO.Path]::GetFileNameWithoutExtension($Name)
  $ProjectFile = Join-Path $Build ($Target + '.vcxproj')
  $ProjectText = Get-Content -LiteralPath $ProjectFile -Raw
  if ($ProjectText -notmatch ('<WindowsTargetPlatformVersion>' + [regex]::Escape($SdkVersion) + '</WindowsTargetPlatformVersion>') -or
      $ProjectText -notmatch '<PlatformToolset>v143</PlatformToolset>') { throw 'A generated target differs from the observed SDK or toolset.' }
  $Probe = $Name -eq 'panelreply_windows_storage_probe.node'
  if (($ProjectText.Contains('PANELREPLY_STORAGE_TEST_PROBE=1')) -ne $Probe) { throw 'The test-probe define does not match its separate target.' }
  $Artifacts += [ordered]@{ name = $Name; path = $File; bytes = (Get-Item -LiteralPath $File).Length;
    sha256 = (Get-FileHash -LiteralPath $File -Algorithm SHA256).Hash.ToLowerInvariant();
    testInstrumented = $Probe; target = $Target;
    projectSha256 = (Get-FileHash -LiteralPath $ProjectFile -Algorithm SHA256).Hash.ToLowerInvariant() }
}
if ((Get-FileHash -LiteralPath $Compiler -Algorithm SHA256).Hash.ToLowerInvariant() -ne $CompilerHash -or
    (Get-FileHash -LiteralPath $CMakeExecutable -Algorithm SHA256).Hash.ToLowerInvariant() -ne $CMakeHash -or
    (Get-FileHash -LiteralPath $TarExecutable -Algorithm SHA256).Hash.ToLowerInvariant() -ne $TarHash -or
    (Get-FileHash -LiteralPath $NodeExecutable -Algorithm SHA256).Hash.ToLowerInvariant() -ne $Pins.nodeExecutableSha256) {
  throw 'A build tool changed during compilation.'
}
if (@(Get-ChildItem -LiteralPath $HeaderPath -Recurse -File).Count -ne $HeaderRecords.Count) { throw 'The extracted header tree changed during compilation.' }
foreach ($Header in $HeaderRecords) {
  $File = Join-Path $HeaderPath $Header.path
  if ((Get-FileHash -LiteralPath $File -Algorithm SHA256).Hash.ToLowerInvariant() -ne $Header.sha256) {
    throw 'An extracted Node header changed during compilation.'
  }
}
foreach ($Dependency in $DependencyRecords) {
  if ((Get-FileHash -LiteralPath $Dependency.path -Algorithm SHA256).Hash.ToLowerInvariant() -ne $Dependency.sha256) {
    throw 'A pinned build dependency changed during compilation.'
  }
}
$SourceAfter = (& $NodeExecutable (Join-Path $Repository 'scripts/test-evidence.cjs') --source | ConvertFrom-Json)
if ($LASTEXITCODE -ne 0 -or $SourceBefore.sourceTreeSha256 -ne $SourceAfter.sourceTreeSha256 -or
    $SourceBefore.sourceCommit -ne $SourceAfter.sourceCommit) { throw 'The source changed during the native build.' }
$Record = [ordered]@{
  format = 'panelreply-windows-storage-build-v1'
  createdAt = [DateTime]::UtcNow.ToString('o')
  sourceCommit = $SourceBefore.sourceCommit
  sourceTreeSha256 = $SourceBefore.sourceTreeSha256
  platform = 'win32'
  architecture = 'x64'
  environmentOverrides = [ordered]@{ rejected = $RejectedOverrides; detected = @() }
  node = $NodeVersion
  nodeExecutableSha256 = $Pins.nodeExecutableSha256
  compiler = [ordered]@{ path = $Compiler; version = $CompilerVersion;
    sha256 = $CompilerHash }
  windowsSdk = $ObservedToolchain.windowsSdk
  configuredToolchain = [ordered]@{ observed = $ObservedToolchain;
    sha256 = (Get-FileHash -LiteralPath $ObservedToolchainFile -Algorithm SHA256).Hash.ToLowerInvariant() }
  cmake = [ordered]@{ path = $CMakeExecutable; version = $CMakeVersion; sha256 = $CMakeHash }
  tar = [ordered]@{ path = $TarExecutable; sha256 = $TarHash }
  headers = [ordered]@{ count = $HeaderRecords.Count;
    sha256 = (Get-FileHash -LiteralPath $HeaderManifest -Algorithm SHA256).Hash.ToLowerInvariant() }
  runnerImage = [ordered]@{ os = $env:ImageOS; version = $env:ImageVersion }
  checksumManifest = [ordered]@{ url = $Distribution + 'SHASUMS256.txt';
    sha256 = (Get-FileHash -LiteralPath $ChecksumsFile -Algorithm SHA256).Hash.ToLowerInvariant() }
  dependencies = $DependencyRecords
  artifacts = $Artifacts
  scope = 'Component only. Neither application loads this module. SQLite and restore integration remain disabled.'
}
$Record | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath (Join-Path $Destination 'build-identity.json') -Encoding utf8NoBOM
Write-Output "Built the source-bound Windows storage component in $Destination"
