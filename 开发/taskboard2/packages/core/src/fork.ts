/**
 * ⑧ core —— fork 流程。
 *
 * ## 为什么 fork 在 ⑧ 有一整段逻辑
 *
 * ⑦ 的 `planFork` 只给**两个清单**（纯键集运算），**不解释 payload**：
 *   · `droppedSections` —— 源卡有、新模板无
 *   · `missingSections` —— 新模板有、源卡无
 *
 * 而这两个清单要变成"可落库的卡"，需要**两件 ⑦ 做不到的事**：
 *   1. **判"丢的那章有没有用户内容"** ⇒ 调 ② 的 `hasUserContent`（payload 语义）
 *   2. **给缺的章补空 payload** ⇒ 调 ② 的 `emptyPayloadFor(accepts)`
 *
 * ⇒ ⑧ 在这一条路径上不是纯转发，而是**编排 + 消费 ② 的判定**。
 *   ⚠ 但"要不要因丢弃而阻断"是**已裁策略**（允许丢弃 + history 留痕），
 *   **不是 core 每次运行时做的决定** —— 所以这里没有 `if (hasContent && !allow) 拒绝`。
 *
 * ## 两个失败必须分开报
 *
 * | 情形 | 错误 |
 * |---|---|
 * | `accepts: []`（该章禁一切 action） | `SECTION_ACCEPTS_NOTHING` |
 * | `accepts` 非空但都构造不出空 payload | `SECTION_NO_EMPTY_PAYLOAD` |
 *
 * 合并成"系统错误"会让用户分不清"模板设计如此"与"能力缺口"。
 *
 * ## 丢弃的 payload 不被持久化
 *
 * `droppedSections[].payload` **只用来判空**，判完即弃 ——
 * history 只记 `{ sectionId, hadContent }`（内容进 history 会让卡变大、且可能含敏感数据）。
 */

import { coreError, describeReject, type CoreError } from './errors.js';
import { allocateId } from './ids.js';
import type { Card, Ports } from './ports.js';
import { assertSectionsComplete } from './validate.js';
import type { ActiveWorkspace } from './workspace.js';
import { findCard } from './workspace.js';

/** 丢弃的一章（已判过是否有内容）。 */
export interface DroppedRecord {
	readonly sectionId: string;
	readonly hadContent: boolean;
}

/** 补上的一章。 */
export interface FilledRecord {
	readonly sectionId: string;
}

/** fork 结果。 */
export interface ForkSuccess {
	readonly ok: true;
	readonly card: Card;
	readonly dropped: readonly DroppedRecord[];
	readonly filled: readonly FilledRecord[];
}

export interface ForkFailure {
	readonly ok: false;
	readonly error: CoreError;
	readonly issuesForUI?: readonly unknown[];
}

export type ForkResult = ForkSuccess | ForkFailure;

/**
 * fork 一张卡。
 *
 * 流程：
 * ```
 * ⑦ planFork → { newCard, relations, droppedSections, missingSections }
 * 对 dropped：② hasUserContent(payload) ⇒ hadContent
 * 对 missing：② emptyPayloadFor(accepts) ⇒ 补 payload（undefined ⇒ 报错）
 * assertSectionsComplete(新模板, 补齐后的 payloads)
 * 事务：发号 + 写卡 + 历史
 * ```
 */
