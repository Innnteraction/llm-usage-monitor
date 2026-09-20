Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Resolve-InstallVariant([string]$Value) {
    switch ($Value.Trim().ToLowerInvariant()) {
        { $_ -in @('n','node') } { return 'node' }
        { $_ -in @('r','rust') } { return 'rust' }
        default { throw 'Choose node (n) or rust (r).' }
    }
}

function Get-ToolVersion([string]$Name) {
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) { return $null }
    try { return ((& $Name --version 2>$null) | Select-Object -First 1) } catch { return $null }
}
function Get-NodeMajor([string]$Version) {
    if ($Version -match '^v?(\d+)\.') { return [int]$Matches[1] }
    return 0
}
function Get-BuildToolsReady {
    $vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/vswhere.exe'
    if (-not (Test-Path -LiteralPath $vswhere)) { return $false }
    $vs = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
    $sdk = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits/10/Lib'
    return [bool]($vs -and (Test-Path -LiteralPath $sdk))
}
function Get-InstallEnvironment([string]$PnpmVersion) {
    $node = Get-ToolVersion node
    $pnpm = Get-ToolVersion pnpm
    $rustup = Get-ToolVersion rustup
    $cargo = Get-ToolVersion cargo
    $nodeNeeds = @()
    if ((Get-NodeMajor $node) -ne 24) { $nodeNeeds += 'Node.js 24.19.0 (nodejs.org / WinGet OpenJS.NodeJS.LTS)' }
    if ($pnpm -ne $PnpmVersion) { $nodeNeeds += "pnpm $PnpmVersion (npm registry, project packageManager)" }
    $rustNeeds = @()
    if (-not $rustup) { $rustNeeds += 'rustup (rust-lang.org)' }
    if (-not $cargo) { $rustNeeds += 'Rust stable MSVC / Cargo (rustup)' }
    if (-not (Get-BuildToolsReady)) { $rustNeeds += 'Visual Studio 2022 C++ Build Tools + Windows SDK (Microsoft)' }
    return @{ Node = $node; Pnpm = $pnpm; NodeNeeds = $nodeNeeds; RustNeeds = $rustNeeds }
}
function Show-InstallComparison($Environment) {
    Write-Host 'Node / Electron: web UI, Node 24 + pnpm. Simpler build preparation; includes the Electron runtime.'
    Write-Host 'Rust / GPUI: native UI, Rust + C++/SDK tools. More initial setup and compilation work.'
    Write-Host 'Memory usage varies by environment. The sample below does not guarantee a reduction.'
    Write-Host 'Reference (2026-09-20, Windows x64, synthetic expanded UI, five Working Set samples): Node 314-318 MiB / Rust 55 MiB. Results vary by PC, driver and data.'
    Write-Host 'macOS live UI, login startup and full UI parity still require manual verification.'
    foreach ($kind in @('Node','Rust')) {
        $needs = @($Environment["${kind}Needs"])
        Write-Host "$kind required tools: $(if ($needs.Count) { $needs -join '; ' } else { 'ready' })"
    }
}
function Confirm-InstallAction([string]$Message, [bool]$Accepted, [bool]$NonInteractive) {
    Write-Host $Message
    if ($Accepted) { return }
    if ($NonInteractive -or [Console]::IsInputRedirected) { throw 'Explicit consent is required. Check -AcceptInstall / -AcceptDependencies.' }
    if ((Read-Host 'Type yes to agree') -cne 'yes') { throw 'Cancelled by user.' }
}

function Invoke-Checked([string]$File, [string[]]$Arguments) {
    & $File @Arguments | Out-Host
    if ($LASTEXITCODE -in @(3010,1641)) { throw 'A restart is required after tool installation. Restart Windows and run the same command.' }
    if ($LASTEXITCODE -ne 0) { throw "$File failed (exit $LASTEXITCODE). The existing app is preserved. Rerun the same command to resume." }
}

