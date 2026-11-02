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
import type { Card, Ports, SectionSpec } from './ports.js';
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

	/* ① 章节必须在模板里，或本来就是卡上已有的（旧模板残留也允许改）。 */
	const sections = sectionsOfCard(ports.types, card);
	if (sections === undefined) {
		return {
			ok: false,
			error: coreError('TEMPLATE_MISSING', `找不到模板「${card.template.ref}」`, {
				templateRef: card.template.ref,
			}),
		};
	}

	const known = sections.find((section) => section.id === sectionId);
	const existing = Object.hasOwn(card.sections, sectionId);

	if (known === undefined && !existing) {
		return {
			ok: false,
			error: coreError(
				'EDIT_VALIDATION_FAILED',
				`章节「${sectionId}」不在模板「${card.template.ref}」里。`,
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

	/* ③ ⑦ 出计划（键集守卫 / 声明冻结都在它那儿）。 */
	const nextSections = { ...card.sections, [sectionId]: payload };
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

	/* 新增章节必须属于模板（⑦ 不查模板）。 */
	if (editable['sections'] !== undefined) {
		const sections = sectionsOfCard(ports.types, card);
		if (sections === undefined) {
			return {
				ok: false,
				error: coreError('TEMPLATE_MISSING', `找不到模板「${card.template.ref}」`, {
					templateRef: card.template.ref,
				}),
			};
		}
		const allowed = new Set(sections.map((section) => section.id));
		const added = addedSectionIds(
			card.sections,
			editable['sections'] as Record<string, unknown>,
		).filter((id) => !allowed.has(id));
		if (added.length > 0) {
			return {
				ok: false,
				error: coreError(
					'EDIT_VALIDATION_FAILED',
					`新增的章节不在模板里：${added.join(' / ')}`,
					{ cardId, sectionIds: added },
				),
			};
		}
	}

	const plan = ports.cards.planChange(card, { editable, at });
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
