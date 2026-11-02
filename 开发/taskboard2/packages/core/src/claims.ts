/**
 * ⑧ core —— 领取 / 释放。
 *
 * ## ⑧ 在这一层要算两件 ⑦ 算不了的事
 *
 * ⑦ 的 `planClaim` 只判**单卡准入**，它明确要求调用方（⑧）算好并传入：
 *
 *   · `actorHasActiveWork` —— **跨卡聚合**：该 actor 名下是否已有「处理中」的工作卡
 *   · `depsAllEnded`       —— 跨卡聚合：该卡依赖是否**全部**进入「完成」组
 *
 * 两者都**必填**：漏传 ⑦ 会抛错（默认 `false` 等于静默放行）。
 *
 * ## 配额维度：`QUOTA_STATES` vs `OCCUPYING_STATES`
 *
 * · **`OCCUPYING_STATES`**（`claimedBy` 非空的状态）：**处理中 ∪ 搁置**
 *   —— 搁置是"暂停"，人还占着；
 * · **`QUOTA_STATES`**（计入「一个 actor 只能占 1 个」）：**只有处理中**
 *   （用户 06:55「搁置不算处理中」）。
 *
 * ⇒ **两个量分开算，禁止用一个布尔表达两件事。**
 *
 * ## 释放
 *
 * `处理中 → 提交`。准入 = **持有者本人 或 用户**（用户 07:00「用户可以释放」）。
 * 用户释放别人的卡要记 `force_release` —— 否则"异常解除"与"正常放下"历史里不可区分。
 */

import { coreError, describeReject, type CoreError } from './errors.js';
import type { Card, Ports, Principal, Tx } from './ports.js';
import { recomputeUpward } from './recompute.js';
import type { ActiveWorkspace } from './workspace.js';
import { findCard } from './workspace.js';

/** 结果形状。 */
export interface ClaimSuccess {
	readonly ok: true;
	readonly card: Card;
	/** 沿监听链重算后**连带改变**的父卡（可能为空）。 */
	readonly recomputed: readonly Card[];
}
export interface ClaimFailure {
	readonly ok: false;
	readonly error: CoreError;
}
export type ClaimResult = ClaimSuccess | ClaimFailure;

/** `claimedBy` 里表示"用户"的字符串（⑦ 的 `describePrincipal` 的产物之一）。 */
const USER_CLAIM = 'user';

/** 主体是否与 `claimedBy` 指向同一个持有者。 */
function samePrincipal(claimedBy: string, principal: Principal): boolean {
	if (principal.type === 'user') return claimedBy === USER_CLAIM;
	return claimedBy === `loop:${principal.id}`;
}

/** 该 actor 名下的字符串（写进 `claimedBy`）。 */
function claimValueOf(principal: Principal): string {
	return principal.type === 'user' ? USER_CLAIM : `loop:${principal.id}`;
}

/**
 * 跨卡聚合：该 actor 是否已有**计入配额**的工作卡。
 *
 * 只看 `QUOTA_STATES`（= 处理中），**不看搁置** —— 搁置占持有、不占配额。
 * 限定 `kind === 'work'`：配额是工作类的规则（③ 的 `KindDef.quota` 也只有 work 非空）。
 */
export function actorHasActiveWork(
	workspace: ActiveWorkspace,
	principal: Principal,
	quotaStates: readonly string[],
): boolean {
	const claimedBy = claimValueOf(principal);
	return workspace.cards.some(
		(card) =>
			card.deleted !== true &&
			card.template.kind === 'work' &&
			card.claimedBy === claimedBy &&
			quotaStates.includes(card.status),
	);
}

/**
 * 跨卡聚合：该卡依赖的目标是否**全部**进入「完成」组。
 *
 * - 无依赖 ⇒ `true`（空集合上"全部"为真）；
 * - 依赖目标找不到 ⇒ **`false`**（fail-closed：找不到 ≠ 满足）。
 */
