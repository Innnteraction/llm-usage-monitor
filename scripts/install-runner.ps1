function Get-InstallShortcutShell { New-Object -ComObject WScript.Shell }
function Get-InstallShortcutPaths {
return @(
    (Join-Path ([Environment]::GetFolderPath('Programs')) 'LLM Usage Monitor.lnk'),
    (Join-Path ([Environment]::GetFolderPath('Desktop')) 'LLM Usage Monitor.lnk'),
    (Join-Path ([Environment]::GetFolderPath('Startup')) 'LLM Usage Monitor.lnk')
)
}

function Invoke-ManagedInstall {
[CmdletBinding()]
param(
    [ValidateSet('node','rust','n','r')][string]$Variant,
    [switch]$Check,
    [switch]$NonInteractive,
    [switch]$AcceptInstall,
    [switch]$AcceptDependencies,
    [ValidateSet('preserve','on','off')][string]$AutoStart = 'preserve',
    [switch]$NoStart,
    [switch]$Uninstall
)
$projectRoot = Split-Path -Parent $PSScriptRoot
if ($env:OS -ne 'Windows_NT' -or $env:PROCESSOR_ARCHITECTURE -ne 'AMD64' -or $env:PROCESSOR_ARCHITEW6432) {
    throw 'Run in 64-bit PowerShell on Windows x64. Windows ARM64 and WSL are not supported.'
}
$package = Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json
$pnpmVersion = $package.packageManager -replace '^pnpm@',''
$environment = Get-InstallEnvironment $pnpmVersion
Show-InstallComparison $environment
if ($Check) { return }
if (-not $Variant -and -not $Uninstall) {
    if ($NonInteractive -or [Console]::IsInputRedirected) { throw 'Specify -Variant node (n) or rust (r).' }
    $Variant = Read-Host 'Choose a version: node (n) / rust (r), no default'
}
if ($Variant) { $Variant = Resolve-InstallVariant $Variant }
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
    elseif ($value -and $name -eq $startupName) { throw 'The shared startup entry belongs to another application. Check the existing registration.' }
}
$shell = Get-InstallShortcutShell
$links = Get-InstallShortcutPaths
$ownedLinks = @{}
$oldEnabled = $oldRun.Count -gt 0
foreach ($link in $links) {
    if (Test-Path -LiteralPath $link) {
        $destination = $shell.CreateShortcut($link).TargetPath
        if ($destination.StartsWith($installRoot + '\',[StringComparison]::OrdinalIgnoreCase) -or $destination.StartsWith($legacyNative + '\',[StringComparison]::OrdinalIgnoreCase)) {
            $ownedLinks[$link] = [IO.File]::ReadAllBytes($link)
            if ($link -eq $links[2]) { $oldEnabled = $true }
        } elseif ($link -eq $links[0]) { throw 'A Start menu shortcut with this name points elsewhere. Check the existing shortcut.' }
    }
}
if ($AutoStart -eq 'preserve' -and -not (Test-Path -LiteralPath $installRoot) -and -not (Test-Path -LiteralPath $legacyNative) -and -not $Uninstall) {
    if ($NonInteractive -or [Console]::IsInputRedirected) { throw 'New installations require -AutoStart on or off.' }
    $AutoStart = Read-Host 'Start at login: on / off'
    if ($AutoStart -notin @('on','off')) { throw 'Choose on or off.' }
}
$enableStartup = if ($AutoStart -eq 'preserve') { $oldEnabled } else { $AutoStart -eq 'on' }
Confirm-InstallAction "Managed installation: $installRoot / action: $(if ($Uninstall) { 'uninstall' } else { $Variant + ' install/replace' }). Previous per-version UI preferences are not converted. Known separate Native installations will be consolidated." $AcceptInstall $NonInteractive
Assert-InstallChild $installRoot $installParent
Assert-InstallChild $legacyNative $installParent
Assert-AppStopped $installRoot
Assert-AppStopped $legacyNative
# Only migrate a known native app directory, never arbitrary similarly named user data.
if ((Test-Path -LiteralPath $legacyNative) -and -not (Test-Path -LiteralPath (Join-Path $legacyNative 'llm-usage-monitor.exe'))) { throw 'Cannot verify ownership of the separate Native installation.' }
if ((Test-Path -LiteralPath $installRoot) -and -not (Test-Path -LiteralPath (Join-Path $installRoot 'install-info.json')) -and -not (Test-Path -LiteralPath (Join-Path $installRoot 'LLM Usage Monitor.exe'))) { throw 'Cannot verify ownership of the existing installation.' }
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
        if (-not (Test-Path -LiteralPath (Join-Path $stage $executable))) { throw 'Built application validation failed.' }
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
                & (Join-Path $installRoot 'startup.ps1') -Action $action | Out-Null
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
    if (Test-Path -LiteralPath $legacyBackup) { Assert-InstallChild $legacyBackup $installParent; try { Remove-Item -LiteralPath $legacyBackup -Recurse -Force } catch { Write-Warning "Previous Native backup cleanup remains: $legacyBackup" } }
    if ($Uninstall) { Remove-Item -LiteralPath $installRoot; Write-Host 'App removed. Shared cache, credentials and development tools were preserved.' }
    else {
        Write-Host "Installation complete: $Variant $($package.version) ($revision) / $(Join-Path $installRoot $executable) / start at login=$enableStartup"
        if (-not $NoStart) { Start-Process -FilePath (Join-Path $installRoot $executable) -WorkingDirectory $installRoot -WindowStyle Hidden }
    }
} finally {
    if (Test-Path -LiteralPath $stage) { Assert-InstallChild $stage $installParent; Remove-Item -LiteralPath $stage -Recurse -Force }
}

}
