/**
 * 任务板 2 —— bundle 壳。
 *
 * 这个包**自己不做任何事**。它只干两件事：
 *
 *   1. 承载 `cordis.patch.yml`（把下面的包装配进进程）
 *   2. 在设置页显示一张卡片
 *
 * 装配什么，见 `cordis.patch.yml`；每个包负责什么，见 `README.md`。
 *
 * ---- 规矩 ----
 *
 *   patch 里的条目数 = 插件包数（11）。一个插件包可以包含多个开发期模块。
 *   packages/browser/ 是独立浏览器入口，不是插件，不进 patch。
 */

export const name = 'taskboard2';

/* 壳不注册任何东西。 */
export function apply() {}
