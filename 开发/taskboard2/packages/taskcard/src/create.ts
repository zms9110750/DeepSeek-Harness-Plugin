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
 *   4. 关系收口（用户/预设给的关系必须过 ④）
 *   5. 产出计划：`createCard` + 历史「创建」
 *
 * ⑦ **不校验 `sections` 内容**（不判 payload、不判"每章有没有行为"）—— 那是 ⑧ 调 ② 的事。
 */

import type { Card, CardId, HistoryEntry, Plan, PlanResult, Ports, Relations } from './types.js';

/** `planCreate` 的入参。 */
export interface CreateInput {
	/** **已分配好的**编号（由 ⑧ 调 ③ 的生成器得到）。 */
	id: CardId;
	title: string;
	/** 模板名（= ③ 的模板 `name`；卡上 `template.ref` 存的就是它）。 */
	templateRef: string;
	/** `{ [sectionId]: payload }`；⑦ 原样透传，不解释。 */
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
		sections: input.sections ?? {},
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
