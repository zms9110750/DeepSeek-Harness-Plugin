/**
 * ④ relation —— 关系变更的**唯一**收口。
 *
 * ## 为什么要单入口
 *
 * "用户提交一份编辑视图"和"级联给一串补丁"看起来是两件事，但它们都必须先做同一件事：
 * **校验 current**。拆成两个函数就会出现两处 `validateRelations(current)` ——
 * 同一规则写两处必漂，而"不采信调用方已校验的声称"这条纪律只有落在一处才守得住。
 *
 * ⇒ 一个入口 + 两种**变更来源**（`kind`），内部固定三步。
 *
 * ## 三步（不可省）
 *
 *   1. `validateRelations(current)` —— `current` 来自卡（可能是旧数据/迁移数据），
 *      **不假设它良构**，也不采信"调用方说已经校验过"；
 *   2. 按 `change.kind` 应用变更；
 *   3. `validateRelations(merged)` → 定型。
 *
 * ## ⚠ 没有 `author` 参数
 *
 * 曾经的 `user` / `fork` / `system-transfer` 三档作者已作废 ——
 * 用户 `2026-11-01 13:18` 推翻"取代不可编辑"：「取代是可以编辑的。甚至新建的时候可以取代多个卡。」
 * 于是"谁能新增取代"这个判断不再需要。现在唯一的差别只剩**变更从哪来**（`edit` / `patch`），
 * 那是来源，不是权限。
 *
 * 见 docs/04-relation.md 2.6。
 */

import { applyPatches, type RelationPatch } from './patch.js';
import {
	validateRelations,
	type CardId,
	type EditableRelations,
	type Issue,
	type RelationEntry,
	type Relations,
} from './relations.js';

/**
 * 一次关系写入的来源。
 *
 * - `edit`  —— 用户/AI 提交的**完整编辑视图**（整体替换可编辑部分）；
 * - `patch` —— ④ 的级联计划，**按数组顺序**应用。
 */
export type RelationsChange =
	| { readonly kind: 'edit'; readonly value: EditableRelations }
	| { readonly kind: 'patch'; readonly patches: readonly RelationPatch[] };

/** 一次关系写入的结果。 */
export type ChangeResult =
	| { readonly ok: true; readonly value: Relations }
	| { readonly ok: false; readonly issues: readonly Issue[] };

/**
 * 应用一次关系变更。**纯函数**，无副作用、无 IO。
 *
 * `current` 的类型故意是 `unknown`：它来自卡上的 JSON，**在通过校验之前没有任何保证**。
 * 收成 `Relations` 会撒谎（那种类型只可能由 `validateRelations` 产出）。
 */
export function applyRelationsChange(current: unknown, change: RelationsChange): ChangeResult {
	/* ① 先校验 current —— 不可省，且不采信"调用方已校验"的声称。 */
	const currentResult = validateRelations(current);
	if (!currentResult.ok) {
		/* current 本身坏了 ⇒ 原样报出来，让调用方归入"坏卡"清单去人工处置，不静默修。 */
		return { ok: false, issues: currentResult.issues };
	}

	const base = currentResult.value;

	/* ② 应用变更 */
	let nextParent: CardId | '';
	let nextLinks: RelationEntry[];
	if (change.kind === 'edit') {
		/* 整体替换可编辑部分。所有 label 都可编辑（13:18），所以没有"必须保留"的条目。 */
		nextParent = change.value.parent;
		nextLinks = [...change.value.links];
	} else {
		const patched = applyPatches(base.links, change.patches);
		if (!patched.ok) return { ok: false, issues: patched.issues };
		nextParent = base.parent;
		nextLinks = [...patched.links];
	}

	/* ③ 再校验合并结果并定型。 */
	return validateRelations({ parent: nextParent, links: nextLinks });
}
