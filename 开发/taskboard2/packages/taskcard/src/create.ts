/**
 * ⑦ 任务卡 —— 建卡。
 *
 * **建卡是提交时发号**（`【用户指令，2026-11-01 06:43】`）。但**编号不归 ⑦ 生成**：
 * ⑦ 收到的是"已分配好的编号"（③ 的生成器由 ⑧ 调用，`usedIds` 必须含墓碑）。
 *
 * ## 这一步要做什么
 *
 *   1. 解析模板（**未命中 ⇒ fail-closed 拒绝；注册表未初始化 ⇒ 原样上抛**）
 *   2. 定初始状态（问 ③ 的 `initialStatus`）
 *   3. 填 `template` 快照（`ref` / `kind` / **`domain`**）—— **此后以卡上快照为准，不再回查模板**
 *   4. **写 `sections` 时把模板的章节 `label` 拷成快照**（`buildSections`）——
 *      模板是 mod 带的，mod 关了模板就没了，**卡必须能独立显示**
 *      ⚠ **拿不到 `label` ⇒ 整份拒绝**（`section-label-missing`），**不写 `sectionId` 假值**
 *   5. 关系收口（用户/预设给的关系必须过 ④）
 *   6. 产出计划：`createCard` + 历史「创建」
 *
 * ⑦ **不校验 `sections` 内容**（不判 payload、不判"每章有没有行为"）—— 那是 ⑧ 调 ② 的事。
 */

import type {
	Card,
	CardId,
	CardSection,
	HistoryEntry,
	Plan,
	PlanResult,
	Ports,
	Relations,
	ResolvedTemplate,
	TemplateSection,
} from './types.js';

/** `planCreate` 的入参。 */
export interface CreateInput {
	/** **已分配好的**编号（由 ⑧ 调 ③ 的生成器得到）。 */
	id: CardId;
	title: string;
	/** 模板名（= ③ 的模板 `name`；卡上 `template.ref` 存的就是它）。 */
	templateRef: string;
	/**
	 * `{ [sectionId]: payload }` —— **只有 payload，没有 label**。
	 *
	 * `label` 由 ⑦ **从模板补**（`【Lead 决定，2026-11-02 15:10】`）。
	 * 理由：调用方（⑧ / ⑩）不该重复知道 `label`；模板在手，⑦ 自己就能填。
	 * ⑦ **不解释 payload 内容**，只搬运。
	 */
	sections?: Record<string, unknown>;
	/** 关系。⑦ 只搬运，形状与词汇由 ④ 校验。 */
	relations?: Relations;
	note?: string;
	/**
	 * 分类。**内部模板可省**（用模板的 kind）；外部 / 多分类模板**必须显式给**。
	 * 省略且模板不足以确定分类时 ⇒ 拒绝（⑦ 不猜）。
	 */
	kind?: string;
	/** 由 ⑧ 在事务内盖时间戳；⑦ 不取时钟。省略则不写历史。 */
	at?: number;
}

/** 建卡时写进历史的动作名。 */
export const CREATE_ACTION = 'create';

/** 空关系（新建卡的默认）。 */
export function emptyRelations(): Relations {
	return { parent: '', links: [] };
}

/** `buildSections` 的结果：要么整份 `sections`，要么"哪几章拿不到 label"。 */
export type BuildSectionsResult =
	| { readonly ok: true; readonly value: Record<string, CardSection> }
	| { readonly ok: false; readonly sectionIds: readonly string[] };

