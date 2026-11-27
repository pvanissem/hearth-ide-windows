# Hearth IDE for Windows - installer download.
#   irm https://pvanissem.github.io/hearth-ide-windows/install.ps1 | iex
# Downloads the installer of the latest GitHub release, checks it against the SHA-512 checksum the release
# publishes (latest.yml) and runs it. The installer puts Hearth IDE into your user profile (no admin rights)
# and starts it. Run it again to update.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$repo = 'pvanissem/hearth-ide-windows'
Write-Host 'Hearth IDE: looking up the latest release...'
$release = Invoke-RestMethod "https://api.github.com/repos/$repo/releases/latest" -Headers @{ 'User-Agent' = 'hearth-install' }
$asset = $release.assets | Where-Object { $_.name -like '*.exe' } | Select-Object -First 1
$yml = $release.assets | Where-Object { $_.name -eq 'latest.yml' } | Select-Object -First 1
if (-not $asset -or -not $yml) { throw "Release $($release.tag_name) has no installer." }
$content = (Invoke-WebRequest $yml.browser_download_url -UseBasicParsing).Content
if ($content -is [byte[]]) { $content = [Text.Encoding]::UTF8.GetString($content) }   # Windows PowerShell 5.1: octet-stream
$expected = ([regex]'(?m)^sha512:\s*(\S+)').Match($content).Groups[1].Value
if (-not $expected) { throw 'The release publishes no checksum.' }
$file = Join-Path $env:TEMP $asset.name
Write-Host "Downloading $($asset.name) ($([math]::Round($asset.size / 1MB)) MB)..."
Invoke-WebRequest $asset.browser_download_url -OutFile $file -UseBasicParsing
$sha = [Security.Cryptography.SHA512]::Create()
$stream = [IO.File]::OpenRead($file)
try { $actual = [Convert]::ToBase64String($sha.ComputeHash($stream)) } finally { $stream.Dispose() }
if ($actual -ne $expected) { Remove-Item $file -Force; throw 'Checksum mismatch: the download was removed.' }
Write-Host 'Checksum OK. Starting the installer...'
try { Start-Process -FilePath $file -Wait }
catch {
  # Hearth is not code-signed yet: with Smart App Control switched on, Windows refuses to run the installer.
  Write-Host ''
  Write-Host 'Windows blocked the installer. Hearth IDE is not code-signed yet, and Smart App Control only runs' -ForegroundColor Yellow
  Write-Host 'signed or well-known apps. The download itself is intact (the checksum matched).' -ForegroundColor Yellow
  Write-Host "Details: $($_.Exception.Message)"
  Remove-Item $file -Force -ErrorAction SilentlyContinue
  return
}
Remove-Item $file -Force -ErrorAction SilentlyContinue
Write-Host 'Hearth IDE is installed.'
