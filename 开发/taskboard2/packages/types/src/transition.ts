/**
 * ③ transition —— 转移判决（只给判决，不执行）。
 *
 * 本文件只回答一个问题：**这次转移允许吗？**
 * 它不写状态、不维护领取、不级联、不读存储。
 *
 * 判决分三层：
 *   1) **安全/结构规则**（任何分类、任何模板都不可覆盖）：
 *      - 已处终态 ⇒ 任何转移都不允许（规则表里没有「终态还能转变」的规则）；
 *      - 草稿不可直转处理中（必须先经采纳）；
 *      - 工作类一个 actor 只能占一张（`WORK_SINGLE_CLAIM`）。
 *   2) **依赖门**（`DEPENDS_ON_GATE`）：工作的「提交 → 处理中」要求依赖全部进入「完成」组。
 *   3) **分类规则**：由分类注册项提供（本文件不写死分类差异）。
 *
 * 所有「外部世界的事实」都走 `ctx`，**不走 `actor`**：
 * `actor` 只承载身份种类，不承载依赖、占用、计数等状态信息。
 */

import { type TaskState, TaskState as S } from './status.js';
import { getKind, isEndedStatus } from './kind.js';

/** 触发转移的主体种类（只区分种类，不区分个体）。 */
export type Actor = 'user' | 'ai' | 'host';

/**
 * 转移判决所需的外部事实。
 *
 * **两个字段都必须由调用方（⑧）算好传入。**
 * `undefined` 一律抛错，**不得给默认值** —— 默认 `true` = 静默放行（fail-open）。
 */
export type TransitionCtx = {
	/** 依赖目标是否**全部**处于「完成」组（= 终态）。无依赖时传 `true`。 */
	readonly depsAllEnded: boolean;
	/** 该 actor 名下是否已有「处理中的工作」卡。 */
	readonly actorHasActiveWork: boolean;
};

/** 判决结果。 */
export type TransitionVerdict =
	| { readonly ok: true }
	| { readonly ok: false; readonly reason: string };

function deny(reason: string): TransitionVerdict {
	return { ok: false, reason };
}

const ALLOW: TransitionVerdict = { ok: true };

/** 采纳：草稿 → 提交（只能用户）。 */
function isAdopt(from: TaskState, to: TaskState): boolean {
	return from === S.UNSPECIFIED && to === S.SUBMITTED;
}

/** 领取：提交 → 处理中。 */
function isClaim(from: TaskState, to: TaskState): boolean {
	return from === S.SUBMITTED && to === S.WORKING;
}

/**
 * 运行时守卫：`ctx` 必须是一个带两个 boolean 字段的对象。
 *
 * 为什么不写成 `if (ctx === undefined)`：`ctx` 的静态类型不含 `undefined`，
 * 那样写会触发「无重叠」比较错误。走 `unknown` 通道既保留类型整洁，又能挡住
 * JS 调用方 / `any` 穿透 —— 这是**唯一**能防住"静默放行"的地方。
 */
function requireCtx(ctx: unknown): TransitionCtx {
	if (ctx === null || typeof ctx !== 'object') {
		throw new Error(
			'taskboard2-types: canTransition 缺少 ctx（必须显式提供 depsAllEnded / actorHasActiveWork）',
		);
	}
	const record = ctx as unknown as Record<string, unknown>;
	const deps = record['depsAllEnded'];
	const busy = record['actorHasActiveWork'];
	if (typeof deps !== 'boolean') {
		throw new Error('taskboard2-types: canTransition 的 ctx.depsAllEnded 必须是 boolean，不得缺省');
	}
	if (typeof busy !== 'boolean') {
		throw new Error(
			'taskboard2-types: canTransition 的 ctx.actorHasActiveWork 必须是 boolean，不得缺省',
		);
	}
	return { depsAllEnded: deps, actorHasActiveWork: busy };
}

/**
 * 转移判决。
 *
 * @param kind  分类 id（未注册的分类直接抛错）
 * @param from  当前状态
 * @param to    目标状态
 * @param actor 主体种类
 * @param ctx   外部事实，**必填**；缺字段直接抛错
 */
export function canTransition(
	kind: string,
	from: TaskState,
	to: TaskState,
	actor: Actor,
	ctx: TransitionCtx,
): TransitionVerdict {
	const facts = requireCtx(ctx);

	/* 分类未注册 ⇒ 调用方违约，直接抛错。 */
	if (getKind(kind) === undefined) {
		throw new Error(`taskboard2-types: 未注册的分类 "${kind}"，无法判决转移`);
	}

	/* 同状态：允许（幂等写入不算转移）。 */
	if (from === to) return ALLOW;

	/* 已处终态：任何转移都不允许。 */
	if (isEndedStatus(from)) return deny('终态不可再转移');

	/* 草稿不可直转处理中：必须先经采纳（安全边界，任何模板都不可覆盖）。 */
	if (from === S.UNSPECIFIED && to === S.WORKING) {
		return deny('草稿必须先由用户采纳为「提交」，才能领取');
	}

	/* 采纳只能用户。 */
	if (isAdopt(from, to) && actor !== 'user') return deny('采纳只能由用户执行');

	/* 依赖门：工作的「提交 → 处理中」要求依赖全部进入「完成」组。 */
	if (kind === 'work' && isClaim(from, to) && !facts.depsAllEnded) {
		return deny('依赖尚未全部进入完成组，不能领取（DEPENDS_ON_GATE）');
	}

	/* 工作类一个 actor 只能占一张（WORK_SINGLE_CLAIM）。 */
	if (kind === 'work' && to === S.WORKING && facts.actorHasActiveWork) {
		return deny('该 actor 手上已有处于「处理中」的工作卡，必须先放下（WORK_SINGLE_CLAIM）');
	}

	/* 回到草稿：不允许（草稿只从创建获得，无任何转移转入）。 */
	if (to === S.UNSPECIFIED) return deny('不允许转移回草稿');

	/* 其余转移：放行，由分类规则与准入层继续约束。 */
	return ALLOW;
}
