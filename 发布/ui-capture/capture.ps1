param(
  [Parameter(Mandatory = $true)][string]$Out
)

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Drawing

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class DshWindowCapture {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
}
"@

$target = Get-Process |
  Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero -and $_.ProcessName -like 'DeepSeek Harness*' } |
  Select-Object -First 1

if (-not $target) {
  throw 'no visible Harness window: this tool needs a rendered UI'
}

$hwnd = $target.MainWindowHandle
if (-not [DshWindowCapture]::IsWindowVisible($hwnd)) {
  throw 'the Harness window is hidden'
}

$rect = New-Object DshWindowCapture+RECT
[void][DshWindowCapture]::GetWindowRect($hwnd, [ref]$rect)

$width = $rect.Right - $rect.Left
$height = $rect.Bottom - $rect.Top
if ($width -le 0 -or $height -le 0) {
  throw "the window has no area ($width x $height)"
}

$bitmap = New-Object System.Drawing.Bitmap($width, $height)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$hdc = $graphics.GetHdc()
try {
  # 2 = PW_RENDERFULLCONTENT, required for Chromium surfaces
  $ok = [DshWindowCapture]::PrintWindow($hwnd, $hdc, 2)
} finally {
  $graphics.ReleaseHdc($hdc)
  $graphics.Dispose()
}

if (-not $ok) {
  $bitmap.Dispose()
  throw 'PrintWindow refused to copy the window surface'
}

$folder = Split-Path -Parent $Out
if ($folder -and -not (Test-Path -LiteralPath $folder)) {
  New-Item -ItemType Directory -Force -Path $folder | Out-Null
}

$bitmap.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$bitmap.Dispose()
