/**
 * ⑧ core —— 级联计划执行。
 *
 * ## 两阶段，core 不重排、不校验
 *
 * ```
 * CascadePlan = { relationsPhase: RelationsItem[], statusPhase: StatusItem[] }
 * ```
 *
 * - **先跑完 `relationsPhase`，再跑 `statusPhase`** —— 这就是"先转移依赖、再判旧卡死刑"。
 *   它从一句约定变成了**结构**：core 用两个循环，不可能交错。
 * - **phase 内按 `cardId` 升序**（④ 已排好，UTF-16 code unit）。core **不重排、不校验** ——
 *   校验就等于在 core 里复刻一次 ④ 的排序规则。
 * - **无 `switch`**：两个 phase 的项类型不同（`RelationsItem` / `StatusItem`），
 *   `kind` 字段只是判别标签，core 无需按它分派。
 *
 * ## core 在这一层做什么
 *
 * 只做"写"：把 `patchRelations` 交给 ④ 的 `applyRelationsChange` 展开成最终 relations，
 * 把 `setStatus` 直接落到卡上，然后**在一个事务里**统一写。
 *
 * ## 因果（`reasons`）去哪
 *
 * 写进 `history` 的 `detail`。**不产文案**（文案归 ⑨⑪）。
 */

import { coreError, type CoreError } from './errors.js';
import type { Card, CascadePlan, Ports } from './ports.js';
import { recomputeUpward } from './recompute.js';
import { applyStatus } from './status-write.js';
import type { ActiveWorkspace } from './workspace.js';

/**
 * 级联执行结果。
 *
 * **判别式联合**，不是 `{ ok: boolean; changed; error? }`：后者允许"失败但带 changed"
 * 与"成功却没有 changed"两种不合形组合；而事实上失败时事务已回滚、**一张卡都没写**。
 * ⇒ 让类型说出这件事，而不是靠注释提醒。
 */
export type CascadeResult =
	| {
			readonly ok: true;
			/** 计划**直接**改动的卡。 */
			readonly changed: readonly Card[];
			/** 沿监听链重算后**连带改变**的父卡（可能为空）。 */
			readonly recomputed: readonly Card[];
	  }
	| { readonly ok: false; readonly error: CoreError };

/**
 * 在一个事务里执行一份级联计划。
 *
 * **调用方必须已经把这份计划算好**（④ 产出）。本函数不做任何计划生成。
 *
 * 写完之后**在同一个事务内**沿监听链重算父卡 ——
 * 否则会出现"子卡已落库、父卡状态没更新"的中间态。
 *
 * @param at 时间戳，由门面给（本模块不取时钟）。
 */
export function runCascade(
	ports: Pick<Ports, 'store' | 'relation' | 'types'>,
	workspace: ActiveWorkspace,
	plan: CascadePlan,
	at: number,
): CascadeResult {
	let changed: Card[] = [];
	let recomputed: Card[] = [];
	let failure: CoreError | undefined;

	ports.store.transaction(workspace.wsId, (tx) => {
		const byId = new Map<string, Card>();
		for (const card of tx.readAll()) byId.set(card.id, card);

		const touched = new Set<string>();
		/** **状态真的变了**的卡 —— 独立集合，不能与 `touched` 共用（见阶段二注释）。 */
		const statusChanged = new Set<string>();

		/* ── 阶段一：改关系 ── */
		for (const item of plan.relationsPhase) {
			const card = byId.get(item.cardId);
			if (card === undefined) continue; /* 悬空引用：不猜、不造卡 */

			const applied = ports.relation.applyRelationsChange(card.relations, {
				kind: 'patch',
				patches: item.relationPatches,
			});
			if (!applied.ok) {
				failure = coreError(
					'RELATIONS_CHANGE_REJECTED',
					`级联改关系失败（卡 ${item.cardId}）。`,
					{ cardId: item.cardId, issues: applied.issues, reasons: item.reasons },
				);
				return;
			}

			byId.set(item.cardId, { ...card, relations: applied.value as Card['relations'] });
			touched.add(item.cardId);
		}

		/* ── 阶段二：改状态 ── */
		for (const item of plan.statusPhase) {
			const card = byId.get(item.cardId);
			if (card === undefined) continue;

			/*
			 * 终态粘滞：已经是终态就不再改。
			 *
			 * 为什么 core 要判这一条：④ 只负责算"谁该被收"，它的 vocabulary 里
			 * `activeStatuses` 已经滤掉了终态；但**阶段一与阶段二之间**卡可能被别的路径
			 * 改过（④ 的计划是按快照算的）。这里用 ③ 的 `isEndedStatus` 再确认一次 ——
			 * **不写状态字面量**，也就不构成"core 里的业务规则"。
			 */
			if (ports.types.isEndedStatus(card.status)) continue;

			/* 收口：同值 ⇒ 不写盘、不写历史、不通知父卡。 */
			const outcome = applyStatus({
				card,
				to: item.targetStatus,
				events: [{ at, action: 'cascade', detail: { to: item.targetStatus, reasons: item.reasons } }],
				mode: 'transition',
			});
			if (!outcome.changed) continue;

			byId.set(item.cardId, outcome.card);
			touched.add(item.cardId);
			/*
			 * ⚠ **独立的集合**，不能用 `touched`：
			 * `touched` 阶段一也在往里加（改关系也算"这张卡要写盘"），
			 * 拿它当"状态变了"会把"只改了关系、或状态被终态粘滞跳过"的卡误判成变了 ⇒
			 * 白通知它的父卡重算一次。**不产生错值，但违反"同值不广播"。**
			 */
			statusChanged.add(item.cardId);
		}

		changed = [...touched].map((id) => byId.get(id) as Card);
		tx.write(changed);

		/*
		 * ── 监听链：状态变了的卡 ⇒ 唤醒它们的父卡 ──
		 *
		 * 与上面的写入**同一个事务**。传 `cards` 让重算复用这份快照，不再重读一次全量。
		 * ⚠ 传的是 `statusChanged`（独立集合、只有真变了的才进），**不是 `touched`**。
		 */
		if (statusChanged.size > 0) {
			const result = recomputeUpward(ports, tx, [...statusChanged], {
				at,
				cards: [...byId.values()],
			});
			recomputed = [...result.changed];
			if (result.failures.length > 0) {
				/* 重算失败不中断已完成的写入（事务已提交），但**不静默** —— 由调用方呈现。 */
				console.error('[taskboard2-core] 级联后重算失败：');
				for (const item of result.failures) console.error(`  · [${item.code}] ${item.message}`);
			}
		}
	});

	if (failure !== undefined) return { ok: false, error: failure };
	return { ok: true, changed, recomputed };
}
