param(
  [Parameter(Mandatory = $true)]
  [string]$ProjectDir,

  [Parameter(Mandatory = $true)]
  [string]$ConfigPath,

  [Parameter(Mandatory = $true)]
  [string]$JobId,

  [Parameter(Mandatory = $true)]
  [string]$TaskName,

  [ValidateSet("once", "persistent")]
  [string]$Mode = "persistent",

  [string]$NodeBin = "node"
)

$ErrorActionPreference = "Continue"
Set-Location $ProjectDir

& $NodeBin (Join-Path $ProjectDir "src\index.js") run --job $JobId --config $ConfigPath
$exitCode = $LASTEXITCODE

if ($Mode -eq "once") {
  try {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction Stop
  } catch {
    Write-Error "Failed to unregister one-shot task '$TaskName': $($_.Exception.Message)"
  }
}

exit $exitCode
