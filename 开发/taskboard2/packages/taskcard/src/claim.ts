/**
 * ⑦ 任务卡 —— 领取。
 *
 * ## 领取是什么
 *
 * **`提交 → 处理中`**（用户 00:47 口径；用户与 AI 都可以）。
 * 与「采纳」是两个不同动作：采纳是 `未指定 → 提交`（只能用户）。
 *
 * ## ⑦ 在这一步判什么（只判单卡）
 *
 *   · 卡不是墓碑、不是草稿
 *   · 当前状态是「提交」
 *   · 该卡当前**没有被别人占用**（`claimedBy` 为空）
 *   · 转移判决问 ③ 的 `canTransition`
 *
 * ## ⑦ **不**判什么
 *
 *   · **「一个 actor 只能有一张处理中的工作卡」** —— 那是**跨卡聚合**，归 ⑧ 算、⑧ 拦。
 *     ⑦ 只对入参 `ctx.actorHasActiveWork` 做**非空校验**（`undefined` 直接抛错，不许默认 `false`）。
 *   · **「依赖是否全部进入完成组」** —— 那是状态转移的准入条件，归 ③ 的 `canTransition`
 *     （⑧ 把"依赖是否全完成"算好传进去）。⑦ 不扫全图。
 *
 * ## `claimedBy` 存的是**消息循环 id**
 *
 * `【用户指令，2026-11-01 06:43】`「一个会话的子消息，也可以另外领取」
 * ⇒ 存会话 id 会实现成"整会话只能一张"。⑦ 只透传 `actor`，不解释它的构成。
 */

import type { Card, HistoryEntry, Plan, PlanItem, PlanResult, Ports, Principal } from './types.js';

/** 领取写进历史的动作名。 */
export const CLAIM_ACTION = 'claim';

/**
 * 领取时需要由 ⑧ 算好并传入的上下文。
 *
 * ⚠ `actorHasActiveWork` **必填**：漏传 ⇒ ⑦ 抛错（装配缺陷）。
 * 默认 `false` 等于"静默允许重复领取"，这是**数据方向**的错误，不能靠缺省兜。
 */
export interface ClaimContext {
	/** 该 actor 当前是否已有一张「处理中」的工作卡（跨卡聚合，由 ⑧ 算）。 */
	actorHasActiveWork: boolean;
	/**
	 * 该卡的**依赖目标是否全部进入「完成」组**（跨卡聚合，由 ⑧ 算）。
	 *
	 * `【用户指令，2026-11-01 13:18】`「有行为的只有『依赖』。效果是所有依赖对象都进入了
	 * 完成态，这个卡才能被领取」⇒ 这是**转移准入条件**，归 ③ 的 `canTransition` 判，
	 * ⑦ **只搬运**、不自己扫全图。
	 *
	 * `【实现判断】` 可选：不传就不把这条递给 ③（等价于"没有依赖信息"）。
	 * 但**只要传了，就必须是布尔**（不传与 `false` 是两件事，别混）。
	 */
	depsAllEnded?: boolean;
	/** 由 ⑧ 在事务内盖；⑦ 不取时钟。省略则不写历史。 */
	at?: number;
}

export function planClaim(
	ports: Ports,
	card: Card,
	actor: Principal,
	ctx: ClaimContext,
): PlanResult {
	// ── 装配校验：这是编程错误，不是业务拒绝 ⇒ 抛错，不返回 Rejection ──
	// `actorHasActiveWork` 若缺省被当成 `false`，就等于"静默允许重复领取"（数据方向错误），
	// 所以这里宁可炸，也不给默认值。
	const guard = ctx as ClaimContext | undefined;
	if (guard === undefined || typeof guard.actorHasActiveWork !== 'boolean') {
		throw new Error(
			'taskboard2-taskcard: planClaim 需要 ctx.actorHasActiveWork（由 ⑧ 算好传入）；' +
				'漏传会被视为装配缺陷，不允许默认 false。',
		);
	}

	// ── 业务前置 ──
	if (card.deleted) {
		return { ok: false, reason: { kind: 'already-deleted' } };
	}
	if (card.status === ports.types.DRAFT) {
		return { ok: false, reason: { kind: 'not-claimable', why: 'not-submitted' } };
	}
	if (card.claimedBy !== '') {
		return { ok: false, reason: { kind: 'not-claimable', why: 'already-claimed' } };
	}
	if (card.status !== ports.types.states.SUBMITTED) {
		return { ok: false, reason: { kind: 'not-claimable', why: 'not-submitted' } };
	}

	// ── 「一 actor 只能一张处理中的工作卡」：⑧ 已算好，这里只读 ──
	if (ctx.actorHasActiveWork) {
		return { ok: false, reason: { kind: 'not-claimable', why: 'quota-exhausted' } };
	}

	// ── 转移判决问 ③ ──
	// `depsAllEnded` 属于"依赖行为"的准入条件（用户 13:18），归 ③ 判；⑦ 只把 ⑧ 算好的值递过去。
	const target = ports.types.states.WORKING;
	const transitionCtx =
		ctx.depsAllEnded === undefined ? undefined : { depsAllEnded: ctx.depsAllEnded };
	if (!ports.types.canTransition(card.template.kind, card.status, target, actor, transitionCtx)) {
		return { ok: false, reason: { kind: 'not-claimable', why: 'not-submitted' } };
	}

	const events: HistoryEntry[] = [];
	if (ctx.at !== undefined) {
		events.push({ at: ctx.at, action: CLAIM_ACTION, detail: { actor: describePrincipal(actor) } });
	}

	const items: PlanItem[] = [
		{
			op: 'updateCard',
			card: {
				...card,
				status: target,
				// ⚠ 消息循环 id：不解释、不拼接、不归一。
				claimedBy: describePrincipal(actor),
				claimedAt: ctx.at ?? card.claimedAt,
			},
		},
	];

	const plan: Plan = { ok: true, items, events };
	return plan;
}

/**
 * 把主体序列化成 `claimedBy` 里能比较的值。
 *
 * `【实现判断】` 用户与循环用不同前缀区分，避免"用户 id"与"循环 id"撞成同一个字符串。
 * ⑦ **不解释**这个值的内部结构，只保证同一主体得到同一字符串。
 */
export function describePrincipal(principal: Principal): string {
	return principal.type === 'user' ? 'user' : `loop:${principal.id}`;
}

/** 从 `claimedBy` 解回主体（用于"是否本人"的判定）。 */
export function principalOfClaim(claimedBy: string): Principal | undefined {
	if (claimedBy === '') return undefined;
	if (claimedBy === 'user') return { type: 'user' };
	if (claimedBy.startsWith('loop:')) return { type: 'loop', id: claimedBy.slice('loop:'.length) };
	return undefined;
}
