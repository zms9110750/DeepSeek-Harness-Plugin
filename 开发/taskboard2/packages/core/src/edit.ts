/**
 * ⑧ core —— 编辑流程（UI 单章编辑 + 整卡编辑）。
 *
 * ## 两个入口，强度不同
 *
 * ```
 * updateBody(cardId, sectionId, payload)   —— 单章：只跑 ② validateForEdit（L1）
 * updateCard(cardId, editable)             —— 整卡：走 ⑦ planChange（键集守卫 / 声明冻结 / 关系收口）
 * ```
 *
 * ## 落库前的模板检查：**只查新增键，不查删键**
 *
 * ⑦ 的 `planChange` 已保证「草稿期不得删已有 `sectionId` 键」，但它**不查"新键是否属于模板"**
 * （那需要模板知识，⑦ 不看模板）。⇒ 这一条落在 ⑧：**新增的 `sectionId` 必须在模板章节集里**。
 *
 * 为什么只查新增：删键已被 ⑦ 拦；只查新增不会与它重复。
 */

import { coreError, describeReject, type CoreError } from './errors.js';
import type { Card, CardSection, Ports, SectionSpec } from './ports.js';
import { appendHistory, type HistoryEvent } from './status-write.js';
import type { ActiveWorkspace } from './workspace.js';
import { findCard } from './workspace.js';

/** 失败。 */
export interface EditFailure {
	readonly ok: false;
	readonly error: CoreError;
	readonly issuesForUI?: readonly unknown[];
}

export interface EditSuccess {
	readonly ok: true;
	readonly card: Card;
	/** 沿监听链重算后**连带改变**的父卡（可能为空）。 */
	readonly recomputed: readonly Card[];
}

export type EditResult = EditSuccess | EditFailure;

/** 从卡的模板取章节清单（模板不存在 ⇒ `undefined`）。 */
function sectionsOfCard(
	types: Pick<Ports['types'], 'sectionsOf'>,
	card: Card,
): readonly SectionSpec[] | undefined {
	return types.sectionsOf(card.template.ref);
}

/** 对比两版 `sections`，取出**新增**的键。 */
function addedSectionIds(
	before: Readonly<Record<string, unknown>>,
	after: Readonly<Record<string, unknown>>,
): string[] {
	const out: string[] = [];
	for (const key of Object.keys(after)) {
		if (!Object.hasOwn(before, key)) out.push(key);
	}
	return out;
}

/**
 * UI 单章编辑：**只校验这一章**，不跑整卡 schema。
 *
 * 编辑期若跑完整 schema，用户"把 `ask` 的最后一项删掉"就存不下来（`minItems: 1` 会拒），
 * 且无法绕过（必须先加一项才能删）。⇒ 编辑期只跑 L1，正确性由渲染器健壮性兜底。
 *
 * ⚠ **新增章节也要过 ⑧ 的"属于模板"检查**：单章编辑可以新增 key，
 * 而 ⑦ 的键集守卫只在 `planChange` 里、且不查模板。
 */
