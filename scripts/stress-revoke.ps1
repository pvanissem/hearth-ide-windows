# A new sandboxed process starts while the clean-up of the previous session (revoke: remove grants, delete the
# container profile) is still running in the same project. Reproduces "cannot start: file not found" after closing a session.
#   powershell -File scripts/stress-revoke.ps1 -Helper native\bin\hearth-sandbox.exe [-Rounds 5] [-Files 8000] [-DelayMs 800]
param([Parameter(Mandatory)][string]$Helper, [int]$Rounds = 5, [int]$Files = 8000, [int]$DelayMs = 800)
$Helper = (Resolve-Path $Helper).Path
$root = Join-Path $env:TEMP 'hearth-stress-revoke'
Remove-Item $root -Recurse -Force -ErrorAction SilentlyContinue
$tree = "$root\project"; $tools = "$root\tools"
New-Item -ItemType Directory -Force $tree, $tools | Out-Null
1..$Files | ForEach-Object { Set-Content "$tree\f$_.txt" 'x' }
Copy-Item "$env:WINDIR\System32\cmd.exe" "$tools\tool.exe"
$name = 'rv' + [guid]::NewGuid().ToString('N').Substring(0, 6)
$common = @('--name', $name, '--rw', $tree, '--ro', $tools)
$ok = 0; $errors = @()
for ($i = 1; $i -le $Rounds; $i++) {
  # session 1 runs and ends (its grants stay until the clean-up)
  & $Helper @common --cwd $tree --net none --pipes -- "$tools\tool.exe" /c echo one | Out-Null
  # the clean-up of session 1 starts, and shortly after session 2 starts
  $rv = Start-Process -FilePath $Helper -ArgumentList (($common + '--revoke') | ForEach-Object { "`"$_`"" }) -PassThru -WindowStyle Hidden
  Start-Sleep -Milliseconds $DelayMs
  $out = & $Helper @common --cwd $tree --net none --pipes -- "$tools\tool.exe" /c echo two 2>&1
  if ("$out" -match 'two') { $ok++ } else { $errors += ("$out" -split "`n")[0] }
  $rv.WaitForExit()
}
"rounds=$Rounds ok=$ok failed=$($Rounds - $ok)"
$errors | Group-Object | ForEach-Object { "  $($_.Count)x $($_.Name.Substring(0, [Math]::Min(180, $_.Name.Length)))" }
& $Helper @common --revoke
Remove-Item $root -Recurse -Force -ErrorAction SilentlyContinue
