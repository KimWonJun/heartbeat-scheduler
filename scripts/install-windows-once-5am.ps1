param(
  [string]$ProjectDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
  [string]$ConfigPath = "",
  [string]$NodeBin = "node"
)

if ([string]::IsNullOrWhiteSpace($ConfigPath)) {
  $ConfigPath = Join-Path $ProjectDir "config.5am-once.json"
}

$runDate = (Get-Date).Date.AddHours(5)
if ($runDate -le (Get-Date)) {
  $runDate = $runDate.AddDays(1)
}

$jobs = @(
  @{ Id = "claude-5am-once"; Name = "CLI Heartbeat Scheduler Claude 5AM Once" },
  @{ Id = "codex-5am-once"; Name = "CLI Heartbeat Scheduler Codex 5AM Once" }
)

foreach ($job in $jobs) {
  $args = "`"$ProjectDir\src\index.js`" run --job $($job.Id) --config `"$ConfigPath`""
  $action = New-ScheduledTaskAction -Execute $NodeBin -Argument $args -WorkingDirectory $ProjectDir
  $trigger = New-ScheduledTaskTrigger -Once -At $runDate
  Register-ScheduledTask -TaskName $job.Name -Action $action -Trigger $trigger -Description "One-shot local CLI heartbeat run" -Force | Out-Null
  Write-Output "installed $($job.Name) for $runDate"
}
