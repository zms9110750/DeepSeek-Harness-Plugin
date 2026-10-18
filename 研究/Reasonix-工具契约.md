# Reasonix 的工具契约（读源码所得）

- 仓库：https://github.com/esengine/DeepSeek-Reasonix
- 事实：Go 编写，MIT，默认分支 `studio`，35.8k star，2.4k fork
- 读到的文件：`docs/TOOL_CONTRACT.md`、`internal/tools/jobs/` 目录清单
- 限制：`raw.githubusercontent.com` 在这台机器上取不到（404），
  只能读 GitHub 的 blob 页面和 API 目录清单；`jobs.go`（58KB）还没逐行读

---

## 一、后台调用：三件套，全部按 job id

契约里写得非常清楚：

| 工具 | 只读 | 行为 |
|---|---|---|
| `bash(run_in_background=true)` | 否 | 起一个后台命令，立刻返回 |
| `task(run_in_background=true)` | 否 | 起一个后台子任务 |
| `bash_output(job_id?)` | 是 | 读**上次读之后的新输出**，附状态 `running/done/failed/killed`。**不阻塞**。省略 job_id 就列出还在跑的作业（kind、label、已运行时长） |
| `wait(job_ids?)` | 是 | **阻塞**到作业结束，返回每个作业的状态和最终输出/答案。省略则等全部 |
| `kill_shell(job_id)` | 否 | 终止后台作业。已结束或 id 未知时是 no-op |

对应关系一目了然：

```
启动 → 拿 id → bash_output(id) 偷看 → wait(id) 收尾 → kill_shell(id) 掐掉
```

**这正是你说的"有 kill、有 wait、都按 id 操作"。** 我之前的猜测是对的，
但细节比我猜的好：`bash_output` 是"增量读"，而且能当"列出所有在跑的作业"用。

## 二、编号：`#n` 在他们的语境里是"折叠索引"

`recall` 工具的描述里提到：

> read the `#n` positions listed under "Folded work index" in a compaction summary

也就是说 `#n` 在 Reasonix 里首先是**压缩后折叠区的位置编号**，不是工具调用编号。
工具调用编号是 `job_id`（后台作业才有）。

**所以"同步调用也有编号"这一条，我在契约文档里没找到证据。**
可能在 UI/session 层（`internal/session` 或前端），还没读到。
需要的话下一步去 `internal/tools/sessiontool` 和前端目录确认。

## 三、最值钱的一课：MCP 不做逐个映射

契约里反复讲 `use_capability`：

> Balanced with a distinct Planner and every Delivery session additionally expose one stable proxy
> `use_capability`, so optional MCP servers … can be inspected and called **without changing
> provider-visible schemas mid-session**.

> The fixed proxy's provider-visible name, description, schema, and ordering **do not change when
> MCP inventory changes**.

一个稳定的代理工具，四种动作：`list` / `inspect` / `call` / `decline`。

为什么这么做，文档里也写了：**provider 前缀一变，KV 缓存全废**。
每个 MCP 工具都注册成独立工具，装一个 server 就改一次 schema，缓存从头再来，钱就烧在这。

这直接推翻了我原来在 `计划/02` 里写的"每个 MCP tool 映射成一个 DSH 工具"。

还有一个细思恐极的点：

> The server process starts only **after** the permission gate and PreToolUse hooks approve the call.

即：**进程是在批准之后才起的**，不是启动就连。而且连接身份是按 server 单独的
（`mcp_connect__github`），可以精确 deny 掉某一个 server 而不影响别的。

## 四、审批与"用户回合"也是工具

- `ask` / `await_user`：契约说它们是 "host-control tools … for the turns that end on the model's terms"
  —— 也就是说，**用户交互是工具调用，不是弹窗阻塞**。
- 这和你的需求 8 完全一致：把等待变成可积压的调用。

## 五、完成要有证据

- `complete_step`：记录"某一步完成"，**没有证据会被拒绝**；宿主自己把下一步推进到 in_progress。
- `todo_write`：两级结构（level 0 = 阶段，level 1 = 具体步骤），带稳定 `step_id`，改标题/重排都不能改 id。

这两条对我们 `计划/03` 的"任务树/摘要回报"很有参考价值：
**完成不是模型说了算，是可以被拒绝的声明。**

## 六、还有一份没读的文档

`docs/TOOL_APPROVAL_MODES.md` —— 从名字看就是审批模式（可能就是你说的"四描述符/权限"那套）。
下一轮应该先读它。

---

## 结论：我们的差距在哪

| 能力 | DSH 现在 | Reasonix 现在 | 差距 |
|---|---|---|---|
| 后台作业 | ✅ `ctx.jobs` + `job_output/job_list/job_kill` | ✅ `bash_output/wait/kill_shell` | 我们缺 `wait` 独立工具；`job_output` 语义接近 |
| 任意调用编号 | ❌ 只有 job 有 id | ？后台有 job id，同步待确认 | 都要补 |
| MCP 接入 | ❌ 无客户端 | ✅ 稳定代理 + 按需启动 + 精确授权 | 差一整代 |
| 用户交互 | 弹窗阻塞 | ✅ `ask` / `await_user` 工具化 | 差一个设计 |
| 完成声明 | 模型自觉 | ✅ `complete_step` 需证据 | 差一个约束 |
