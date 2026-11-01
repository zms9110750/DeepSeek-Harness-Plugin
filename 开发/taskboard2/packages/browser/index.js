/**
 * 浏览器入口 —— 不是一个 dsh 插件，是一段独立启动的程序。
 *
 * ## 它不做什么（这是它存在的理由）
 *
 *   ✗ 不声明 `dsh.bundle`、不声明 `dsh.client` —— dsh 根本不认识这个包
 *   ✗ 不读 dsh 的 profile、不碰 `$DSH_HOME`
 *   ✗ 不加载会话、不写会话日志、不上传遥测
 *   ✗ 不进任何 dsh 会话的加载列表
 *
 * ## 它做什么
 *
 *   起一个 Cordis 根上下文，只装 taskboard2 的十四个包，
 *   起一个 `node:http` 服务，把画面和 API 放在同一个源上。
 *
 * ## 为什么能这么起
 *
 *   `boot(configPath)` 那个原语可以批任何配置树；而「条目缺失或被显式禁用 →
 *   忽略」（`dsh-app-boot\README.zh.md:111`）意味着**不装 agent-loop 完全合法**。
 *   `dsh-host-webserver` 也明说自己「不了解任何 harness 概念」。
 *
 *   所以这不是绕路，是框架原本就允许的组合方式 —— 只是发行包里没有现成的
 *   这种 profile 罢了。
 *
 * ## 隔离级别
 *
 *   配置隔离靠 profile，profile 隔离靠 `DSH_HOME`。
 *   本入口两样都不写：它的配置全在 `createApp()` 的入参里，
 *   数据落在它自己的目录下，跟 dsh 的会话/repo 完全无关。
 */
export { createApp, start } from './server.js';
