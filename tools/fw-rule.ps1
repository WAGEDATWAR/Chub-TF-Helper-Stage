# Adds the inbound firewall rule the stage's staging URL needs.
# Run in an *Administrator* PowerShell, or via the scheduled-task trick in STAGING.md.
$port = 5173
if (-not (Get-NetFirewallRule -DisplayName "ViteStage$port" -ErrorAction SilentlyContinue)) {
  New-NetFirewallRule -DisplayName "ViteStage$port" -Direction Inbound -Action Allow -Protocol TCP -LocalPort $port -Profile Any
  Write-Host "Added inbound allow for TCP $port"
} else {
  Write-Host "Rule 'ViteStage$port' already exists"
}
