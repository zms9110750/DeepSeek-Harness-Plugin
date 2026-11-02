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
import type { Actor, Card, Ports, Principal } from './ports.js';
import { recomputeUpward } from './recompute.js';
import { appendHistory, applyStatus, type HistoryEvent } from './status-write.js';
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
 * @param principal 谁在采纳（身份）　@param actor 什么权限（类别，由调用入口写死）
 * @param at 时间戳（门面盖）。
 *
 * ⚠ **必须收 `principal`**：`design` / `record` 的采纳 `user` 与 `ai` 都可以做
 * （③ 的 `canTransition` 已放开），⇒ **不知道"这次是谁"就无法判权限**。
 */
export function adoptCard(
	ports: Ports,
	workspace: ActiveWorkspace,
	cardId: string,
	principal: Principal,
	actor: Actor,
	at: number,
): AdoptResult {
	const card = findCard(workspace, cardId);
	if (card === undefined || card.deleted === true) {
		return { ok: false, error: coreError('CARD_NOT_FOUND', `找不到这张卡：${cardId}`, { cardId }) };
	}

	/* ① ⑦ 出采纳计划（含旧卡终止意图）。`principal` / `actor` 分开传，⑧ 不推断。 */
	const plan = ports.cards.planAdopt(card, workspace.cards, { principal, actor, at });
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
	/** **状态真的变了**的卡（只有它们才产生广播）。 */
	const statusChangedIds = new Set<string>();

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

		/*
		 * ── 阶段二：⑦ 的状态意图（新卡转提交 / 旧卡终止） ──
		 *
		 * 逐张走收口（`applyStatus`）：**同值 ⇒ 不写、不写历史、不通知父卡**。
		 * `statusChangedIds` 只收**真变了的**，`changed` 也只装它们。
		 */
		for (const item of plan.items) {
			if (item.op === 'setStatus') {
				const target = byId.get(item.cardId);
				if (target === undefined) continue;

				const outcome = applyStatus({ card: target, to: item.to, mode: 'transition' });
				if (!outcome.changed) continue;

				byId.set(item.cardId, outcome.card);
				statusChangedIds.add(item.cardId);
				if (item.cardId === card.id) updated = outcome.card;
				else changed.push(outcome.card);
			} else if (item.op === 'updateCard') {
				/*
				 * ⑦ 给的整卡覆写：其它字段（title / sections / relations）⑦ 已收过口，
				 * 但 **status 若也被它改了，那是一次转移** ⇒ 交给 ⑧ 的收口判等 + 计广播。
				 *
				 * ⚠ **这里不做自己的 status 比较、也不自己拼"换回旧值"**：
				 * `from` 参数表达"基准是旧卡的 status"，由 `applyStatus` 内部判等。
				 * ⇒ 判等与换基准都只在 `status-write.ts` 一处。
				 */
				const before = byId.get(item.card.id);
				if (before === undefined) continue;

				const outcome = applyStatus({
					card: item.card,
					to: item.card.status,
					from: before.status,
					mode: 'transition',
				});

				byId.set(item.card.id, outcome.card);
				if (outcome.changed) statusChangedIds.add(item.card.id);
				if (item.card.id === card.id) updated = outcome.card;
				else changed.push(outcome.card);
			}
		}

		if (updated === undefined) return;

		/* ── 阶段三：历史（⑦ 的 events，追加走收口） ── */
		updated = appendHistory(updated, plan.events as readonly HistoryEvent[]);

		tx.write([updated, ...changed]);

		/*
		 * ── 监听链：**真的**变了状态的卡 ⇒ 唤醒它们的父卡 ──
		 *
		 * 传 `statusChangedIds` 而非"plan 提到的所有 id"：
		 * 旧卡可能因「终态粘滞」或「同值」没有真正变化，那些不该产生广播。
		 * 阶段一改的是 relations（依赖转移），**不触发状态重算**。
		 */
		if (statusChangedIds.size > 0) {
			const recomputedResult = recomputeUpward(ports, tx, [...statusChangedIds], {
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
		}
	});

	if (failure !== undefined) return { ok: false, error: failure };
	if (updated === undefined) {
		return { ok: false, error: coreError('CREATE_VALIDATION_FAILED', '采纳未产出新状态。') };
	}
	return { ok: true, card: updated, changed, recomputed };
}
