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
$installParent = Join-Path $env:LOCALAPPDATA 'Programs'
$installRoot = Join-Path $installParent 'llm-usage-monitor'
$legacyNative = Join-Path $installParent 'llm-usage-monitor-native'
$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$startupName = 'LLM Usage Monitor'
$oldRun = @{}
$runProperties = try { Get-ItemProperty -LiteralPath $runKey -ErrorAction Stop } catch [System.Management.Automation.ItemNotFoundException] { $null }
foreach ($name in @($startupName,'LLM Usage Monitor Native','llm-usage-monitor','electron.app.LLMUsageMonitor')) {
    $property = if ($null -ne $runProperties) { $runProperties.PSObject.Properties[$name] } else { $null }
    $value = if ($null -ne $property) { $property.Value } else { $null }
    if ($value -and ($value.Contains($installRoot) -or $value.Contains($legacyNative) -or ($name -eq 'LLM Usage Monitor Native' -and $value -match 'llm-usage-monitor\.exe"? --start-hidden$'))) { $oldRun[$name] = $value }
    elseif ($value -and $name -eq $startupName) { throw '공통 자동 시작 이름에 다른 대상이 등록되어 있습니다. 기존 설정을 확인하세요.' }
}
$shell = New-Object -ComObject WScript.Shell
$links = @(
    (Join-Path ([Environment]::GetFolderPath('Programs')) 'LLM Usage Monitor.lnk'),
    (Join-Path ([Environment]::GetFolderPath('Desktop')) 'LLM Usage Monitor.lnk'),
    (Join-Path ([Environment]::GetFolderPath('Startup')) 'LLM Usage Monitor.lnk')
)
$ownedLinks = @{}
$oldEnabled = $oldRun.Count -gt 0
foreach ($link in $links) {
    if (Test-Path -LiteralPath $link) {
        $destination = $shell.CreateShortcut($link).TargetPath
        if ($destination.StartsWith($installRoot + '\',[StringComparison]::OrdinalIgnoreCase) -or $destination.StartsWith($legacyNative + '\',[StringComparison]::OrdinalIgnoreCase)) {
            $ownedLinks[$link] = [IO.File]::ReadAllBytes($link)
            if ($link -eq $links[2]) { $oldEnabled = $true }
        } elseif ($link -eq $links[0]) { throw '다른 대상의 동일 이름 시작 메뉴 바로가기가 있습니다. 기존 바로가기를 확인하세요.' }
    }
}
if ($AutoStart -eq 'preserve' -and -not (Test-Path -LiteralPath $installRoot) -and -not (Test-Path -LiteralPath $legacyNative) -and -not $Uninstall) {
    if ($NonInteractive -or [Console]::IsInputRedirected) { throw '신규 설치는 -AutoStart on 또는 off를 명시하세요.' }
    $AutoStart = Read-Host '로그인 시 자동 시작: on / off'
    if ($AutoStart -notin @('on','off')) { throw 'on 또는 off를 선택하세요.' }
}
$enableStartup = if ($AutoStart -eq 'preserve') { $oldEnabled } else { $AutoStart -eq 'on' }
Confirm-InstallAction "관리 설치본: $installRoot / 작업: $(if ($Uninstall) { '제거' } else { $Variant + ' 설치·교체' }). 이전 버전의 개별 UI 설정은 변환하지 않습니다. 알려진 Native 별도 설치본도 통합합니다." $AcceptInstall $NonInteractive
Assert-InstallChild $installRoot $installParent
Assert-InstallChild $legacyNative $installParent
Assert-AppStopped $installRoot
Assert-AppStopped $legacyNative
# Only migrate a known native app directory, never arbitrary similarly named user data.
if ((Test-Path -LiteralPath $legacyNative) -and -not (Test-Path -LiteralPath (Join-Path $legacyNative 'llm-usage-monitor.exe'))) { throw '별도 Native 설치 경로의 소유권을 확인할 수 없습니다.' }
if ((Test-Path -LiteralPath $installRoot) -and -not (Test-Path -LiteralPath (Join-Path $installRoot 'install-info.json')) -and -not (Test-Path -LiteralPath (Join-Path $installRoot 'LLM Usage Monitor.exe'))) { throw '기존 설치 경로의 앱 소유권을 확인할 수 없습니다.' }
$restoreRegistration = {
    foreach ($name in @($startupName) + @($oldRun.Keys)) { Remove-ItemProperty -LiteralPath $runKey -Name $name -ErrorAction SilentlyContinue }
    foreach ($name in $oldRun.Keys) { New-ItemProperty -LiteralPath $runKey -Name $name -Value $oldRun[$name] -PropertyType String -Force | Out-Null }
    foreach ($link in $ownedLinks.Keys) { [IO.File]::WriteAllBytes($link,$ownedLinks[$link]) }
    if (-not $ownedLinks.ContainsKey($links[0]) -and (Test-Path -LiteralPath $links[0])) { Remove-Item -LiteralPath $links[0] -Force }
}
if (-not $Uninstall) {
    Install-SelectedDependencies $Variant $pnpmVersion $AcceptDependencies $NonInteractive
    $artifact = Build-SelectedApp $Variant $projectRoot
}
New-Item -ItemType Directory -Force -Path $installParent | Out-Null
$stage = Join-Path $installParent ('.llm-install-' + [guid]::NewGuid().ToString('N'))
$legacyBackup = "$legacyNative.backup-$([guid]::NewGuid().ToString('N'))"
try {
    New-Item -ItemType Directory -Path $stage | Out-Null
    if (-not $Uninstall) {
        if ($Variant -eq 'node') { Copy-Item -Path (Join-Path $artifact '*') -Destination $stage -Recurse; $executable = 'LLM Usage Monitor.exe' }
        else { Copy-Item -LiteralPath $artifact -Destination (Join-Path $stage 'llm-usage-monitor.exe'); $executable = 'llm-usage-monitor.exe' }
        if (-not (Test-Path -LiteralPath (Join-Path $stage $executable))) { throw '실행 산출물 검증 실패.' }
        Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'startup.ps1') -Destination $stage
        $revision = 'source-zip'
        if (Get-Command git -ErrorAction SilentlyContinue) { $candidate = & git -C $projectRoot rev-parse --short HEAD 2>$null; if ($LASTEXITCODE -eq 0) { $revision = $candidate } }
        @{schemaVersion=1;appId='llm-usage-monitor';variant=$Variant;version=$package.version;revision=$revision;executable=$executable} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $stage 'install-info.json') -Encoding UTF8
    }
    Assert-AppStopped $installRoot
    Assert-AppStopped $legacyNative
    if (Test-Path -LiteralPath $legacyNative) { Move-Item -LiteralPath $legacyNative -Destination $legacyBackup }
    try {
        Switch-InstallDirectory $stage $installRoot {
            foreach ($name in $oldRun.Keys) { Remove-ItemProperty -LiteralPath $runKey -Name $name }
            foreach ($link in $ownedLinks.Keys) { Remove-Item -LiteralPath $link -Force }
            if (-not $Uninstall) {
                $action = if ($enableStartup) { 'on' } else { 'off' }
                & (Join-Path $installRoot 'startup.ps1') -Action $action | Out-Host
                $shortcut = $shell.CreateShortcut($links[0])
                $shortcut.TargetPath = Join-Path $installRoot $executable
                $shortcut.WorkingDirectory = $installRoot
                $shortcut.Save()
            }
        }
    } catch {
        & $restoreRegistration
        if (Test-Path -LiteralPath $legacyBackup) { Move-Item -LiteralPath $legacyBackup -Destination $legacyNative }
        throw
    }
    if (Test-Path -LiteralPath $legacyBackup) { Assert-InstallChild $legacyBackup $installParent; try { Remove-Item -LiteralPath $legacyBackup -Recurse -Force } catch { Write-Warning "기존 Native 백업 정리가 남았습니다: $legacyBackup" } }
    if ($Uninstall) { Remove-Item -LiteralPath $installRoot; Write-Host '앱 제거 완료. 공유 캐시·인증·개발 도구는 보존했습니다.' }
    else {
        Write-Host "설치 완료: $Variant $($package.version) ($revision) / $(Join-Path $installRoot $executable) / 자동 시작=$enableStartup"
        if (-not $NoStart) { Start-Process -FilePath (Join-Path $installRoot $executable) -WorkingDirectory $installRoot -WindowStyle Hidden }
    }
} finally {
    if (Test-Path -LiteralPath $stage) { Assert-InstallChild $stage $installParent; Remove-Item -LiteralPath $stage -Recurse -Force }
}
