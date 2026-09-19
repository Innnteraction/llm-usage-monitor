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
