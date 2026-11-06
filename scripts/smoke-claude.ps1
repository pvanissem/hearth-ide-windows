# Starts Claude Code through the real session path in a throw-away project and prints what happened.
#   powershell -File scripts/smoke-claude.ps1 [-Packaged] [-CleanPath]
param([switch]$Packaged, [switch]$CleanPath, [string]$Project, [string]$Script = 'test\smoke-claude.js')   # -CleanPath: only the system PATH (like a shortcut after a fresh login); -Project: use this folder instead of a throw-away one
$root = Split-Path $PSScriptRoot -Parent
$tmp = Join-Path $env:TEMP 'hearth-smoke-claude'
Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $tmp | Out-Null
if ($Project) { $project = $Project } else { $project = "$tmp\project"; New-Item -ItemType Directory -Force $project | Out-Null; git -C $project init -q -b main }
$body = Get-Content (Join-Path $root $Script) -Raw
"(async()=>{const SMOKE_DIR=String.raw``$project``;return await $body})()" | Set-Content (Join-Path $tmp 'run.js') -Encoding utf8
$env:HEARTH_HOME = Join-Path $tmp 'home'; $env:HEARTH_SMOKE = Join-Path $tmp 'run.js'; $env:HEARTH_SMOKE_DIR = $project; $env:HEARTH_SHOT = Join-Path $tmp 'shot.png'
if ($CleanPath) { $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') }
if ($Packaged) { $exe = Join-Path $root 'dist\win-unpacked\Hearth IDE.exe'; $args2 = @() } else { $exe = Join-Path $root 'node_modules\electron\dist\electron.exe'; $args2 = @('.') }
$out = Join-Path $tmp 'out.txt'
$p = @{ FilePath = $exe; WorkingDirectory = $root; RedirectStandardOutput = $out; RedirectStandardError = (Join-Path $tmp 'err.txt'); Wait = $true; NoNewWindow = $true }
if ($args2.Count) { $p.ArgumentList = $args2 }
Start-Process @p
(Get-Content $out | Select-String 'SMOKE_RESULT' | Select-Object -Last 1).Line
Get-Content (Join-Path $tmp 'err.txt') -ErrorAction SilentlyContinue | Where-Object { $_ -match 'rror' } | Select-Object -First 4
