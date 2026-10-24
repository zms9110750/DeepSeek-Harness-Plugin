# subai 400 问题：根因与修复方案

调查时间：2026-10-24 22:5x（Asia/Shanghai）
被调查对象：`@local/subai` 0.4.0（`X:\temp\dsh\开发\subai\`，经软链接挂到 `desktop` profile）
出错会话：`session-5c125856-9f57-4795-8f9d-46b492017940`，turn 22 / step 18

---

## 一、现象

父会话在 sub-ai 子会话结算时报 400：

```
400: [code=upstream_error] Messages with role 'tool' must be a response to a
preceding message with 'tool_calls' (request_id: 5568b2ed-…)
```

而且**报一次之后每轮都报**（turn 23 开头又报一次），会话被彻底卡死。

## 二、根因（已从日志证据定位）

出事的日志序列（`session-5c125856…`，原始事件序号）：

| 序号 | 事件 | 说明 |
|---|---|---|
| 2046 | `assistant/message` 带 `tool-call(call_…7583)` | 发起一个 pwsh 调用 |
| 2047 | `tool/call` | 该调用开始执行 |
| **2049** | **`user/message`（`subagent-settled` 通知，`surfaceOp: "append"`）** | **★ 插在中间** |
| 2051 | `tool/result`（call_…7583 的结果，`surfaceOp: "append"`） | 结果姗姗来迟 |
| 2054 | `assistant/attempt` → 400 | 下一次请求就崩 |

投影到模型可见的 surface 后，消息序列变成：

```
assistant(tool_calls=[call_…7583])   ← 声明了一个待回的工具调用
user(…)                              ← 中间插进来一条用户消息
tool(call_…7583)                     ← 工具结果
```

OpenAI 兼容协议要求：带 `tool_calls` 的 assistant 消息**后面必须紧跟**对应的 tool 消息。中间夹任何一条 user 消息都是非法请求，所以上游直接 400。

官方自己在 `@deepseek-ai/dsh-session/lib/types/repair.js` 里把这条约束写得很清楚：

> "Close calls before their step: **providers reject dangling assistant calls**"

### 为什么会插进去

`@local/subai` 的 `deliver()`（index.js 第 583 行附近）这样投递：

```js
if (target.status === 'running') target.session.append('user/message', message, { surfaceOp: 'append' })
```

`surfaceOp: 'append'` 只是把消息追加到 surface 尾部，**它不管当前是否有「已发出、未收到结果」的工具调用**。而子 AI 结算的时机完全独立于父会话执行到哪一步——父会话正在等工具结果时子 AI 刚好结算，通知就会插进工具调用与结果之间。

`subai_send` 里也是同一段逻辑（第 859 行），问题相同。

### 决定性证据：同一会话里，走收件箱的通知全都正常

`session-5c125856` 里有 62 条 `agent/inbox/spliced`。其中 seq 194、209、317 的
`subagent-settled` 通知走的是 `target: "next-step"`，实际落地是这样的：

```
193  step/end        ← 当前 step 的工具调用已全部回结果
194  next-step 入队    ← 通知此时才被收件箱收下
195  step/start      ← 下一个 step 开头
205  user/message    ← 通知出现在这里，合法
```

而 2048 那条**绕过了收件箱**，直接 append 到表面序列尾部，于是插进了工具调用中间。

所以：**收件箱那条路是对的，直接 append 那条路是错的。**

### 为什么以前没暴露

同类错位其实**发生过多次**。我对 `--X-temp-dsh--` 下所有会话做了统计：

- `subagent-settled` 通知共 **236** 条
- 其中落在「已发出、未回结果」的工具调用之间的有 **15** 处

但只有这次报错。差别在 provider：

| 会话 | provider | 结果 |
|---|---|---|
| `session-0c7ddc30…`（`plan-state` 通知错位） | `cc-goat` | 容忍，没报错 |
| `session-5c125856…`（`subagent-settled` 通知错位） | `command-code` | **严格拒绝，400** |

所以这是个**一直存在、只在严格上游下才暴露**的潜伏 bug。

### 为什么「报一次之后就每轮都报」

错位的那条 `user/message` 已经写进 durable log 了。之后每轮请求都会重放整个 surface，这个非法序列永远在那里，于是**每一轮都 400**——会话报废，只能靠「继续」反复失败。这正是你截图里连续两次「本轮运行失败」的原因。

## 三、投递机制：官方到底怎么做的

`dsh-agent-loop` 的收件箱是**两级**的：

| 方法 | 投到哪 | 语义 |
|---|---|---|
| `followup(input)` | `next-turn` + 唤醒 | 排一轮，当前 turn 结束后才在下一轮开头并入 |
| `steer(input)` | `next-step` + 唤醒 | 当前 step 收尾后立刻在**下一个 step 开头**并入 |
| `inject(input)` | `next-step`，不唤醒 | 只塞队列，不叫醒 |

而 `preStep()` 在**每个 step 开头**执行 `this.inbox.claim(...)`，一次性把 `next-step`
里的消息全部取走。所以 `steer` 的消息必然落在「上一步的工具调用已全部回结果」之后，
模型看到的顺序天然合法。

**结论（用户指出的正是这个）**：子 AI 回报就该用官方插话机制——
没循环就 `followup` 起循环，在跑就 `steer` 插话，且由 step 边界保证等工具调用跑完。
直接 `session.append(..., { surfaceOp: 'append' })` 是绕过收件箱的旁路，必须禁用。

## 四、已实施的修复

### 1. 代码修复（`开发\subai\index.js` → 0.4.1）

`deliver()` 和 `subai_send` 都改为**走官方收件箱**：

```js
if (agent.status === 'running' && typeof agent.steer === 'function') agent.steer(message)
else agent.followup(message)
```

- 在跑 → `steer`（`next-step` + 唤醒）：当前 step 收尾后、下一个 step 开头并入，不插进工具调用中间；
- 空闲 → `followup`（`next-turn` + 唤醒）：起一轮；
- 老版本没有 `steer` 时退回 `followup`，行为仍然安全。

**彻底移除** `session.append(..., { surfaceOp: 'append' })` 这条旁路。全文件已无该调用。

验证（`研究\脚本\test-deliver.mjs`，从源码里剥出 `deliver` 打桩跑）：

| 用例 | 结果 |
|---|---|
| 空闲 → followup | PASS |
| 在跑 → steer | PASS |
| 无 steer 时退回 followup | PASS |
| 目标不在本进程 → 返回 false 并告警 | PASS |
| **任何分支都不直接写表面序列** | PASS |

> 中途踩的坑：一开始想用官方的 `ToolCallRecovery` 自己判「有没有未回的工具调用」。
> `node --check` 能过，但实跑报 `does not provide an export named 'ToolCallRecovery'`——
> 插件实际解析到的是随应用分发的 `dsh-session@0.1.0-rc.6`，那个版本没导出它（0.2.x 才加）。
> 最终方案不依赖它：交给官方收件箱的 step 边界去保证顺序，比自己判更准。

### 2. 数据修复（`session-5c125856…`）

先试过「把通知挪到工具结果之后」，**不可行**：日志加载时按位置强制校验
`seq === index`（`planSurfaceEvent` 里的 `is not contiguous`），挪位置会让 seq 断裂，
会话直接加载失败，比 400 更糟。

最终做法：**删除那条通知并整体重编号**。它只是一条纯通知（`subagent-settled` 的
"reported."），内容在子会话日志里仍有，删掉不损失可追溯信息。

校验结果（`研究\脚本\verify-log2.mjs`）：

| 检查 | 结果 |
|---|---|
| 恰好删除 1 条事件，且正是那条通知 | PASS |
| 没有多出的事件 | PASS |
| seq 连续（2064 条事件 + 1 个头） | PASS |
| 表面序列不再有非法错位 | PASS |
| session 头完好 | PASS |
| 其余事件相对顺序完全不变 | PASS |

原文件备份在该会话目录下：`session.v4.jsonl.zstd.bak-1792853299260`。

## 五、重装与端到端验收（0.4.2）

### 入口

`plugin_manager` 的 `remove_bundle` / `install_bundle`，条目 `include:subai`，
包为软链接 `profiles\desktop\node_modules\@local\subai → X:\temp\dsh\开发\subai`。

切换前做了三件事：快照当前源码、备份 `subai.db`、确认移除插件后其余工具全在
（`listTools` 里 `subai*` 消失、其他工具不受影响），所以不会让整个 agent 不可用。

### 验收结果

| 项目 | 结果 |
|---|---|
| 安装版本 | 0.4.2，`include:subai` = active |
| 六个 `subai*` 工具 | 全部恢复 |
| 结算通知落点 | seq 1421，`step/end → inbox/spliced → step/start → user/message`，**PASS** |
| 主动回报落点 | seq 1525，同样落在 step 边界后，**PASS** |
| 本次会话 turn 数 / 报错数 | 3 / **0** |
| `INVALID_REQUEST` 出现次数 | **0** |

两次投递都是在**父会话正等工具结果**时到达的（最危险的时机），都落在了工具调用之外。

### 顺带修掉的第二个 bug

端到端测试暴露 `subai_report` 永远失败：

```
subai_report: "session-cfcf6d53-…" is not a subai session
```

根因：`adjacency()` 要求**双方都在** subai 表里，但父会话从不入表（表里只有本插件建的子会话）。
于是子 AI 永远无法回报。

修法：`adjacency` 改为「对方在表里看 `owner`，对方不在表里则看我方登记的 `owner`/`parent` 是否指向它」；
`subai_report` 的默认目标补上 `mine.parent` 兜底。

用真实库数据做了前后对照：修复前正是那句报错，修复后放行（`它是我的运行期父`），
而「子 → 无关会话」仍然拒绝。

## 六、附带发现（与本次 400 无关）

本会话的 `pwsh` 一开始全都失败：

```
sandbox-local windows-acl temp grant materialization failed and its cleanup also failed
```

用 `diagnose-windows-sandbox-acl` 脚本诊断 `X:\temp\dsh`，结论 `NOT_THIS_CLASS`：工作区本身权限完全正常（当前用户 FullControl），也没有可疑的包权限项。所以**这不是工作区权限问题**，而是沙箱建「临时授权」那一步自身失败。切到完全权限后 shell 就正常了。这条要单独查，和 subai 无关。

