/**
 * 任务板 —— bundle 壳。
 *
 * 这个包**自己不做任何事**。它的作用是：
 *
 *   1. 承载 `cordis.patch.yml`（bundle 的插件清单）
 *   2. 在设置页显示一张卡片（用户要的「我的整个事情是一个任务库」）
 *   3. 提供卡片图标和显示名
 *
 * 八个实际组件都是独立的包，各自能单独开关：
 *
 *   ① @local/taskboard-store           持久化提供者
 *   ② @local/taskboard-core            内存里的核心（不能关）
 *   ③ @local/taskboard-tools           给 agent 的工具面
 *   ④ @local/taskboard-ui              抽屉 + 右侧栏
 *   ⑤ @local/taskboard-templates       领域模板
 *   ⑥ @local/taskboard-plan-preset     按计划的权限
 *   ⑦ @local/taskboard-workspace       子工作空间（占位）
 *   ⑧ @local/taskboard-extra-workspace 额外工作空间（占位）
 *
 * 这个结构和官方「智能体团队」bundle 一致：一张卡片下面挂若干独立包。
 * 参照 dsh-experimental-agent-team-profile 的 cordis.patch.yml。
 */

export const name = 'taskboard';

/* 壳不注册任何东西。 */
export function apply() {}
