# @local/subai

自管日志的子 AI。循环、提示词、工具、模型请求全走官方 `agent-loop`；**只有子会话的日志**
由本插件存：`~/.dsh/subai/subai.db`（SQLite，WAL）。

## 工具面

与官方子 AI 工具包同形，只换名字；另加一个按 seq 截断的分叉工具。

| 本插件 | 对应官方 | 参数 |
|---|---|---|
| `subai` | `subagent` | `cwd?` `description` `prompt` |
| `subai_fork` | `subagent_fork`（但可指定源与截断点） | `target` `atSeq?` `cwd?` `description` `prompt` |
| `subai_send` | `send_message` | `agent_id` `message` |
| `subai_interrupt` | `interrupt_agent` | `agent_id` |
| `subai_list` | `list_agents` | `scope?: 'children' \| 'descendants'` |

## 怎么做到「日志归自己」

1. 建子会话前，先把 session id 记进本插件（`store.reserve`）。
2. 包住活实例 `ctx.sessionPersistence` 的 `create/open/stat/list/flush`：命中自己登记的 id
   就返回 SQLite `SessionHandle`，其余原样交给官方 JSONL 后端。
3. 官方后端的 `session/event` 路由只认它自己的 `writers` 表 → 我们的会话不在里面，
   它静默不写（正是要的）；我们自己的监听器把事件写进 SQLite。
4. `ctx.agents.create/resume` 照旧跑官方循环；`whenIdle` 后把最后一条助手消息投给父会话
   （`user/message` + `source.kind = 'subagent-settled'`）。

   **投递规则**（0.4.1 起，与官方 `sendMessage` 完全一致）：

   | 目标状态 | 走法 | 何时被看到 |
   |---|---|---|
   | 空闲 | `followup`（next-turn + 唤醒） | 起一轮，下一轮开头 |
   | 在跑 | `steer`（next-step + 唤醒） | 当前 step 收尾后、下一个 step 开头 |

   官方 agent-loop 的收件箱分两级：`preStep()` 在每个 step 开头 `inbox.claim()`，
   把 `next-step` 里的消息一次性取走。所以 `steer` 进来的消息**一定落在
   「上一步的工具调用已全部回结果」之后**，顺序天然合法。

   **绝不能用** `session.append(..., { surfaceOp: 'append' })`：那是直接往表面序列尾部
   塞一条 user 消息，不看当前 step 走到哪。父会话正在等工具结果时塞进去，就成了
   `assistant(tool_calls) → user → tool`，上游直接报
   `Messages with role 'tool' must be a response to a preceding message with 'tool_calls'`。
   而且那条非法消息已经落盘，之后**每一轮都 400**，会话报废。
   官方 `repair.js` 也写明：providers reject dangling assistant calls。

   0.4.0 就是踩了这个坑：无条件 append。同一会话里走 `next-step` 的通知（seq 194/209/317）
   全都正常，只有直接 append 的那条（seq 2048）把会话打死了。

## 安装

```
plugin_manager install_bundle  target=X:\temp\dsh\开发\subai
```

（需要完全权限；装完 `cordis_inspect_query` → `Tool.listTools` 里应出现 `subai*`。）

## 存储：只存自己的行，前缀由视图拼

```sql
sessions(id, parent, cut, header, label, description, status, created_at, revision)
events(sid, seq, type, json)          -- 只存 seq >= sessions.cut 的行
```

`cut` = 这个会话从哪里接上：它继承了 `parent` 的 `[0, cut)`，自己的行从 `seq = cut` 开始
（分叉时 `cut` 处的 `session/end-seed {inherited:true}` 属于自己这侧）。

两个视图（SQL 里直接可用，查出来就是完整逻辑日志）：

```sql
-- 逐行：某个会话的完整日志，seq 从 0 连续
SELECT seq, type, json FROM session_events WHERE sid = ? ORDER BY seq;

-- 整份：一行一个会话，events 是可直接用的 JSON 数组
SELECT events FROM session_log WHERE sid = ?;
```

