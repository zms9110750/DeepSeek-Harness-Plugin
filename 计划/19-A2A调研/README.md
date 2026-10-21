# A2A 协议与 SDK 调研

> 这是一份**调研**，不是提案。协议本身：Agent2Agent (A2A) Protocol Specification **1.0.0**（Linux Foundation，原 Google 的 Agent2Agent）。

## 一句话

A2A 是**独立智能体之间**的通信协议：发现彼此、协商交互形式、管理协作任务、在不共享内部状态的前提下交换信息。它和 MCP 是互补的两件事——MCP 管"智能体怎么用工具/资源"，A2A 管"智能体怎么和另一个智能体搭档/派活"。

## 三层结构

| 层 | 内容 |
|---|---|
| L1 数据模型 | `Task` / `Message` / `AgentCard` / `Part` / `Artifact` / `Extension`，用 proto 定义（`spec/a2a.proto` 是唯一权威） |
| L2 抽象操作 | Send Message / Send Streaming Message / Get Task / List Tasks / Cancel Task / Subscribe to Task / Push Notification Config / Get Agent Card |
| L3 协议绑定 | JSON-RPC、gRPC、HTTP/REST，可扩展自定义绑定 |

## 核心对象

- **AgentCard**：一份 JSON 元数据，发布在 `/.well-known/agent-card.json`，描述身份、能力、技能、端点、认证要求。
- **Task**：**有状态的**工作单元，有唯一 id 和生命周期。字段大致是 `id / contextId / status（state + message + timestamp）/ artifacts / history / metadata`。
- **Message**：一次通信轮次，有 `role`（user / agent），内容是若干 `Part`。
- **Part**：最小内容单元——文本、文件引用、结构化数据。
- **Artifact**：任务产出（文档、图片、结构化数据），也由 Part 组成。
- **Context**：可选的 id，把相关任务与消息归到一段上下文里。

## 任务的九个状态（重点）

| 值 | 含义 | 类别 |
|---|---|---|
| `TASK_STATE_UNSPECIFIED` | 未知/不确定 | — |
| `TASK_STATE_SUBMITTED` | 已提交并被确认 | 进行中 |
| `TASK_STATE_WORKING` | 正在处理 | 进行中 |
| `TASK_STATE_INPUT_REQUIRED` | 需要用户补充输入 | **中断** |
| `TASK_STATE_AUTH_REQUIRED` | 需要认证/授权才能继续 | **中断** |
| `TASK_STATE_COMPLETED` | 成功完成 | **终结** |
| `TASK_STATE_FAILED` | 出错结束 | **终结** |
| `TASK_STATE_CANCELED` | 完成前被取消 | **终结** |
| `TASK_STATE_REJECTED` | 智能体决定不执行（可以在创建时就拒，也可以后来拒） | **终结** |

生命周期：

```
SUBMITTED ──> WORKING ──┬─> COMPLETED   (终结)
                        ├─> FAILED      (终结)
                        ├─> CANCELED    (终结)
                        └─> REJECTED    (终结)
                    ↑
        INPUT_REQUIRED / AUTH_REQUIRED   (中断，可回去继续)
```

**硬规则**：进了终结态（completed / failed / canceled / rejected）的任务**不能重启**——再发消息会报 `UnsupportedOperationError`。

## 操作与 JSON-RPC 方法

| 抽象操作 | JSON-RPC 方法 | 备注 |
|---|---|---|
| Send Message | `message/send` | 立刻返回 `Task` 或一条 `Message`；任务可异步继续 |
| Send Streaming | `message/stream` | SSE：先 `Task`，再 `TaskStatusUpdateEvent` / `TaskArtifactUpdateEvent` |
| Get Task | `tasks/get` | 可选 `historyLength` |
| List Tasks | `tasks/list` | 按 `contextId` / `status` / 时间过滤，游标分页 |
| Cancel Task | `tasks/cancel` | 不保证成功（可能已完成/不可取消） |
| Subscribe | `tasks/resubscribe` | 对已存在任务开流；终结态会拒 |
| Push Config | `tasks/pushNotificationConfig/*` | webhook，长任务/断线场景 |
| Agent Card | `/.well-known/agent-card.json`、`agent/getAuthenticatedExtendedCard` | 公开卡 + 认证后的扩展卡 |

错误也都是具名的：`TaskNotFoundError`、`TaskNotCancelableError`、`UnsupportedOperationError`、`ContentTypeNotSupportedError`、`PushNotificationNotSupportedError`。

## SDK

