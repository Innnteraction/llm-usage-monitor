[CmdletBinding()]
param(
    [ValidateSet('node','rust')][string]$Variant,
    [switch]$Check,
    [switch]$NonInteractive,
    [switch]$AcceptInstall,
    [switch]$AcceptDependencies,
    [ValidateSet('preserve','on','off')][string]$AutoStart = 'preserve',
    [switch]$NoStart,
    [switch]$Uninstall
)
. (Join-Path $PSScriptRoot 'install-common.ps1')
$projectRoot = Split-Path -Parent $PSScriptRoot
if ($env:OS -ne 'Windows_NT' -or $env:PROCESSOR_ARCHITECTURE -ne 'AMD64' -or $env:PROCESSOR_ARCHITEW6432) {
    throw 'Windows x64의 64-bit PowerShell에서 실행하세요. Windows ARM64/WSL은 지원하지 않습니다.'
}
$package = Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json
$pnpmVersion = $package.packageManager -replace '^pnpm@',''
$environment = Get-InstallEnvironment $pnpmVersion
Show-InstallComparison $environment
if ($Check) { return }
if (-not $Variant -and -not $Uninstall) {
    if ($NonInteractive -or [Console]::IsInputRedirected) { throw '-Variant node 또는 rust를 명시하세요.' }
    $Variant = Read-Host '설치할 버전을 입력하세요: node / rust (기본 선택 없음)'
    if ($Variant -notin @('node','rust')) { throw 'node 또는 rust를 선택하세요.' }
}
throw '설치 실행 계층을 준비 중입니다. 현재 -Check 환경 검사를 사용할 수 있습니다.'