export function forkCard(
	ports: Ports,
	workspace: ActiveWorkspace,
	srcId: string,
	options: {
		readonly templateRef?: string;
		readonly kind?: string;
		readonly at: number;
	},
): ForkResult {
	const src = findCard(workspace, srcId);
	if (src === undefined || src.deleted === true) {
		return { ok: false, error: coreError('CARD_NOT_FOUND', `找不到这张卡：${srcId}`, { cardId: srcId }) };
	}

	/* ① 新模板的章节清单（新模板缺 ⇒ fail-closed） */
	const templateRef = options.templateRef ?? src.template.ref;
	const newSections = ports.types.sectionsOf(templateRef);
	if (newSections === undefined) {
		return {
			ok: false,
			error: coreError('TEMPLATE_MISSING', `找不到模板「${templateRef}」，无法 fork`, {
				templateRef,
			}),
		};
	}

	/* ② ⑦ 出 fork 计划（编号先占位，事务内会重发） */
	const preview = ports.cards.planFork(src, newSections, {
		id: src.id, // 占位；真正的编号在事务内由 ③ 发
		templateRef,
		...(options.kind === undefined ? {} : { kind: options.kind }),
		at: options.at,
	});
	if (!preview.ok) {
		return {
			ok: false,
			error: coreError('CREATE_VALIDATION_FAILED', describeReject(preview.reason as never), {
				reason: preview.reason,
			}),
		};
	}

	/* ③ 判"丢的那章有没有内容"（② 的 payload 语义） */
	const dropped: DroppedRecord[] = preview.droppedSections.map((section) => ({
		sectionId: section.sectionId,
		hadContent: ports.actions.hasUserContent(section.payload),
	}));

	/* ④ 给缺的章补空 payload（② 的构造器） */
	const payloads: Record<string, unknown> = { ...preview.newCard.sections };
	const filled: FilledRecord[] = [];

	for (const section of preview.missingSections) {
		const accepts = section.accepts;
		const empty = ports.actions.emptyPayloadFor(accepts as never);

		if (empty === undefined) {
			/* 两种失败分开报：禁一切 vs 构造不出。 */
			const isForbidden = Array.isArray(accepts) && accepts.length === 0;
			return {
				ok: false,
				error: isForbidden
					? coreError(
							'SECTION_ACCEPTS_NOTHING',
							`章节「${section.sectionId}」不接受任何输入组件，fork 无法自动补全，需人工处理。`,
							{ sectionId: section.sectionId },
						)
					: coreError(
							'SECTION_NO_EMPTY_PAYLOAD',
							`章节「${section.sectionId}」的候选组件都无法自动初始化，需人工填写。`,
							{ sectionId: section.sectionId, accepts },
						),
			};
		}
		payloads[section.sectionId] = empty;
		filled.push({ sectionId: section.sectionId });
	}

	/* ⑤ 章节校验（**与新建卡同一个闸门、同一个强度**） */
	const chapterCheck = assertSectionsComplete(
		{ types: ports.types, actions: ports.actions },
		templateRef,
		payloads,
	);
	if (!chapterCheck.ok) {
		return {
			ok: false,
			error: chapterCheck.error,
			...(chapterCheck.issuesForUI === undefined ? {} : { issuesForUI: chapterCheck.issuesForUI }),
		};
	}

	/* ⑥ 事务内：发号 + 落卡 + 两个清单写进 history */
	let created: Card | undefined;
	let failure: CoreError | undefined;

	ports.store.transaction(workspace.wsId, (tx) => {
		const current = tx.readAll();
		const usedIds = current.map((card) => card.id);

		const allocated = allocateId(ports.types, templateRef, usedIds);
		if (!allocated.ok) {
			failure = allocated.error;
			return;
		}

		const plan = ports.cards.planFork(src, newSections, {
			id: allocated.id,
			templateRef,
			...(options.kind === undefined ? {} : { kind: options.kind }),
			at: options.at,
		});
		if (!plan.ok) {
			failure = coreError('CREATE_VALIDATION_FAILED', describeReject(plan.reason as never), {
				reason: plan.reason,
			});
			return;
		}

		/* 用补齐后的 payloads 覆盖 ⑦ 给的 sections（⑦ 只保留了新模板里存在的章）。 */
		const card: Card = {
			...plan.newCard,
			sections: payloads,
			history: [
				...plan.newCard.history,
				...(dropped.length === 0
					? []
					: [
							{
								at: options.at,
								action: 'fork_discarded',
								/* ⚠ 只记 id 与"有没有内容"，**不记 payload**。 */
								detail: dropped.map((item) => ({ sectionId: item.sectionId, hadContent: item.hadContent })),
							},
						]),
				...(filled.length === 0
					? []
					: [
							{
								at: options.at,
								action: 'fork_filled',
								detail: filled.map((item) => item.sectionId),
							},
						]),
			],
		};

		tx.write([card]);
		created = card;
	});

	if (failure !== undefined) return { ok: false, error: failure };
	if (created === undefined) {
		return { ok: false, error: coreError('CREATE_VALIDATION_FAILED', 'fork 未产出新卡。') };
	}
	return { ok: true, card: created, dropped, filled };
}
