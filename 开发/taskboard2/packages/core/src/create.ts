/**
 * ⑧ core —— 建卡流程（三入口共用）。
 *
 * ## 流程（顺序不可换）
 *
 * ```
 * ① 解析模板（③）                    —— 拿 kind / domain / codePrefix / 章节清单
 * ② 预置 sections（预设模板才带）      —— 普通模板 = 面板已填
 * ③ 章节校验（assertSectionsComplete） —— 事务**外**
 * ④ 关系目标校验（存在 / 非草稿 / 同空间）—— 事务**外**
 * ⑤ 事务内：发号 → ⑦ planCreate → 写卡 + 历史
 * ```
 *
 * ## 为什么校验在事务外
 *
 * ② 与 ③ 都是**纯内存判定**（不写盘、不读库）⇒ 放事务内只拉长事务、不增加正确性。
 * 而模板注册表**启动期后不可变** ⇒ 不存在"校验通过 → 落库"之间模板变更的窗口。
 *
 * ## 为什么关系校验在 ⑧
 *
 * 变量替换后的 `relations.parent` 与每条 `links[].to` 都要判「存在 / 非草稿 / 同空间」。
 * ⑦ **不知道"空间"这个概念**（卡不存空间、⑦ 不依赖 ⑥）⇒ 这条判据 ⑦ 表达不出来。
 */

import { coreError, describeReject, type CoreError } from './errors.js';
import { allocateId } from './ids.js';
import type { Card, DeriveButton, Ports, Principal, TypesPort } from './ports.js';
import { applyStatus, type HistoryEvent } from './status-write.js';
import { assertSectionsComplete } from './validate.js';
import type { ActiveWorkspace } from './workspace.js';
import { findCard } from './workspace.js';

/** 建卡来源。**只影响 `history` 的动作名与日志，不影响校验强度**。 */
export type CreateOrigin = 'panel' | 'ai';

/** `createCard` 的入参。 */
export interface CreateCardInput {
	/** 模板名（= ③ 的 `name`）。 */
	readonly templateRef: string;
	readonly title: string;
	/** `{ [sectionId]: payload }`。省略 ⇒ 用各章的 `default` 预填（见 `sectionsFromDefaults`）。 */
	readonly sections?: Readonly<Record<string, unknown>>;
	/** 关系。 */
	readonly relations?: { readonly parent?: string; readonly links?: readonly { readonly label: string; readonly to: string }[] };
	readonly note?: string;
	/** 分类覆盖。省略 ⇒ 用模板的 `kind`。 */
	readonly kind?: string;
	readonly origin: CreateOrigin;
	/** 由门面盖时间戳；本模块不取时钟。 */
	readonly at: number;
}

/** 失败。 */
export interface CreateFailure {
	readonly ok: false;
	readonly error: CoreError;
	/** ⑩ 用的 issue 投影（只有校验失败时非空）。 */
	readonly issuesForUI?: readonly unknown[];
}

/** 成功：新卡已落库。 */
export interface CreateSuccess {
	readonly ok: true;
	readonly card: Card;
	/** 沿监听链重算后**连带改变**的父卡（可能为空）。 */
	readonly recomputed: readonly Card[];
}

export type CreateResult = CreateSuccess | CreateFailure;

/**
 * 关系目标校验：**存在 / 非草稿 / 同空间**。
 *
 * `parent` 与每条 `links[].to` **一视同仁** —— 它们在"草稿不能被指"下是同一条规则的两个实例，
 * 不是"顺手也校一下"。
 *
 * 空串（顶层 `parent`）跳过。
 */
export function checkRelationTargets(
	ports: { readonly types: Pick<TypesPort, 'DRAFT'> },
	workspace: ActiveWorkspace,
	relations: { readonly parent?: string; readonly links?: readonly { readonly label: string; readonly to: string }[] } | undefined,
): CoreError | undefined {	if (relations === undefined) return undefined;

	const bad = (id: string, why: string): CoreError =>
		coreError('RELATION_TARGET_INVALID', `关系目标「${id}」不可用：${why}`, { target: id, why });

	const targets: string[] = [];
	if (typeof relations.parent === 'string' && relations.parent !== '') targets.push(relations.parent);
	for (const link of relations.links ?? []) {
		if (typeof link?.to === 'string' && link.to !== '') targets.push(link.to);
	}

	for (const target of targets) {
		const card = findCard(workspace, target);
		/* 卡集本来就是"当前空间全量"，找不到 ⇒ 不存在（或不在这个空间）。 */
		if (card === undefined) return bad(target, '这张卡不在当前工作空间里');
		if (card.deleted === true) return bad(target, '这张卡已删除');
		if (card.status === ports.types.DRAFT) return bad(target, '草稿不能作为关系的目标');
	}
	return undefined;
}

/**
 * 用模板各章的 `default` 铺一份初始 `sections`。
 *
 * **只铺有 `default` 的章**：没写 `default` 的章留空 —— "该补什么"由调用方决定
 * （建卡面板会让用户填、fork 会单独报错）。这里**不猜**。
 */
export function sectionsFromDefaults(
	sections: readonly { readonly id: string; readonly default?: unknown }[],
): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const section of sections) {
		if (section.default === undefined) continue;
		/* 深拷贝一层：`default` 来自注册表，调用方会改它，不能共享引用。 */
		out[section.id] = structuredClone(section.default);
	}
	return out;
}

/** `deriveDefaults` 的产物：建卡时的三个初始字段。 */
export interface DeriveInit {
	/** 用哪个模板。 */
	readonly templateRef: string;
	/** 新卡标题。 */
	readonly title: string;
	/** 关系：父任务 = 当前卡。 */
	readonly relations: { readonly parent: string; readonly links: readonly [] };
}

