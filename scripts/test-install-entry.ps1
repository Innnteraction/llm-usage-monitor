# Runs the production installer orchestration with synthetic OS adapters.
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'install-common.ps1')
. (Join-Path $PSScriptRoot 'install-runner.ps1')
function Assert($Condition,$Message) { if (-not $Condition) { throw $Message } }
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('llm-entry-' + [guid]::NewGuid().ToString('N'))
$previousLocal = $env:LOCALAPPDATA
$global:entryTest_registry = @{}
$global:entryTest_buildFailure = $false
$global:entryTest_registrationFailure = $false
$global:entryTest_dependencies = @()
try {
    $env:LOCALAPPDATA = Join-Path $testRoot 'Unicode 설치 App'
    $global:entryTest_linkPaths = @('Programs','Desktop','Startup') | ForEach-Object { Join-Path $env:LOCALAPPDATA "$_.lnk" }
    $global:entryTest_artifact = Join-Path $testRoot 'artifact'
    New-Item -ItemType Directory -Path $global:entryTest_artifact -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $global:entryTest_artifact 'LLM Usage Monitor.exe') -Value 'synthetic node'
    Set-Content -LiteralPath (Join-Path $global:entryTest_artifact 'rust.exe') -Value 'synthetic rust'
    function Get-InstallEnvironment { return @{} }
    function Show-InstallComparison { }
    function Install-SelectedDependencies($Variant) { $global:entryTest_dependencies += $Variant }
    function Build-SelectedApp($Variant) {
        if ($global:entryTest_buildFailure) { throw 'Synthetic build failure' }
        if ($Variant -eq 'node') { return $global:entryTest_artifact }
        return (Join-Path $global:entryTest_artifact 'rust.exe')
    }
    function Get-InstallShortcutPaths { return $global:entryTest_linkPaths }
    function Get-InstallShortcutShell {
        $shell = New-Object PSObject
        $shell | Add-Member ScriptMethod CreateShortcut {
            param($File)
            $target = if (Test-Path -LiteralPath $File) { [IO.File]::ReadAllText($File) } else { '' }
            $link = [pscustomobject]@{ File=$File; TargetPath=$target; WorkingDirectory='' }
            $link | Add-Member ScriptMethod Save { [IO.File]::WriteAllText($this.File,$this.TargetPath) }
            return $link
        }
        return $shell
    }
    function Get-ItemProperty { param($LiteralPath,$ErrorAction); Assert ($LiteralPath -like 'HKCU:*') 'Unexpected registry read'; return [pscustomobject]$global:entryTest_registry }
    function New-ItemProperty {
        param($LiteralPath,$Name,$Value,$PropertyType,[switch]$Force)
        if ($global:entryTest_registrationFailure) { $global:entryTest_registrationFailure=$false; throw 'Synthetic registration failure' }
        $global:entryTest_registry[$Name]=$Value
    }
    function Remove-ItemProperty { param($LiteralPath,$Name,$ErrorAction); $global:entryTest_registry.Remove($Name) }
    function New-Item {
        param($Path,$ItemType,[switch]$Force)
        if ($Path -like 'HKCU:*') { return }
        Microsoft.PowerShell.Management\New-Item -Path $Path -ItemType $ItemType -Force:$Force
    }
    function Start-Process { throw 'Tests must never launch the installed app' }
    $root = Join-Path $env:LOCALAPPDATA 'Programs/llm-usage-monitor'
    foreach ($variant in @('n','r','n','node')) {
        Invoke-ManagedInstall -Variant $variant -AcceptInstall -NonInteractive -AutoStart on -NoStart
        $expected = Resolve-InstallVariant $variant
        $info = Get-Content -LiteralPath (Join-Path $root 'install-info.json') -Raw | ConvertFrom-Json
        Assert ($info.variant -eq $expected) 'Installed manifest variant'
        Assert ($global:entryTest_registry.Count -eq 1) 'Only one startup entry'
        Assert ([IO.File]::ReadAllText($global:entryTest_linkPaths[0]) -eq (Join-Path $root $info.executable)) 'Shortcut follows replacement'
        Assert (@(Get-ChildItem -LiteralPath (Split-Path -Parent $root) -Directory).Count -eq 1) 'Only one managed app'
    }
    foreach ($failure in @('buildFailure','registrationFailure')) {
        $oldManifest = [IO.File]::ReadAllText((Join-Path $root 'install-info.json'))
        $oldRegistration = $global:entryTest_registry['LLM Usage Monitor']
        Set-Variable -Name ('entryTest_'+$failure) -Value $true -Scope Global
        $failed=$false
        try { Invoke-ManagedInstall -Variant rust -AcceptInstall -NonInteractive -AutoStart preserve -NoStart } catch { $failed=$true }
        Set-Variable -Name ('entryTest_'+$failure) -Value $false -Scope Global
        Assert $failed 'Expected synthetic failure'
        Assert ([IO.File]::ReadAllText((Join-Path $root 'install-info.json')) -eq $oldManifest) 'Previous app preserved'
        Assert ($global:entryTest_registry['LLM Usage Monitor'] -eq $oldRegistration) 'Previous startup preserved'
        Assert ([IO.File]::ReadAllText($global:entryTest_linkPaths[0]) -eq (Join-Path $root 'LLM Usage Monitor.exe')) 'Previous shortcut preserved'
    }
    Invoke-ManagedInstall -Uninstall -AcceptInstall -NonInteractive -NoStart
    Assert (-not (Test-Path -LiteralPath $root)) 'Uninstalled app'
    Assert ($global:entryTest_registry.Count -eq 0) 'Removed startup'
    Assert (-not (Test-Path -LiteralPath $global:entryTest_linkPaths[0])) 'Removed shortcut'
    Write-Host 'PASS: production entry orchestration, transitions, update, build/registration rollback and uninstall.'
} finally {
    Remove-Variable -Name entryTest_* -Scope Global -ErrorAction SilentlyContinue
    $env:LOCALAPPDATA=$previousLocal
    Assert-InstallChild $testRoot ([IO.Path]::GetTempPath())
    if (Test-Path -LiteralPath $testRoot) { Remove-Item -LiteralPath $testRoot -Recurse -Force }
}
