param(
  [Parameter(Mandatory = $true)][string]$Path
)

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName Microsoft.VisualBasic

if (-not (Test-Path -LiteralPath $Path)) {
  throw '路径不存在：' + $Path
}

$item = Get-Item -LiteralPath $Path -Force

if ($item.PSIsContainer) {
  # 目录：整个树一起进回收站
  [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory(
    $item.FullName,
    [Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs,
    [Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin
  )
} else {
  [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile(
    $item.FullName,
    [Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs,
    [Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin
  )
}

# 真删掉了才算成功：如果文件还在，说明没进回收站，当作失败
if (Test-Path -LiteralPath $Path) {
  throw '没有进回收站，文件仍然存在（可能该位置不支持回收站）'
}
