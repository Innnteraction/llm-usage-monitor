# No installed application, real registry, tool installer, vendor CLI or credentials are touched.
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../install-common.ps1')
function Assert($Condition,[string]$Message) { if (-not $Condition) { throw $Message } }
function Must-Fail([scriptblock]$Operation) { $failed=$false; try { & $Operation } catch { $failed=$true }; Assert $failed 'Expected failure' }
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('llm-install-test-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $testRoot | Out-Null
try {
    foreach ($value in @('n','N','node','NODE',' node ')) { Assert ((Resolve-InstallVariant $value) -eq 'node') 'Node aliases' }
    foreach ($value in @('r','R','rust','RUST',' rust ')) { Assert ((Resolve-InstallVariant $value) -eq 'rust') 'Rust aliases' }
    Must-Fail { Resolve-InstallVariant '' }
    Must-Fail { Resolve-InstallVariant 'other' }
    Assert ((Get-NodeMajor 'v24.1.0') -eq 24) 'Node major'
    Assert ((Get-NodeMajor 'v22.0.0') -eq 22) 'Conflicting Node'
    Must-Fail { Confirm-InstallAction 'No consent test' $false $true }
    & {
        # Dependency scenarios call the real orchestration with all installers replaced.
        $global:installTestCalls = @()
        function Get-ToolVersion([string]$Name) {
            if ($Name -eq 'node') { return $global:installTestNode }
            if ($Name -eq 'pnpm') { return $null }
            return 'fake'
        }
        function Get-BuildToolsReady { return $true }
        function Invoke-Checked([string]$File,[string[]]$Arguments) {
            $global:installTestCalls += $File
            throw 'Synthetic download/installer failure'
        }
        $global:installTestNode = 'v22.1.0'
        Must-Fail { Install-SelectedDependencies node 9.15.9 $true $true }
        Assert ($global:installTestCalls.Count -eq 0) 'Incompatible Node must not be replaced'
        $global:installTestNode = 'v24.1.0'
        Must-Fail { Install-SelectedDependencies node 9.15.9 $false $true }
        Assert ($global:installTestCalls.Count -eq 0) 'No installer without dependency consent'
        Must-Fail { Install-SelectedDependencies node 9.15.9 $true $true }
        Assert ($global:installTestCalls -contains 'npm') 'Download failure reached fake installer'
    }
    & {
        # Exercise the actual rustup download branch without network or tool installation.
        $global:installTestRustLock = $null
        $global:installTestRustDownload = $null
        function Get-ToolVersion([string]$Name) { if ($Name -ne 'rustup') { return 'fake' } }
        function Get-BuildToolsReady { return $true }
        function Invoke-WebRequest {
            param($Uri,$OutFile,[switch]$UseBasicParsing)
            if ($OutFile) {
                $global:installTestRustDownload = $OutFile
                [IO.File]::WriteAllText($OutFile,'Synthetic installer')
            } else {
                return @{ Content = (Get-FileHash -LiteralPath $global:installTestRustDownload -Algorithm SHA256).Hash + '  rustup-init.exe' }
            }
        }
        function Invoke-Checked([string]$File,[string[]]$Arguments) {
            Assert ((Split-Path -Leaf $File) -eq 'rustup-init.exe') 'rustup installer filename must be preserved'
            Assert ($Arguments -contains '--no-modify-path') 'Preserve global PATH'
            $global:installTestRustLock = [IO.File]::Open($File,'Open','Read','None')
            throw 'Synthetic rustup installation failure'
        }
        try {
            $failure = ''
            try { Install-SelectedDependencies rust 9.15.9 $true $true }
            catch { $failure = $_.Exception.Message }
            Assert ($failure -eq 'Synthetic rustup installation failure') 'Cleanup must preserve the original installer error'
            Assert (Test-Path -LiteralPath $global:installTestRustDownload) 'Locked installer must be preserved'
        } finally {
            if ($global:installTestRustLock) { $global:installTestRustLock.Dispose() }
            if ($global:installTestRustDownload) {
                $directory = Split-Path -Parent $global:installTestRustDownload
                Assert-InstallChild $directory ([IO.Path]::GetTempPath())
                Remove-Item -LiteralPath $directory -Recurse -Force
            }
        }
    }
    Must-Fail { Invoke-Checked powershell.exe @('-NoProfile','-Command','exit 3010') }
    Must-Fail { Invoke-Checked powershell.exe @('-NoProfile','-Command','exit 1') }
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
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot '../startup.ps1') -Destination $target
    @{schemaVersion=1;appId='llm-usage-monitor';variant='rust';executable='locked.exe'} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $target 'install-info.json') -Encoding UTF8
    $global:installTestRegistry=$null
    function Get-ItemProperty {
        param($LiteralPath,$ErrorAction)
        if ($global:installTestReadError) { throw $global:installTestReadError }
        $values = @{}
        if ($null -ne $global:installTestRegistry) { $values['LLM Usage Monitor'] = $global:installTestRegistry }
        return [pscustomobject]$values
    }
    function New-ItemProperty { param($LiteralPath,$Name,$Value,$PropertyType,[switch]$Force); $global:installTestRegistry=$Value }
    function Remove-ItemProperty { param($LiteralPath,$Name); $global:installTestRegistry=$null }
    function New-Item { param($Path,[switch]$Force); Assert ($Path -like 'HKCU:*') 'Only fake registry creation allowed' }
    $helper=Join-Path $target 'startup.ps1'
    $global:installTestReadError = [System.Management.Automation.ItemNotFoundException]::new('Synthetic missing Run key')
    Assert ((& $helper -Action query) -eq 'false') 'Missing Run key means startup off'
    $global:installTestReadError = [UnauthorizedAccessException]::new('Synthetic registry access denied')
    Must-Fail { & $helper -Action query }
    $global:installTestReadError = $null
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
    Remove-Variable installTestRegistry,installTestReadError,installTestCalls,installTestNode,installTestRustDownload,installTestRustLock -Scope Global -ErrorAction SilentlyContinue
}
