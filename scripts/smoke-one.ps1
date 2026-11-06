# Runs one renderer script (default: test/smoke-shift.js) in the real app with an isolated HOME.
# The script may use REPO_FILE (a file of this repository, opened as workspace).
#   powershell -File scripts/smoke-one.ps1 [path-to-script]
param([string]$Script = 'test\smoke-shift.js')
$root = Split-Path $PSScriptRoot -Parent
$tmp = Join-Path $env:TEMP 'hearth-smoke-one'
Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $tmp | Out-Null
$repoFile = Join-Path $root 'src\main\paths.js'
$body = Get-Content (Join-Path $root $Script) -Raw
"(async()=>{const REPO_FILE=String.raw``$repoFile``;return await $body})()" | Set-Content (Join-Path $tmp 'run.js') -Encoding utf8
$env:HEARTH_HOME = Join-Path $tmp 'home'
$env:HEARTH_SMOKE = Join-Path $tmp 'run.js'
$env:HEARTH_SMOKE_DIR = $root
$env:HEARTH_SHOT = Join-Path $tmp 'shot.png'
$out = Join-Path $tmp 'out.txt'
Start-Process -FilePath (Join-Path $root 'node_modules\electron\dist\electron.exe') -ArgumentList '.' -WorkingDirectory $root `
  -RedirectStandardOutput $out -RedirectStandardError (Join-Path $tmp 'err.txt') -Wait -NoNewWindow
(Get-Content $out | Select-String 'SMOKE_RESULT' | Select-Object -Last 1).Line
