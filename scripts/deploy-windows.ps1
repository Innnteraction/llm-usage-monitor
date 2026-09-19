# Compatibility entry point: one managed installation only.
[CmdletBinding()]
param([switch]$AutoStart,[switch]$SkipBuild,[switch]$NoStart,[switch]$Uninstall,[switch]$CreateDesktopShortcut,[string]$InstallDir)
if ($InstallDir -or $CreateDesktopShortcut) { throw 'Custom paths/desktop shortcuts are no longer supported. Use scripts/install.ps1.' }
if ($SkipBuild) { Write-Warning 'SkipBuild now performs a verified incremental build to avoid installing stale output.' }
$forward = @{ Variant='node'; NoStart=$NoStart; Uninstall=$Uninstall }
if ($AutoStart) { $forward.AutoStart='on' }
& (Join-Path $PSScriptRoot 'install.ps1') @forward