function Assert-InstallChild([string]$Path, [string]$Parent) {
    $full = [IO.Path]::GetFullPath($Path).TrimEnd('\','/')
    $base = [IO.Path]::GetFullPath($Parent).TrimEnd('\','/') + [IO.Path]::DirectorySeparatorChar
    if (-not $full.StartsWith($base,[StringComparison]::OrdinalIgnoreCase)) { throw "Unsafe install path: $Path" }
    if ((Test-Path -LiteralPath $full) -and ((Get-Item -LiteralPath $full).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw "Linked install directory rejected: $full" }
}
function Switch-InstallDirectory([string]$Stage, [string]$Target, [scriptblock]$Configure) {
    $parent = Split-Path -Parent $Target
    Assert-InstallChild $Stage $parent
    Assert-InstallChild $Target $parent
    $backup = "$Target.backup-$([guid]::NewGuid().ToString('N'))"
    $hadPrevious = Test-Path -LiteralPath $Target
    if ($hadPrevious) { Move-Item -LiteralPath $Target -Destination $backup }
    try {
        Move-Item -LiteralPath $Stage -Destination $Target
        & $Configure
    } catch {
        if (Test-Path -LiteralPath $Target) { Assert-InstallChild $Target $parent; Remove-Item -LiteralPath $Target -Recurse -Force }
        if ($hadPrevious) { Move-Item -LiteralPath $backup -Destination $Target }
        throw
    }
    if ($hadPrevious) {
        Assert-InstallChild $backup $parent
        try { Remove-Item -LiteralPath $backup -Recurse -Force }
        catch { Write-Warning "Installation completed, but backup cleanup remains: $backup" }
    }
}
function Assert-AppStopped([string]$Directory) {
    if (-not (Test-Path -LiteralPath $Directory)) { return }
    # A process can conceal its image path; testing executable sharing catches locked binaries too.
    foreach ($exe in Get-ChildItem -LiteralPath $Directory -Filter '*.exe' -Recurse -File) {
        try { $stream = [IO.File]::Open($exe.FullName,'Open','ReadWrite','Read'); $stream.Dispose() }
        catch { throw 'The app or installation files are in use. Choose Quit in the tray menu and retry. The installer will not force quit the app.' }
    }
}
function Update-InstallerPath {
    $env:PATH = "$env:USERPROFILE/.cargo/bin;" + [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User') + ';' + $env:PATH
}
function Install-SelectedDependencies([string]$Variant, [string]$PnpmVersion, [bool]$AcceptDependencies, [bool]$NonInteractive) {
    $environment = Get-InstallEnvironment $PnpmVersion
    $needs = @($environment["${Variant}Needs"])
    if ($needs.Count) {
        Confirm-InstallAction ("Required tools: " + ($needs -join '; ') + '. Administrator permission/UAC and a restart may be required.') $AcceptDependencies $NonInteractive
    }
    if ($Variant -eq 'node') {
        if ($environment.Node -and (Get-NodeMajor $environment.Node) -ne 24) {
            throw 'Existing Node will not be changed. Install Node.js 24 separately, select it in PATH, then retry: https://nodejs.org/en/download'
        }
        if (-not $environment.Node) {
            if (-not (Get-Command winget -ErrorAction SilentlyContinue)) { throw 'WinGet is unavailable. Install Node 24 from https://nodejs.org/en/download and retry.' }
            Invoke-Checked winget @('install','--id','OpenJS.NodeJS.LTS','--version','24.19.0','--exact','--source','winget','--accept-source-agreements','--accept-package-agreements')
            Update-InstallerPath
        }
        if ((Get-NodeMajor (Get-ToolVersion node)) -ne 24) { throw 'Node 24 was not found. Retry in a new terminal.' }
        if ((Get-ToolVersion pnpm) -ne $PnpmVersion) {
            # Keep other projects' global pnpm untouched.
            $toolsDir = Join-Path $env:LOCALAPPDATA "llm-usage-monitor/build-tools/pnpm-$PnpmVersion"
            Invoke-Checked npm @('install','--prefix',$toolsDir,'--no-audit','--no-fund',"pnpm@$PnpmVersion")
            $env:PATH = (Join-Path $toolsDir 'node_modules/.bin') + ';' + $env:PATH
        }
        if ((Get-ToolVersion pnpm) -ne $PnpmVersion) { throw 'pnpm version validation failed.' }
    } else {
        if (-not (Get-BuildToolsReady)) {
            if (-not (Get-Command winget -ErrorAction SilentlyContinue)) { throw 'Install WinGet or Microsoft C++ Build Tools: https://visualstudio.microsoft.com/visual-cpp-build-tools/' }
            Invoke-Checked winget @('install','--id','Microsoft.VisualStudio.2022.BuildTools','--exact','--source','winget','--accept-source-agreements','--accept-package-agreements','--override','--wait --passive --norestart --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended')
        }
        if (-not (Get-ToolVersion rustup)) {
            $downloadDirectory = Join-Path ([IO.Path]::GetTempPath()) ("llm-rustup-" + [guid]::NewGuid().ToString('N'))
            # rustup selects installer/proxy mode from its executable filename.
            $download = Join-Path $downloadDirectory 'rustup-init.exe'
            try {
                New-Item -ItemType Directory -Path $downloadDirectory | Out-Null
                Invoke-WebRequest 'https://static.rust-lang.org/rustup/dist/x86_64-pc-windows-msvc/rustup-init.exe' -OutFile $download -UseBasicParsing
                $checksumResponse = Invoke-WebRequest 'https://static.rust-lang.org/rustup/dist/x86_64-pc-windows-msvc/rustup-init.exe.sha256' -UseBasicParsing
                $checksumText = if ($checksumResponse.Content -is [byte[]]) { [Text.Encoding]::UTF8.GetString($checksumResponse.Content) } else { [string]$checksumResponse.Content }
                if ($checksumText -notmatch '^([a-fA-F0-9]{64})\b' -or (Get-FileHash -LiteralPath $download -Algorithm SHA256).Hash -ne $Matches[1]) { throw 'rustup official SHA-256 validation failed. Installation stopped.' }
                Invoke-Checked $download @('-y','--default-toolchain','none','--no-modify-path')
            } finally {
                if (Test-Path -LiteralPath $downloadDirectory) {
                    Assert-InstallChild $downloadDirectory ([IO.Path]::GetTempPath())
                    try { Remove-Item -LiteralPath $downloadDirectory -Recurse -Force }
                    catch { Write-Warning "Temporary installer cleanup remains: $downloadDirectory. Close any installer still running before removing it." }
                }
            }
            Update-InstallerPath
        }
        $stable = & rustup toolchain list
        if (-not ($stable -match '^stable-x86_64-pc-windows-msvc')) {
            Confirm-InstallAction 'Install Rust stable MSVC. The existing global default toolchain will be preserved.' $AcceptDependencies $NonInteractive
            Invoke-Checked rustup @('toolchain','install','stable-x86_64-pc-windows-msvc','--profile','minimal')
        }
        if (-not (Get-BuildToolsReady)) { throw 'C++ Build Tools/Windows SDK validation failed. Complete setup, restart if required, and retry.' }
        Invoke-Checked rustup @('run','stable-x86_64-pc-windows-msvc','cargo','--version')
    }
}
function Build-SelectedApp([string]$Variant, [string]$ProjectRoot) {
    Push-Location $ProjectRoot
    try {
        if ($Variant -eq 'node') {
            Invoke-Checked pnpm @('install','--frozen-lockfile')
            Invoke-Checked node @('scripts/package-install.mjs')
            return (Join-Path $ProjectRoot 'out/install-build/LLM Usage Monitor-win32-x64')
        }
        Invoke-Checked rustup @('run','stable-x86_64-pc-windows-msvc','cargo','build','--locked','--release','--bin','llm-usage-monitor')
        return (Join-Path $ProjectRoot 'target/release/llm-usage-monitor.exe')
    } finally { Pop-Location }
}