/**
 * 建出卡上的 `sections`：**调用方只给 payload，`label` 从这里补**。
 *
 * ## 三条规则
 *
 * 1. **`label` 一律取模板的**（`template.sections` 里同名 `id` 的 `label`）。
 * 2. **模板里没有这个 `id`** ⇒ **整份失败，返回缺 label 的 `sectionId` 列表**
 *    （`【Lead 决定，2026-11-02 15:45】`「兜底会把假值（`core-userNeed`）写进卡。卡是
 *    **永久数据**，假值会一直躺在那」⇒ 与其存假值，不如当场失败）。
 *    ⚠ **一次报全**缺失的 `sectionId`，不让调用方逐个试错。
 * 3. **缺失的章节（模板有、入参没有）：不补** ——
 *    是否补、补什么 payload 是 ⑧ 的落库门与 ② 的 `default` 的事，⑦ 不越界。
 *
 * ⚠ **`payload` 原样透传**，⑦ 不看它、不改它、不判它。
 *
 * ## 为什么返回结果对象而不是抛错
 *
 * 这是**数据问题**（调用方给了模板里没有的章节），不是装配缺陷 ⇒
 * 走 `Rejection` 通道让 ⑧ 转文案给用户；抛错是留给"程序写错了"那类（如 `planClaim` 漏 ctx）。
 */
export function buildSections(
	template: ResolvedTemplate,
	payloads: Record<string, unknown> | undefined,
): BuildSectionsResult {
	const labelsOf = labelsByName(template.sections);
	const missing: string[] = [];
	const out: Record<string, CardSection> = {};
	for (const [sectionId, payload] of Object.entries(payloads ?? {})) {
		const label = labelsOf.get(sectionId);
		// 取不到 label ⇒ 不写假值，记下来整份失败。
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

/** 把模板章节列表转成 `id → label` 的查表。 */
export function labelsByName(
	sections: readonly TemplateSection[],
): Map<string, string> {
	const out = new Map<string, string>();
	for (const section of sections) out.set(section.id, section.label);
	return out;
}

export function planCreate(ports: Ports, input: CreateInput, all: readonly Card[]): PlanResult {
	void all;

	// ① 模板解析：两种失败分开处理（未命中 undefined / 未初始化抛错）。
	const template = ports.types.resolve(input.templateRef);
	if (template === undefined) {
		return { ok: false, reason: { kind: 'template-missing', ref: input.templateRef } };
	}

	// ② 分类：显式给就用显式值；否则用模板的 kind（内部模板 1:1）。
	const kind = input.kind ?? template.kind;

	// ③ 初始状态由 ③ 给，⑦ 不写状态字面量。
	const status = ports.types.initialStatus(kind);

	// ④ 关系收口：卡上的 relations 必须来自 ④（`current` 传空关系，等价于"从零开始"）。
	const baseRelations: Relations = input.relations ?? emptyRelations();
	const applied = ports.relation.validateRelations(baseRelations);
	if (!applied.ok) {
		return { ok: false, reason: { kind: 'relations-invalid', issues: applied.issues } };
	}

	// ⑤ sections 收口：每章都必须能拿到模板的 `label`（拿不到 ⇒ 当场失败，不写假值）。
	const built = buildSections(template, input.sections);
	if (!built.ok) {
		return { ok: false, reason: { kind: 'section-label-missing', sectionIds: built.sectionIds } };
	}

	const events: HistoryEntry[] = [];
	if (input.at !== undefined) {
		events.push({ at: input.at, action: CREATE_ACTION });
	}

	/*
	 * `events` 已经写进新卡的 `history` 里了，所以 `plan.events` 留空 ——
	 * 否则 ⑧ 若两边都落，会写出两条一样的「创建」。
	 * 其它 plan（编辑 / 采纳 / 释放…）动的是**已存在的卡**，才用 `events` 单独给。
	 */
	const card: Card = {
		id: input.id,
		title: input.title,
		status,
		template: {
			ref: input.templateRef,
			kind,
			// ⚠ 领域快照：建卡这一刻的值。此后不回查模板（模板可改版）。
			domain: template.domain,
		},
		relations: applied.value,
		sections: built.value,
		note: input.note ?? '',
		history: events,
		deleted: false,
		claimedBy: '',
		claimedAt: 0,
	};

	const plan: Plan = {
		ok: true,
		items: [{ op: 'createCard', card }],
		events: [],
	};
	return plan;
}
