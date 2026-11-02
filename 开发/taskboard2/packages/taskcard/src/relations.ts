/**
 * ⑦ 任务卡 —— 与 ④ relation 的接缝。
 *
 * ## 边界
 *
 * · **关系域对象（词汇 / 条目形状 / 校验）归 ④**：本包只 `import` 结构类型、只 `inject` 服务。
 * · **本包只做三件事**：① 决定"这次变更是什么形态"；② 调 ④ 的收口函数；③ 把结果变成计划项。
 * · ⑦ **不比较 label、不判断边是否合法** —— 那是 ④ 的词汇与校验。
 *
 * ## 为什么不自己合并
 *
 * `applyRelationsChange` 内部固定三步（先校验 `current`、再应用、再校验 `merged`），
 * 那条"先校验 current，不采信调用方已校验的声称"的纪律落在 ④ 侧，本包只负责**不要绕过它**。
 */

import type { Card, CardId, PlanItem, RelationPatch, Relations, RelationsChange, RejectReason, RelationIssue, RelationPort } from './types.js';

/** 一次关系变更的结果（内部用）。 */
export type RelationApplyResult =
	| { ok: true; value: Relations }
	| { ok: false; reason: RejectReason };

/**
 * 把"用户提交的可编辑视图"或"④ 的级联 patch 数组"交给 ④ 收口。
 *
 * ⚠ `current` 的类型是 `unknown`（不是 `Relations`）：**卡上的 relations 来自 JSON，
 * 从未经过 ④ 校验，它不可能是 ④ 的品牌值**。用 `unknown` 进、`Relations` 出，
 * 让"先校验"这件事在类型上无法被省略。
 */
export function applyRelations(
	relation: RelationPort,
	current: unknown,
	change: RelationsChange,
): RelationApplyResult {
	const result = relation.applyRelationsChange(current, change);
	if (!result.ok) {
		return { ok: false, reason: { kind: 'relations-invalid', issues: result.issues } };
	}
	return { ok: true, value: result.value };
}

/** 由一次"用户编辑"构成的关系变更。 */
export function editChange(value: Relations): RelationsChange {
	return { kind: 'edit', value };
}

/** 由 ④ 的级联计划构成的关系变更。 */
export function patchChange(patches: readonly RelationPatch[]): RelationsChange {
	return { kind: 'patch', patches };
}

/**
 * 把「采纳时转移依赖」这件事变成计划项。
 *
 * `【用户指令，2026-11-01 05:52】`「取代的方向 新的->旧的」+「采纳了才执行取代」。
 * 顺序约束（**先转移依赖、再判旧卡**）由 ④ 的计划给出，⑦ 只按序搬运、**不重排**。
 */
export function relationsItems(cardId: CardId, relations: Relations): PlanItem[] {
	return [{ op: 'setRelations', cardId, relations }];
}

/** 只搬运 issues，不解释 —— 文案由 ⑧ 查表转。 */
export function toIssues(reason: RejectReason): readonly RelationIssue[] {
	if (reason.kind === 'relations-invalid') return reason.issues;
	return [];
}

/**
 * 取关系里所有「指向某张卡」的目标（**只读遍历，不判语义**）。
 *
 * ⑦ 用它来算"被取代的旧卡集合"这类**集合**，不做任何"这条边意味着什么"的判断。
 * 关系语义（方向、是否阻断）归 ④。
 */
export function linkTargets(relations: Relations, label?: string): CardId[] {
	const out: CardId[] = [];
	for (const link of relations.links) {
		if (label !== undefined && link.label !== label) continue;
		out.push(link.to);
	}
	return out;
}

/** 卡上的父卡（`''` 归一成 `undefined`，方便调用方判空）。 */
export function parentOf(card: Card): CardId | undefined {
	const parent = card.relations.parent;
	return parent === '' ? undefined : parent;
}
