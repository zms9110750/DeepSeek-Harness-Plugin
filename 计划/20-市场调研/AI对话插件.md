# 市场调研：DSH 内部的 AI 与 AI 对话（多智能体互相说话）

> 目标：找"多个 AI 在 DSH 内部互相发消息"的现成东西（狼人杀那种轮流发言）。

## 结论先说

**官方已经自带一套，且已做成可选 bundle**；市场里还有三四个第三方实现，重心各不相同。不需要自己从零写消息循环。

## 一、官方：Agent Teams（实验性，内置）

包：`@deepseek-ai/dsh-experimental-agent-team` + `dsh-experimental-tool-agent-team`（另有一个整包 `…-agent-team-profile`）。桌面版插件列表里叫「智能体团队」。

| 能力 | 说明 |
|---|---|
| Lead + 具名 teammate | 只有 Lead 能创建/中断成员；名字永久、不复用 |
| 成员两种起步 | **fresh**（不带记忆）或 **fork**（继承 Lead 已完成轮次）——和我们树的分叉同构 |
| 直接消息 | 任何成员可给任何成员或 Lead 发消息，投递到对方 inbox，返回 `MessageId` |
| 消息呈现 | 每条 peer 消息是**用户角色消息，前缀是发送者名**，后接原始内容 |
| 共享任务板 | 持久 roster + 任务状态（`maxTasks` 默认 256） |
| 状态 | `running` / `inactive`（含仅存储）/ `provisioning` / `failed` |
| 限额 | 成员 16、任务 256、单条消息 64 KB、清理 5 s |
| KV cache | peer 消息追加在可复用前缀之后；冷恢复先复用历史再追加 |

**不支持的**：独立工作目录、跨进程协调、任务 owner 自动释放。需要持久会话存储。

最小配置（官方给的三行）：

```yaml
- name: '@deepseek-ai/dsh-session-persistence-jsonl'
- name: '@deepseek-ai/dsh-experimental-agent-team'
- name: '@deepseek-ai/dsh-experimental-tool-agent-team'
```

## 二、市场里的第三方

| 插件 | 重心 | 备注 |
|---|---|---|
| [dsh-market / npm `dshmarket`](https://github.com/dsh-market/dsh-market) | 插件市场本体（搜索、安装、升级、启停） | 不是多智能体，是"找插件"的入口 |
| [NanmiCoder/dsh-agent-teams](https://github.com/NanmiCoder/dsh-agent-teams) | 多智能体协作 + **任务依赖管理 + 持久化** | 团队状态落在 `<workspace>/.agent-teams/`，注册 `/agent-teams` 宿主命令 |
| [2507483326/dsh-eteams](https://github.com/2507483326/dsh-eteams) | 领队拆目标、成员接力执行 | 在市场里搜 ETeams 安装 |
| [CH3SH-LC/dsh-team-workbench](https://github.com/CH3SH-LC/dsh-team-workbench) | **1/2/4 窗**同时看真实会话 + 自主智能体团队 | 对"面板里看多个会话"这件事最接近我们的需求 |
| [@sylvainatelier/dsh-agent-hub](https://www.npmjs.com/package/@sylvainatelier/dsh-agent-hub) | 多 agent 中枢，可按 agent 配模型 | 偏"调度 + 模型分配" |

索引：[awesome-dsh-plugin](https://github.com/billliao/awesome-dsh-plugin)。

## 三、对"狼人杀"够不够

够，但要接受三条边界：

1. **发言是消息，不是轮次**：没有"轮到谁"的调度器；谁想说话就发消息，靠提示词约束轮流。
2. **消息进 inbox 就当用户发言**：发送者名前缀 + 原文，所以模型看到的是"某人对我说"，天然适合角色扮演。
3. **上限 16 人 / 单条 64 KB**：狼人杀够用；要"长发言"就受限。

## 四、和我们的树的关系

- 它们的"team"是**平的成员表**（Lead + N 个 peer），和我们"树"（父子 + 分叉点）不是一个形状；
- 但 **fork 起步**这一条完全同构：teammate 也能"继承 Lead 的已完成轮次"，这正是我们派发子会话的做法；
- **消息面**可以直接借：`inbox` + "发送者名前缀的用户消息"，我们不必自造一套对话传输；
- 如果目标是"多个 AI 互相说"，官方这套已经够；如果目标是"父子树 + 分支上下文 + 结算归档"，仍是我们自己的东西。
