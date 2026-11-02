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
 * ⚠ **按需提供**（`【Lead 决定，2026-11-02 13:50】`）：
 * 本文件只在**真正用到**某个字段的分支里 require 它 ——
 * · `depsAllEnded` 只被「工作：提交 → 处理中」用到；
 * · `actorHasActiveWork` 只被「→ 处理中」用到。
 *
 * 用不到的转移（采纳 / 释放 / 取消 / 置成功…）**可以不传 ctx**：强制它们传等于
 * **逼调用方编造 `true` / `false`**，那是让上层撒谎。
 * 但只要**走到了需要该字段的分支却没传** ⇒ **照旧抛错**（fail-closed，不默认 `true`）。
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

/**
 * 采纳的**目的地状态**（按分类）。
 *
 *   · `goal` / `work` ⇒ `SUBMITTED`（提交，进入计算 / 可领取）
 *   · `design` / `record` ⇒ `AUTH_REQUIRED`（需要授权，它们是搁置态的卡）
 *
 * ## ⚠ 这是「哪些分类采纳后去哪」的**唯一出口**
 *
 * ⑦ 的 `planAdopt` **必须调本函数**取目标，**不得自己写分类名单**。
 * 理由：若 ⑦ 自己写一份，将来加第五类时 ——
 *   ③ 的名单改了、⑦ 的没改 ⇒ ⑦ 算出 `SUBMITTED`、`isAdopt` 判为假 ⇒ **采纳被拒**，
 *   而错误是运行期的 `not-draft`，**不是编译错误**，没人看得出为什么。
 *
 * ⇒ `isAdopt` 内部也调本函数（规则只有一份，改一处等于改两处）。
 *
 * ## 与 `isAdopt` 的关系
 *
 * 两者是**同一条规则的两面**：
 *   · 本函数给「采纳该去哪个 `to`」；
 *   · `isAdopt` 判「这个 `(from, to)` 是不是采纳」= `from === 草稿 && to === 本函数结果`。
 *
 * **未注册分类 ⇒ 抛错**（与 `canTransition` 同一口径：分类未注册是调用方违约，
 * 默认成 `SUBMITTED` 会造出一个没人验证过的目的地）。
 */
export function adoptTargetOf(kind: string): TaskState {
	/* 分类必须在册（不猜；`canTransition` 也会在入口先查一次）。 */
	if (getKind(kind) === undefined) {
		throw new Error(`taskboard2-types: 未注册的分类 "${kind}"，无法判断采纳目的地`);
	}
	return kind === 'design' || kind === 'record' ? S.AUTH_REQUIRED : S.SUBMITTED;
}

/**
 * 采纳 —— **两种不同目的地的转移，被叫成同一个名字**：
 *
 *   · goal / work：`草稿 → 提交`（进入计算 / 可领取）
 *   · design / record：`草稿 → 需要授权`（**采纳后**是搁置态，不是生来就搁置）
 *
 * 两者都从草稿出发、都由「采纳」触发，但**目的地不同** ⇒ 下面的 actor 限制也不同。
 * **目的地按分类判定**，不做"任意草稿→任意非草稿都算采纳"的放宽（那会把非矩阵转移也套上采纳的限制）。
 *
 * ⚠ **四类的 `initialStatus` 现在都是 `UNSPECIFIED`**（用户 `16:05` 裁定：
 * 设计卡 / 记录卡建出来应该是草稿，采纳后才变「需要授权」）。
 * 此前 `design` / `record` 的 `initialStatus` 是 `AUTH_REQUIRED` ⇒ 它们**永不处于草稿**
 * ⇒ **本函数对它们的两条分支里，"草稿 → 需要授权"那一条永远走不到**。
 * 改完之后这条路才真的通。
 */
function isAdopt(kind: string, from: TaskState, to: TaskState): boolean {
	if (from !== S.UNSPECIFIED) return false;
	/* ⚠ 目的地规则只有一份（见 `adoptTargetOf`）——别在这里另写分类名单。 */
	return to === adoptTargetOf(kind);
}

/**
 * 采纳的 actor 限制。
 *
 * 依据（用户 `13:15`）：「我现在允许设计和记录，由actor为ai的时候通过。」
 * 与 `docs/状态转移矩阵.md` 一致：
 *   - 目标（三/草稿）、工作（五/草稿）：**只列「用户点击采纳」** ⇒ 仅 `user`
 *   - 设计（四/草稿）、记录（六/草稿）：列了「用户点击采纳」+「**ai 调用采纳**」 ⇒ `user` / `ai`
 *
 * ⚠ 用户 `01:29`「采纳只能用户」的适用范围是 **goal/work 的草稿→提交**；
 * design/record 的草稿→需要授权是**另一条转移**，当时被我实现成"全分类一刀切"，已修正。
 *
 * `host` 不在矩阵里出现 ⇒ **一律不允许**（不猜）。
 */
