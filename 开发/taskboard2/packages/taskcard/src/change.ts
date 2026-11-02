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
 * ## 不产历史（`【用户指令，2026-11-02 12:46】`）
 *
 * 「编辑不会产生历史。只有状态转移会留下历史。」⇒ `events` **恒为空**。
 * 改 `title` / `note` / `sections` / `relations` 都不是"卡的状态变化"。
 *
 * ## 章节形状：卡上是 `{label, payload}`，编辑只提交 payload
 *
 * `【用户指令，2026-11-02 14:47】`「任务卡要存一个章节名字的副本……任务卡必须在无模板的
 * 情况下正常显示。」⇒ 卡上 `sections[id] = { label, payload }`。
 * 但**编辑入参只有裸 payload**（调用方不该重复知道 label）⇒
 * 比较前 `pluckPayloads`、落回时 `mergeLabels`。**漏了这两步会让 ② 永远判"声明变了"**。
 *
 * ⚠ **⑦ 不校验"新增 `sectionId` 是否属于模板"** —— 那需要模板知识，归 ⑧ 的落库入口
 * （`docs` §3.3 第 7 条，(丙) 方案）。`mergeLabels` 只在"给新增键补 label"时读模板，不判合法性。
 */

import type {
	Card,
	CardSection,
	Plan,
	PlanResult,
	Ports,
	RelationPatch,
	Relations,
} from './types.js';
import { labelsByName } from './create.js';

/** 冻结期内允许改的字段（只有它们不在冻结集合里）。 */
export const UNFROZEN_FIELDS = ['note', 'sections'] as const;

/** 用户 / AI 提交的可编辑视图。 */
export interface EditableFields {
	title?: string;
	note?: string;
	/**
	 * 整份 `sections` —— **只有裸 payload，没有 `label`**。
	 *
	 * ⚠ **这是刻意的**（`【Lead 决定，2026-11-02 15:10】`）：调用方不该重复知道 `label`；
	 * `label` 是卡上的快照，编辑不改它（`mergeLabels` 保留卡上原值）。
	 * ⇒ ⑦ 必须先 `pluck` 出卡上的 payload 再去问 ②，否则 ② 会拿 `{label,payload}`
	 *   和裸 `payload` 比，`splitPayload` 读不到 `$type` ⇒ **永远判"声明变了"**。
	 */
	sections?: Record<string, unknown>;
	/** 整份关系（形状与词汇由 ④ 校验）。 */
	relations?: Relations;
}

/** `planChange` 的入参。 */
export interface ChangeInput {
	editable: EditableFields;
	/** 计划项式最小操作（④ 的级联计划）。与 `editable` 二选一或并存。 */
	patch?: readonly RelationPatch[];
	/**
	 * 由 ⑧ 在事务内盖的时间戳。
	 *
	 * ⚠ **保留但已无用**：`【用户指令，2026-11-02 12:46】`「编辑不会产生历史」⇒
	 * `planChange` 的 `events` 恒为空，不再需要 `at`。留着是为了⑧的调用签名不破。
	 */
	at?: number;
}

/**
 * 编辑的历史动作名 —— **保留常量以兼容 ⑧/⑤ 的 import，但 ⑦ 不再产出它**。
 *
 * `【用户指令，2026-11-02 12:46】`「编辑不会产生历史。只有状态转移会留下历史。」
 * ⇒ `planChange` 的 `events` **恒为空**。若外部仍引用此常量，行为应是"无事件可写"，
 * 而不是"写一条 `edit`"。
 */
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

/**
 * 把卡上的 `{ [id]: {label, payload} }` **摊平成 `{ [id]: payload }`**。
 *
 * ⚠ **为什么必须摊平**：② 的 `isDeclarationOnlyChange` / `splitPayload` 认的是
 * **action payload**（靠 `$type` 判断"答案在哪"）。把 `{label, payload}` 直接丢给它，
 * 它读不到 `$type` ⇒ 把一切都当"声明"⇒ **永远判"声明变了"**，
 * 结果是**冻结期任何编辑都被当"改了声明"而拒绝**（而且编译不报错）。
 *
 * ⇒ 摊平后，⑦ 交给 ② 的东西与"卡上直接存 payload 时"**完全一致** ⇒ 行为等价。
 */
export function pluckPayloads(sections: Record<string, CardSection>): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [sectionId, section] of Object.entries(sections)) {
		out[sectionId] = section.payload;
	}
	return out;
}

/** `mergeLabels` 的结果：要么整份 `sections`，要么"哪几章拿不到 label"。 */
export type MergeLabelsResult =
	| { readonly ok: true; readonly value: Record<string, CardSection> }
	| { readonly ok: false; readonly sectionIds: readonly string[] };

