Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

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
    if ((Get-NodeMajor $node) -ne 24) { $nodeNeeds += 'Node.js 24 (nodejs.org / WinGet OpenJS.NodeJS.24)' }
    if ($pnpm -ne $PnpmVersion) { $nodeNeeds += "pnpm $PnpmVersion (npm registry, project packageManager)" }
    $rustNeeds = @()
    if (-not $rustup) { $rustNeeds += 'rustup (rust-lang.org)' }
    if (-not $cargo) { $rustNeeds += 'Rust stable MSVC / Cargo (rustup)' }
    if (-not (Get-BuildToolsReady)) { $rustNeeds += 'Visual Studio 2022 C++ Build Tools + Windows SDK (Microsoft)' }
    return @{ Node = $node; Pnpm = $pnpm; NodeNeeds = $nodeNeeds; RustNeeds = $rustNeeds }
}
function Show-InstallComparison($Environment) {
    Write-Host 'Node / Electron: 웹 UI, Node 24 + pnpm. 빌드 준비가 비교적 단순하지만 Electron 런타임을 포함합니다.'
    Write-Host 'Rust / GPUI: 네이티브 UI, Rust + C++/SDK 도구. 최초 준비·컴파일 부담이 더 큽니다.'
    Write-Host '실행 메모리는 Rust가 작을 것으로 예상되나 동일 조건 측정 전에는 절감률을 보장하지 않습니다.'
    Write-Host 'macOS 실화면·로그인 실행 및 UI 전체 동등성은 별도 검수가 필요합니다.'
    foreach ($kind in @('Node','Rust')) {
        $needs = @($Environment["${kind}Needs"])
        Write-Host "$kind 필요 도구: $(if ($needs.Count) { $needs -join '; ' } else { '준비됨' })"
    }
}
function Confirm-InstallAction([string]$Message, [bool]$Accepted, [bool]$NonInteractive) {
    Write-Host $Message
    if ($Accepted) { return }
    if ($NonInteractive -or [Console]::IsInputRedirected) { throw '명시적 동의가 필요합니다. -AcceptInstall / -AcceptDependencies를 확인하세요.' }
    if ((Read-Host '동의하면 yes 입력') -cne 'yes') { throw '사용자가 취소했습니다. 변경하지 않습니다.' }
}