/**
 * 派生按钮的**初始化行为**（用户 11:26 写死在代码里的那三条）。
 *
 * > 「选择派生提供的模板，把关系里面设置对方为父任务，标题用父任务的标题，
 * >   加上 `-`，然后加上父任务对这个派生按钮写的 label。如果没有 label，就加模板名字。」
 *
 * ```
 * templateRef = derive.template
 * relations.parent = parentCard.id
 * title = `${parentCard.title}-${derive.label ?? template.displayName}`
 * ```
 *
 * ⚠ **这只是初始化**：返回的是"建卡面板的预填值"，用户随后可以改模板、改标题、删关系。
 * 中途改模板时**标题不会跟着自动改** —— 因为标题一旦预填就是普通字段，
 * 由用户/面板自己维护，**⑧ 不再回算**。
 *
 * 纯函数：不碰存储、不产生计划、不取时钟。
 */
export function deriveDefaults(
	parentCard: Pick<Card, 'id' | 'title'>,
	derive: DeriveButton,
	templateDisplayName: string,
): DeriveInit {
	/* 按钮按钮文字优先；没写就用模板的中文显示名。 */
	const suffix = derive.label !== undefined && derive.label !== '' ? derive.label : templateDisplayName;
	return {
		templateRef: derive.template,
		title: `${parentCard.title}-${suffix}`,
		relations: { parent: parentCard.id, links: [] },
	};
}

/**
 * 建卡。
 *
 * **三入口共用**：`origin` 只影响历史动作名，**不影响任何校验强度**。
 */
export function createCard(ports: Ports, workspace: ActiveWorkspace, input: CreateCardInput): CreateResult {
	const template = ports.types.resolve(input.templateRef);
	if (template === undefined) {
		return {
			ok: false,
			error: coreError('TEMPLATE_MISSING', `找不到模板「${input.templateRef}」，无法建卡`, {
				templateRef: input.templateRef,
			}),
		};
	}

	/* ── ② 章节初值：调用方给了就用；没给就用模板各章的 `default` ── */
	const sections: Record<string, unknown> =
		input.sections !== undefined
			? { ...input.sections }
			: sectionsFromDefaults(template.sections);

	/* ── ③ 章节校验（事务外）── */
	const chapterCheck = assertSectionsComplete(
		{ types: ports.types, actions: ports.actions },
		input.templateRef,
		sections,
	);
	if (!chapterCheck.ok) {
		return {
			ok: false,
			error: chapterCheck.error,
			...(chapterCheck.issuesForUI === undefined ? {} : { issuesForUI: chapterCheck.issuesForUI }),
		};
	}

	/* ── ④ 关系目标校验（事务外）── */
	const relationError = checkRelationTargets(ports, workspace, input.relations);
	if (relationError !== undefined) return { ok: false, error: relationError };

	/* ── ⑤ 事务内：发号 + 建卡计划 + 写卡 ── */
	let created: Card | undefined;
	let failure: CoreError | undefined;

	ports.store.transaction(workspace.wsId, (tx) => {
		/* 事务内重读：拿到最新全量（含墓碑）用于发号。 */
		const current = tx.readAll();
		const usedIds = current.map((card) => card.id);

		const allocated = allocateId(ports.types, input.templateRef, usedIds);
		if (!allocated.ok) {
			failure = allocated.error;
			return;
		}

		const plan = ports.cards.planCreate(
			{
				id: allocated.id,
				title: input.title,
				templateRef: input.templateRef,
				sections,
				...(input.relations === undefined ? {} : { relations: input.relations }),
				...(input.note === undefined ? {} : { note: input.note }),
				...(input.kind === undefined ? {} : { kind: input.kind }),
				at: input.at,
			},
			current,
		);

		if (!plan.ok) {
			failure = coreError(
				'CREATE_VALIDATION_FAILED',
				describeReject(plan.reason as never),
				{ reason: plan.reason },
			);
			return;
		}

		/* ⑦ 只给计划 ⇒ ⑧ 执行：createCard 项就是要写的卡。 */
		for (const item of plan.items) {
			if (item.op === 'createCard') created = item.card;
		}
		if (created === undefined) {
			failure = coreError('CREATE_VALIDATION_FAILED', '建卡计划里没有新卡（⑧ 与 ⑦ 的契约不一致）。');
			return;
		}

		/*
		 * ── 收口：**初值**（`mode:'init'`）──
		 *
		 * 用户 12:46：「建卡，fork，这两个卡的状态初始值，严格上不算转移。」
		 * ⇒ **不判等、不广播**。⑦ 已把 `initialStatus` 写进卡里，这里只确认它过收口这一层。
		 *
		 * ⚠ **建卡不调 `recomputeUpward`** —— 草稿不是有效卡（用户 12:46），
		 * 父卡看不到它，也就没有"子任务变了"这回事。
		 * （更彻底地说：**初值不广播**，不管它恰好是不是草稿。）
		 */
		const outcome = applyStatus({
			card: created,
			to: created.status,
			events: plan.events as readonly HistoryEvent[],
			mode: 'init',
		});
		created = outcome.card;
		tx.write([created]);
	});

	if (failure !== undefined) return { ok: false, error: failure };
	if (created === undefined) {
		return { ok: false, error: coreError('CREATE_VALIDATION_FAILED', '建卡未产出新卡。') };
	}
	return { ok: true, card: created, recomputed: [] };
}

/** 供门面转发给 ⑩ 的会话主体类型（`Principal` 与 ③ 的 `Actor` 不是同一套）。 */
export function actorKindOf(principal: Principal): 'user' | 'ai' {
	return principal.type === 'user' ? 'user' : 'ai';
}
