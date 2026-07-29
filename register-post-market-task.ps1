# ─────────────────────────────────────────────────────────────────────────────
# MarketDNA — Register the daily post-market scheduled task (Windows)
#
# Registers a Windows Scheduled Task that runs post-market-full.ps1 every
# weekday at -Time (LOCAL machine time). NSE closes 15:30 IST; the default 15:45
# leaves a margin. If your machine's clock is NOT IST, set -Time to 15:45 IST in
# your local timezone.
#
# Run ONCE, in an elevated (Administrator) PowerShell:
#   .\register-post-market-task.ps1
#   .\register-post-market-task.ps1 -Time 15:45 -Port 8001
#
# Re-running updates the existing task. To remove:
#   Unregister-ScheduledTask -TaskName "MarketDNA Post-Market" -Confirm:$false
# ─────────────────────────────────────────────────────────────────────────────

param(
    [string]$Time = "15:45",
    [int]$Port = 8001,
    [string]$TaskName = "MarketDNA Post-Market"
)

$root   = $PSScriptRoot
$script = Join-Path $root "post-market-full.ps1"

if (-not (Test-Path $script)) {
    Write-Error "Cannot find $script"; exit 1
}

$action = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$script`" -Port $Port" `
    -WorkingDirectory $root

$trigger = New-ScheduledTaskTrigger `
    -Weekly `
    -DaysOfWeek Monday, Tuesday, Wednesday, Thursday, Friday `
    -At $Time

# Run even if a scheduled start was missed (e.g. machine was asleep at 15:45).
$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 30) `
    -MultipleInstances IgnoreNew

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Description "Runs the MarketDNA end-of-day pipeline: ingest -> invalidate -> snapshot -> jobs." `
    -Force | Out-Null

Write-Output "Registered '$TaskName' — weekdays at $Time (local), backend port $Port."
Write-Output "Run now to test:  Start-ScheduledTask -TaskName `"$TaskName`""
Write-Output "Inspect:          Get-ScheduledTaskInfo -TaskName `"$TaskName`""
Write-Output "Logs:             $($root)\logs\post-market_<date>.log"
