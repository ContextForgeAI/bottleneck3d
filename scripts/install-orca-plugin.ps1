# Builds the Orca page and the plugin wheel, then installs it for the current user.
# Usage (from the web app root): powershell -ExecutionPolicy Bypass -File scripts/install-orca-plugin.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$plugin = Join-Path $root 'orca-plugin'
$wheelDir = Join-Path $env:TEMP 'b3d-wheel'
$target = Join-Path $env:APPDATA 'OrcaSlicer\orca_plugins\bottleneck3d'

if (Get-Process orca-slicer -ErrorAction SilentlyContinue) {
  Write-Warning 'OrcaSlicer is running: the new plugin loads after Orca restarts.'
}

Push-Location $root
try {
  npm run build:orca
  if ($LASTEXITCODE -ne 0) { throw 'npm run build:orca failed' }
} finally { Pop-Location }

Push-Location $plugin
try {
  Remove-Item -Recurse -Force $wheelDir -ErrorAction SilentlyContinue
  uv build --wheel --out-dir $wheelDir
  if ($LASTEXITCODE -ne 0) { throw 'uv build failed' }
  Remove-Item -Recurse -Force build -ErrorAction SilentlyContinue
  Get-ChildItem src -Filter *.egg-info -Directory | Remove-Item -Recurse -Force
} finally { Pop-Location }

New-Item -ItemType Directory -Force $target | Out-Null
Remove-Item -Recurse -Force (Join-Path $target '__whl_extracted__') -ErrorAction SilentlyContinue
Get-ChildItem $target -Filter *.whl | Remove-Item -Force
$wheel = Get-ChildItem $wheelDir -Filter *.whl | Select-Object -First 1
Copy-Item $wheel.FullName $target
Write-Host "Installed $($wheel.Name) -> $target"
