# 用隔离的 headless `dev` 配置跑一次性任务：./dev.ps1 "任务"
# 独立进程、跑完就退，不碰正在跑的 GUI；插件是 link: 装的，改完下次启动即生效。
$env:PATH = "X:\temp\dsh\探针\bin;$env:PATH"
& node "X:\temp\dsh\探针\asar\out\dsh\node_modules\@deepseek-ai\dsh\lib\bin.js" --profile dev @args
exit $LASTEXITCODE
