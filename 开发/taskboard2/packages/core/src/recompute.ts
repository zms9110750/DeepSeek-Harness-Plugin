/**
 * ⑧ core —— 计算态重算（**监听链**）。
 *
 * ## 用户的口径（`【用户指令，2026-11-02 02:25】`）
 *
 * > 「所有任务卡都是监听自己的监听对象。目标看自己的子任务的状态变化。既然变了，
 * >   扳机，触发时点就出来了。那当然应该触发。」
 *
 * ⇒ **模型是"监听"，不是"上溯遍历"**：
 *   · 每张卡只监听**自己的直接子任务**（不监听孙任务 —— 孙任务变了由子卡自己转发上来）；
 *   · 子任务状态变了 ⇒ **父卡重算**；
 *   · **父卡的状态若因此变了 ⇒ 轮到祖父卡重算**（链式）。
 *
 * ## 为什么用队列而不是递归
 *
 * "链式"听起来像递归，但**递归会让栈深度等于链长**。而监听链本质是"一个通知传给下一个"，
 * **队列天然表达它，且没有栈深度上限**。
 * ⇒ 本文件用 `queue` + `visited`，**不是**函数自调用。
 *
 * ## 链断条件
 *
 * **重算结果 = 当前状态 ⇒ 不写、不往上通知。**
 * 这就是"没变就不用通知" —— 也正是监听模型的自然后果：**没有事件发生，就没有下一个监听者被唤醒**。
 *
 * ## 只做计算态，不碰依赖
 *
 * 用户同句：「唯一一个跨任务的是依赖。但是这个的触发时点是手动操作，所以不需要立刻检查。」
 * ⇒ **`dependsOn` 不进本链**。依赖的门在领取时由 ③ 的 `canTransition`（`ctx.depsAllEnded`）判，
 * 由 `claims.ts` 算好传入。
 *
 * ## 成本（如实说明）
 *
 * 每次调用**扫一遍全量卡**建一次 `parent → children` 索引（一次 O(n)），
 * 之后每张卡的重算都是 map 查找（O(1)），**不是每张卡各扫一遍全表**。
 * 当前空间卡量级"编号不上 99"（用户口径）⇒ 一次 O(n) 可接受。
 * 若将来成为热点，正解是 **core 自己持有增量维护的索引**，而不是让本函数反复扫。
 *
 * ## 与 ⑦ 的分工
 *
 * 重算**只改 `status`**，且这个值**来自 ③ 的 `deriveStatus`（规则在 ③）** ——
 * 所以这里直接写卡、不经 ⑦ 的 `planChange`（`planChange` 管的是 title/note/sections/relations，
 * 不含 status）。**⑧ 只做"把 ③ 算出的值落盘 + 写历史"**，不含任何规则判断。
 */

import { coreError, type CoreError } from './errors.js';
import type { Card, ChildSnapshot, Ports, Tx } from './ports.js';
import { applyStatus } from './status-write.js';

/** 重算写进历史的动作名（**封闭标识，不是文案**）。 */
export const RECOMPUTE_ACTION = 'recompute';

/** `recomputeUpward` 的可选入参。 */
export interface RecomputeOptions {
	/** 时间戳。**由门面给** —— ⑧ 的流程模块不直接读时钟。 */
	readonly at: number;
	/**
	 * 已读的卡快照。省略则本函数自己 `tx.readAll()` 一次。
	 *
	 * 传它的意义：级联 / 采纳 / 领取这些调用方**本来就已经读过全量**
	 * （它们要在事务里建 `byId`），再读一次是白扫一遍。
	 */
	readonly cards?: readonly Card[];
}

/** 重算结果。 */
export interface RecomputeResult {
	/** 被重算且**状态真的变了**的卡（已写盘）。 */
	readonly changed: readonly Card[];
	/** 实际被重算过的卡 id（按处理顺序）—— 供诊断与测试断言。 */
	readonly visited: readonly string[];
	/**
	 * 单卡重算失败（③ 的 `deriveStatus` 抛错，例如旧卡引用了已注销的分类）。
	 *
	 * **不静默**：把错误带出去，让调用方 / 门面决定怎么呈现；
	 * **不中断整条链**：一张坏卡不该让其它父卡也不更新。
	 */
	readonly failures: readonly CoreError[];
}

/** 一次全量扫描的结果：`id → 卡` 与 `父 id → 直接子卡`。 */
interface CardIndex {
	readonly byId: Map<string, Card>;
	readonly childrenOf: Map<string, Card[]>;
}

/**
 * 把一张卡转成 ③ 要的 `ChildSnapshot`。
 *
 * ⚠ **`template` 取 `card.template.ref`（模板 name，如 `'research'`），不是 `.kind`（分类，如 `'work'`）**。
 * `TemplateRef` 同时有这两个字段、且都是 `string` ⇒ 写错**编译不报错、运行不报错**，
 * 只会让 `design.2.2`（判 `child.template === 'research'`）**静默永不命中**。
 */
function snapshotOf(card: Card): ChildSnapshot {
	return {
		id: card.id,
		kind: card.template.kind,
		template: card.template.ref,
		status: card.status,
		deleted: card.deleted === true,
	};
}

/** 扫一遍卡集，建两个索引。**只扫一次**（不是每张卡各扫一遍）。 */
function indexCards(cards: readonly Card[]): CardIndex {
	const byId = new Map<string, Card>();
	const childrenOf = new Map<string, Card[]>();

	for (const card of cards) {
		byId.set(card.id, card);
		const parent = card.relations.parent;
		if (parent === '') continue;
		const siblings = childrenOf.get(parent);
		if (siblings === undefined) childrenOf.set(parent, [card]);
		else siblings.push(card);
	}

	return { byId, childrenOf };
}