`session_events` 用递归 CTE 沿 `parent`/`cut` 把祖先前缀拼回来；`session_log` 在它外面再套
`json_group_array`。所以 fork 只写自己的行，读的时候不需要在应用层裁、拼、加条目。

视图体里带 `ORDER BY sid, seq`，`session_log` 的聚合里带 `ORDER BY v.seq`：GUI 点开就是
顺序对的，TS 里 `SELECT ... WHERE sid = ?` 不用再写 `ORDER BY`。

## 界面：会话顶栏的「N 个子 AI」

`client.js` 注册到 **`conversation.session.header.actions`**（和官方「N 个子智能体」同一个插槽，
官方那条 `order: 10`，我们 `order: 20`，所以在它右边）。触发器同样是「图标 + 数字 + 文案 + 箭头」，
点开是一个下拉面板，里面按 `parentId` 画出可折叠的文件夹树；点一行 `uiWorkspace.openSession(id)`
打开该子会话。数据来自插槽标准属性 `useSessions(state => state.byId)`，不轮询、也不碰 sqlite。

装了新版本后**刷新一次页面**（Ctrl+R），顶栏才会出现这个控件。

## 已验证（2026-10-24，本机 0.2.1-rc.2）

| 项 | 结果 |
|---|---|
| 安装/激活 | `plugin_manager install_bundle` → `application: applied`；`Tool.listTools` 里 5 个 `subai*` 工具都在 |
| 派发 | 子会话跑完整一轮（system prompt → user/message → request/header → assistant "pong" → turn/end），sqlite 里 18 条事件、seq 0..17 连续 |
| 按 seq 截断分叉 `atSeq=15` | 只写自己的 12 行（cut=16 起）；`session_events` 查出 28 行 0..27（父的 16 行由视图拼进来） |
| 嵌套分叉 | 从分叉子再 fork（`atSeq=20`）：新会话只存 20 行（21..40），视图跨两层拼出 41 行 0..40 |
| 视图 | `session_events` 逐行可用；`session_log.events` 是可直接喂的 JSON 数组（顺序 = seq） |
| 续聊 | `subai_send` 对活着的子会话直接开新一轮 |
| 冷续 | 插件禁用→启用（子 agent 被 dispose）后 `subai_send`：官方 `agents.resume` 从 SQLite 读回完整逻辑日志，补 `session/end-seed {}`，跑完 turn 4 |
| 官方通道未受影响 | 普通会话的 `session.v4.jsonl.zstd` 照常在写（本会话 1.28 MB） |

**冷续的坑（已修）**：resume 时如果不传 `agentOptions`，系统提示词的 `{{model}}` 取不到值，
turn 会以 `prompt variable "{{model}}" has no value (section "deployment:persona-prefix")` 报错。
现在 `subai_send` 的冷续会把 `agentDefaultModel.currentSelection()` 一起带上。

## 已知边界（v1）

- 子会话日志是**完整逻辑日志**，还没做「前缀引用」；fork 仍会复制前缀。
- 子会话的权限/沙箱继承没有抄官方 `captureDelegatedPolicyOverrides`，沿用默认。
- 不写 `subagent/catalog` 事实 → 官方 `list_agents` / 会话列表看不到这些子会话；用 `subai_list` 看。
- 深度上限写死 `MAX_DEPTH = 1`（和官方默认一致）。
- `subai_send` 冷续时把 `parentAgent` 设成调用者；如果调用者不是原父，归属关系会变。
- 卸载插件后这些子会话没人认得（日志还在 sqlite 里，官方看不到）。
- 事件逐条 `INSERT`（`synchronous=FULL`）；子会话很长时是性能瓶颈，后续可批写。
- `session_events` 是全库视图：查一个会话时递归 CTE 仍会枚举所有会话（当前规模无所谓，
  会话上千时再改成带参数的查询或按 root 建物化表）。父缺失时视图会**静默少行**；
  插件自己的 `read()` 会校验连续性并报错（fail-closed），直接写 SQL 的人要知道这点。
- 测试数据留在 `~/.dsh/subai/subai.db`，要清就 `DELETE FROM events; DELETE FROM sessions;`。

