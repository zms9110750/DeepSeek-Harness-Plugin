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
import type { Actor, Card, Ports, Principal, Tx } from './ports.js';
import { recomputeUpward } from './recompute.js';
import { appendHistory, applyStatus, type HistoryEvent } from './status-write.js';
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

/**
 * `claimedBy` 里消息循环的前缀。
 *
 * `【用户指令，2026-11-02 13:30】`：「loop要改名，前缀改就一起改。**agentMessageLoop**」
 * ⇒ 前缀从 `loop:` 改为 `agentMessageLoop:`。
 *
 * ⚠ **这个前缀是落库的**（写在 `claimedBy` 字段里）⇒ 改名后**库里已有的 `loop:xxx` 解不回来**。
 * 现在无真实数据（原型阶段）⇒ **不做迁移**；若将来有存量数据，必须先跑一次字符串迁移。
 * ⚠ **必须与 ⑦ 的 `describePrincipal` 一致**（它产出这个值），否则两边认不出同一个持有者。
 */
const LOOP_CLAIM_PREFIX = 'agentMessageLoop:';

/** 主体是否与 `claimedBy` 指向同一个持有者。 */
function samePrincipal(claimedBy: string, principal: Principal): boolean {
	if (principal.type === 'user') return claimedBy === USER_CLAIM;
	return claimedBy === `${LOOP_CLAIM_PREFIX}${principal.id}`;
}