/**
 * 把编辑提交的裸 payload **合回卡上的 `{label, payload}`**。
 *
 * ## 规则
 *
 * · **已有键**：`label` 沿用卡上的 —— **编辑不改 label**（`label` 是建卡 / fork 时的快照）。
 * · **新增键**（草稿期允许加）：`label` 一律取模板的。
 *   **模板里没有该章 ⇒ 失败**（`section-label-missing`），**不写 `sectionId` 假值**
 *   —— 与 `buildSections` / `planFork` 同一口径
 *   （`【Lead 决定，2026-11-02 15:45】`「兜底会把假值写进卡。卡是**永久数据**，假值会一直躺在那」）。
 */
export function mergeLabels(
	ports: Ports,
	card: Card,
	payloads: Record<string, unknown>,
): MergeLabelsResult {
	const current = card.sections;
	// 惰性解析：只有真的出现了"新键"才需要模板，避免每次编辑都读注册表。
	let labels: Map<string, string> | undefined;
	const missing: string[] = [];

	const out: Record<string, CardSection> = {};
	for (const [sectionId, payload] of Object.entries(payloads)) {
		const existing = current[sectionId];
		if (existing !== undefined) {
			// 已有键：沿用卡上的 label（编辑不改它）。
			out[sectionId] = { label: existing.label, payload };
			continue;
		}
		// 新增键：从模板取 label；取不到 ⇒ 不写假值，记下来整份失败。
		if (labels === undefined) {
			const template = ports.types.resolve(card.template.ref);
			labels = template === undefined ? new Map() : labelsByName(template.sections);
		}
		const label = labels.get(sectionId);
		if (label === undefined) {
			missing.push(sectionId);
			continue;
		}
		out[sectionId] = { label, payload };
	}

	if (missing.length > 0) {
		return { ok: false, sectionIds: missing };
	}
	return { ok: true, value: out };
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
	//
	// ⚠ **`editable.sections` 是裸 payload**，卡上是 `{label, payload}` ⇒
	// 比较前必须 `pluckPayloads` 摊平（否则 ② 读不到 `$type`，永远判"声明变了"）。
	// `label` 只在**落回时**由 `mergeLabels` 补（已有键沿用卡上原值）。
	if (editable.sections !== undefined) {
		const currentPayloads = pluckPayloads(card.sections);
		const nextPayloads = editable.sections;

		if (draft) {
			// 草稿期：**不得删键**（可改 payload、可新增键）；不查"新键是否属于模板"（归 ⑧）。
			const removed = missingKeys(currentPayloads, nextPayloads);
			if (removed.length > 0) {
				return { ok: false, reason: { kind: 'section-key-removed', sectionIds: removed } };
			}
		} else {
			// 冻结期：**声明不可改**（答案可改）。
			// 用 ② 的判定：⑦ 不看 payload 结构，只收一个布尔。
			// ⚠ 两边都必须是**裸 payload**，否则这个判定恒为"声明变了"。
			const onlyAnswers = ports.action.isDeclarationOnlyChange(currentPayloads, nextPayloads);
			if (!onlyAnswers) {
				const touched = [
					...missingKeys(currentPayloads, nextPayloads),
					...addedKeys(currentPayloads, nextPayloads),
				];
				return { ok: false, reason: { kind: 'declaration-changed', sectionIds: touched } };
			}
		}
		// 落回：把裸 payload 合回 `{label, payload}`（已有键沿用卡上的 label，编辑不改它）。
		// ⚠ 新增键取不到模板 label ⇒ **整份拒绝**，不写 `sectionId` 假值。
		const merged = mergeLabels(ports, card, nextPayloads);
		if (!merged.ok) {
			return { ok: false, reason: { kind: 'section-label-missing', sectionIds: merged.sectionIds } };
		}
		next.sections = merged.value;
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

	/*
	 * ⚠ **编辑不产任何历史事件**（`【用户指令，2026-11-02 12:46】`）。
	 *
	 * 用户原话：
	 *   「编辑不会产生历史。只有状态转移会留下历史。记录编辑这得要多少个历史事件啊。」
	 *   「history 记录的是卡。而编辑，是模板内容。卡不穿透到模板里面保存，只保存自己这个卡
	 *     提供的额外的变化。所以状态是他的，创建是他的，归档是他的。所以他存。」
	 *
	 * ⇒ 改 `title` / `note` / `sections` / `relations` **都不留历史**：它们要么是模板内容
	 *   （`sections`），要么是卡的附属字段，**不是"卡的状态变化"**。
	 * ⇒ 因此 `events` **恒为空**。`at` 仍然照收（⑧ 可能仍传），但 ⑦ 不再用它产事件。
	 */
	const plan: Plan = {
		ok: true,
		items: [{ op: 'updateCard', card: next }],
		events: [],
	};
	return plan;
}