/**
 * 取一张卡的**直接**子任务 —— **原样传，不预先过滤**。
 *
 * ⚠ 为什么不在 ⑧ 这侧滤墓碑：③ 的 `liveChildren` 在**每条**计算规则里都调了（8 条无一例外），
 * 过滤动作只有那一处。⑧ 再滤一次就是**两处都滤** ⇒ 将来 ③ 的过滤口径一变，
 * 两边立刻不一致。
 *
 * ⇒ 传原始列表（含墓碑、含草稿、含终态），由 ③ 决定谁参与推导。
 */
function childrenOf(index: CardIndex, cardId: string): Card[] {
	return index.childrenOf.get(cardId) ?? [];
}

/**
 * 沿监听链向上重算。
 *
 * @param changedCardIds **刚刚状态发生变化的卡**（触发者）。本函数从**它们的父卡**开始重算。
 * @param options 时间戳 +（可选）已读快照。
 */
export function recomputeUpward(
	ports: Pick<Ports, 'types'>,
	tx: Tx,
	changedCardIds: readonly string[],
	options: RecomputeOptions,
): RecomputeResult {
	const index = indexCards(options.cards ?? tx.readAll());
	const { at } = options;

	/*
	 * 待处理队列的初始值 = **变化的卡的父卡**。
	 * 变化的那张卡自己不需要重算（它的状态是刚被显式设定的，不是算出来的）。
	 */
	const queue: string[] = [];
	const enqueued = new Set<string>();

	const enqueueParentOf = (cardId: string): void => {
		const card = index.byId.get(cardId);
		if (card === undefined) return;
		const parentId = card.relations.parent;
		if (parentId === '') return; /* 顶层：没有父卡，链到此为止 */
		if (enqueued.has(parentId)) return;
		enqueued.add(parentId);
		queue.push(parentId);
	};

	for (const cardId of changedCardIds) enqueueParentOf(cardId);

	/** 已重算过的卡 —— **防环**（损坏数据里 `A.parent=B` 且 `B.parent=A` 可达）。 */
	const visited = new Set<string>();
	const visitedOrder: string[] = [];
	const changed: Card[] = [];
	const failures: CoreError[] = [];

	/* 逐个通知（不是递归）：取队头 → 重算 → 变了就把它的父卡入队。 */
	while (queue.length > 0) {
		const cardId = queue.shift() as string;

		/* 防环：同一张卡在一次传播里只重算一次（也顺带去重）。 */
		if (visited.has(cardId)) continue;
		visited.add(cardId);
		visitedOrder.push(cardId);

		const card = index.byId.get(cardId);
		if (card === undefined) continue;
		/* 墓碑卡不参与推导，也不往上传播（它已经出局）。 */
		if (card.deleted === true) continue;

		const deriveStatus = ports.types.deriveStatus;
		if (typeof deriveStatus !== 'function') {
			/*
			 * ③ 没提供 `deriveStatus` ⇒ 重算无法进行。
			 * **不静默降级成"当作没变"**：那会让整条链假装跑过。
			 * 记一条 failure 并停止向上传播（本卡状态未知，继续传会基于错误前提）。
			 */
			failures.push(
				coreError(
					'RECOMPUTE_UNAVAILABLE',
					'③ 未提供 deriveStatus，无法重算计算态（整条监听链当前不可用）。',
					{ cardId },
				),
			);
			break;
		}

		const children = childrenOf(index, cardId).map(snapshotOf);

		let nextStatus: string;
		try {
			nextStatus = deriveStatus(card.template.kind, {
				status: card.status,
				/* `isHeld` = 有占用者（③ 的 `RuleInput` 约定：由 ⑧ 从 `claimedBy` 判空得到）。 */
				isHeld: card.claimedBy !== '',
				children,
			});
		} catch (error) {
			failures.push(
				coreError(
					'RECOMPUTE_FAILED',
					`重算卡「${cardId}」失败：${error instanceof Error ? error.message : String(error)}`,
					{ cardId, kind: card.template.kind },
				),
			);
			/* 这张卡状态未知 ⇒ 链在这里断掉，不往上传播。 */
			continue;
		}

		/*
		 * 性能早退：避免构造 events 数组再丢掉。**真正的判等在 `applyStatus` 内部**
		 * （它还会保证"同值 ⇒ 不追加历史"）。
		 */
		if (nextStatus === card.status) continue;

		/*
		 * 写卡走**收口**（⑧ 唯一的 status 写入口）——
		 * 循环、队列、`visited` 都不变，只把"赋值 + 追加历史"这一步交出去。
		 * ⇒ 收口覆盖全部 5 条写 status 的路径，`recompute` 不是例外。
		 */
		const outcome = applyStatus({
			card,
			to: nextStatus,
			events: [{ at, action: RECOMPUTE_ACTION, detail: { from: card.status, to: nextStatus } }],
			mode: 'transition',
		});
		if (!outcome.changed) continue;

		const next = outcome.card;

		/* 更新索引：后续若有人读这张卡（它也是别人的子任务）要看到新状态。 */
		index.byId.set(cardId, next);
		changed.push(next);

		/* ③ 它自己变了 ⇒ 唤醒它的父卡（链式传播）。 */
		enqueueParentOf(cardId);
	}

	if (changed.length > 0) tx.write(changed);

	return { changed, visited: visitedOrder, failures };
}
