/**
 * ④ relation —— 级联**计划**。只算不写，执行归 ⑧ core。
 *
 * ## 两阶段：`relationsPhase` 与 `statusPhase`
 *
 * 原以为"同一张卡内先改关系再改状态"就够了。**不成立** ——
 * 真正的顺序是**跨卡的**：A 的「依赖从旧卡改指新卡」必须发生在**旧卡**被置为终态之前，
 * 而 A 与旧卡是**两张不同的卡**。卡内约束会漏掉跨卡顺序。
 *
 * ⇒ 拆成两个 phase：**先把所有关系改完，再改任何状态**。
 * "先转移依赖、再判旧卡死刑"于是从一句约定变成**结构**：⑧ 跑完 `relationsPhase` 再跑 `statusPhase`，
 * 不可能交错，也不需要任何运行时校验。
 *
 * ## 为什么两个数组用两个**具体类型**，而不是一个联合
 *
 * 若两个数组都收 `PlanItem` 联合，"把 `patchRelations` 塞进 `statusPhase`"在类型上就是合法的，
 * 只能靠承诺。分开之后：
 *   - 混放是**编译错误**；
 *   - ⑧ 的循环里不会出现 `item.kind === …` 这个分支位置 —— 而那个位置就是"未来顺手加个 case"的入口。
 *
 * 代价：将来加第三类动作必须加第三个 phase。**而这正是收益**：强制回答"它属于哪个阶段"，
 * 而阶段顺序是这里**唯一有语义**的东西。
 *
 * ## phase 内的顺序
 *
 * **按 `cardId` 的 UTF-16 code unit 升序**，**禁用 `localeCompare`** ——
 * 后者依赖运行环境 locale，会让同一份计划在两台机器上排序不同，
 * 于是"两份语义相同的计划深比较不相等"，可观察性被打坏。
 *
 * phase 内顺序**无语义，仅确定性**（可重放、可测、可观察）。
 *
 * ## ④ 不认识状态
 *
 * "哪些状态算进行态 / 完成组"由调用方以**数据**形式传入（`CascadeVocabulary`），
 * ④ 只做集合成员判断，不持有状态词汇。状态组是 TS 类型、运行时被擦除，
 * 所以除了传数组没有别的办法 —— 这也正是它必须是数据的原因。
 *
 * 见 docs/04-relation.md 2.5 / 2.10。
 */

import { BEHAVIOR_LINK, type LinkLabel } from './kinds.js';
import type { RelationPatch } from './patch.js';
import {
	validateRelations,
	type CardId,
	type Issue,
	type RelationEntry,
	type Relations,
} from './relations.js';

/** 级联里"为什么动这张卡"。结构化、可写进历史、可被程序读，不含自然语言。 */
export type Reason =
	/** 沿边命中：`via: 'parent'` 表示它是上级的子卡；`via: { label, from }` 表示某卡指向它的那条边。 */
	| { readonly kind: 'path-hit'; readonly via: 'parent' | { readonly label: LinkLabel; readonly from: CardId } }
	/** 旧卡不在「完成」组 ⇒ 转取消。 */
	| { readonly kind: 'superseded-incomplete' }
	/** 旧卡已在「完成」组 ⇒ 不动状态。 */
	| { readonly kind: 'superseded-noop' };

/** 改关系的那一类动作。`relationsPhase` 只收这个。 */
export interface RelationsItem {
	readonly kind: 'patchRelations';
	readonly cardId: CardId;
	/**
	 * 这张卡要应用的补丁，**按数组顺序**。
	 *
 * ⚠ 与 docs 2.5 写的单数字段名 `relationPatch` 不同：这里用**复数** `relationPatches`。
 * 理由：一张卡可能同时依赖**两张都被取代的旧卡**，那样它需要带走两条补丁；
 * 用单数只能让同一张卡在数组里出现两次 —— 而计划项按 `cardId` 唯一（④⑧ 的约定）。
 * **这条差异需 Lead / ⑧ 确认。**
	 */
	readonly relationPatches: readonly RelationPatch[];
	readonly reasons: readonly Reason[];
}

/** 改状态的那一类动作。`statusPhase` 只收这个。 */
export interface StatusItem {
	readonly kind: 'setStatus';
	readonly cardId: CardId;
	readonly targetStatus: string;
	readonly reasons: readonly Reason[];
}

/** 一次级联的完整计划。 */
export interface CascadePlan {
	readonly relationsPhase: readonly RelationsItem[];
	readonly statusPhase: readonly StatusItem[];
	/**
	 * 算计划时发现的**坏数据**（某些卡的 relations 本身不合形），
	 * 单列出来让调用方归入"坏卡"清单 —— **不静默跳过**。
	 */
	readonly issues: readonly Issue[];
}

