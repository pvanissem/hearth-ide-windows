# End-to-end smoke test: starts the real Electron app with an isolated HOME, starts a SANDBOXED
# shell through the UI, tries to break out of it, then drives every inspector view (journal, themes,
# German UI, search, usages, build, tests, architecture, git, settings). Prints the result as JSON and
# keeps screenshots next to it.
param([switch]$Packaged)   # -Packaged: test dist\win-unpacked\Hearth IDE.exe (after "npx electron-builder --win --dir") instead of the dev app
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
New-Item -ItemType Directory -Force "$project\src", "$project\docs" | Out-Null
$pkg = @{ name = 'hearth-ide-windows-fixture'; scripts = @{ build = 'echo building-in-sandbox'; test = 'node test.js'; start = 'node src/app.js' } }
$pkg | ConvertTo-Json | Set-Content "$project\package.json" -Encoding utf8
@"
const fs = require('fs');
fs.writeFileSync('junit.xml', '<testsuite name="Calc"><testcase classname="Calc" name="adds" time="0.01"/><testcase classname="Calc" name="divides" time="0.02"><failure message="boom: 1/0"/></testcase></testsuite>');
console.log('tests done');
process.exit(1);
"@ | Set-Content "$project\test.js" -Encoding utf8
@"
function greet(name) { return 'hi ' + name; }
const run = () => greet('x');
module.exports = { greet, run };
"@ | Set-Content "$project\src\app.js" -Encoding utf8
'module.exports = {};' | Set-Content "$project\src\hello-tools.js" -Encoding utf8
@"
# Architecture

## Flow
``````mermaid
flowchart LR
  UI --> Main --> Sandbox
``````
"@ | Set-Content "$project\docs\architecture.md" -Encoding utf8
git -C $project init -q -b main
git -C $project -c user.name=Smoke -c user.email=smoke@example.com add package.json
git -C $project -c user.name=Smoke -c user.email=smoke@example.com commit -q -m "Initial"
git -C $project config user.name Smoke; git -C $project config user.email smoke@example.com

$body = Get-Content (Join-Path $root 'test\smoke-renderer.js') -Raw
"(async()=>{const SMOKE_DIR=String.raw``$project``;const SECRET=String.raw``$secret``;const OUTSIDE=String.raw``$outside``;return await $body})()" |
  Set-Content (Join-Path $tmp 'run.js') -Encoding utf8
$env:HEARTH_HOME = Join-Path $tmp 'home'
$env:HEARTH_SMOKE = Join-Path $tmp 'run.js'
$env:HEARTH_SMOKE_DIR = $project
$env:HEARTH_SHOT = Join-Path $tmp 'shot.png'
$out = Join-Path $tmp 'out.txt'
if ($Packaged) { $exe = Join-Path $root 'dist\win-unpacked\Hearth IDE.exe'; $argList = @() }
else { $exe = Join-Path $root 'node_modules\electron\dist\electron.exe'; $argList = @('.') }
if (-not (Test-Path $exe)) { throw "Not found: $exe" }
$p = @{ FilePath = $exe; WorkingDirectory = $root; RedirectStandardOutput = $out; RedirectStandardError = (Join-Path $tmp 'err.txt'); Wait = $true; NoNewWindow = $true }
if ($argList.Count) { $p.ArgumentList = $argList }
Start-Process @p
$line = Get-Content $out | Select-String 'SMOKE_RESULT' | Select-Object -Last 1
if (-not $line) { Write-Error 'No smoke result'; exit 1 }
$line.Line
"outside file created by sandbox: $(Test-Path $outside)"
"leftover AppContainer ACEs on project: $((icacls $project | Select-String 'S-1-15-2-[0-9]{5,}').Count)"
Write-Host "Screenshots: $tmp"
