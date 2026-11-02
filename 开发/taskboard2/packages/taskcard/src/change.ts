/**
 * ⑦ 任务卡 —— 草稿期原地编辑。
 *
 * ## 判定式（一句话）
 *
 * **可原地编辑 ⟺ `status === DRAFT`**；冻结 ⟺ 非草稿。
 *
 * ## 冻结了什么
 *
 * · 冻结：`id` / `title` / `template` / `relations` / `sections` 的**声明部分**
 * · **不冻结**：`note`（永远可写）、`sections` 内的**答案值**
 *
 * ## 三条守卫
 *
 *   1. **草稿期不得删除已有 `sectionId` 键**（键集只增不减）
 *   2. **冻结期不得改声明**（问 ② 的 `isDeclarationOnlyChange`，⑦ 不看 payload）
 *   3. **关系必须过 ④ 的收口**（`validateRelations` / `applyRelationsChange`）
 *
 * ⚠ **⑦ 不校验"新增 `sectionId` 是否属于模板"** —— 那需要模板知识，归 ⑧ 的落库入口
 * （`docs` §3.3 第 7 条，(丙) 方案）。本文件**不查模板**。
 */

import type { Card, HistoryEntry, Plan, PlanResult, Ports, RelationPatch, Relations } from './types.js';

/** 冻结期内允许改的字段（只有它们不在冻结集合里）。 */
export const UNFROZEN_FIELDS = ['note', 'sections'] as const;

/** 用户 / AI 提交的可编辑视图。 */
export interface EditableFields {
	title?: string;
	note?: string;
	/** 整份 `sections`（⑦ 只做键集比较 + 透传，不看内容）。 */
	sections?: Record<string, unknown>;
	/** 整份关系（形状与词汇由 ④ 校验）。 */
	relations?: Relations;
}

/** `planChange` 的入参。 */
export interface ChangeInput {
	editable: EditableFields;
	/** 计划项式最小操作（④ 的级联计划）。与 `editable` 二选一或并存。 */
	patch?: readonly RelationPatch[];
	/** 由 ⑧ 在事务内盖；⑦ 不取时钟。省略则不写历史。 */
	at?: number;
}

/** 编辑写进历史的动作名（"编辑"是行为，不是状态）。 */
export const EDIT_ACTION = 'edit';

/** 取两个对象键集的差集（`a` 有、`b` 没有）。 */
function missingKeys(a: Record<string, unknown>, b: Record<string, unknown>): string[] {
	const out: string[] = [];
	for (const key of Object.keys(a)) {
		if (!Object.hasOwn(b, key)) out.push(key);
	}
	return out;
}

/** 取两个对象键集的差集（`b` 有、`a` 没有）。 */
function addedKeys(a: Record<string, unknown>, b: Record<string, unknown>): string[] {
	const out: string[] = [];
	for (const key of Object.keys(b)) {
		if (!Object.hasOwn(a, key)) out.push(key);
	}
	return out;
}

export function planChange(ports: Ports, card: Card, input: ChangeInput): PlanResult {
	const draft = card.status === ports.types.DRAFT;
	const { editable, patch } = input;

	// ── 墓碑卡不再接受任何编辑（已删除 = 已出局） ──
	if (card.deleted) {
		return { ok: false, reason: { kind: 'already-deleted' } };
	}

	const next: Card = {
		...card,
		// 深一层的两个字段用新对象，避免调用方共享引用
		template: { ...card.template },
		relations: card.relations,
		sections: card.sections,
		history: card.history,
	};

	// ── ① title：草稿可改；冻结后拒绝 ──
	if (editable.title !== undefined && editable.title !== card.title) {
		if (!draft) return { ok: false, reason: { kind: 'frozen', field: 'title' } };
		next.title = editable.title;
	}

	// ── ② note：**永不冻结** ──
	if (editable.note !== undefined) {
		next.note = editable.note;
	}

	// ── ③ sections：键集守卫 + 声明冻结 ──
	if (editable.sections !== undefined) {
		const currentSections = card.sections;
		const nextSections = editable.sections;

		if (draft) {
			// 草稿期：**不得删键**（可改 payload、可新增键）；不查"新键是否属于模板"（归 ⑧）。
			const removed = missingKeys(currentSections, nextSections);
			if (removed.length > 0) {
				return { ok: false, reason: { kind: 'section-key-removed', sectionIds: removed } };
			}
		} else {
			// 冻结期：**声明不可改**（答案可改）。
			// 用 ② 的判定：⑦ 不看 payload 结构，只收一个布尔。
			const onlyAnswers = ports.action.isDeclarationOnlyChange(currentSections, nextSections);
			if (!onlyAnswers) {
				const touched = [
					...missingKeys(currentSections, nextSections),
					...addedKeys(currentSections, nextSections),
				];
				return { ok: false, reason: { kind: 'declaration-changed', sectionIds: touched } };
			}
		}
		next.sections = nextSections;
	}

	// ── ④ relations：一律过 ④ 的收口（可编辑 / 可新建 / 可多条 —— 用户 13:18） ──
	if (patch !== undefined || editable.relations !== undefined) {
		if (!draft && patch === undefined) {
			// 冻结期，用户/系统仍在关系上动手 ⇒ 拒绝（关系属冻结集合）。
			return { ok: false, reason: { kind: 'frozen', field: 'relations' } };
		}
		const change =
			patch !== undefined
				? ({ kind: 'patch', patches: patch } as const)
				: ({ kind: 'edit', value: editable.relations as Relations } as const);

		const applied = ports.relation.applyRelationsChange(card.relations, change);
		if (!applied.ok) {
			return { ok: false, reason: { kind: 'relations-invalid', issues: applied.issues } };
		}
		next.relations = applied.value;
	}

	const events: HistoryEntry[] = [];
	if (input.at !== undefined) {
		events.push({ at: input.at, action: EDIT_ACTION });
	}

	const plan: Plan = {
		ok: true,
		items: [{ op: 'updateCard', card: next }],
		events,
	};
	return plan;
}
