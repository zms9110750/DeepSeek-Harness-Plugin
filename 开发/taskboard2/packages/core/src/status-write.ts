/**
 * ⑧ core —— 状态写入收口（**唯一的 status 写入口**）。
 *
 * ## 用户的口径
 *
 * > 【用户指令，2026-11-02 12:35】
 * > **1.要收口。2.要广播。**
 * > **因为状态变化，是要去通知父任务的。是有通知机制的。**
 *
 * > **所有转移都要走。触发通知的是状态转移本身。**
 *
 * 以及状态字段应有的形状：
 *
 * ```
 * state{
 *   get;
 *   set{
 *     if(filed==value)
 *     {return;}
 *     filed=value;
 *     广播状态变化。
 *   }
 * }
 *
 * 构造器(){
 *   广播状态变化 += 写历史消息
 * }
 * ```
 *
 * ## 为什么不是给 `Card` 加 setter
 *
 * `Card` 是 ⑦ 的 **structural type**，全字段 `readonly`，靠**不可变展开 + `tx.write(cards)` 批量覆写**。
 * 给它加 class 会把 ⑦ 的领域模型改成带行为的对象，且 **bulk write 与"setter 立刻写盘"根本冲突**。
 * ⇒ **收口落在"⑧ 的一个纯函数"上**：拿卡、算新卡、告诉调用方"变没变"。
 *
 * ## 两个 mode 的语义（这是本文件的核心）
 *
 * | mode | 判等 | 写 card | 追加 history | 返回 changed |
 * |---|---|---|---|---|
 * | `init`（建卡 / fork 初值） | **不判**（没有旧值） | 是 | 是 | **恒 `true`** |
 * | `transition`（采纳 / 领取 / 释放 / 级联 / 重算） | **判** | 同值 ⇒ **不写、不追加** | 同值 ⇒ **不追加** | **真的变了才 `true`** |
 *
 * **⚠ `init` 不广播**（用户：「建卡，fork，这两个卡的状态初始值，严格上不算转移」）。
 * 本文件**不持有广播队列** —— `changed` 就是广播信号，由调用方交给 `recomputeUpward`。
 * （丙方案：不引入第二套队列，复用现有"收集 changed → 调 recompute"模式。）
 *
 * ## 为什么还要 `appendHistory`
 *
 * **不改 status 但必须留痕**的路径（当前是删除：只置 `deleted`）。
 * 用 `applyStatus` 表达删除会让读代码的人以为删除改了 status —— 那是语义污染。
 * ⇒ **两个函数同文件、`[...history, ...events]` 只实现一次。**
 */

import type { Card, HistoryEntry } from './ports.js';

/** 一次写入的结果。 */
export interface StatusWriteOutcome {
	/** 值**真的变了**才为 `true`；`mode: 'init'` 恒 `true`。 */
	readonly changed: boolean;
	/** 新卡对象；未变时 = 传入的原对象（**引用相等**，调用方可用 `===` 判断）。 */
	readonly card: Card;
}

/**
 * 一段历史事件（⑦ 给的 `plan.events` 与 ⑧ 自造的条目共用这个形状）。
 *
 * `action` 是**封闭的机器可读标识**（英文），不是文案 —— 文案归 ⑨⑪。
 */
export interface HistoryEvent {
	readonly at: number;
	readonly action: string;
	readonly detail?: unknown;
}

/**
 * 追加历史（**不改 status**）。
 *
 * 这是**唯一**一处做 `[...card.history, ...events]` 的地方 —— 全部历史追加都过它。
 * `events` 为空 ⇒ **原样返回同一个引用**（不造新对象，避免无意义的引用变化）。
 *
 * @param card 原卡
 * @param events 要追加的条目（按顺序追加，排在已有历史之后）
 */
export function appendHistory(card: Card, events: readonly HistoryEvent[]): Card {
	if (events.length === 0) return card;
	/* ⑦ 的 `HistoryEntry` 与 ⑧ 的 `HistoryEvent` 形状一致，转一次类型即可。 */
	return { ...card, history: [...card.history, ...(events as readonly HistoryEntry[])] };
}

/**
 * 唯一的 **status** 写入口。
 *
 * @param input.card 原卡（**除 status 外**的字段基准；`from` 省略时 `card.status` 也当基准）
 * @param input.to 目标状态（`mode: 'init'` 时就是初值，传值不判等）
 * @param input.from **旧值基准**（可选）。省略 ⇒ 用 `input.card.status`。
 * @param input.events 要一并追加的历史（⑦ 的 `plan.events`）
 * @param input.mode `'init'` = 首值（不判等、恒 changed）；`'transition'` = 转移（判等）
 *
 * ## 为什么需要 `from`
 *
 * ⑦ 的 `planClaim` / `planRelease` / `planAdopt` 给的是**整卡**（status 已写成目标值）。
 * 若直接把它当 `card` 传进来，`to === card.status` **恒成立** ⇒ 永远判同值 ⇒ **永不广播**（静默失效）。
 *
 * ⇒ 调用方需要"拿 ⑦ 的整卡当其余字段的来源，但用**事务内旧卡**的 status 当比较基准"。
 * **这个组合由 `from` 参数表达，而不是让每个调用点自己拼 `{...proposed, status: before.status}`。**
 * 理由：那个拼法若写错（例如漏了某处、或拼反了 `before`/`proposed`），
 * 结果是"永远同值"或"永远不同值" —— **两种都不报错**。
 * ⇒ **拼法只能有一处：这里。**
 */
export function applyStatus(input: {
	readonly card: Card;
	readonly to: string;
	readonly from?: string;
	readonly events?: readonly HistoryEvent[];
	readonly mode: 'init' | 'transition';
}): StatusWriteOutcome {
	const events = input.events ?? [];
	const from = input.from ?? input.card.status;

	/*
	 * ── init：首值 ──
	 *
	 * 没有"旧值"可比较（卡刚被构造出来），**不判等**。
	 * `changed` 恒 `true`，但**调用方不该据此广播** —— 用户的裁决是"初值不算转移、不广播"。
	 * ⇒ 是否广播由**调用路径**决定（建卡 / fork 那条路径压根不调 `recomputeUpward`），
	 *   而不是由这个返回值决定。这样"初值不广播"这条规则只有一处，不会散开。
	 */
	if (input.mode === 'init') {
		const next = appendHistory({ ...input.card, status: input.to }, events);
		return { changed: true, card: next };
	}

	/*
	 * ── transition：转移 ──
	 *
	 * **同值 ⇒ 原样返回，什么都不做。**
	 * 用户：「不切是必要的。因为状态转移会在"历史"里面留下一个记录。」
	 * ⇒ 不写卡、不追加历史、（由调用方看 `changed:false` 得知）不广播。
	 */
	if (input.to === from) {
		return { changed: false, card: input.card };
	}

	const next = appendHistory({ ...input.card, status: input.to }, events);
	return { changed: true, card: next };
}