function Invoke-Checked([string]$File, [string[]]$Arguments) {
    & $File @Arguments | Out-Host
    if ($LASTEXITCODE -in @(3010,1641)) { throw '도구 설치 후 재부팅이 필요합니다. 재부팅 후 같은 명령을 실행하세요.' }
    if ($LASTEXITCODE -ne 0) { throw "$File 실패 (exit $LASTEXITCODE). 기존 앱은 유지됩니다. 같은 명령으로 재개하세요." }
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
    if ($hadPrevious) { Assert-InstallChild $backup $parent; Remove-Item -LiteralPath $backup -Recurse -Force }
}
function Assert-AppStopped([string]$Directory) {
    if (-not (Test-Path -LiteralPath $Directory)) { return }
    # A process can conceal its image path; testing executable sharing catches locked binaries too.
    foreach ($exe in Get-ChildItem -LiteralPath $Directory -Filter '*.exe' -Recurse -File) {
        try { $stream = [IO.File]::Open($exe.FullName,'Open','ReadWrite','Read'); $stream.Dispose() }
        catch { throw '앱 또는 설치 파일이 사용 중입니다. 트레이 Quit으로 종료한 뒤 재실행하세요. 강제 종료하지 않습니다.' }
    }
}
function Update-InstallerPath {
    $env:PATH = "$env:USERPROFILE/.cargo/bin;" + [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User') + ';' + $env:PATH
}
function Install-SelectedDependencies([string]$Variant, [string]$PnpmVersion, [bool]$AcceptDependencies, [bool]$NonInteractive) {
    $environment = Get-InstallEnvironment $PnpmVersion
    $needs = @($environment["${Variant}Needs"])
    if ($needs.Count) {
        Confirm-InstallAction ("필요 도구: " + ($needs -join '; ') + '. 관리자 권한/UAC 및 재부팅이 필요할 수 있습니다.') $AcceptDependencies $NonInteractive
    }
    if ($Variant -eq 'node') {
        if ($environment.Node -and (Get-NodeMajor $environment.Node) -ne 24) {
            throw '기존 Node는 변경하지 않습니다. Node.js 24를 별도로 준비하여 PATH에서 선택한 뒤 재실행하세요: https://nodejs.org/en/download'
        }
        if (-not $environment.Node) {
            if (-not (Get-Command winget -ErrorAction SilentlyContinue)) { throw 'WinGet이 없습니다. https://nodejs.org/en/download 에서 Node 24를 설치한 뒤 재실행하세요.' }
            Invoke-Checked winget @('install','--id','OpenJS.NodeJS.24','--exact','--source','winget','--accept-source-agreements','--accept-package-agreements')
            Update-InstallerPath
        }
        if ((Get-NodeMajor (Get-ToolVersion node)) -ne 24) { throw 'Node 24를 아직 찾지 못했습니다. 새 터미널에서 재실행하세요.' }
        if ((Get-ToolVersion pnpm) -ne $PnpmVersion) {
            # Keep other projects' global pnpm untouched.
            $toolsDir = Join-Path $env:LOCALAPPDATA "llm-usage-monitor/build-tools/pnpm-$PnpmVersion"
            Invoke-Checked npm @('install','--prefix',$toolsDir,'--no-audit','--no-fund',"pnpm@$PnpmVersion")
            $env:PATH = (Join-Path $toolsDir 'node_modules/.bin') + ';' + $env:PATH
        }
        if ((Get-ToolVersion pnpm) -ne $PnpmVersion) { throw 'pnpm 버전 검증 실패.' }
    } else {
        if (-not (Get-BuildToolsReady)) {
            if (-not (Get-Command winget -ErrorAction SilentlyContinue)) { throw 'WinGet 또는 Microsoft C++ Build Tools 설치가 필요합니다: https://visualstudio.microsoft.com/visual-cpp-build-tools/' }
            Invoke-Checked winget @('install','--id','Microsoft.VisualStudio.2022.BuildTools','--exact','--source','winget','--accept-source-agreements','--accept-package-agreements','--override','--wait --passive --norestart --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended')
        }
        if (-not (Get-ToolVersion rustup)) {
            $download = Join-Path ([IO.Path]::GetTempPath()) ("llm-rustup-" + [guid]::NewGuid().ToString('N') + '.exe')
            try {
                Invoke-WebRequest 'https://static.rust-lang.org/rustup/dist/x86_64-pc-windows-msvc/rustup-init.exe' -OutFile $download -UseBasicParsing
                if ((Get-AuthenticodeSignature -LiteralPath $download).Status -ne 'Valid') { throw 'rustup 설치 프로그램 서명 검증 실패. https://rustup.rs/ 에서 직접 설치하세요.' }
                Invoke-Checked $download @('-y','--default-toolchain','none','--no-modify-path')
            } finally { if (Test-Path -LiteralPath $download) { Remove-Item -LiteralPath $download -Force } }
            Update-InstallerPath
        }
        $stable = & rustup toolchain list
        if (-not ($stable -match '^stable-x86_64-pc-windows-msvc')) {
            Confirm-InstallAction 'Rust stable MSVC를 설치합니다. 기존 전역 기본 toolchain은 유지합니다.' $AcceptDependencies $NonInteractive
            Invoke-Checked rustup @('toolchain','install','stable-x86_64-pc-windows-msvc','--profile','minimal')
        }
        if (-not (Get-BuildToolsReady)) { throw 'C++ Build Tools/Windows SDK 검증 실패. 설치 완료·재부팅 후 다시 실행하세요.' }
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
