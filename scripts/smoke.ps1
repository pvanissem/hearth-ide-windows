# End-to-end smoke test: starts the real Electron app with an isolated HOME, starts a SANDBOXED
# shell through the UI, tries to break out of it and prints the result as JSON.
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
& (Join-Path $PSScriptRoot 'build-native.ps1') | Out-Null
$tmp = Join-Path $env:TEMP 'hearth-smoke'
Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force "$tmp\secret", "$tmp\outside" | Out-Null
'TOPSECRET' | Set-Content "$tmp\secret\key.txt"
$secret = "$tmp\secret\key.txt"; $outside = "$tmp\outside\evil.txt"
# The project under test is a throw-away repository (never this one: it contains Electron itself).
$project = "$tmp\project"
New-Item -ItemType Directory -Force $project | Out-Null
'{ "name": "hearth-ide-windows-fixture" }' | Set-Content "$project\package.json"
git -C $project init -q -b main
'hello' | Set-Content "$project\a.txt"
$body = Get-Content (Join-Path $root 'test\smoke-renderer.js') -Raw
"(async()=>{const SMOKE_DIR=String.raw``$project``;const SECRET=String.raw``$secret``;const OUTSIDE=String.raw``$outside``;return await $body})()" |
  Set-Content (Join-Path $tmp 'run.js') -Encoding utf8
$env:HEARTH_HOME = Join-Path $tmp 'home'
$env:HEARTH_SMOKE = Join-Path $tmp 'run.js'
$env:HEARTH_SMOKE_DIR = $project
$env:HEARTH_SHOT = Join-Path $tmp 'shot.png'
$out = Join-Path $tmp 'out.txt'
Start-Process -FilePath (Join-Path $root 'node_modules\electron\dist\electron.exe') -ArgumentList '.' -WorkingDirectory $root `
  -RedirectStandardOutput $out -RedirectStandardError (Join-Path $tmp 'err.txt') -Wait -NoNewWindow
$line = Get-Content $out | Select-String 'SMOKE_RESULT' | Select-Object -Last 1
if (-not $line) { Write-Error 'No smoke result'; exit 1 }
$line.Line
"outside file created by sandbox: $(Test-Path $outside)"
"leftover AppContainer ACEs on project: $((icacls $project | Select-String 'S-1-15-2-[0-9]{5,}').Count)"
Write-Host "Screenshot: $env:HEARTH_SHOT"
