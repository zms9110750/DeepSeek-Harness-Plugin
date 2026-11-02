/**
 * ⑦ 任务卡 —— fork 与 fork 面板预览。
 *
 * ## fork 是什么（`【用户指令，2026-11-01 13:18】`）
 *
 * 「**fork 只是快速的创建一个卡，帮你填写字段。**」
 * ⇒ 它**不是特殊机制**，只是快捷建卡（与 `derive` 同一定位）。
 * ⇒ 但它仍**自动建立一条「取代」边**（新 → 旧）：这条来自 `【用户指令，2026-11-01 05:52】`，
 *    该句**未被 13:18 推翻** —— 13:18 推翻的是"取代不可编辑 / 只能一个 / 只能由 fork 产生"。
 *
 * ## fork 权
 *
 * **fork 权 ⟺ 非 `DRAFT`**（草稿不能 fork，`【用户指令，2026-11-01 06:43】`）。
 * 设计 / 记录**生来即非草稿**（初始为「需要授权」）⇒ 它们自动获得 fork，**不需要特判**。
 *
 * ## 两个清单（给 ⑧）
 *
 * **⑦ 只算 `sectionId` 全集**（纯键集运算），**payload 原样透传、不解释**：
 *   · `droppedSections`：源卡有、新模板无 ⇒ ⑧ 调 ② 判 `hadContent` 后写历史
 *   · `missingSections`：新模板有、源卡无 ⇒ ⑧ 自己从 ③ 拿 `default` 补空 payload
 *
 * ⚠ 清单非空 **≠** 数据有问题：只是键集差异的如实报告（`docs` §3.8 第 28 条）。
 */

import type {
	Card,
	CardId,
	HistoryEntry,
	Ports,
	Rejection,
	Relations,
	TemplateSection,
} from './types.js';

/** fork 写进新卡历史的动作名（`05:52`「历史写的是『分支』，而不是『创建』」）。 */
export const FORK_ACTION = 'fork';

/** 被丢弃的一章：⑦ 只给 `sectionId` + 原始 `payload`（不解释、不判"有没有内容"）。 */
export interface DroppedSection {
	sectionId: string;
	payload: unknown;
}

/**
 * 缺失的一章：⑦ 只给 `sectionId`。
 *
 * ⚠ 这里**故意不带 `accepts`**：③ 已彻底移除它（`sectionsOf` 只返回 `{ id, default? }`）。
 * 补空 payload 需要的是**该章的 `default`**，由 ⑧ 自己从 ③ 拿 —— ⑦ 只报"缺哪几章"。
 */
export interface MissingSection {
	sectionId: string;
}

/** `planFork` 的产物 —— **不是** `Plan`（它还带着给 ⑧ 的两个清单）。 */
export interface ForkPlan {
	ok: true;
	newCard: Card;
	/** 取代边（新 → 旧）。⑧ 落盘时写进新卡的 relations。 */
	relations: Relations;
	/** 新卡历史事件。 */
	events: HistoryEntry[];
	/** 源卡有、新模板无。 */
	droppedSections: DroppedSection[];
	/** 新模板有、源卡无。 */
	missingSections: MissingSection[];
}

/** `planFork` 的入参。 */
export interface ForkInput {
	/** 新编号（**已分配好**，由 ⑧ 调 ③ 的生成器）。 */
	id: CardId;
	/** 新模板名。省略则沿用源卡的模板引用。 */
	templateRef?: string;
	/** 分类。省略则用模板的 `kind`。 */
	kind?: string;
	/** 由 ⑧ 在事务内盖；⑦ 不取时钟。省略则不写历史。 */
	at?: number;
}

/** fork 结果：成功带清单；失败带拒绝原因。 */
export type ForkResult = ForkPlan | Rejection;

