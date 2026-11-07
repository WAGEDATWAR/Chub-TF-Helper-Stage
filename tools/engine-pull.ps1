# Pull a new engine (Chimera) release into this repo.
#
# The engine is a pinned git submodule (`chimera-core/`), never edited here. To take a
# fix or feature: pick the release tag, check it out, then commit the pin.
#
#   npm run engine:pull -- v0.2.1
#
# Everything else (tooling, the overlay, the stage) stays in this repo.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

$tag = $args[0]
if (-not $tag) {
  $tag = Read-Host "Engine tag to pin (e.g. v0.2.1)"
}
if (-not $tag) { throw "No tag given." }

$engine = Join-Path $root "chimera-core"
if (-not (Test-Path (Join-Path $engine "core"))) {
  throw "Engine submodule missing. Run: git submodule update --init --recursive"
}

Push-Location $engine
try {
  git fetch --tags origin
  git checkout $tag
  $sha = (git rev-parse --short HEAD)
} finally {
  Pop-Location
}

Write-Host "Pinned engine at $tag ($sha). Now commit the pin:"
Write-Host "  git add chimera-core; git commit -m `"chore(engine): pin Chimera $tag`""
