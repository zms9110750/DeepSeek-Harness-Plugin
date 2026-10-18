# 发布：可用的插件

每个目录都是一个独立的 DSH bundle，用 `plugin_manager install_bundle` 按目录绝对路径安装。
源码就是运行时的源码（安装是链接，不是拷贝）—— 改完客户端要换包名重装才能刷新，宿主侧要换名或重启。

| 目录 | 包名 | 给谁用 | 入口 |
|---|---|---|---|
| `ui-capture` | `@local/ui-capture` | 模型工具 | `screenshot()` — 抓当前 Harness 窗口存 PNG，返回路径 |
| `recycle-delete` | `@local/recycle-delete` | 模型工具 | `delete(path, reason?)` — 只进回收站，进不去就不删 |
| `call-index` | `@local/call-index` | 模型工具 | 每次调用编号 `#n`；`calls(limit?)` 列表；`show_call(id)` 原样重放 |
| `gate-switch2` | `@local/gate-switch2` | **用户** | `/gate on｜off｜status`；状态发布为会话投影 `gate` |
| `gate-toggle9` | `@local/gate-toggle9` | **用户** | 输入框工具行里的开关，读投影 `gate`，与 `/gate` 永远一致 |

## 两条经验，改之前先读

1. **插件目录必须有自己的 `node_modules`。** Node 按真实路径解析依赖，插件在 `X:\...` 下时找不到 `@deepseek-ai/dsh-tools`，装上了也不会激活。
2. **客户端插件调用宿主用 `ctx.remote.commands.*`，且必须注入两个服务**：`"remote"` 和 `"remote.commands"`（命名空间是按 `remote.<name>` 单独注册的服务）。参数形状是 `execute(sessionId, line, attachments)`。

## 状态一致性怎么做的

`gate-switch2` 把开关写进会话投影：命令 append `gate/set` 事件 → 投影 fold → 客户端 `useProjection('gate')` 读。
按钮不持有状态，所以点击和打字不会打架。
