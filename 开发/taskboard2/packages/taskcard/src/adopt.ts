/**
 * ⑦ 任务卡 —— 采纳。
 *
 * ## 采纳是什么
 *
 * **纯状态转移**：从草稿转到一个**按分类决定的目的地**。
 *
 * · `goal` / `work` ⇒ 草稿 → **「提交」**（进入计算 / 可领取）
 * · `design` / `record` ⇒ 草稿 → **「需要授权」**
 *
 * `【用户指令，2026-11-02 16:05】`「设计卡 / 记录卡建出来应该是草稿，采纳后才变『需要授权』」
 * ⇒ 四类初始都是草稿，**采纳是唯一入口**。
 *
 * ⚠ **目的地由 ③ 的 `adoptTargetOf(kind)` 给，⑦ 不写分类名单**
 * （名单在 ③ 只有一份，与 `isAdopt` 同源；抄进 ⑦ 会在加第五类时静默漂移）。
 *
 * ⚠ **actor 限制按分类不同**（用户 `13:15`）：`goal` / `work` 只能用户；`design` / `record`
 * 允许 ai。这条在 ③ 的 `canTransition` 里判，⑦ 只透传 `actor`。
 *
 * **采纳本身不产生任何关系** —— 取代边在 fork 时就已建好（`05:52`「采纳了才执行取代」
 * 说的是**执行**，不是建立）。
 *
 * ## 采纳时要执行「取代」
 *
 * 对本卡身上每一条「取代」边（`from` = 本卡，`to` = 旧卡）逐张处置：
 *   · 旧卡在**「完成」组**（成功/失败/取消/拒绝）⇒ **不动**（`superseded-noop`）
 *   · 否则 ⇒ **转「取消」**（`superseded-incomplete`）
 *   · **多条取代 ⇒ 逐张处置**，不是只判一张（用户 13:18 允许取代多个）
 *
 * ## 顺序
 *
 * **先转移依赖、再判旧卡** —— 顺序由 ④ 的计划给出，⑦ 只按序搬运、**不重排**。
 * 反序会让依赖方在旧卡转取消的瞬间被级联误收，而它们本该改指新卡活下来。
 *
 * ⚠ **旧卡已终态**（在「完成」组）⇒ **不产生状态变更项**，只转移依赖。
 */

import type {
	Actor,
	Card,
	CardId,
	HistoryEntry,
	Plan,
	PlanItem,
	PlanResult,
	Ports,
	Principal,
} from './types.js';
import { ADOPT_ACTION, SUPERSEDE_ACTION } from './query.js';
import { describePrincipal } from './claim.js';

/** 一条取代边（`from` = 新卡 / `to` = 旧卡）。 */
export interface SupersedeEdge {
	from: CardId;
	to: CardId;
}

/** `planAdopt` 的入参。 */
export interface AdoptInput {
	/**
	 * **身份**：谁在采纳（会被写进历史）。
	 *
	 * 与 `actor` 是两个不同语义（`【用户指令，2026-11-02 14:05】`「各用各的不要映射」）：
	 * 这里写"哪个消息循环 / 用户"，权限层只看"属于 user 还是 ai 类别"。
	 */
	principal: Principal;
	/** **权限类别**：问 ③ 用的 `'user' | 'ai' | 'host'`。⑧ 自己知道它，⑦ 不推断。 */
	actor: Actor;
	/** 由 ⑧ 在事务内盖；⑦ 不取时钟。省略则不写历史。 */
	at?: number;
}

/** 取代标签。**由 ④ 的词汇表定义**；⑦ 只在"枚举自身出边"时用它，不做语义判断。 */
const SUPERSEDES = 'supersedes';

/**
 * 取本卡身上所有「取代」边。
 *
 * ⑦ **只做结构枚举**（`label` 与 `to`），不判"取代意味着什么" —— 语义在 ④。
 * 用户 13:18 裁"取代可编辑 / 可新建 / 可多条" ⇒ 这里必须支持多条。
 */
export function supersedeEdges(card: Card): SupersedeEdge[] {
	const out: SupersedeEdge[] = [];
	for (const link of card.relations.links) {
		if (link.label !== SUPERSEDES) continue;
		if (link.to === '') continue;
		out.push({ from: card.id, to: link.to });
	}
	return out;
}

