# Refresh the committed `vendor/` copy of the parent game's `core/` + `data/`.
#
# The helper imports the parent core so there is one source of truth and zero drift,
# but CI has no sibling folder. So the parent's `core/` and `data/` are committed
# under `vendor/` and the aliases (@core, @gamedata) point there. Run this after
# changing the parent, and commit the result.
#
#   npm run sync:vendor
#
# Override the sibling location with $env:CHRYSALIS_HOME if it is not the default.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

$parent = $env:CHRYSALIS_HOME
if (-not $parent) {
  $parent = Join-Path (Split-Path -Parent (Split-Path -Parent $root)) "Game Projects\Chrysalis"
}
if (-not (Test-Path (Join-Path $parent "core"))) {
  throw "Parent core not found at '$parent'. Set `$env:CHRYSALIS_HOME to the parent game folder."
}

$dst = Join-Path $root "vendor"
Write-Host "Syncing parent core + data from '$parent' -> '$dst' ..."
foreach ($sub in @("core", "data")) {
  $target = Join-Path $dst $sub
  if (Test-Path $target) { Remove-Item $target -Recurse -Force }
  Copy-Item (Join-Path $parent $sub) -Destination $target -Recurse -Force
}
$core = (Get-ChildItem (Join-Path $dst "core") -Recurse -File).Count
$data = (Get-ChildItem (Join-Path $dst "data") -Recurse -File).Count
Write-Host "Vendored $core core file(s), $data data file(s). Commit the change."