/** 该 actor 名下的字符串（写进 `claimedBy`）。 */
function claimValueOf(principal: Principal): string {
	return principal.type === 'user' ? USER_CLAIM : `${LOOP_CLAIM_PREFIX}${principal.id}`;
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

/**
 * 领取。
 *
 * @param principal **谁在领**（身份，有 id；写进 `claimedBy`）
 * @param actor **什么权限**（类别，无 id；问 ③ 的 `canTransition`）
 *
 * ⚠ 两个参数**不能互相推导**（用户 14:05：「这是两个不同的东西」）；
 *   `actor` 由**调用入口写死**（⑨ AI tool ⇒ `'ai'`、⑩ UI ⇒ `'user'`），⑧ **不推断**。
 */
export function claimCard(
	ports: Ports,
	workspace: ActiveWorkspace,
	cardId: string,
	principal: Principal,
	actor: Actor,
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

	const plan = ports.cards.planClaim(card, principal, actor, {
		actorHasActiveWork: busy,
		depsAllEnded: deps,
		at,
	});
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
		/*
		 * 把 ⑦ 的计划意图翻译成 `(字段来源卡, 目标值, 旧值基准)` 三元组。
		 *
		 * 两种 `op` 形状不同：
		 *   · `updateCard` —— ⑦ 给**整卡**，status **已经是目标值** ⇒ 目标值从卡上读，
		 *     旧值基准取事务内的旧卡；
		 *   · `setStatus`  —— ⑦ 只给"改成什么" ⇒ 字段来源与旧值基准**都是**事务内旧卡，
		 *     目标值用 `item.to`。**不需要先拼一张 `{...fresh, status: item.to}` 的假卡。**
		 *
		 * ⇒ 两种形状在这里收敛成三元组，**后续只有一条 `applyStatus` 调用**；
		 *   与 `adopt.ts` 的写法一致（那里也是"直接传卡 + to"，不预拼整卡）。
		 *
		 * ## ⚠ `setStatus` 分支当前**无调用方**（保留是因为它服务于已知的演化方向）
		 *
		 * ⑦ 产出 `setStatus` 的只有 `taskcard/adopt.ts:85,106`，而它走的是**本包的 `adopt.ts`**、
		 * 不是这里。**领取 / 释放的 ⑦ 计划只产 `updateCard`**
		 * （`taskcard/claim.ts:110`、`taskcard/release.ts:88`，都是单元素数组字面量）
		 * ⇒ **本函数的 `setStatus` 分支今天走不到。**
		 *
		 * **为什么"留 `setStatus` 分支"但"不留多条 intent 的防御"** —— 两者判据不同，写清免得看起来随心：
		 *   · `setStatus` 分支：服务于**已知的演化方向**（⑦ 若把 `planClaim` / `planRelease` 改成
		 *     只给"改成什么"而非整卡，就会走到）。**代价 ~6 行，收益是那时不用改这里。**
		 *   · 多条 intent 的防御：服务于**假想情形**（没有已知计划要这么做）；且真要发生，
		 *     根因在函数形状（`claimCard` 返回 `card: Card` 而非 `cards: Card[]`），
		 *     **加运行时抛错只是让它更深处炸，不会让它变对。**
		 *
		 * ## ⚠ 隐式契约（**两条**，都由 ⑦ 的形状保证，不由本函数保证）
		 *
		 * 1. **只含一条状态意图** —— 本循环是"后写覆盖先写"，多条时前面的会被**静默丢弃**；
		 * 2. **不混用 op** —— 若一条 `updateCard` + 一条 `setStatus`，落盘只看最后一条，
		 *    "落哪张卡"就从"按 op 推"退化成"按顺序推"。
		 * ⇒ 任一条件被 ⑦ 打破，这里必须改（且**不会报错**，只会静默按最后一条落盘）。
		 */
		let intent: { readonly card: Card; readonly to: string; readonly from: string } | undefined;

		for (const item of plan.items) {
			if (item.op === 'updateCard') {
				const before = tx.read(item.card.id);
				if (before === undefined) continue;
				intent = { card: item.card, to: item.card.status, from: before.status };
			} else if (item.op === 'setStatus') {
				const before = tx.read(item.cardId);
				if (before === undefined) continue;
				intent = { card: before, to: item.to, from: before.status };
			}
		}
		if (intent === undefined) return;

		const events = plan.events as readonly HistoryEvent[];
		const outcome = applyStatus({
			card: intent.card,
			to: intent.to,
			from: intent.from,
			events,
			mode: 'transition',
		});

		/*
		 * 同值时落的盘：`intent.card`。
		 *
		 * ⚠ **这个正确性是按 op 各自推出来的，不是设计天然安全** —— 两种情况要分开看：
		 *   · `setStatus`  —— `intent.card` = 事务内旧卡。⑦ 只说"改状态"，状态没变 ⇒ 别的也没变
		 *     ⇒ 落旧卡等于**无变化的写**（幂等，无害）；
		 *   · `updateCard` —— `intent.card` = ⑦ 的整卡。⑦ 可能**同时**改了 `claimedBy` / `title` /
		 *     `sections` 等，那些与 status 无关、必须落盘 ⇒ 落 `item.card` 正确。
		 *
		 * ⇒ 两种都对，但**理由不同**；若将来加第三种 op，必须重新推一遍它在这种情形下该落哪张卡。
		 * ⇒ 不写历史、不广播（用户「不切是必要的」）。
		 */
		updated = outcome.changed ? outcome.card : intent.card;

		tx.write([updated]);

		/*
		 * 监听链：**只有 status 真的变了**才通知父卡。
		 * 领取在正常路径上一定变（提交 → 处理中），但收口后不再假设。
		 * **同一个事务**内做，否则会出现"子卡已领、父卡状态没更新"的中间态。
		 */
		if (outcome.changed) recomputed = [...recomputeAfter(ports, tx, updated, at)];
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

/**
 * 释放。
 *
 * @param principal 谁在释放（身份）　@param actor 什么权限（类别）
 */
export function releaseClaim(
	ports: Ports,
	workspace: ActiveWorkspace,
	cardId: string,
	principal: Principal,
	actor: Actor,
	at: number,
): ClaimResult {
	const card = findCard(workspace, cardId);
	if (card === undefined || card.deleted === true) {
		return { ok: false, error: coreError('CARD_NOT_FOUND', `找不到这张卡：${cardId}`, { cardId }) };
	}

	const plan = ports.cards.planRelease(card, principal, actor, { at });
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
		let proposed: Card | undefined;
		for (const item of plan.items) {
			if (item.op === 'updateCard') proposed = item.card;
		}
		if (proposed === undefined) return;

		const before = tx.read(proposed.id);
		if (before === undefined) return;

		const events = plan.events as readonly HistoryEvent[];
		/* 强制释放的判定在 ⑦（它知道 `claimedBy` 与主体的关系）；这里只搬运事件。 */
		const outcome = applyStatus({
			card: proposed,
			to: proposed.status,
			from: before.status,
			events,
			mode: 'transition',
		});

		/* status 同值 ⇒ 不写历史、不广播；但 ⑦ 清的占用字段仍要落盘。 */
		updated = outcome.changed ? outcome.card : proposed;

		tx.write([updated]);

		/* 监听链：**只有 status 真的变了**才通知父卡（同事务）。 */
		if (outcome.changed) recomputed = [...recomputeAfter(ports, tx, updated, at)];
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

/**
 * 纯状态转移（成功 / 失败 / 取消 / 拒绝 / 搁置）。
 *
 * 用户 11-02 13:30：「我加上去了。**工作的进行和搁置的4个状态都可以用户点击失败**。」
 *
 * ## 谁判什么
 *
 * | 谁 | 判什么 |
 * |---|---|
 * | **⑦ `planTransition`** | 单卡准入 + **三道闸**（有成功交付 / 所有子任务完成 / 有失败交付或阻碍，用 `all` 全量卡自算） |
 * | **⑧（本函数）** | 只算两件事实：`depsAllEnded`；把 `principal` / `actor` 原样传下去 |
 * | **③ `canTransition`** | 转移合不合法（由 ⑦ 内部问） |
 *
 * ⚠ **⑧ 不判那三道闸** —— 它们要"这张卡有哪些子任务、各自什么状态、有没有交付"，
 * 那是 ⑦ 的卡语义 + ③ 的分类知识。
 *
 * ## 写盘
 *
 * 与领取 / 释放 / 采纳 / 级联 / 重算**同一条收口**（`applyStatus(mode:'transition')`）：
 * **同值 ⇒ 不写盘、不写历史、不广播**（用户「不切是必要的」）。
 */
export function transitionCard(
	ports: Ports,
	workspace: ActiveWorkspace,
	cardId: string,
	to: string,
	principal: Principal,
	actor: Actor,
	at: number,
): ClaimResult {
	const card = findCard(workspace, cardId);
	if (card === undefined || card.deleted === true) {
		return { ok: false, error: coreError('CARD_NOT_FOUND', `找不到这张卡：${cardId}`, { cardId }) };
	}

	/* 依赖是否全部进入「完成」组 —— ⑦ 的三道闸之一要用它。 */
	const deps = depsAllEnded(ports, workspace, card);

	/*
	 * `all` 给**全量含墓碑**（与 `planAdopt` 一致）：⑦ 自己用 `liveChildren` 滤。
	 * ⇒ ⑧ 不预过滤 —— 过滤口径只有 ⑦/③ 一处。
	 */
	const plan = ports.cards.planTransition(card, workspace.cards, {
		to,
		principal,
		actor,
		depsAllEnded: deps,
		at,
	});
	if (!plan.ok) {
		return {
			ok: false,
			error: coreError('TRANSITION_REJECTED', describeReject(plan.reason as never), {
				reason: plan.reason,
				depsAllEnded: deps,
				to,
			}),
		};
	}

	let updated: Card | undefined;
	let recomputed: Card[] = [];
	let failure: CoreError | undefined;

	ports.store.transaction(workspace.wsId, (tx) => {
		/* 事务内定基准：计划可能是 `updateCard`（整卡）或 `setStatus`（只给 to）。 */
		let intent: { readonly card: Card; readonly to: string; readonly from: string } | undefined;

		for (const item of plan.items) {
			if (item.op === 'updateCard') {
				const before = tx.read(item.card.id);
				if (before === undefined) continue;
				intent = { card: item.card, to: item.card.status, from: before.status };
			} else if (item.op === 'setStatus') {
				const before = tx.read(item.cardId);
				if (before === undefined) continue;
				intent = { card: before, to: item.to, from: before.status };
			}
		}
		if (intent === undefined) {
			/*
			 * 两种情形必须分开：
			 *   · `plan.items` 为空 ⇒ ⑦ 已经判定"无需发生"（同值），返回成功但无变化；
			 *   · 有 items 却定不出基准 ⇒ 事务内读不到那张卡（并发删了），是真错。
			 *
			 * ⚠ 曾经一律报 `CARD_NOT_FOUND`，把"点了已经是的状态"报成"卡不存在"。
			 */
			if (plan.items.length === 0) {
				const current = tx.read(cardId);
				if (current !== undefined) updated = current;
				return;
			}
			failure = coreError('CARD_NOT_FOUND', `转移未定出基准卡（卡 ${cardId}）。`, { cardId });
			return;
		}

		const events = plan.events as readonly HistoryEvent[];
		const outcome = applyStatus({
			card: intent.card,
			to: intent.to,
			from: intent.from,
			events,
			mode: 'transition',
		});

		/* 同值 ⇒ 不写历史、不广播；但 ⑦ 若同时改了别的字段，那些仍要落盘。 */
		updated = outcome.changed ? outcome.card : intent.card;

		tx.write([updated]);

		/* 监听链：**只有 status 真的变了**才通知父卡（同事务）。 */
		if (outcome.changed) recomputed = [...recomputeAfter(ports, tx, updated, at)];
	});

	if (failure !== undefined) return { ok: false, error: failure };
	if (updated === undefined) {
		return { ok: false, error: coreError('TRANSITION_REJECTED', '转移未产出新卡。') };
	}
	return { ok: true, card: updated, recomputed };
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
	ports.store.transaction(workspace.wsId, (tx) => {
		for (const item of plan.items) {
			if (item.op === 'updateCard') updated = item.card;
		}
		if (updated === undefined) return;

		/*
		 * 归档：**只置 `deleted`，不改 status** ⇒ 走 `appendHistory`，不走 `applyStatus`。
		 *
		 * ## 为什么不广播 —— 三个前提缺一不可
		 *
		 * 1. **③ 的 `liveChildren` 滤草稿** ⇒ 父卡的 `children` 里本来就没有草稿子卡；
		 * 2. **删除 = 标记墓碑**（`【用户指令，2026-11-01 03:32】`「删除是标记为删除」）
		 *    且 **`liveChildren` 也滤墓碑** ⇒ 墓碑对父卡同样不可见；
		 * 3. **被归档的卡在归档前必须是草稿**（⑦ 的 `planDelete` 强制 `DRAFT`；
		 *    `【用户指令，2026-11-02 13:15】`「归档在现阶段只有草稿才能归档」）。
		 *
		 * ⇒ 归档前不可见（前提 1 + 3）、归档后仍不可见（前提 2）⇒ **父卡看到的东西没变** ⇒ 不通知。
		 *
		 * ⚠⚠ **前提 3 是"现阶段"的规则，不是永久约束。** 若将来允许"非草稿也能归档"，
		 * 那张卡归档前对父卡**是可见的**、归档后不可见 ⇒ **父卡看到的东西变了 ⇒ 这里必须改成广播**。
		 *
		 * ⚠⚠ **本结论依赖 ③ 的 `liveChildren`（`packages/types/src/kind.ts`）同时滤墓碑与草稿。**
		 * 若 ③ 改了那个函数的过滤口径，**本结论立刻失效，而 ⑧ 这边不会有任何编译或运行报错** ——
		 * 只会静默地少通知一次父卡重算。**改 ③ 的人请回来看这一行。**
		 *
		 * ⇒ 一句话：**这条"不广播"是三个前提共同支撑的，任何一个变松它都会静默失效。**
		 */
		updated = appendHistory(updated, plan.events as readonly HistoryEvent[]);
		tx.write([updated]);
	});

	/* 幂等：已墓碑时 ⑦ 给空计划 ⇒ 返回原卡。 */
	return { ok: true, card: updated ?? card, recomputed: [] };
}
