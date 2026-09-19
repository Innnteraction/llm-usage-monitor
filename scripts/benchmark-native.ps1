param(
    [string]$Executable = (Join-Path $PSScriptRoot '../target/release/llm-usage-monitor.exe'),
    [ValidateRange(3, 60)][int]$Samples = 10,
    [string]$Output = (Join-Path $PSScriptRoot '../.work/native-memory-results.json')
)
$ErrorActionPreference = 'Stop'
$resolvedExe = (Resolve-Path -LiteralPath $Executable).Path
$results = @()
foreach ($mode in @('visible', 'tray', 'tray-after-close')) {
    $arguments = @('--demo', "--quit-after=$($Samples + 15)")
    if ($mode -eq 'tray') { $arguments += '--start-hidden' }
    if ($mode -eq 'tray-after-close') { $arguments += '--hide-after=1' }
    $process = Start-Process -FilePath $resolvedExe -ArgumentList $arguments -WindowStyle Hidden -PassThru
    try {
        Start-Sleep -Seconds 3
        $process.Refresh()
        if ($process.HasExited) { throw "Native process exited before sampling ($mode)" }
        $cpuStart = $process.TotalProcessorTime.TotalSeconds
        $clock = [Diagnostics.Stopwatch]::StartNew()
        $measurements = @()
        for ($i = 0; $i -lt $Samples; $i++) {
            Start-Sleep -Seconds 1
            $process.Refresh()
            if ($process.HasExited) { throw "Native process exited while sampling ($mode)" }
            $measurements += [pscustomobject]@{
                workingSetMiB = [math]::Round($process.WorkingSet64 / 1MB, 2)
                privateMiB = [math]::Round($process.PrivateMemorySize64 / 1MB, 2)
            }
        }
        $cpuPercentOneCore = 100 * ($process.TotalProcessorTime.TotalSeconds - $cpuStart) / $clock.Elapsed.TotalSeconds
        $results += [pscustomobject]@{
            mode = $mode
            workload = 'synthetic snapshot; no vendor CLI, network or real logs'
            samples = $measurements
            cpuPercentOneCore = [math]::Round($cpuPercentOneCore, 3)
            targetWorkingSetMiB = if ($mode -eq 'visible') { 35 } else { 20 }
            withinTarget = (($measurements.workingSetMiB | Measure-Object -Maximum).Maximum -le $(if ($mode -eq 'visible') { 35 } else { 20 }))
        }
        if (-not $process.WaitForExit(20000)) { throw 'Native process did not honor --quit-after' }
        if ($process.ExitCode -ne 0) { throw "Native process exit code: $($process.ExitCode)" }
        $results | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $Output -Encoding utf8
    } finally {
        $process.Refresh()
        if (-not $process.HasExited) { Stop-Process -Id $process.Id }
        $process.Dispose()
    }
}
$results | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $Output -Encoding utf8
$results | Select-Object mode,cpuPercentOneCore,withinTarget | Format-Table
