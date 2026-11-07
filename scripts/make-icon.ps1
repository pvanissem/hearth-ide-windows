# Builds the Windows icon from the macOS master (Resources/AppIcon-1024.png of hearth-ide):
# trims the transparent margin (Windows icons fill the canvas), writes build/icon.png and a multi-size build/icon.ico.
param([string]$Source = "$PSScriptRoot\..\..\hearth-ide\Resources\AppIcon-1024.png")
Add-Type -AssemblyName System.Drawing
$out = Join-Path $PSScriptRoot '..\build'
$src = [System.Drawing.Bitmap]::FromFile((Resolve-Path $Source))
# bounding box of everything that is not (nearly) transparent
$minX = $src.Width; $minY = $src.Height; $maxX = 0; $maxY = 0
for ($y = 0; $y -lt $src.Height; $y += 2) { for ($x = 0; $x -lt $src.Width; $x += 2) {
  if ($src.GetPixel($x, $y).A -gt 40) { if ($x -lt $minX) { $minX = $x }; if ($x -gt $maxX) { $maxX = $x }; if ($y -lt $minY) { $minY = $y }; if ($y -gt $maxY) { $maxY = $y } } } }
$side = [Math]::Max($maxX - $minX, $maxY - $minY) + 2
$cx = ($minX + $maxX) / 2; $cy = ($minY + $maxY) / 2
$crop = New-Object System.Drawing.RectangleF ($cx - $side / 2), ($cy - $side / 2), $side, $side
function Scaled([int]$n) {
  $b = New-Object System.Drawing.Bitmap $n, $n, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($b)
  $g.InterpolationMode = 'HighQualityBicubic'; $g.SmoothingMode = 'HighQuality'; $g.PixelOffsetMode = 'HighQuality'; $g.Clear([System.Drawing.Color]::Transparent)
  $g.DrawImage($src, (New-Object System.Drawing.RectangleF 0, 0, $n, $n), $crop, [System.Drawing.GraphicsUnit]::Pixel); $g.Dispose(); return $b
}
$png = @{}
foreach ($n in 16, 24, 32, 48, 64, 128, 256, 512, 1024) {
  $b = Scaled $n; $ms = New-Object System.IO.MemoryStream; $b.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png); $png[$n] = $ms.ToArray(); $b.Dispose()
}
[System.IO.File]::WriteAllBytes((Join-Path $out 'icon.png'), $png[1024])
[System.IO.File]::WriteAllBytes((Join-Path $PSScriptRoot '..\src\renderer\assets\icon-256.png'), $png[256])
[System.IO.File]::WriteAllBytes((Join-Path $PSScriptRoot '..\src\renderer\assets\icon-64.png'), $png[64])
# ICO container with PNG entries (Vista and newer)
$sizes = 16, 24, 32, 48, 64, 128, 256
$ms = New-Object System.IO.MemoryStream; $w = New-Object System.IO.BinaryWriter $ms
$w.Write([uint16]0); $w.Write([uint16]1); $w.Write([uint16]$sizes.Count)
$offset = 6 + 16 * $sizes.Count
foreach ($n in $sizes) { $d = if ($n -eq 256) { 0 } else { $n }; $w.Write([byte]$d); $w.Write([byte]$d); $w.Write([byte]0); $w.Write([byte]0); $w.Write([uint16]1); $w.Write([uint16]32); $w.Write([uint32]$png[$n].Length); $w.Write([uint32]$offset); $offset += $png[$n].Length }
foreach ($n in $sizes) { $w.Write($png[$n]) }
[System.IO.File]::WriteAllBytes((Join-Path $out 'icon.ico'), $ms.ToArray())
$src.Dispose()
"icon written: trimmed {0}x{0} from {1},{2}" -f $side, $minX, $minY
