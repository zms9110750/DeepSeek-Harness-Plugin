/**
 * ⑧ core —— 采纳流程。
 *
 * ## 采纳做什么
 *
 * `未指定 → 提交`，**纯状态转移**。它本身**不建立任何关系** ——
 * 取代边在 fork 时就已建好；采纳时做的是**执行**（`【用户指令，2026-11-01 05:52】`
 * 「这个卡采纳了，才执行取代」）。
 *
 * ## 采纳事务里有什么
 *
 * ```
 * ① 新卡状态（未指定 → 提交）
 * ② 依赖转移（relationsPhase，来自 ④ 的 planSupersede）
 * ③ 旧卡终止（statusPhase：未完成 → 取消；已完成 → 不动）
 * ④ 历史
 * ```
 *
 * **四样必须原子、全成或全滚。** 顺序：**先转移依赖、再判旧卡** ——
 * 反序会让旧卡一转取消就触发级联，把还没转移的依赖方误收。
 *
 * ## 为什么把 ④ 的计划与 ⑦ 的计划合起来执行
 *
 * ⑦ 给的是**单卡意图**（新卡转提交、旧卡转取消），④ 给的是**跨卡级联**（把依赖改指新卡）。
 * 两份计划是两份东西：**同一份计划内的顺序由它的有序性保证；跨两份计划之间只能由 ⑧ 编排**。
 * ⇒ 这里的编排顺序是：**先跑 ④ 的 relationsPhase，再跑 ⑦ 的 items（含新卡转提交 + 旧卡终止）**。
 */

import { coreError, describeReject, type CoreError } from './errors.js';
import type { Card, Ports } from './ports.js';
import { recomputeUpward } from './recompute.js';
import type { ActiveWorkspace } from './workspace.js';
import { findCard, visibleCards } from './workspace.js';

/** 采纳结果。 */
export interface AdoptSuccess {
	readonly ok: true;
	readonly card: Card;
	/** 被改动的其它卡（旧卡 + 依赖转移）。 */
	readonly changed: readonly Card[];
	/** 沿监听链重算后**连带改变**的父卡（可能为空）。 */
	readonly recomputed: readonly Card[];
}

export interface AdoptFailure {
	readonly ok: false;
	readonly error: CoreError;
}

export type AdoptResult = AdoptSuccess | AdoptFailure;

/** 状态词汇，由 ⑧ 从 ③ 取来传给 ④（④ 不认识状态）。 */
function vocabularyOf(ports: Ports): { activeStatuses: string[]; completedStatuses: string[]; canceledStatus: string } {
	const states = ports.types.TaskState;
	return {
		activeStatuses: [states.SUBMITTED, states.WORKING],
		completedStatuses: [states.COMPLETED, states.FAILED, states.CANCELED, states.REJECTED],
		canceledStatus: states.CANCELED,
	};
}

/**
 * 采纳一张卡。
 *
 * @param at 时间戳（门面盖）。
 */
export function adoptCard(
	ports: Ports,
	workspace: ActiveWorkspace,
	cardId: string,
	at: number,
): AdoptResult {
	const card = findCard(workspace, cardId);
	if (card === undefined || card.deleted === true) {
		return { ok: false, error: coreError('CARD_NOT_FOUND', `找不到这张卡：${cardId}`, { cardId }) };
	}

	/* ① ⑦ 出采纳计划（含旧卡终止意图）。 */
	const plan = ports.cards.planAdopt(card, workspace.cards, { at });
	if (!plan.ok) {
		return {
			ok: false,
			error: coreError(
				'CREATE_VALIDATION_FAILED',
				describeReject(plan.reason as never),
				{ reason: plan.reason },
			),
		};
	}

	/* ② ④ 出取代级联计划（把依赖改指新卡）。 */
	const supersedeEdges = card.relations.links
		.filter((link) => link.label === 'supersedes' && link.to !== '')
		.map((link) => link.to);

	const cascadePlan =
		supersedeEdges.length === 0
			? { relationsPhase: [], statusPhase: [], issues: [] }
			: ports.relation.planSupersede(
					visibleCards(workspace).map((item) => ({
						id: item.id,
						status: item.status,
						relations: item.relations,
					})),
					card.id,
					supersedeEdges,
					vocabularyOf(ports),
				);

	/* ③ 事务内：先转移依赖、再改状态、再写历史。全成或全滚。 */
	let updated: Card | undefined;
	const changed: Card[] = [];
	let recomputed: Card[] = [];
	let failure: CoreError | undefined;

	ports.store.transaction(workspace.wsId, (tx) => {
		const byId = new Map<string, Card>();
		for (const item of tx.readAll()) byId.set(item.id, item);

		/* ── 阶段一：依赖转移（④ 的计划） ── */
		for (const item of cascadePlan.relationsPhase) {
			const target = byId.get(item.cardId);
			if (target === undefined) continue;

			const applied = ports.relation.applyRelationsChange(target.relations, {
				kind: 'patch',
				patches: item.relationPatches,
			});
			if (!applied.ok) {
				failure = coreError(
					'RELATIONS_CHANGE_REJECTED',
					`采纳时转移依赖失败（卡 ${item.cardId}）。`,
					{ cardId: item.cardId, issues: applied.issues },
				);
				return;
			}
			const next: Card = { ...target, relations: applied.value as Card['relations'] };
			byId.set(item.cardId, next);
			changed.push(next);
		}

		/* ── 阶段二：⑦ 的状态意图（新卡转提交 / 旧卡终止） ── */
		for (const item of plan.items) {
			if (item.op === 'setStatus') {
				const target = byId.get(item.cardId);
				if (target === undefined) continue;
				const next: Card = { ...target, status: item.to };
				byId.set(item.cardId, next);
				if (item.cardId === card.id) updated = next;
				else changed.push(next);
			} else if (item.op === 'updateCard') {
				byId.set(item.card.id, item.card);
				if (item.card.id === card.id) updated = item.card;
				else changed.push(item.card);
			}
		}

		if (updated === undefined) return;

		/* ── 阶段三：历史（⑦ 的 events + 本卡自身） ── */
		const events = plan.events as readonly { at: number; action: string; detail?: unknown }[];
		updated = {
			...updated,
			history: [...updated.history, ...events],
		};

		tx.write([updated, ...changed]);

		/*
		 * ── 监听链：状态变了的卡 ⇒ 唤醒它们的父卡 ──
		 *
		 * 采纳会改**多张**卡的状态（本卡 未指定→提交；旧卡 未完成→取消），
		 * 所以传的是"所有状态被改过的 id"，不是单个。
		 * 阶段一改的是 relations（依赖转移），**不触发状态重算**。
		 */
		const statusChanged = [
			card.id,
			...changed.filter((item) => item.id !== card.id).map((item) => item.id),
		];
		const recomputedResult = recomputeUpward(ports, tx, statusChanged, {
			at,
			cards: [...byId.values()],
		});
		recomputed = [...recomputedResult.changed];
		if (recomputedResult.failures.length > 0) {
			console.error('[taskboard2-core] 采纳后重算失败：');
			for (const item of recomputedResult.failures) {
				console.error(`  · [${item.code}] ${item.message}`);
			}
		}
	});

	if (failure !== undefined) return { ok: false, error: failure };
	if (updated === undefined) {
		return { ok: false, error: coreError('CREATE_VALIDATION_FAILED', '采纳未产出新状态。') };
	}
	return { ok: true, card: updated, changed, recomputed };
}