export function updateBody(
	ports: Pick<Ports, 'store' | 'actions' | 'types' | 'cards'>,
	workspace: ActiveWorkspace,
	cardId: string,
	sectionId: string,
	payload: unknown,
	at: number,
): EditResult {
	const card = findCard(workspace, cardId);
	if (card === undefined || card.deleted === true) {
		return { ok: false, error: coreError('CARD_NOT_FOUND', `找不到这张卡：${cardId}`, { cardId }) };
	}

	/*
	 * ① 章节定位 —— **降级友好**：不改 label，只改 payload。
	 *
	 * - **卡上已有的章** ⇒ 直接允许改（**不查模板**）—— 用户 14:50「可以展示，没有行为」下，
	 *   已有章节的内容仍可编辑（label 在卡上，不依赖模板）；
	 * - **卡上没有的章**（新章节）⇒ 必须查模板拿 `label` ⇒ 模板不可用则拒绝
	 *   （用 `SECTION_LABEL_UNAVAILABLE`，**不是** `TEMPLATE_MISSING` —— 后者意思是"模板不存在"，
	 *   而这里的真实原因是"新章节需要模板提供 label，但模板不可用"）。
	 */
	const existing = Object.hasOwn(card.sections, sectionId);
	let label: string | undefined;

	if (existing) {
		/* 已有章节：label 就在卡上，**完全不碰模板**（降级模式下也能改）。 */
		label = card.sections[sectionId]?.label;
	} else {
		const specs = sectionsOfCard(ports.types, card);
		const known = specs?.find((section) => section.id === sectionId);
		if (known === undefined) {
			return {
				ok: false,
				error: coreError(
					'SECTION_LABEL_UNAVAILABLE',
					`章节「${sectionId}」不在卡上，且模板「${card.template.ref}」不可用或没有这一章，无法确定章节名。`,
					{ cardId, sectionId, templateRef: card.template.ref },
				),
			};
		}
		label = known.label;
	}

	if (label === undefined) {
		return {
			ok: false,
			error: coreError(
				'SECTION_LABEL_UNAVAILABLE',
				`章节「${sectionId}」在卡上没有章节名副本，且模板不可用。`,
				{ cardId, sectionId, templateRef: card.template.ref },
			),
		};
	}

	/* ② 单章校验：`accepts` 已移除（用户 11:26）⇒ 只传 `sectionId` 用于问题定位。 */
	const result = ports.actions.validateForEdit(payload, { sectionId });
	if (!result.ok) {
		return {
			ok: false,
			error: coreError('EDIT_VALIDATION_FAILED', '编辑校验未通过。', {
				cardId,
				sectionId,
				issues: result.issues,
			}),
			issuesForUI: result.issues.map((issue) => ports.actions.toIssueForUI(issue)),
		};
	}

	/* ③ ⑦ 出计划（键集守卫 / 声明冻结都在它那儿）。**只换 payload，label 保持原值**。 */
	const nextSections = { ...card.sections, [sectionId]: { label, payload } };
	const plan = ports.cards.planChange(card, { editable: { sections: nextSections }, at });
	if (!plan.ok) {
		return {
			ok: false,
			error: coreError('EDIT_VALIDATION_FAILED', describeReject(plan.reason as never), {
				reason: plan.reason,
			}),
		};
	}

	/* ④ 事务内落地。 */
	let updated: Card | undefined;
	let failure: CoreError | undefined;

	ports.store.transaction(workspace.wsId, (tx) => {
		const fresh = tx.read(cardId);
		if (fresh === undefined || fresh.deleted === true) {
			failure = coreError('CARD_NOT_FOUND', `找不到这张卡：${cardId}`, { cardId });
			return;
		}
		/* 事务内重判：卡在事务外被别的循环改过 ⇒ 计划已过期。 */
		if (fresh.status !== card.status || JSON.stringify(fresh.sections) !== JSON.stringify(card.sections)) {
			failure = coreError(
				'EDIT_VALIDATION_FAILED',
				'这张卡在编辑期间被改动过，请重新打开再改。',
				{ cardId },
			);
			return;
		}

		for (const item of plan.items) {
			if (item.op === 'updateCard') updated = item.card;
		}
		if (updated === undefined) return;

		/*
		 * ── 编辑：**不触发状态转移，因而不广播、不写历史** ──
		 *
		 * 用户 12:46：「编辑不会产生历史。只有状态转移会留下历史。」
		 * 且 ⑦ 的 `planChange` **完全不碰 status**（只改 title / note / sections / relations）。
		 * ⇒ 这里既不需要判等、也不需要 `recomputeUpward`。
		 *
		 * ⚠ 曾写过 `if (updated.status !== fresh.status) { recomputeUpward... }` ——
		 * 那个条件**恒为 false**（⑦ 不改 status），是一段"看起来接上了、其实永不执行"的死代码，已删。
		 *
		 * ⑦ 若将来产出 events（当前 `EDIT_ACTION` 按用户口径要删），仍由这里统一追加 ——
		 * 「谁产出事件」与「谁追加历史」是两件事，收口保持通用。
		 */
		updated = appendHistory(updated, plan.events as readonly HistoryEvent[]);
		tx.write([updated]);
	});

	if (failure !== undefined) return { ok: false, error: failure };
	if (updated === undefined) {
		return { ok: false, error: coreError('EDIT_VALIDATION_FAILED', '编辑未产出新卡。') };
	}
	return { ok: true, card: updated, recomputed: [] };
}

