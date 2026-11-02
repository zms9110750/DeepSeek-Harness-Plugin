/**
 * ⑦ 任务卡 —— 删除（墓碑）。
 *
 * ## 删除是标记，不是抹掉
 *
 * `【用户指令，2026-11-01 03:21】`「**删除是标记为删除。不是持久化里面不存了。**」
 * ⇒ 置 `deleted = true`，记录仍在；**编号不释放**（不回收，号只增不回头）。
 *
 * ## 只有草稿能删
 *
 * 依据：删除是"改内容"的一种，而**采纳后不可原地改**（草稿期才可肆意编辑，含删除）。
 * ⇒ 非草稿 ⇒ 拒绝。
 *
 * ## 幂等
 *
 * 对已墓碑的卡再删 ⇒ **成功且不产生第二条记录**（重试友好）。
 *
 * ## 读路径
 *
 * 墓碑**默认读路径过滤**，但**按 id 直查可见**（用户 03:32）；过滤是 ⑧/⑤ 的事，
 * ⑦ 只负责把 `deleted` 置上。
 */

import type { Card, HistoryEntry, Plan, PlanItem, PlanResult, Ports } from './types.js';

/** 删除写进历史的动作名。 */
export const DELETE_ACTION = 'delete';

/** `planDelete` 的入参。 */
export interface DeleteInput {
	/** 由 ⑧ 在事务内盖；⑦ 不取时钟。省略则不写历史。 */
	at?: number;
}

export function planDelete(ports: Ports, card: Card, input: DeleteInput = {}): PlanResult {
	// ── 幂等：已墓碑 ⇒ 成功、无动作 ──
	if (card.deleted) {
		const plan: Plan = { ok: true, items: [], events: [] };
		return plan;
	}

	// ── 只有草稿能删 ──
	if (card.status !== ports.types.DRAFT) {
		return { ok: false, reason: { kind: 'not-draft' } };
	}

	const events: HistoryEntry[] = [];
	if (input.at !== undefined) {
		events.push({ at: input.at, action: DELETE_ACTION });
	}

	const items: PlanItem[] = [
		{
			op: 'updateCard',
			card: { ...card, deleted: true },
		},
	];

	const plan: Plan = { ok: true, items, events };
	return plan;
}
