# gate-switch2（开发版 3.0.0）

工具总闸。`/gate on` 拦截本会话所有工具调用，`/gate off` 放行，`/gate status` 报告。
**状态只在内存里**：不写会话事件，进程重启后默认打开。

## 为什么不再写会话日志

2.0.0 用 `agent.session.append('gate/set', …)` 把开关状态写进会话日志，直接踩了两个约束：

1. 表外事件类型必须在信封上带 `ignorable: true` 才能被读取器保留并跳过，否则整份历史拒绝加载
   （`dsh-session-persistence` 的 `validateStoredEvents`，报错就是“unknown to this harness and not marked ignorable”）。
2. 第三方插件没有合法途径写这种信封：`appendPluginRecord()` 只发给仓库内 `packages/experimental/`，
   它内部走 `session.#appendRecord(...)` 私有方法；插件从自己的 `node_modules` 解析到的是另一份
   `@deepseek-ai/dsh-session` 副本，拿宿主的 session 调用会因私有字段品牌不匹配而抛错。

所以这一版把状态收进模块内存，会话日志恢复成“只含 harness 认识的事件”。

## 接口契约

命令结果只有文本，所以状态回复里固定带两个词：

| 状态 | 文本里必含 |
|---|---|
| 关闭 | `闸门已关闭` |
| 打开 | `闸门已打开` |

界面侧（gate-toggle9）不再读 `useProjection('gate')`：挂载时执行 `/gate status`，按这两个词判断；
点击时执行 `/gate on|off`。打字和按钮读的是同一个内存 Set，仍然不会打架。

## 还没做

- `发布/gate-toggle9` 仍在读已删除的投影 `gate`，装上这一版之前必须同步改客户端。
- 会话结束不从 Set 里清理 session id（进程内泄漏量级：每会话一个短字符串）；要清理得挂会话销毁事件。
- `pnpm-lock.yaml` 还是 2.0.0 的（含 zod），本版不再依赖 zod，安装前重新生成。
