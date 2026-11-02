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
 * 为什么用户要能释放别人的卡：持有者（agent 消息循环）可能已经消失（会话结束 / 崩溃），
 * 否则**没有任何主体能满足"本人"** ⇒ 卡被永久锁死在「处理中」。
 *
 * ## `claimedBy` 的语义
 *
 * 它是**"谁在占用"**（`Principal` = 身份），不是**"谁有权释放"**。
 * 权限类别是另一个参数 `Actor`（`'user' | 'ai' | 'host'`）——
 * **两者不合并、不映射**（`【用户指令，2026-11-02 14:05】`「各用各的不要映射」）。
 * ⇒ 不要拿 `claimedBy` 当权限字段读。
 *
 * ## 强制释放要留痕
 *
 * 用户释放**不是自己持有**的卡 ⇒ 记 `force-release`（带原持有者），
 * 否则历史里"异常解除"与"正常放下"不可区分，复盘时无法回答"这张卡为什么被换过人"。
 */

import type {
	Actor,
	Card,
	HistoryEntry,
	Plan,
	PlanItem,
	PlanResult,
	Ports,
	Principal,
} from './types.js';
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

/**
 * 释放。
 *
 * ## 两个"主体"参数，**不合并、不映射**（`【用户指令，2026-11-02 14:05】`）
 *
 * · `principal`（**身份**）：判断"是不是持有者本人"，写进历史。
 * · `actor`（**权限类别**）：问 ③。
 *
 * ⚠ **"谁能释放"看的是 `principal`（是不是本人 / 是不是用户），不是 `actor`** ——
 * 该判定已在本函数里用 `principalOfClaim(card.claimedBy)` 与 `principal` 比对完成。
 */
export function planRelease(
	ports: Ports,
	card: Card,
	/** **身份**：谁在释放。 */
	principal: Principal,
	/** **权限类别**：问 ③ 用。 */
	actor: Actor,
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
	const verdict = ports.types.canTransition(card.template.kind, card.status, target, actor);
	// `undefined` = ③ 拒绝判决（分类未注册）⇒ 数据问题，不抛，走 reason。
	if (verdict === undefined) {
		return { ok: false, reason: { kind: 'kind-unavailable', kindId: card.template.kind } };
	}
	if (!verdict) {
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