export function depsAllEnded(ports: Pick<Ports, 'types'>, workspace: ActiveWorkspace, card: Card): boolean {
	const targets = card.relations.links.filter((link) => link.label === 'dependsOn').map((link) => link.to);
	if (targets.length === 0) return true;

	for (const target of targets) {
		const dep = findCard(workspace, target);
		if (dep === undefined || dep.deleted === true) return false;
		if (!ports.types.isEndedStatus(dep.status)) return false;
	}
	return true;
}

/** 领取。 */
export function claimCard(
	ports: Ports,
	workspace: ActiveWorkspace,
	cardId: string,
	principal: Principal,
	at: number,
): ClaimResult {
	const card = findCard(workspace, cardId);
	if (card === undefined || card.deleted === true) {
		return { ok: false, error: coreError('CARD_NOT_FOUND', `找不到这张卡：${cardId}`, { cardId }) };
	}

	/* 配额：只有处理中计入（用户 06:55）。 */
	const quotaStates = [ports.types.TaskState.WORKING];
	const busy = actorHasActiveWork(workspace, principal, quotaStates);

	/*
	 * `depsAllEnded` 交给 ③ 的 `canTransition` 判 —— ⑧ 只算事实，不做判决。
	 * 但 ⑦ 的 `planClaim` 也会问 ③，所以这里把事实一并传下去（两条路径同一个来源）。
	 */
	const deps = depsAllEnded(ports, workspace, card);

	const plan = ports.cards.planClaim(card, principal, { actorHasActiveWork: busy, at });
	if (!plan.ok) {
		return {
			ok: false,
			error: coreError('WORK_SINGLE_CLAIM', describeReject(plan.reason as never), {
				reason: plan.reason,
				depsAllEnded: deps,
			}),
		};
	}

	let updated: Card | undefined;
	let recomputed: Card[] = [];
	ports.store.transaction(workspace.wsId, (tx) => {
		for (const item of plan.items) {
			if (item.op === 'updateCard') updated = item.card;
			else if (item.op === 'setStatus') {
				const fresh = tx.read(item.cardId);
				if (fresh === undefined) continue;
				updated = { ...fresh, status: item.to };
			}
		}
		if (updated === undefined) return;

		/* 历史事件由 ⑦ 给（不含时间戳则空），⑧ 在事务内补齐。 */
		const events = plan.events as readonly { at: number; action: string; detail?: unknown }[];
		if (events.length > 0) updated = { ...updated, history: [...updated.history, ...events] };

		tx.write([updated]);

		/*
		 * 监听链：领取让状态变了 ⇒ 父卡重算。
		 * **同一个事务**内做，否则会出现"子卡已领、父卡状态没更新"的中间态。
		 */
		recomputed = [...recomputeAfter(ports, tx, updated, at)];
	});

	if (updated === undefined) {
		return { ok: false, error: coreError('WORK_SINGLE_CLAIM', '领取未产出新卡。') };
	}
	return { ok: true, card: updated, recomputed };
}

/**
 * 在事务内对"刚改过状态的卡"跑监听链，返回连带改变的父卡。
 *
 * 抽成一个函数：五个调用点（级联 / 采纳 / 领取 / 释放 / 建卡 / 编辑）写法完全一样，
 * 各写一遍就会有五份"传哪些 id"的判断。
 *
 * ⚠ 重算失败**打印但不抛**：事务里的已写内容不该因为"某张父卡的规则抛错"而整体回滚 ——
 * 那会把一个局部数据问题放大成全局失败。错误由调用方经由 `recomputed` 的缺失察觉不到，
 * 所以这里必须打日志（不静默）。
 */
function recomputeAfter(
	ports: Pick<Ports, 'types'>,
	tx: Tx,
	card: Card,
	at: number,
): readonly Card[] {
	const result = recomputeUpward(ports, tx, [card.id], { at });
	if (result.failures.length > 0) {
		console.error('[taskboard2-core] 状态变更后重算失败：');
		for (const item of result.failures) console.error(`  · [${item.code}] ${item.message}`);
	}
	return result.changed;
}