function adoptActorAllowed(kind: string, actor: Actor): boolean {
	/* 设计与记录的采纳放开给 ai（用户 13:15）；用户始终可以。 */
	if (kind === 'design' || kind === 'record') return actor === 'user' || actor === 'ai';
	/* 其余分类（goal / work / 外部注册）保持原口径：只能用户。 */
	return actor === 'user';
}

/** 领取：提交 → 处理中。 */
function isClaim(from: TaskState, to: TaskState): boolean {
	return from === S.SUBMITTED && to === S.WORKING;
}

/**
 * 运行时守卫：**按需**取一个必填 boolean 字段。
 *
 * 为什么不再用 `requireCtx` 一次性把两个字段都要齐：
 * 有些转移（采纳 / 释放 / 取消 …）**根本不看** `depsAllEnded` / `actorHasActiveWork`，
 * 强制它们传等于**逼调用方编造事实**（传 `true` / `false` 都是撒谎）。
 *
 * ⇒ 只有**真正会用到**该字段的分支才 require；用到了却没传 ⇒ **照旧抛错（fail-closed）**。
 *
 * 为什么不写成 `if (ctx === undefined)`：`ctx` 的静态类型里没有 `undefined`，
 * 那样写会触发「无重叠」比较错误。走 `unknown` 通道既保留类型整洁，又能挡住
 * JS 调用方 / `any` 穿透 —— 这是**唯一**能防住"静默放行"的地方。
 */
function requireFact(ctx: unknown, field: 'depsAllEnded' | 'actorHasActiveWork'): boolean {
	if (ctx === null || typeof ctx !== 'object') {
		throw new Error(
			`taskboard2-types: canTransition 的这一分支需要 ctx.${field}，但调用方没有提供 ctx`,
		);
	}
	const value = (ctx as unknown as Record<string, unknown>)[field];
	if (typeof value !== 'boolean') {
		throw new Error(
			`taskboard2-types: canTransition 的这一分支需要 ctx.${field}，必须是 boolean，不得缺省`,
		);
	}
	return value;
}

/**
 * 转移判决。
 *
 * @param kind  分类 id（未注册的分类直接抛错）
 * @param from  当前状态
 * @param to    目标状态
 * @param actor 主体种类
 * @param ctx   外部事实。**按需必填**：只有真正走到需要某个事实的分支时，该字段才必须存在；
 *              否则可以整个省略（见 `requireFact`）
 */
export function canTransition(
	kind: string,
	from: TaskState,
	to: TaskState,
	actor: Actor,
	ctx?: TransitionCtx,
): TransitionVerdict {
	/* 分类未注册 ⇒ 调用方违约，直接抛错。 */
	if (getKind(kind) === undefined) {
		throw new Error(`taskboard2-types: 未注册的分类 "${kind}"，无法判决转移`);
	}

	/* 同状态：允许（幂等写入不算转移）。 */
	if (from === to) return ALLOW;

	/* 已处终态：任何转移都不允许。 */
	if (isEndedStatus(from)) return deny('终态不可再转移');

	/*
	 * 草稿不可直转处理中：必须先经采纳（安全边界，任何模板都不可覆盖）。
	 *
	 * ⚠ **文案要中性**：采纳的目的地按分类不同 ——
	 *   goal / work ⇒ 「提交」；design / record ⇒ 「需要授权」。
	 * ⇒ 不能写死"「提交」"，否则对 design / record 是错的描述。
	 */
	if (from === S.UNSPECIFIED && to === S.WORKING) {
		return deny('草稿必须先经采纳，才能进入处理中');
	}

	/*
	 * 采纳的 actor 限制：**按分类分**（用户 13:15）。
	 *   · goal / work  → 仅 user
	 *   · design / record → user 或 ai
	 */
	if (isAdopt(kind, from, to) && !adoptActorAllowed(kind, actor)) {
		return deny(`「${kind}」的采纳不能由 ${actor} 执行`);
	}

	/* 依赖门：工作的「提交 → 处理中」要求依赖全部进入「完成」组。 ——只有这一条用到 depsAllEnded */
	if (kind === 'work' && isClaim(from, to) && !requireFact(ctx, 'depsAllEnded')) {
		return deny('依赖尚未全部进入完成组，不能领取（DEPENDS_ON_GATE）');
	}

	/* 工作类一个 actor 只能占一张（WORK_SINGLE_CLAIM）。 ——只有这一条用到 actorHasActiveWork */
	if (kind === 'work' && to === S.WORKING && requireFact(ctx, 'actorHasActiveWork')) {
		return deny('该 actor 手上已有处于「处理中」的工作卡，必须先放下（WORK_SINGLE_CLAIM）');
	}

	/* 回到草稿：不允许（草稿只从创建获得，无任何转移转入）。 */
	if (to === S.UNSPECIFIED) return deny('不允许转移回草稿');

	/* 其余转移：放行，由分类规则与准入层继续约束。 */
	return ALLOW;
}
