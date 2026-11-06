# End-to-end smoke test: starts the real Electron app with an isolated HOME,
# drives the UI through test/smoke-renderer.js and prints the result as JSON.
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$tmp = Join-Path $env:TEMP 'hearth-smoke'
New-Item -ItemType Directory -Force $tmp | Out-Null
$body = Get-Content (Join-Path $root 'test\smoke-renderer.js') -Raw
"(async()=>{const SMOKE_DIR=String.raw``$root``;return await $body})()" | Set-Content (Join-Path $tmp 'run.js') -Encoding utf8
$env:HEARTH_HOME = Join-Path $tmp 'home'
Remove-Item $env:HEARTH_HOME -Recurse -Force -ErrorAction SilentlyContinue
$env:HEARTH_SMOKE = Join-Path $tmp 'run.js'
$env:HEARTH_SMOKE_DIR = $root
$env:HEARTH_SHOT = Join-Path $tmp 'shot.png'
$out = Join-Path $tmp 'out.txt'
Start-Process -FilePath (Join-Path $root 'node_modules\electron\dist\electron.exe') -ArgumentList '.' -WorkingDirectory $root `
  -RedirectStandardOutput $out -RedirectStandardError (Join-Path $tmp 'err.txt') -Wait -NoNewWindow
$line = Get-Content $out | Select-String 'SMOKE_RESULT' | Select-Object -Last 1
if (-not $line) { Write-Error 'No smoke result'; exit 1 }
$line.Line
Write-Host "Screenshot: $env:HEARTH_SHOT"
