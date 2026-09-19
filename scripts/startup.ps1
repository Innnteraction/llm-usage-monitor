param([ValidateSet('query','on','off')][string]$Action = 'query', [string]$Executable)
$ErrorActionPreference = 'Stop'
$manifest = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'install-info.json') -Raw | ConvertFrom-Json
$target = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot $manifest.executable))
if ($manifest.schemaVersion -ne 1 -or $manifest.appId -ne 'llm-usage-monitor' -or
    -not $target.StartsWith($PSScriptRoot + [IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase) -or
    ($Executable -and [IO.Path]::GetFullPath($Executable) -ne $target) -or -not (Test-Path -LiteralPath $target)) {
    throw 'Managed installation identity mismatch.'
}
$key = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$name = 'LLM Usage Monitor'
$command = '"' + $target + '" --start-hidden'
function Read-StartupCommand {
    $properties = try { Get-ItemProperty -LiteralPath $key -ErrorAction Stop } catch [System.Management.Automation.ItemNotFoundException] { $null }
    $property = if ($null -ne $properties) { $properties.PSObject.Properties[$name] } else { $null }
    if ($null -ne $property) { $property.Value }
}
$current = Read-StartupCommand
if ($Action -eq 'on') {
    New-Item -Path $key -Force | Out-Null
    New-ItemProperty -LiteralPath $key -Name $name -Value $command -PropertyType String -Force | Out-Null
} elseif ($Action -eq 'off' -and $current -eq $command) {
    Remove-ItemProperty -LiteralPath $key -Name $name
}
$actual = Read-StartupCommand
if ($Action -eq 'on' -and $actual -ne $command) { throw 'Startup registration verification failed.' }
if ($Action -eq 'off' -and $actual -eq $command) { throw 'Startup removal verification failed.' }
if ($actual -eq $command) { 'true' } else { 'false' }
