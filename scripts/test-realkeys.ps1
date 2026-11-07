# Starts the app (default: a copy of the dev app; -Packaged: dist\win-unpacked), waits until a sandboxed terminal is ready,
# brings the window to the front and sends a REAL Ctrl+V (and optionally Ctrl+C/Shift+Insert) to it.
#   powershell -File scripts/test-realkeys.ps1 [-AppRoot <folder with node_modules\electron>] [-Packaged] [-Keys '^v']
param([string]$AppRoot, [switch]$Packaged, [string]$Keys = '^v', [string]$Script = 'test\smoke-realkeys.js')
$root = Split-Path $PSScriptRoot -Parent
if (-not $AppRoot) { $AppRoot = $root }
$tmp = Join-Path $env:TEMP 'hearth-realkeys'
Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force "$tmp\project" | Out-Null
git -C "$tmp\project" init -q -b main
$body = Get-Content (Join-Path $AppRoot $Script) -Raw
"(async()=>{const SMOKE_DIR=String.raw``$tmp\project``;return await $body})()" | Set-Content "$tmp\run.js" -Encoding utf8
$env:HEARTH_HOME = "$tmp\home"; $env:HEARTH_SMOKE = "$tmp\run.js"; $env:HEARTH_SMOKE_DIR = "$tmp\project"; $env:HEARTH_SHOT = "$tmp\shot.png"
if ($Packaged) { $exe = Join-Path $AppRoot 'dist\win-unpacked\Hearth IDE.exe'; $a = @() } else { $exe = Join-Path $AppRoot 'node_modules\electron\dist\electron.exe'; $a = @('.') }
$p = @{ FilePath = $exe; WorkingDirectory = $AppRoot; RedirectStandardOutput = "$tmp\out.txt"; RedirectStandardError = "$tmp\err.txt"; PassThru = $true }
if ($a.Count) { $p.ArgumentList = $a }
$app = Start-Process @p
Add-Type -AssemblyName System.Windows.Forms
Start-Sleep -Seconds 22                                        # the app opens a sandboxed shell and starts the listener
$shell = New-Object -ComObject WScript.Shell
$main = Get-Process -Id $app.Id -ErrorAction SilentlyContinue
$handle = (Get-Process electron, 'Hearth IDE' -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -like '*Hearth*' } | Select-Object -First 1)
Add-Type -Namespace W -Name U -MemberDefinition '[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid); [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);'
if ($handle) { [void]$shell.AppActivate($handle.Id); [void][W.U]::SetForegroundWindow($handle.MainWindowHandle) }
Start-Sleep -Milliseconds 800
$fg = [W.U]::GetForegroundWindow(); $fgPid = 0; [void][W.U]::GetWindowThreadProcessId($fg, [ref]$fgPid)
"window found: $([bool]$handle) title='$($handle.MainWindowTitle)' pid=$($handle.Id); foreground pid=$fgPid ($((Get-Process -Id $fgPid -ErrorAction SilentlyContinue).ProcessName))"
[System.Windows.Forms.SendKeys]::SendWait($Keys)               # a real keystroke
$app.WaitForExit(120000) | Out-Null
$line = (Get-Content "$tmp\out.txt" -ErrorAction SilentlyContinue | Select-String SMOKE_RESULT | Select-Object -Last 1).Line
if ($line) { $line -replace '^SMOKE_RESULT ', '' } else { 'no result'; Get-Content "$tmp\err.txt" -TotalCount 3 }
if (-not $app.HasExited) { $app.Kill() }
Remove-Item Env:HEARTH_HOME, Env:HEARTH_SMOKE, Env:HEARTH_SMOKE_DIR, Env:HEARTH_SHOT -ErrorAction SilentlyContinue