官方 SDK 覆盖 **Python / Go / Java / JavaScript / C#(.NET)**（路线图里还提到 Rust）。都是稳定级。

Python 的结构最有代表性：

- **服务端**：`AgentExecutor`（实现 `execute()` / `cancel()`）+ `RequestContext` + `EventQueue`；
- **任务推进**：`new_task(context.message)` 造任务，`TaskUpdater(event_queue, task_id, context_id)` 改状态（`start_work` / `complete` / `failed` / `requires_input` …）；
- **组装**：`DefaultRequestHandler(agent_executor, task_store, push_config_store, push_sender)` + `A2AStarletteApplication(agent_card, http_handler)` → `uvicorn`；
- **客户端**：`A2ACardResolver` 拉 Agent Card → `create_client(agent, ClientConfig(streaming=True/False))` → `send_message(request)` 返回**异步迭代器**（非流式只 yield 一个最终 Task/Message；流式依次 yield `task` / `status_update` / `artifact_update`）。

一个典型的流式顺序：`task(SUBMITTED)` → `status_update(WORKING)` → `artifact_update(结果)` → `status_update(COMPLETED)`。

## 和我们自己的计划树对照

| A2A | 我们的计划树 | 差异 |
|---|---|---|
| `TASK_STATE_SUBMITTED` | 计划已采纳、已派发（节点 open） | 我们"派发"就对了 |
| `WORKING` | 进行中 | 一致 |
| `INPUT_REQUIRED` / `AUTH_REQUIRED`（中断） | 我们没有"中断"态 | **值得借**：B-03 里"搁置的计划"其实混了"要信息"和"要授权"两种情况 |
| `COMPLETED` / `FAILED` | 完成计划 / 失败计划 | 一致 |
| `CANCELED` | 无（我们只会 shelved） | 取消 ≠ 搁置：取消是终结，搁置可重启 |
| `REJECTED` | （我们有"否决草案"，但那是草案层） | 我们缺少"派出去之后智能体主动拒绝"这一态 |
| 终结态不可重启 | 我们的"一份计划只派一次" | 精神一致 |
| `contextId` | 树根 + 祖先链 | 语义接近：都是"把相关任务归到一段上下文" |
| `artifacts` | 结算五项里的"产物" | 我们的更弱：只是一行文本 |
| `TaskStatusUpdateEvent` 流 | 我们的状态广播（未实现） | 他们已有成熟形态，可参考事件类型命名 |

## 结论 / 待议

1. **九态里我们缺三个**：`INPUT_REQUIRED`、`AUTH_REQUIRED`、`CANCELED`。前两个能把"搁置"拆开，第三个把"取消"和"搁置"分开。
2. **`REJECTED` 的位置值得想**：A2A 允许智能体在创建时就拒任务；我们的"否决"只发生在草案层（用户否决），派出去之后执行者说"我不干"目前只能报失败。
3. **状态变更事件**（`TaskStatusUpdateEvent`）的结构可以直接借：`{taskId, status:{state, message, timestamp}, final}`。
4. **不建议照搬的部分**：Agent Card 发现、认证、push webhook——那是跨组织通信的需要，本地树用不上。
5. 若要真接 A2A（让别的智能体来派活），最小面是 `message/send` + `tasks/get` + 三态（submitted/working/terminal）；`message/stream` 可以后加。

## 能不能直接替代我们的计划树

**分层看：能替代一层，不能替代另一层。**

| 我们现在的 | A2A 有吗 | 结论 |
|---|---|---|
| 任务状态机（7 态） | 有 9 态，且定义了终结/中断 | **可以借** |
| 状态变更通知 | `TaskStatusUpdateEvent` | **可以借** |
| 结果/产物传递 | `Artifact`（Part 组成） | 可以借，比我们"产物一行字"强 |
| 采纳（用户决定） | 无此概念：Task 只在 `message/send` 之后才存在 | **替代不了**，是本地状态 |
| 分叉与上下文继承 | **完全没有**：只有 `contextId` 分组与 `history` 消息 | **替代不了**，而且这是我们的核心 |
| 层序 / 闸门 / 三连否决 | 无 | **替代不了**，是我们自己的语义 |
| 子工作区（写范围） | 无（有认证/授权，但那是跨组织） | 替代不了 |

一句话：**A2A 能替掉"任务状态与通知"，替不掉"分叉与继承"。** 它传的是消息，不是 token 前缀；也没有 KV cache 复用。

### 状态映射（按"需要输入就是搁置"）

