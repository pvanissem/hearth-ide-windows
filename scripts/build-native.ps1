# Builds native\bin\hearth-sandbox.exe with the C# compiler that ships with Windows
# (.NET Framework 4, no SDK needed).
# Only when Program.cs changed (or with -Force): every compile gets a new file hash, and Smart App Control judges
# each hash on its own - a binary Windows already allowed should not be replaced without need.
param([switch]$Force)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$src = Join-Path $root 'native\hearth-sandbox\Program.cs'
$out = Join-Path $root 'native\bin'
$exe = Join-Path $out 'hearth-sandbox.exe'
$stamp = Join-Path $out 'source.sha256'
$hash = (Get-FileHash $src -Algorithm SHA256).Hash
if (-not $Force -and (Test-Path $exe) -and (Test-Path $stamp) -and ((Get-Content $stamp -Raw).Trim() -eq $hash)) {
  Write-Host "hearth-sandbox.exe is up to date"
  exit 0
}
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { throw "csc.exe not found: $csc" }
New-Item -ItemType Directory -Force $out | Out-Null
& $csc /nologo /optimize+ /target:exe /platform:x64 /out:"$exe" "$src"
if ($LASTEXITCODE -ne 0) { throw 'compile failed' }
Set-Content -Path $stamp -Value $hash -Encoding ascii
Write-Host "Built $exe"