/** 释放。 */
export function releaseClaim(
	ports: Ports,
	workspace: ActiveWorkspace,
	cardId: string,
	principal: Principal,
	at: number,
): ClaimResult {
	const card = findCard(workspace, cardId);
	if (card === undefined || card.deleted === true) {
		return { ok: false, error: coreError('CARD_NOT_FOUND', `找不到这张卡：${cardId}`, { cardId }) };
	}

	const plan = ports.cards.planRelease(card, principal, { at });
	if (!plan.ok) {
		return {
			ok: false,
			error: coreError('WORK_SINGLE_CLAIM', describeReject(plan.reason as never), {
				reason: plan.reason,
			}),
		};
	}

	let updated: Card | undefined;
	let recomputed: Card[] = [];
	ports.store.transaction(workspace.wsId, (tx) => {
		for (const item of plan.items) {
			if (item.op === 'updateCard') updated = item.card;
		}
		if (updated === undefined) return;

		const events = plan.events as readonly { at: number; action: string; detail?: unknown }[];
		/* 强制释放的判定在 ⑦（它知道 `claimedBy` 与主体的关系）；这里只搬运事件。 */
		if (events.length > 0) updated = { ...updated, history: [...updated.history, ...events] };

		tx.write([updated]);

		/* 监听链：释放改了状态 ⇒ 父卡重算（同事务）。 */
		recomputed = [...recomputeAfter(ports, tx, updated, at)];
	});

	if (updated === undefined) {
		return { ok: false, error: coreError('WORK_SINGLE_CLAIM', '释放未产出新卡。') };
	}
	return { ok: true, card: updated, recomputed };
}

/** 该卡当前是否由这个主体持有（供门面与 ⑨ 查）。 */
export function isHeldBy(card: Card, principal: Principal): boolean {
	return card.claimedBy !== '' && samePrincipal(card.claimedBy, principal);
}

/** 删除（墓碑）。业务删除 = 写 `deleted: true` 的整卡覆写，**永不调 `purgePhysical`**。 */
export function deleteCard(
	ports: Pick<Ports, 'store' | 'cards' | 'types'>,
	workspace: ActiveWorkspace,
	cardId: string,
	at: number,
): ClaimResult {
	const card = findCard(workspace, cardId);
	if (card === undefined) {
		return { ok: false, error: coreError('CARD_NOT_FOUND', `找不到这张卡：${cardId}`, { cardId }) };
	}

	const plan = ports.cards.planDelete(card, { at });
	if (!plan.ok) {
		return {
			ok: false,
			error: coreError('CREATE_VALIDATION_FAILED', describeReject(plan.reason as never), {
				reason: plan.reason,
			}),
		};
	}

	let updated: Card | undefined;
	let recomputed: Card[] = [];
	ports.store.transaction(workspace.wsId, (tx) => {
		for (const item of plan.items) {
			if (item.op === 'updateCard') updated = item.card;
		}
		if (updated === undefined) return;
		const events = plan.events as readonly { at: number; action: string; detail?: unknown }[];
		if (events.length > 0) updated = { ...updated, history: [...updated.history, ...events] };
		tx.write([updated]);

		/*
		 * 监听链：删除**改变了父卡的子任务集合** ⇒ 父卡要重算。
		 *
		 * 墓碑在 ③ 的 `liveChildren` 里被滤掉 ⇒ 父卡的推导会看到"这个孩子不在了"。
		 * ⚠ 这里传的是**被删卡的 id**：`recomputeUpward` 会去找它的父卡。
		 */
		const result = recomputeUpward(ports, tx, [updated.id], { at });
		recomputed = [...result.changed];
		if (result.failures.length > 0) {
			console.error('[taskboard2-core] 删除后重算失败：');
			for (const item of result.failures) console.error(`  · [${item.code}] ${item.message}`);
		}
	});

	/* 幂等：已墓碑时 ⑦ 给空计划 ⇒ 返回原卡。 */
	return { ok: true, card: updated ?? card, recomputed };
}
