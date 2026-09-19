# No installed application, real registry, tool installer, vendor CLI or credentials are touched.
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'install-common.ps1')
function Assert($Condition,[string]$Message) { if (-not $Condition) { throw $Message } }
function Must-Fail([scriptblock]$Operation) { $failed=$false; try { & $Operation } catch { $failed=$true }; Assert $failed 'Expected failure' }
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('llm-install-test-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $testRoot | Out-Null
try {
    Assert ((Get-NodeMajor 'v24.1.0') -eq 24) 'Node major'
    Assert ((Get-NodeMajor 'v22.0.0') -eq 22) 'Conflicting Node'
    Must-Fail { Confirm-InstallAction 'No consent test' $false $true }
    Must-Fail { Assert-InstallChild (Split-Path -Parent $testRoot) $testRoot }
    $target = Join-Path $testRoot '설치 App'
    foreach ($variant in @('node','rust','node','node')) {
        $stage=Join-Path $testRoot ('stage-'+[guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $stage | Out-Null
        Set-Content -LiteralPath (Join-Path $stage 'variant') -Value $variant
        Switch-InstallDirectory $stage $target { }
        Assert ((Get-Content -LiteralPath (Join-Path $target 'variant')) -eq $variant) 'Switch result'
        Assert (@(Get-ChildItem -LiteralPath $testRoot -Directory).Count -eq 1) 'Only one installed app'
    }
    $stage=Join-Path $testRoot 'failed-stage'
    New-Item -ItemType Directory -Path $stage | Out-Null
    Set-Content -LiteralPath (Join-Path $stage 'variant') -Value rust
    Must-Fail { Switch-InstallDirectory $stage $target { throw 'Synthetic registration failure' } }
    Assert ((Get-Content -LiteralPath (Join-Path $target 'variant')) -eq 'node') 'Rollback preserves previous app'
    Must-Fail { Switch-InstallDirectory (Join-Path $testRoot 'missing-source') $target { } }
    Assert ((Get-Content -LiteralPath (Join-Path $target 'variant')) -eq 'node') 'Missing artifact rollback'
    Set-Content -LiteralPath (Join-Path $target 'locked.exe') -Value fake
    $lock=[IO.File]::Open((Join-Path $target 'locked.exe'),'Open','Read','None')
    try { Must-Fail { Assert-AppStopped $target } } finally { $lock.Dispose() }
    Assert-AppStopped $target
    # Common startup helper against a fake registry, exercising Unicode/spaces and identity.
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'startup.ps1') -Destination $target
    @{schemaVersion=1;appId='llm-usage-monitor';variant='rust';executable='locked.exe'} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $target 'install-info.json') -Encoding UTF8
    $global:installTestRegistry=$null
    function Get-ItemPropertyValue { param($LiteralPath,$Name,$ErrorAction); return $global:installTestRegistry }
    function New-ItemProperty { param($LiteralPath,$Name,$Value,$PropertyType,[switch]$Force); $global:installTestRegistry=$Value }
    function Remove-ItemProperty { param($LiteralPath,$Name); $global:installTestRegistry=$null }
    function New-Item { param($Path,[switch]$Force); Assert ($Path -like 'HKCU:*') 'Only fake registry creation allowed' }
    $helper=Join-Path $target 'startup.ps1'
    Assert ((& $helper -Action query) -eq 'false') 'Startup initially off'
    Assert ((& $helper -Action on) -eq 'true') 'Startup enabled'
    Assert ($global:installTestRegistry -eq ('"'+(Join-Path $target 'locked.exe')+'" --start-hidden')) 'Quoted executable'
    Assert ((& $helper -Action off) -eq 'false') 'Startup disabled'
    $global:installTestRegistry='"C:\Other\App.exe"'
    Assert ((& $helper -Action off) -eq 'false') 'Foreign registration preserved'
    Assert ($global:installTestRegistry -eq '"C:\Other\App.exe"') 'Do not erase foreign entry'
    Must-Fail { & $helper -Action on -Executable 'C:\Other\App.exe' }
    Write-Host 'PASS: selection consent, transitions, rollback, locked executable, paths and startup identity.'
} finally {
    Assert-InstallChild $testRoot ([IO.Path]::GetTempPath())
    Remove-Item -LiteralPath $testRoot -Recurse -Force
}
