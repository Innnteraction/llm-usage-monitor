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
. (Join-Path $PSScriptRoot 'install-common.ps1')
. (Join-Path $PSScriptRoot 'install-runner.ps1')
Invoke-ManagedInstall @PSBoundParameters