export function planFork(
	ports: Ports,
	src: Card,
	newTemplateSections: readonly TemplateSection[],
	input: ForkInput,
): ForkResult {
	// ── ① fork 权：草稿不能 fork；墓碑不是可 fork 的对象 ──
	if (src.deleted) {
		return { ok: false, reason: { kind: 'already-deleted' } };
	}
	if (src.status === ports.types.DRAFT) {
		return { ok: false, reason: { kind: 'is-draft', action: 'fork' } };
	}

	// ── ② 模板解析（未命中 fail-closed；注册表未初始化原样上抛） ──
	const templateRef = input.templateRef ?? src.template.ref;
	const template = ports.types.resolve(templateRef);
	if (template === undefined) {
		return { ok: false, reason: { kind: 'template-missing', ref: templateRef } };
	}
	const kind = input.kind ?? template.kind;
	const status = ports.types.initialStatus(kind);

	// ── ③ 两个清单：纯键集运算 ──
	const wantIds = new Set(newTemplateSections.map((section) => section.id));
	const haveIds = new Set(Object.keys(src.sections));

	const droppedSections: DroppedSection[] = [];
	for (const sectionId of haveIds) {
		if (!wantIds.has(sectionId)) {
			droppedSections.push({ sectionId, payload: src.sections[sectionId] });
		}
	}

	const missingSections: MissingSection[] = [];
	for (const section of newTemplateSections) {
		if (!haveIds.has(section.id)) {
			missingSections.push({ sectionId: section.id });
		}
	}

	// ── ④ 新卡的 sections：只保留新模板里存在的章 ──
	const keptSections: Record<string, unknown> = {};
	for (const sectionId of haveIds) {
		if (wantIds.has(sectionId)) keptSections[sectionId] = src.sections[sectionId];
	}

	// ── ⑤ 取代边：新 → 旧（方向写死，05:52「新的 -> 旧的」） ──
	const relations: Relations = {
		parent: '',
		links: [{ label: 'supersedes', to: src.id }],
	};
	const validated = ports.relation.validateRelations(relations);
	if (!validated.ok) {
		return { ok: false, reason: { kind: 'relations-invalid', issues: validated.issues } };
	}

	const events: HistoryEntry[] = [];
	if (input.at !== undefined) {
		events.push({ at: input.at, action: FORK_ACTION, detail: { from: src.id } });
	}

	const newCard: Card = {
		id: input.id,
		title: src.title,
		status,
		template: { ref: templateRef, kind, domain: template.domain },
		relations: validated.value,
		sections: keptSections,
		note: '',
		history: events,
		deleted: false,
		claimedBy: '',
		claimedAt: 0,
	};

	return {
		ok: true,
		newCard,
		relations: validated.value,
		events,
		droppedSections,
		missingSections,
	};
}

// ─────────────────────────────────────────────────────────────
// fork 面板预览（只读）
// ─────────────────────────────────────────────────────────────

/** 一条会转移 / 被跳过的边。 */
export interface TransferItem {
	/** 边的持有者（谁身上挂着这条边）。 */
	from: CardId;
	label: string;
	/** 边的目标（= 被 fork 的源卡）。 */
	to: CardId;
	/** 为什么会转 —— 只给类别，不给文案。 */
	why: 'child' | 'dependency';
}

/** 预览结果。 */
export interface ForkTransfer {
	transfer: TransferItem[];
	skip: TransferItem[];
}

/**
 * 供 fork 面板预览「哪些子任务 / 依赖会转移」。
 *
 * `【用户指令，2026-11-01 05:52】`「未完成的子任务，和依赖，都会转移过来。
 * 相关，参考，完成的子任务，不会转移。」
 *
 * ## 边界
 *
 * · **纯读**：不复制边、不改任何东西。
 * · **"未完成"的判定问 ③ 的 `isCompletedGroup`** —— ⑦ 不写状态字面量。
 * · **墓碑卡不参与**（已删除 = 出局）：其边不转移、也不出现在 `skip` 里。
 * · `相关 / 参考` **不在本函数枚举范围**（`why` 只有 `child` / `dependency` 两类），
 *   因此天然不会出现在 `transfer` 里。
 */
export function planForkTransfer(ports: Ports, src: Card, all: readonly Card[]): ForkTransfer {
	const transfer: TransferItem[] = [];
	const skip: TransferItem[] = [];

	for (const card of all) {
		if (card.deleted) continue;
		if (card.id === src.id) continue;

		// ① 子任务：`parent === src.id`。
		if (card.relations.parent === src.id) {
			const item: TransferItem = { from: card.id, label: 'parent', to: src.id, why: 'child' };
			(ports.types.isCompletedGroup(card.status) ? skip : transfer).push(item);
		}

		// ② 依赖：由**依赖方持有**、指向 src 的依赖边。
		for (const link of card.relations.links) {
			if (link.to !== src.id) continue;
			if (link.label !== 'dependsOn') continue;
			const item: TransferItem = {
				from: card.id,
				label: link.label,
				to: src.id,
				why: 'dependency',
			};
			(ports.types.isCompletedGroup(card.status) ? skip : transfer).push(item);
		}
	}

	return { transfer, skip };
}
