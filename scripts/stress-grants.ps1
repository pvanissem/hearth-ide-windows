# Starts several sandboxed processes at (almost) the same time in the same project and counts the failures.
# Reproduces "cannot start: file not found" for overlapping starts (grants being rewritten while another process starts).
#   powershell -File scripts/stress-grants.ps1 -Helper native\bin\hearth-sandbox.exe [-Count 8] [-Files 4000]
param([Parameter(Mandatory)][string]$Helper, [int]$Count = 8, [int]$Files = 4000, [int]$StaggerMs = 400)
$Helper = (Resolve-Path $Helper).Path
$root = Join-Path $env:TEMP 'hearth-stress'
Remove-Item $root -Recurse -Force -ErrorAction SilentlyContinue
$tree = "$root\project"; $tools = "$root\tools"
New-Item -ItemType Directory -Force $tree, $tools | Out-Null
1..$Files | ForEach-Object { Set-Content "$tree\f$_.txt" 'x' }                 # many files: granting takes a moment, like node_modules
Copy-Item "$env:WINDIR\System32\cmd.exe" "$tools\tool.exe"                      # an executable outside the project, like claude.exe
$name = 'stress' + [guid]::NewGuid().ToString('N').Substring(0, 6)
$jobs = 1..$Count | ForEach-Object {
  Start-Sleep -Milliseconds $StaggerMs
  $psi = New-Object Diagnostics.ProcessStartInfo $Helper
  $psi.Arguments = "--name $name --rw `"$tree`" --ro `"$tools`" --cwd `"$tree`" --net none --pipes -- `"$tools\tool.exe`" /c echo ok"
  $psi.UseShellExecute = $false; $psi.RedirectStandardOutput = $true; $psi.RedirectStandardError = $true; $psi.CreateNoWindow = $true
  [Diagnostics.Process]::Start($psi)
}
$ok = 0; $failed = @()
foreach ($p in $jobs) { $out = $p.StandardOutput.ReadToEnd(); $err = $p.StandardError.ReadToEnd(); $p.WaitForExit(); if ($p.ExitCode -eq 0 -and $out -match 'ok') { $ok++ } else { $failed += ($err.Trim() -split "`n")[0] } }
"started=$Count ok=$ok failed=$($Count - $ok)"
$failed | Group-Object | ForEach-Object { "  $($_.Count)x $($_.Name)" }
& $Helper --name $name --rw $tree --ro $tools --revoke
Remove-Item $root -Recurse -Force -ErrorAction SilentlyContinue
