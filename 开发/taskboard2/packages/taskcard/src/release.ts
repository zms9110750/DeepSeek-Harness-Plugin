/**
 * ⑦ 任务卡 —— 释放。
 *
 * ## 释放是什么
 *
 * **`处理中 → 提交`**（`【用户指令，2026-11-01 06:55】`「（释放后）回到『提交』。」）。
 * 往返对称：`提交 →(领取)→ 处理中 →(释放)→ 提交`。
 *
 * ## 谁能释放
 *
 * `【用户指令，2026-11-01 07:00】`「**用户可以释放。用户权限和 ai 权限是不同的。**」
 * ⇒ 准入 = **持有者本人 或 用户**。
 *
 * 为什么用户要能释放别人的卡：持有者（消息循环）可能已经消失（会话结束 / 崩溃），
 * 否则**没有任何 actor 能满足"本人"** ⇒ 卡被永久锁死在「处理中」。
 *
 * ## `claimedBy` 的语义
 *
 * 它是**"谁在占用"**，不是**"谁有权释放"**。权限差异由 `Principal` 表达，
 * 不要把它当权限字段读。
 *
 * ## 强制释放要留痕
 *
 * 用户释放**不是自己持有**的卡 ⇒ 记 `force-release`（带原持有者），
 * 否则历史里"异常解除"与"正常放下"不可区分，复盘时无法回答"这张卡为什么被换过人"。
 */

import type { Card, HistoryEntry, Plan, PlanItem, PlanResult, Ports, Principal } from './types.js';
import { describePrincipal, principalOfClaim } from './claim.js';

/** 释放写进历史的动作名。 */
export const RELEASE_ACTION = 'release';

/** 用户强制释放（不是自己持有）时写进历史的动作名。 */
export const FORCE_RELEASE_ACTION = 'force_release';

/** `planRelease` 的入参。 */
export interface ReleaseInput {
	/** 由 ⑧ 在事务内盖；⑦ 不取时钟。省略则不写历史。 */
	at?: number;
}

export function planRelease(
	ports: Ports,
	card: Card,
	principal: Principal,
	input: ReleaseInput = {},
): PlanResult {
	if (card.deleted) {
		return { ok: false, reason: { kind: 'already-deleted' } };
	}

	const working = ports.types.states.WORKING;
	if (card.status !== working) {
		return { ok: false, reason: { kind: 'not-releasable', why: 'not-working' } };
	}

	const holder = principalOfClaim(card.claimedBy);
	const isHolder = holder !== undefined && describePrincipal(holder) === describePrincipal(principal);
	const isUser = principal.type === 'user';

	// 准入：持有者本人，或用户（用户权限更高，可处理"持有者已消失"的卡）。
	if (!isHolder && !isUser) {
		return { ok: false, reason: { kind: 'not-releasable', why: 'not-holder' } };
	}

	const target = ports.types.states.SUBMITTED;
	if (!ports.types.canTransition(card.template.kind, card.status, target, principal)) {
		return { ok: false, reason: { kind: 'not-releasable', why: 'not-working' } };
	}

	const events: HistoryEntry[] = [];
	if (input.at !== undefined) {
		// 非本人释放 ⇒ 记 force_release，并带上原持有者（否则等于没记账）。
		if (!isHolder) {
			events.push({
				at: input.at,
				action: FORCE_RELEASE_ACTION,
				detail: { previousHolder: card.claimedBy, by: describePrincipal(principal) },
			});
		} else {
			events.push({ at: input.at, action: RELEASE_ACTION });
		}
	}

	const items: PlanItem[] = [
		{
			op: 'updateCard',
			card: {
				...card,
				status: target,
				// 释放即清空占用：`claimedBy` 与 `claimedAt` 同生同灭。
				claimedBy: '',
				claimedAt: 0,
			},
		},
	];

	const plan: Plan = { ok: true, items, events };
	return plan;
}
