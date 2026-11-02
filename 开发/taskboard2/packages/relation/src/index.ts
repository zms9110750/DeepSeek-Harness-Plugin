/**
 * ④ 关系 —— Cordis 入口。
 *
 * 事项之间的边，以及沿边传播的**计划**。只算不写，执行是 ⑧ core 的事。
 *
 * ## 零依赖
 *
 * 本包是**第 0 层最底层**：
 *   - `inject = []` —— 不依赖任何服务；
 *   - **零 `@local/*` import** —— 不 import ① store、不 import ③ types、不 import ⑦ taskcard。
 *     编号就是 `string`，状态就是 `string`，都不认识。
 *
 * 它只**被** ⑦/⑧ 使用。**反方向的 import 一律不允许** —— 否则包图立刻成环。
 *
 * ## 对外形态：服务面 + 静态导出
 *
 * 本包的能力全是纯函数与常量，没有生命周期、没有就绪状态。但**仍然必须 `provide`**：
 *
 *   - Cordis 的 `inject` 机制是"**等对方 provide**"（`fiber.ts` 的 `_refresh`：
 *     `inject` 里有一项在 `_store` 里找不到 ⇒ 永远 `PENDING`，`apply` 永不执行）。
 *     **不 provide ⇒ ⑦ 永远起不来**，不是"慢一点"，是**停在原地**。
 *   - README 硬规矩：**上层只通过服务调用下层，不 import 实现**。否则下层不可替换、不可热重载。
 *
 * ⇒ **`taskboard2Relation` 是 ⑦ 与 ⑧ 的接入口，必须提供。**
 *
 * **静态导出同时保留**：`Relations` / `LinkLabel` 等**类型**只能 `import type`
 * （类型不占运行时、也没法 provide），⑦ 需要它们来声明 `Card.relations` 的形状。
 *
 * `makeRelations` **不 provide、不导出** —— 它是全仓库唯一允许 cast 成 `Relations` 的地方。
 *
 * 见 `docs/04-relation.md` 6.4 / 6.7。
 */

import { applyRelationsChange, type ChangeResult, type RelationsChange } from './change.js';
import {
	planCascade,
	planSupersede,
	type CascadeCard,
	type CascadePlan,
	type CascadeVocabulary,
} from './cascade.js';
import { LINK_KINDS, type LinkKind } from './kinds.js';
import { validateRelations, type ValidationResult } from './relations.js';

export const name = 'taskboard2-relation';

/** 不依赖任何前置服务。 */
export const inject = [];

/**
 * ⑦ / ⑧ 消费的服务面。
 *
 * 五个成员与同名纯函数**逐字对应**，不做任何额外逻辑 ——
 * 一旦这里出现"服务面和纯函数不一样"的分叉，就说明有第二份实现，那是 bug。
 *
 * 成员清单来自两份端口声明，**不是我自己猜的**：
 *   - ⑦ `RelationPort`：`validateRelations` / `applyRelationsChange` / `LINK_KINDS`；
 *   - ⑧ `RelationPort`：`applyRelationsChange` / `planCascade` / `planSupersede`。
 * ⇒ 并起来是五个。少一个，对应的包就永远停在 `PENDING`。
 */
export interface RelationService {
	validateRelations(input: unknown): ValidationResult;
	applyRelationsChange(current: unknown, change: RelationsChange): ChangeResult;
	readonly LINK_KINDS: readonly LinkKind[];
	planCascade(
		cards: readonly CascadeCard[],
		rootId: string,
		vocabulary: CascadeVocabulary,
		closeDependents: boolean,
	): CascadePlan;
	planSupersede(
		cards: readonly CascadeCard[],
		newCardId: string,
		oldCardIds: readonly string[],
		vocabulary: CascadeVocabulary,
	): CascadePlan;
}

/**
 * 提供 `taskboard2Relation`。
 *
 * ⚠ **不包 try/catch**：曾经写成"provide 不可用就静默跳过"，那会让本包**看起来成功**，
 * 而 ⑦ / ⑧ 永远停在 `PENDING` —— 报错被吞掉、症状出现在别人那里。
 * **宁可在这里炸，也不要让下游挂起。**
 */
export function apply(ctx: any): void {
	const service: RelationService = {
		validateRelations: (input) => validateRelations(input),
		applyRelationsChange: (current, change) => applyRelationsChange(current, change),
		LINK_KINDS,
		planCascade: (cards, rootId, vocabulary, closeDependents) =>
			planCascade(cards, rootId, vocabulary, closeDependents),
		planSupersede: (cards, newCardId, oldCardIds, vocabulary) =>
			planSupersede(cards, newCardId, oldCardIds, vocabulary),
	};

	ctx.provide('taskboard2Relation', service);
}

/* ── 词汇 ── */
export {
	BEHAVIOR_LINK,
	LINK_KINDS,
	UNDIRECTED_LINK,
	isLinkLabel,
	linkKindOf,
	type BehaviorLinkLabel,
	type LinkKind,
	type LinkLabel,
	type UndirectedLinkLabel,
} from './kinds.js';

/* ── 形状与校验 ── */
export {
	looksLikeRelations,
	validateRelations,
	type CardId,
	type EditableRelations,
	type Issue,
	type RelationEntry,
	type Relations,
	type ValidationResult,
} from './relations.js';

/* ── 补丁 ── */
export { applyPatches, type PatchResult, type RelationPatch } from './patch.js';

/* ── 变更收口 ── */
export { applyRelationsChange, type ChangeResult, type RelationsChange } from './change.js';

/* ── 级联计划 ── */
export {
	edgesOf,
	isVisibleTarget,
	planCascade,
	planSupersede,
	type CascadeCard,
	type CascadePlan,
	type CascadeVocabulary,
	type Reason,
	type RelationsItem,
	type StatusItem,
} from './cascade.js';
