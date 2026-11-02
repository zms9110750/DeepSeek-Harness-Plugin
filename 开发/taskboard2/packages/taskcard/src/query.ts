/**
 * ⑦ 任务卡 —— 只读查询与常量。
 *
 * 这里只有"问一句"的函数：不产生计划、不写盘、不取时钟。
 * 供 ⑨⑩ 出按钮文案、供 ⑤ 排序、供 ⑧ 分派。
 */

import type { Card, Ports } from './types.js';

/**
 * 「采纳」这个转移动作的机器可读标识。
 *
 * 为什么单独导出：**历史里记的是"行为"不是"状态"**（用户 00:47 口径），
 * 采纳 = 「未指定 → 提交」这个动作名。⑤ 需要按动作名排序，故必须是一个**共享常量**，
 * 而不是各包各写一个字符串字面量。
 *
 * ⚠ 动作名**永不变**（改名会让旧历史失去可判别性）；要加动作就**新增**，不复用旧名。
 */
export const ADOPT_ACTION = 'adopt';

/** 采纳时的另一个历史动作名：完成取代（旧卡被处置）。 */
export const SUPERSEDE_ACTION = 'supersede';

/**
 * 是否处于草稿态。
 *
 * 判定式只有一条：`status === DRAFT`。**不含分类条件**（草稿期分类恒定，
 * 因为编号锁模板、模板锁分类；这属于既有的双锁推论）。
 */
export function isDraft(card: Card, ports: Ports): boolean {
	return card.status === ports.types.DRAFT;
}

/** 是否已冻结（冻结 ⟺ 非草稿）。 */
export function isFrozen(card: Card, ports: Ports): boolean {
	return !isDraft(card, ports);
}

/**
 * 「这一个变更按钮」当前该做哪件事。
 *
 * `【用户指令，2026-11-01 06:43】`「草稿不能 fork。**fork 和编辑，是一个按钮。**」
 * ⇒ 编辑权与 fork 权**互斥**：草稿 → `edit`；非草稿 → `fork`。
 *
 * ⚠ 这是**纯查询**（不产生计划）。它的结果**不得**作为 plan 的输入 ——
 * 两次调用之间卡状态可能被别的消息循环改掉（TOCTOU），plan 必须**内部重判**。
 */
export function changeIntent(card: Card, ports: Ports): 'edit' | 'fork' {
	return isDraft(card, ports) ? 'edit' : 'fork';
}

/**
 * 模板解析的两种失败必须分开（`docs` §3.6 第 19 条）。
 *
 * · **未命中 ⇒ 返回 `undefined`**（数据问题）
 * · **注册表未初始化 ⇒ `resolve` 抛错**（时序问题）
 *
 * 这个包装只在"未命中"时返回 `undefined`，把"抛错"原样放行 —— 让调用方能分开处理。
 */
export function resolveTemplate(
	ports: Ports,
	ref: string,
): { ok: true; template: NonNullable<ReturnType<Ports['types']['resolve']>> } | { ok: false } {
	const template = ports.types.resolve(ref);
	if (template === undefined) return { ok: false };
	return { ok: true, template };
}

/** 卡是否处于墓碑态。 */
export function isDeleted(card: Card): boolean {
	return card.deleted === true;
}

/** 卡当前是否有占用者。 */
export function isClaimed(card: Card): boolean {
	return card.claimedBy !== '';
}
