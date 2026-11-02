/**
 * ⑦ 任务卡 —— 采纳。
 *
 * ## 采纳是什么
 *
 * **纯状态转移**：`未指定 → 提交`（`【用户指令，2026-11-01 03:00】` 批；只能用户）。
 * **采纳本身不产生任何关系** —— 取代边在 fork 时就已建好（`05:52`「采纳了才执行取代」
 * 说的是**执行**，不是建立）。
 *
 * ## 采纳时要执行「取代」
 *
 * 对本卡身上每一条「取代」边（`from` = 本卡，`to` = 旧卡）逐张处置：
 *   · 旧卡在**「完成」组**（成功/失败/取消/拒绝）⇒ **不动**（`superseded-noop`）
 *   · 否则 ⇒ **转「取消」**（`superseded-incomplete`）
 *   · **多条取代 ⇒ 逐张处置**，不是只判一张（用户 13:18 允许取代多个）
 *
 * ## 顺序
 *
 * **先转移依赖、再判旧卡** —— 顺序由 ④ 的计划给出，⑦ 只按序搬运、**不重排**。
 * 反序会让依赖方在旧卡转取消的瞬间被级联误收，而它们本该改指新卡活下来。
 *
 * ⚠ **旧卡已终态**（在「完成」组）⇒ **不产生状态变更项**，只转移依赖。
 */

import type { Card, CardId, HistoryEntry, Plan, PlanItem, PlanResult, Ports, Principal } from './types.js';
import { ADOPT_ACTION, SUPERSEDE_ACTION } from './query.js';

/** 一条取代边（`from` = 新卡 / `to` = 旧卡）。 */
export interface SupersedeEdge {
	from: CardId;
	to: CardId;
}

/** `planAdopt` 的入参。 */
export interface AdoptInput {
	/** 由 ⑧ 在事务内盖；⑦ 不取时钟。省略则不写历史。 */
	at?: number;
	/** 执行采纳的主体。`【实现判断】` 省略时按用户处理（采纳本来就是用户动作）。 */
	actor?: Principal;
}

/** 取代标签。**由 ④ 的词汇表定义**；⑦ 只在"枚举自身出边"时用它，不做语义判断。 */
const SUPERSEDES = 'supersedes';

/**
 * 取本卡身上所有「取代」边。
 *
 * ⑦ **只做结构枚举**（`label` 与 `to`），不判"取代意味着什么" —— 语义在 ④。
 * 用户 13:18 裁"取代可编辑 / 可新建 / 可多条" ⇒ 这里必须支持多条。
 */
export function supersedeEdges(card: Card): SupersedeEdge[] {
	const out: SupersedeEdge[] = [];
	for (const link of card.relations.links) {
		if (link.label !== SUPERSEDES) continue;
		if (link.to === '') continue;
		out.push({ from: card.id, to: link.to });
	}
	return out;
}

export function planAdopt(
	ports: Ports,
	card: Card,
	all: readonly Card[],
	input: AdoptInput = {},
): PlanResult {
	// ── ① 前置：只有草稿能采纳 ──
	if (card.deleted) {
		return { ok: false, reason: { kind: 'already-deleted' } };
	}
	if (card.status !== ports.types.DRAFT) {
		return { ok: false, reason: { kind: 'not-draft' } };
	}

	// ── ② 目标状态与转移判决：问 ③（⑦ 不自己判） ──
	const target = ports.types.states.SUBMITTED;
	const actor: Principal = input.actor ?? { type: 'user' };
	if (!ports.types.canTransition(card.template.kind, card.status, target, actor)) {
		return { ok: false, reason: { kind: 'not-draft' } };
	}

	const items: PlanItem[] = [];

	// ── ③ 本卡：转「提交」。动因在 events 里，items 不带 reason ──
	items.push({ op: 'setStatus', cardId: card.id, to: target });

	// ── ④ 逐张处置被取代的旧卡 ──
	const edges = supersedeEdges(card);

	for (const edge of edges) {
		const old = all.find((item) => item.id === edge.to);
		// 悬空引用：⑦ 不猜、不造卡；⑧ 另有"坏引用"上报通道。
		if (old === undefined) continue;
		// 墓碑不参与任何处置。
		if (old.deleted) continue;

		const done = ports.types.isCompletedGroup(old.status);
		if (done) {
			// 在「完成」组 ⇒ **不动**，不产生状态变更项。
			// 因果记在 events 的 detail 里（见下），不需要额外的 Reason 载体。
			continue;
		}

		// 不在「完成」组 ⇒ 转「取消」。
		items.push({
			op: 'setStatus',
			cardId: old.id,
			to: ports.types.states.CANCELED,
			reason: { kind: 'superseded-incomplete' },
		});
	}

	// ── ⑤ 历史：采纳 + 取代执行（都是"行为"） ──
	const events: HistoryEntry[] = [];
	if (input.at !== undefined) {
		events.push({ at: input.at, action: ADOPT_ACTION });
		if (edges.length > 0) {
			events.push({
				at: input.at,
				action: SUPERSEDE_ACTION,
				detail: { edges: edges.map((edge) => ({ from: edge.from, to: edge.to })) },
			});
		}
	}

	const plan: Plan = { ok: true, items, events };
	return plan;
}