/**
 * ④ 需要的状态数据。**由调用方传**，④ 不持有状态词汇。
 *
 * - `activeStatuses`   —— 哪些状态算"进行态"（会被级联收走）；
 * - `completedStatuses` —— 「完成」组：成功 / 失败 / 取消 / 拒绝（用户 06:55）；
 * - `canceledStatus`   —— 级联收人时改成哪个状态（状态值归 ③，④ 只搬运）。
 */
export interface CascadeVocabulary {
	readonly activeStatuses: readonly string[];
	readonly completedStatuses: readonly string[];
	readonly canceledStatus: string;
}

/** ④ 需要看到的卡的最小面。**不使用 ⑦ 的 `Card`** —— ④ 是第 0 层，零依赖。 */
export interface CascadeCard {
	readonly id: CardId;
	readonly status: string;
	/** 卡上原始的 relations（可能是旧数据，未校验）。 */
	readonly relations: unknown;
}

/** UTF-16 code unit 比较。**不用 `localeCompare`**（见文件头）。 */
function compareCardId(a: CardId, b: CardId): number {
	if (a < b) return -1;
	if (a > b) return 1;
	return 0;
}

function sortByCardId<T extends { readonly cardId: CardId }>(items: T[]): T[] {
	return items.sort((left, right) => compareCardId(left.cardId, right.cardId));
}

function inList(list: readonly string[], value: string): boolean {
	return list.includes(value);
}

/** 读一张卡的 relations；读不出就记 issue 并返回 `undefined`（**不静默**）。 */
function readRelations(card: CascadeCard, issues: Issue[]): Relations | undefined {
	const result = validateRelations(card.relations);
	if (!result.ok) {
		for (const issue of result.issues) issues.push(issue);
		return undefined;
	}
	return result.value;
}

/** 把同一张卡的多个 reason 合并成一条计划项时用；同 reason 去重。 */
function pushReason(target: Reason[], reason: Reason): void {
	const exists = target.some((item) => {
		if (item.kind !== reason.kind) return false;
		if (item.kind !== 'path-hit' || reason.kind !== 'path-hit') return true;
		const left = item.via;
		const right = reason.via;
		if (left === 'parent' || right === 'parent') return left === right;
		return left.label === right.label && left.from === right.from;
	});
	if (!exists) target.push(reason);
}

/**
 * 一次"进入「完成」组"引发的收口计划。
 *
 * - 起点：`rootId` 刚刚进入「完成」组；
 * - **子卡走向下**（`parent` 指向我），**依赖方走反向**（`links` 里 `dependsOn: 我`）；
 * - **只收进行态**：草稿与已终结的不动，且走到即停；
 * - **成功不收下游**：`closeDependents === false` 时只收子卡，不收依赖方 —— 由调用方判断，
 *   因为"哪个终态算成功"是状态词汇，④ 不认识。
 */
export function planCascade(
	cards: readonly CascadeCard[],
	rootId: CardId,
	vocabulary: CascadeVocabulary,
	closeDependents: boolean,
): CascadePlan {
	const issues: Issue[] = [];
	const relationsOf = new Map<CardId, Relations>();

	for (const card of cards) {
		const relations = readRelations(card, issues);
		if (relations !== undefined) relationsOf.set(card.id, relations);
	}

	/* 收集进行态下游。`seen` 兼做防环。 */
	const seen = new Set<CardId>([rootId]);
	const collected = new Map<CardId, Reason[]>();
	const queue: { id: CardId; closeDependents: boolean }[] = [
		{ id: rootId, closeDependents },
	];

	while (queue.length > 0) {
		const item = queue.shift() as { id: CardId; closeDependents: boolean };
		for (const card of cards) {
			if (card.id === item.id) continue;
			if (seen.has(card.id)) continue;
			/* 只收进行态：草稿与终态不动，且不再往下走。 */
			if (!inList(vocabulary.activeStatuses, card.status)) continue;

			const viaParent = relationsOf.get(card.id)?.parent === item.id;
			let viaLink: { label: LinkLabel; from: CardId } | undefined;
			if (item.closeDependents) {
				for (const entry of relationsOf.get(card.id)?.links ?? []) {
					if (entry.to === item.id && entry.label === BEHAVIOR_LINK) {
						viaLink = { label: entry.label, from: card.id };
						break;
					}
				}
			}

			if (!viaParent && viaLink === undefined) continue;

			seen.add(card.id);
			const reasons = collected.get(card.id) ?? [];
			if (viaParent) pushReason(reasons, { kind: 'path-hit', via: 'parent' });
			if (viaLink !== undefined) pushReason(reasons, { kind: 'path-hit', via: viaLink });
			collected.set(card.id, reasons);

			/* 它自己也要被收 ⇒ 它自己的下游也一起收。 */
			queue.push({ id: card.id, closeDependents: true });
		}
	}

	const statusPhase: StatusItem[] = [];
	for (const [cardId, reasons] of collected) {
		statusPhase.push({
			kind: 'setStatus',
			cardId,
			targetStatus: vocabulary.canceledStatus,
			reasons,
		});
	}

	return { relationsPhase: [], statusPhase: sortByCardId(statusPhase), issues };
}

