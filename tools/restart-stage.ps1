# Kills any running node dev server, then starts a fresh staging server on 5173.
# Use this instead of re-running `npm run dev:staging` while an old one squats the
# port (which caused "port already in use" and stale-server confusion).
#
#   powershell -ExecutionPolicy Bypass -File tools/restart-stage.ps1
#
# Port 5173 is Chub's own staging-URL default (its renderer hardcodes
# http://localhost:5173/index.html as the fallback), so we serve there over plain
# http to match it exactly.
#
# The server is started **detached** (a separate powershell window, logs to
# stage-dev.log) so this script returns once the port is live instead of blocking
# until the server exits.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$log = Join-Path $root "stage-dev.log"

Write-Host "Killing running node processes..."
Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
# wait for the port to actually free
for ($i = 0; $i -lt 20; $i++) {
  if (-not (Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue)) { break }
  Start-Sleep -Milliseconds 250
}
if (Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue) {
  Write-Warning "Port 5173 is still held; a non-node process may own it."
}

Write-Host "Starting a fresh staging server (http://localhost:5173/), logs -> $log ..."
Start-Process -FilePath "cmd.exe" -ArgumentList "/c", "npm run dev:staging > `"$log`" 2>&1" -WorkingDirectory $root -WindowStyle Hidden

# wait until the server answers, so a caller knows it is ready
$ok = $false
for ($i = 0; $i -lt 40; $i++) {
  Start-Sleep -Milliseconds 500
  try {
    $r = Invoke-WebRequest "http://localhost:5173/index.html" -UseBasicParsing -TimeoutSec 2
    if ($r.StatusCode -eq 200) { $ok = $true; break }
  } catch { }
}
if ($ok) { Write-Host "Staging server is live on http://localhost:5173/" }
else { Write-Warning "Staging server did not answer within 20s; check $log" }
