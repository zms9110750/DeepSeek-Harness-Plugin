# A-问题

## 痛点
github、pixiv 需要梯子；全局开会烧钱、污染所有流量；关掉又影响用户自己上网。

## 验收
指定某些工具调用走代理，其余直连。不能是全局开关，不能碰用户的梯子状态。

## 适用性
只对"我们发起的连接"有效。

## 先例
clash-verge-mcp。关键事实：新版 Clash Verge Rev 默认不在 TCP 暴露控制器，
REST 走命名管道 `\\.\pipe\verge-mihomo`，且必须手动打开 External Controller。