/**
 * 一次取代（新卡替代若干旧卡）的计划。
 *
 * **顺序**：先把指向旧卡的依赖改指新卡（`relationsPhase`），再处置旧卡（`statusPhase`）——
 * 反序的话，旧卡一转终态就会把那些依赖方当死路收掉，而它们本该改指新卡活下来。
 *
 * **旧卡的处置**（用户 06:55「『完成』是一个状态组」）：
 *   - 在「完成」组 ⇒ **不动状态**（不产生 `statusPhase` 项）；
 *   - 不在「完成」组 ⇒ **转 `canceledStatus`**。
 */
export function planSupersede(
	cards: readonly CascadeCard[],
	newCardId: CardId,
	oldCardIds: readonly CardId[],
	vocabulary: CascadeVocabulary,
): CascadePlan {
	const issues: Issue[] = [];
	const oldSet = new Set(oldCardIds);

	/* 卡 → 需要应用到它的补丁。 */
	const patchesByCard = new Map<CardId, RelationPatch[]>();
	const reasonsByCard = new Map<CardId, Reason[]>();

	for (const card of cards) {
		const relations = readRelations(card, issues);
		if (relations === undefined) continue;

		for (const entry of relations.links) {
			if (!entry || entry.label !== BEHAVIOR_LINK) continue;
			if (!oldSet.has(entry.to)) continue;

			const patches = patchesByCard.get(card.id) ?? [];
			patches.push({ op: 'retargetLink', from: entry.to, to: newCardId, label: BEHAVIOR_LINK });
			patchesByCard.set(card.id, patches);

			const reasons = reasonsByCard.get(card.id) ?? [];
			pushReason(reasons, {
				kind: 'path-hit',
				via: { label: BEHAVIOR_LINK, from: entry.to },
			});
			reasonsByCard.set(card.id, reasons);
		}
	}

	const relationsPhase: RelationsItem[] = [];
	for (const [cardId, patches] of patchesByCard) {
		relationsPhase.push({
			kind: 'patchRelations',
			cardId,
			relationPatches: patches,
			reasons: reasonsByCard.get(cardId) ?? [],
		});
	}

	const statusPhase: StatusItem[] = [];
	for (const oldId of oldCardIds) {
		const status = (cards.find((card) => card.id === oldId) ?? undefined)?.status;
		if (status === undefined) {
			/* 旧卡不在卡集里：数据异常，交给调用方分类（④ 不认识空间 / 墓碑）。 */
			issues.push({
				kind: 'patch',
				reason: 'target-missing',
				detail: `取代目标 ${oldId} 不在卡集中`,
			});
			continue;
		}
		if (inList(vocabulary.completedStatuses, status)) {
			/* 已完成 ⇒ 不动状态（`superseded-noop`）。不产生计划项。 */
			continue;
		}
		statusPhase.push({
			kind: 'setStatus',
			cardId: oldId,
			targetStatus: vocabulary.canceledStatus,
			reasons: [{ kind: 'superseded-incomplete' }],
		});
	}

	return {
		relationsPhase: sortByCardId(relationsPhase),
		statusPhase: sortByCardId(statusPhase),
		issues,
	};
}

/**
 * 读一张卡的关系（对外查询用）。
 *
 * ④ 只出**边**：源头/目标/类型/方向；**不给**目标卡的标题与状态，也不做多跳遍历，
 * 更不做全图组装（画边归 ⑩）。见 docs 3.4 / 5.16。
 */
export function edgesOf(card: CascadeCard): readonly RelationEntry[] {
	const issues: Issue[] = [];
	const relations = readRelations(card, issues);
	return relations?.links ?? [];
}

/**
 * 关系的**另一端点**是否是草稿 —— 关系栏的显示规则。
 *
 * 规则一条：**关系项的另一端点是草稿 ⇒ 不显示**（出边看目标、入边看源）。
 * ④ 不认识状态，所以判断由调用方传进来（`isDraft`）；④ 只负责按它过滤**自己的边**。
 *
 * ⚠ 这只是 ④ 的可用工具，不是 ④ 的默认行为 —— ④ 仍然出全量边。
 */
export function isVisibleTarget(isDraft: (cardId: CardId) => boolean, entry: RelationEntry): boolean {
	return !isDraft(entry.to);
}
