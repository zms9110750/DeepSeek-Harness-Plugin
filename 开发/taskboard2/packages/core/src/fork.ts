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
 *   2. **给缺的章补 payload** ⇒ 用 ③ 的 `sectionsOf` 给出的该章 `default`
 *
 * ⇒ ⑧ 在这一条路径上不是纯转发，而是**编排 + 消费 ② 的判定**。
 *   ⚠ 但"要不要因丢弃而阻断"是**已裁策略**（允许丢弃 + history 留痕），
 *   **不是 core 每次运行时做的决定** —— 所以这里没有 `if (hasContent && !allow) 拒绝`。
 *
 * ## 缺章没有 `default` 怎么办
 *
 * **报错，不猜。** `accepts` 移除后（用户 11:26），"从候选 action 里挑一个"的依据不存在了；
 * 剩下的唯一依据是模板为该章声明的 `default`。没有它就没有任何合法初值可造 ——
 * 猜一个 `$type` 等于替模板作者做决定。
 *
 * ⚠ **实测：17 个模板 52 章里 8 章没有 `default`**（`delivery.yaml` 全部三章、
 *   `question.yaml` 的 `blocked` 等）⇒ 这条报错会真的触发，是**模板内容问题**，
 *   报错信息要能指出是哪一章。
 *
 * ## 丢弃的 payload 不被持久化
 *
 * `droppedSections[].payload` **只用来判空**，判完即弃 ——
 * history 只记 `{ sectionId, hadContent }`（内容进 history 会让卡变大、且可能含敏感数据）。
 */

import { coreError, describeReject, type CoreError } from './errors.js';
import { allocateId } from './ids.js';
import type { Card, Ports } from './ports.js';
import { applyStatus, type HistoryEvent } from './status-write.js';
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
 * 对 missing：③ sectionsOf 里该章的 default ⇒ 补 payload（没有 ⇒ EMPTY_PAYLOAD_UNAVAILABLE）
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

	/*
	 * ③ 给缺的章补 payload —— **用该章的 `default`**。
	 *
	 * `accepts` 已彻底移除（用户 11:26）⇒ "从候选 action 里挑一个"的依据不存在了。
	 * 现在唯一的依据是模板为该章声明的 `default`。
	 * **没有 `default` ⇒ 报错，不猜**（猜一个 action 就是替模板作者做决定）。
	 */
	const payloads: Record<string, unknown> = { ...preview.newCard.sections };
	const filled: FilledRecord[] = [];

	for (const section of preview.missingSections) {
		const spec = newSections.find((item) => item.id === section.sectionId);
		const fallback = spec?.default;

		if (fallback === undefined) {
			return {
				ok: false,
				error: coreError(
					'EMPTY_PAYLOAD_UNAVAILABLE',
					`章节「${section.sectionId}」在模板「${templateRef}」里没有 default，fork 无法自动补全，需人工填写。`,
					{ sectionId: section.sectionId, templateRef },
				),
			};
		}

		/* 深拷贝：`default` 来自注册表，新卡要独立持有。 */
		payloads[section.sectionId] = structuredClone(fallback);
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
		const base: Card = { ...plan.newCard, sections: payloads };

		/*
		 * ── 收口：**初值**（`mode:'init'`）──
		 *
		 * 用户 12:46：「建卡，fork，这两个卡的状态初始值，严格上不算转移。」
		 * ⇒ **不判等、不广播**。fork 出的是顶层卡（`parent: ''`），本来也没有父卡要通知。
		 *
		 * fork 自造的两条历史（`fork_discarded` / `fork_filled`）一并经收口追加 ——
		 * `history` 的追加只实现一次（`appendHistory`），不在别处再拼一次。
		 */
		const events: HistoryEvent[] = [
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
		];

		const card = applyStatus({
			card: base,
			to: base.status,
			events,
			mode: 'init',
		}).card;

		tx.write([card]);
		created = card;
	});

	if (failure !== undefined) return { ok: false, error: failure };
	if (created === undefined) {
		return { ok: false, error: coreError('CREATE_VALIDATION_FAILED', 'fork 未产出新卡。') };
	}
	return { ok: true, card: created, dropped, filled };
}