| 我们的 | A2A | 说明 |
|---|---|---|
| 草案 | —（不是 Task） | 还没有发出去 |
| 计划（已采纳未派发） | — | 只有本地状态；A2A 里"存在即已提交" |
| 派发 | `SUBMITTED` | 创建 Task |
| 进行中 | `WORKING` | |
| 搁置（等用户给信息） | `INPUT_REQUIRED` | 正是你说的这条 |
| 搁置（等授权） | `AUTH_REQUIRED` | 我们目前没有，值得补 |
| 完成 / 失败 | `COMPLETED` / `FAILED` | |
| 取消 | `CANCELED` | 我们目前没有：取消 ≠ 搁置（取消是终结） |
| 执行者主动不干 | `REJECTED` | 我们目前只能报失败 |

注意：`INPUT_REQUIRED` 是**中断态**，可以回到 `WORKING`；而 `CANCELED` 是**终结态**，回不去。这两个别混——这正是现在"搁置"一词背后混着的两件事。

## 一个客户端下的多个会话能否组成上下文树

- **能分组**：A2A 有 `contextId`，"把相关任务与消息逻辑归组"；`tasks/list` 可以按 `contextId` 过滤。所以"一个客户端、多个会话、同一段上下文"是协议支持的。
- **不能成树**：A2A 的上下文是**平的分组**。没有 `parentTaskId`、没有"从第几条分叉"、没有继承。协议层不表达父子。
- **要树只能自己塞**：Task 有 `metadata`（自由键值），可以把 `{parentTaskId, forkPointSeq}` 塞进去，客户端自己还原成树。**树是你的，不是协议的**——换任何客户端都不认这个约定。
- **SDK 的形态**：SDK 是"每个 agent 一个服务端（带 Agent Card）"，多会话 = 多个 Task 存在 `TaskStore` 里。对我们这种**进程内 fork 出来的子会话**，用 A2A 会把一次函数调用变成一次 HTTP 调用（序列化 + 认证 + 延迟），除非目的就是让外部 agent 能参与。

## 采用：自定义内存绑定（in-process）

结论：**用 A2A 的操作与词汇表，不用它的传输。** 同一个客户端进程内，父子会话之间直接函数调用，没有 HTTP、没有序列化、没有 Agent Card 发现。

### 规范要求自定义绑定交代的事，逐条对应

| 规范要求 | 我们的答案 |
|---|---|
| 传输机制 | 进程内函数调用。调用方拿到的是一个实现了 `RequestHandler` 形状的对象 |
| 值的约束 | 直接传对象引用，不走 JSON，所以没有大小/编码限制；但对象必须视为**只读**（跨会话共享） |
| 保留名 | `metadata` 里我们自己的键统一加前缀 `dsh.tree.`（`parentTaskId`、`forkPointSeq`、`planId`） |
| 错误映射 | 直接用 A2A 的具名错误（`TaskNotFoundError` / `TaskNotCancelableError` / `UnsupportedOperationError`），不映射到 HTTP 状态码 |
| 流式支持 | 返回**异步迭代器**，逐个 yield `Task` / `TaskStatusUpdateEvent` / `TaskArtifactUpdateEvent`；终结时结束迭代 |
| 认证 | 不适用：同一进程、同一用户；跨进程时再加认证 |
| Agent Card 声明 | 本地不发布 Card；要对外时再加 HTTP 绑定，届时同一 handler 直接挂上去 |

### 绑定自己的一条扩展（关键）

A2A 的 `Message` 只能装内容。我们的分叉要传的是**父会话的事件前缀**。所以本绑定在请求里加一个不入协议正文的字段：

```
SendMessageRequest {
  message: Message,              // 标准：工单、入口锚
  context: {                     // 本绑定扩展
    parentSessionId, forkPointSeq, seedEvents?   // seedEvents 只给进程内；远程绑定不许带
  }
}
```

远程绑定里 `seedEvents` 必须缺席——这正好对应"远程拿不到我们的内存前缀"。于是同一份 handler，进程内走 fork 语义，远程退化成"只有消息"。

### 得到什么，放弃什么

- **得到**：标准状态机（九态）、标准事件名、标准错误名。以后要接外部 agent，只补一层 HTTP 适配。
- **得到**：并发不用自己发明——每个 Task 一个 id，状态各自独立。
- **放弃**：HTTP 带来的天然隔离与语言无关性（将来要跨语言就得真做绑定）。
- **放弃**：`tasks/get` 之类的"远程可查"——进程内直接查本地 TaskStore。