/** 整卡编辑（标题 / 备注 / 章节 / 关系）。走 ⑦ 的 `planChange`。 */
export function updateCard(
	ports: Pick<Ports, 'store' | 'types' | 'cards'>,
	workspace: ActiveWorkspace,
	cardId: string,
	editable: Readonly<Record<string, unknown>>,
	at: number,
): EditResult {
	const card = findCard(workspace, cardId);
	if (card === undefined || card.deleted === true) {
		return { ok: false, error: coreError('CARD_NOT_FOUND', `找不到这张卡：${cardId}`, { cardId }) };
	}

	/*
	 * 新增章节必须能拿到 `label`（⑦ 不查模板）。
	 *
	 * **降级友好**：卡上已有的章**不需要模板**（label 在卡上）；
	 * 只有**新增**的章需要从模板抄 label ⇒ 模板不可用则拒绝（`SECTION_LABEL_UNAVAILABLE`）。
	 *
	 * ⚠ 校验通过后要把 `label` **补进 `editable.sections`** —— ⑦ 收到的必须已是
	 * `{ [sectionId]: { label, payload } }`（⑦ 不查模板，拿不到 label）。
	 */
	let effectiveEditable = editable;

	if (editable['sections'] !== undefined) {
		const nextSections = editable['sections'] as Record<string, unknown>;
		const added = addedSectionIds(card.sections, nextSections);

		if (added.length > 0) {
			const specs = sectionsOfCard(ports.types, card);
			const byId = new Map((specs ?? []).map((section) => [section.id, section]));

			const unresolved = added.filter((id) => byId.get(id)?.label === undefined);
			if (unresolved.length > 0) {
				return {
					ok: false,
					error: coreError(
						'SECTION_LABEL_UNAVAILABLE',
						`新增章节在卡上不存在，且模板「${card.template.ref}」不可用或没有这些章，无法确定章节名：${unresolved.join(' / ')}`,
						{ cardId, sectionIds: unresolved, templateRef: card.template.ref },
					),
				};
			}
		}

		/*
		 * 把 `editable.sections` 归一成 `{ label, payload }`：
		 * - 已有章 ⇒ label 取卡上那份（**不覆盖**，用户 14:47「存副本」的意思就是它不随模板变）；
		 * - 新增章 ⇒ label 取模板。
		 */
		const normalized: Record<string, { label: string; payload: unknown }> = {};
		for (const [id, value] of Object.entries(nextSections)) {
			const fromCard = card.sections[id]?.label;
			const raw = value as Partial<CardSection> | undefined;
			const payload =
				raw !== null && typeof raw === 'object' && 'payload' in raw ? raw.payload : value;
			const label = fromCard ?? (raw !== null && typeof raw === 'object' ? raw.label : undefined);
			if (label === undefined) continue; /* 已被上面的 unresolved 检查挡掉 */
			normalized[id] = { label, payload };
		}
		effectiveEditable = { ...editable, sections: normalized };
	}

	const plan = ports.cards.planChange(card, { editable: effectiveEditable, at });
	if (!plan.ok) {
		return {
			ok: false,
			error: coreError('EDIT_VALIDATION_FAILED', describeReject(plan.reason as never), {
				reason: plan.reason,
			}),
		};
	}

	let updated: Card | undefined;
	ports.store.transaction(workspace.wsId, (tx) => {
		for (const item of plan.items) {
			if (item.op === 'updateCard') updated = item.card;
		}
		if (updated === undefined) return;

		/* 编辑不产生状态转移 ⇒ 不广播、不写历史（同 `updateBody`）。 */
		updated = appendHistory(updated, plan.events as readonly HistoryEvent[]);
		tx.write([updated]);
	});

	if (updated === undefined) {
		return { ok: false, error: coreError('EDIT_VALIDATION_FAILED', '编辑未产出新卡。') };
	}
	return { ok: true, card: updated, recomputed: [] };
}