export function planAdopt(
	ports: Ports,
	card: Card,
	all: readonly Card[],
	input: AdoptInput,
): PlanResult {
	// ── ① 前置：只有草稿能采纳 ──
	if (card.deleted) {
		return { ok: false, reason: { kind: 'already-deleted' } };
	}
	if (card.status !== ports.types.DRAFT) {
		return { ok: false, reason: { kind: 'not-draft' } };
	}

	// ── ② 目标状态与转移判决：问 ③（⑦ 不自己判） ──
	//
	// **采纳的目的地由 ③ 给**（`ports.types.adoptTargetOf`）：
	// `goal` / `work` → 「提交」；`design` / `record` → 「需要授权」。
	// `【用户指令，2026-11-02 16:05】`「设计卡 / 记录卡建出来应该是草稿，采纳后才变『需要授权』」
	// ⇒ 四类初始都是草稿，**采纳是唯一入口**，而目的地按分类不同。
	//
	// ⚠ **⑦ 不写分类名单** —— 名单在 ③ 只有一份（与 `isAdopt` 同源）。抄一份进 ⑦，
	// 将来加第五类时会静默漂移：⑦ 算出 `SUBMITTED`、③ 判 `isAdopt` 为假 ⇒ 采纳被拒且看不出原因。
	//
	// ⚠ 交给 ③ 的判决参数是 **`input.actor`（权限类别）**，不是 `input.principal`（身份）。
	// ⑦ **不做 `principal → actor` 的映射**（`【用户指令，2026-11-02 14:05】`「各用各的不要映射」）。
	const target = ports.types.adoptTargetOf(card.template.kind);
	// `undefined` = ③ 拒绝判决（分类未注册）⇒ 数据问题，不抛，走 reason。
	if (target === undefined) {
		return { ok: false, reason: { kind: 'kind-unavailable', kindId: card.template.kind } };
	}
	const verdict = ports.types.canTransition(card.template.kind, card.status, target, input.actor);
	if (verdict === undefined) {
		return { ok: false, reason: { kind: 'kind-unavailable', kindId: card.template.kind } };
	}
	if (!verdict) {
		// ⚠ 走到这里说明 ③ 的 `adoptTargetOf` 与 `canTransition` **互不一致**
		// （① 已保证是草稿）⇒ 这是**规则分叉**，不是"卡不是草稿"。
		// 具体分两种：**权限不够**（如 goal/work 由 ai 采纳）或规则冲突。
		return { ok: false, reason: { kind: 'adopt-not-allowed', actor: input.actor } };
	}

	const items: PlanItem[] = [];

	// ── ③ 本卡：转目的地。动因在 events 里，items 不带 reason ──
	items.push({ op: 'setStatus', cardId: card.id, to: target });

	// ── ④ 逐张处置被取代的旧卡 ──
	const edges = supersedeEdges(card);

	for (const edge of edges) {
		const old = all.find((item) => item.id === edge.to);
		// 悬空引用：⑦ 不猜、不造卡；⑧ 另有"坏引用"上报通道。
		if (old === undefined) continue;
		// 墓碑不参与任何处置。
		if (old.deleted) continue;

		const done = ports.types.isCompletedGroup(old.status);
		if (done) {
			// 在「完成」组 ⇒ **不动**，不产生状态变更项。
			// 因果记在 events 的 detail 里（见下），不需要额外的 Reason 载体。
			continue;
		}

		// 不在「完成」组 ⇒ 转「取消」。
		items.push({
			op: 'setStatus',
			cardId: old.id,
			to: ports.types.states.CANCELED,
			reason: { kind: 'superseded-incomplete' },
		});
	}

	// ── ⑤ 历史：采纳 + 取代执行（都是"行为"） ──
	const events: HistoryEntry[] = [];
	if (input.at !== undefined) {
		events.push({
			at: input.at,
			action: ADOPT_ACTION,
			// `to` 必须记：`adopt` 对不同分类结果不同（`goal`/`work` → 提交，
			// `design`/`record` → 需要授权）⇒ 不记 `to` 就分不出"变成了什么"。
			// `principal` 记身份：知道"哪个消息循环 / 用户"采纳的。
			detail: { from: card.status, to: target, principal: describePrincipal(input.principal) },
		});
		if (edges.length > 0) {
			events.push({
				at: input.at,
				action: SUPERSEDE_ACTION,
				detail: { edges: edges.map((edge) => ({ from: edge.from, to: edge.to })) },
			});
		}
	}

	const plan: Plan = { ok: true, items, events };
	return plan;
}
