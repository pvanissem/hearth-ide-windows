# Drives the features ported from the macOS app in the real app, with a temporary Git project and an isolated HOME.
#   powershell -File scripts/smoke-features.ps1
$root = Split-Path $PSScriptRoot -Parent
$tmp = Join-Path $env:TEMP 'hearth-smoke-features'
Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
$project = Join-Path $tmp 'project'
New-Item -ItemType Directory -Force $project | Out-Null
Push-Location $project
git init -q -b main 2>$null; git config user.email smoke@example.com; git config user.name Smoke
Set-Content -Path (Join-Path $project 'readme.md') -Value "# Demo`nline two" -Encoding utf8
git add . ; git commit -qm "First commit" 2>$null
Add-Content -Path (Join-Path $project 'readme.md') -Value 'added line' -Encoding utf8
Pop-Location
$body = Get-Content (Join-Path $root 'test\smoke-features.js') -Raw
"(async()=>{const PROJECT=String.raw``$project``;return await $body})()" | Set-Content (Join-Path $tmp 'run.js') -Encoding utf8
$env:HEARTH_HOME = Join-Path $tmp 'home'
$env:HEARTH_SMOKE = Join-Path $tmp 'run.js'
$env:HEARTH_SMOKE_DIR = $project
$env:HEARTH_SHOT = Join-Path $tmp 'shot.png'
$out = Join-Path $tmp 'out.txt'
Start-Process -FilePath (Join-Path $root 'node_modules\electron\dist\electron.exe') -ArgumentList '.' -WorkingDirectory $root `
  -RedirectStandardOutput $out -RedirectStandardError (Join-Path $tmp 'err.txt') -Wait -NoNewWindow
(Get-Content $out | Select-String 'SMOKE_RESULT' | Select-Object -Last 1).Line
"Screenshots: $tmp"
