# Builds native\bin\hearth-sandbox.exe with the C# compiler that ships with Windows
# (.NET Framework 4, no SDK needed).
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { throw "csc.exe not found: $csc" }
$out = Join-Path $root 'native\bin'
New-Item -ItemType Directory -Force $out | Out-Null
& $csc /nologo /optimize+ /target:exe /platform:x64 /out:"$out\hearth-sandbox.exe" "$root\native\hearth-sandbox\Program.cs"
if ($LASTEXITCODE -ne 0) { throw 'compile failed' }
Write-Host "Built $out\hearth-sandbox.exe"
