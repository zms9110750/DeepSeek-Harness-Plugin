/**
 * ⑦ 任务卡 —— Cordis 入口。
 *
 * ## 本包是什么
 *
 * 任务对象本身：卡的形状、生命周期（创建 / 编辑 / fork / 采纳 / 领取 / 释放 / 删除）。
 * **状态只是它的一个字段。**
 *
 * ## 三个关键立场（用户已确认）
 *
 *   1. **任务卡要解耦**：有些东西依赖它、有些东西不依赖。
 *   2. **备注归卡自己**：采纳冻结后唯一还能改的地方；没有任何角色"需要"这个能力，
 *      所以**不做成服务** —— 只是卡上的一个字段 + 一个永远允许的写入口（`planChange` 的 `note`）。
 *   3. **采纳前原地改、采纳后只能 fork**；且 `【用户指令，2026-11-01 06:43】`
 *      「**fork 和编辑，是一个按钮**」⇒ 编辑权与 fork 权**互斥**。
 *
 * ## 依赖
 *
 * `inject = ['taskboard2Types', 'taskboard2Relation', 'taskboard2Actions']`
 *
 * · ③：`DRAFT` / `Kind` / `initialStatus` / **`adoptTargetOf`** / `canTransition` /
 *   `isCompletedGroup` / `liveChildren` / `resolve`
 * · ④：`validateRelations` / `applyRelationsChange` / `LINK_KINDS`
 * · ②：**只调 `isDeclarationOnlyChange`**（经服务面，**不 import 运行时值** —— 它依赖
 *   `$type → 答案位置` 的注册数据，不是纯函数）
 *
 * ⚠ **③ 的服务面与 ⑦ 的 `Ports` 有两处形状不同**（键名；判决对象 vs 布尔），
 * **全部在 `apply` 里的 `ports()` 一处适配**；不要让第二处再写一遍。
 *
 * ⚠ **`Principal`（身份）与 `Actor`（权限类别）是两个不同语义，不做映射**
 * （`【用户指令，2026-11-02 14:05】`「各用各的不要映射」「我更加希望他们是两个名字。
 * 这是两个不同的东西。领取是消息循环级别的。权限是 ai 这个类别的。」）：
 * ⑧ 同时给出两者，⑦ 原样使用。⑦ 的 `Actor` 与 ③ 的 `Actor` **同值**
 * （`'user' | 'ai' | 'host'`），所以 `ports()` 里**直传、不转换**。
 *
 * ## 本包**不做**什么
 *
 * · 不读不写存储（① 零耦合）：⑦ 出计划，⑧ 落盘、开事务。
 * · 不认识容器 / 工作空间（卡不知道空间）。
 * · 不校验 payload（② 的事）、不判目标合法性（⑧ 的事，它才有全量卡与空间概念）。
 * · 不产生中文、不写文案（`reason` 是封闭枚举，⑧ 查表转文案）。
 *
 * ## 对外只有**一个**入口
 *
 * 所有 plan / 查询都挂在 `taskboard2Cards` 服务上，**不接受静态 import** ——
 * 避免"两条路各写一遍同一规则"（`docs` 里已定：一个变更按钮 = 一个入口）。
 */

import type {
	ActionPort,
	Actor,
	ChildSnapshot,
	Ports,
	RelationPort,
	TransitionCtx,
} from './types.js';

import { planCreate } from './create.js';
import { planChange } from './change.js';
import { planFork, planForkTransfer } from './fork.js';
import { planAdopt } from './adopt.js';
import { planClaim } from './claim.js';
import { planRelease } from './release.js';
import { planDelete } from './delete.js';
import { planTransition } from './transition.js';
import { changeIntent, isClaimed, isDeleted, isDraft, isFrozen } from './query.js';

export const name = 'taskboard2-taskcard';

/** 运行时依赖三个服务；**不 import 它们的任何运行时值**。 */
export const inject = ['taskboard2Types', 'taskboard2Relation', 'taskboard2Actions'];

/* ── 常量（历史动作名 / 建卡默认值），供 ⑤⑧⑨⑩ 引用而不必自己写字面量 ── */
export { ADOPT_ACTION, SUPERSEDE_ACTION } from './query.js';
export { CREATE_ACTION, emptyRelations, buildSections } from './create.js';
export { EDIT_ACTION } from './change.js';
export { pluckPayloads, mergeLabels } from './change.js';
export { FORK_ACTION } from './fork.js';
export { CLAIM_ACTION, describePrincipal, principalOfClaim } from './claim.js';
export { RELEASE_ACTION, FORCE_RELEASE_ACTION } from './release.js';
export { DELETE_ACTION } from './delete.js';
export { TRANSITION_ACTION } from './transition.js';

/* ── 不依赖任何服务、可安全直接 import 的纯判定 ── */
export { isDeleted, isClaimed } from './query.js';
export { supersedeEdges } from './adopt.js';
export { parentOf, linkTargets } from './relations.js';
/** `Card → ChildSnapshot` 的**纯字段投影**（零策略；过滤策略在 ③ 的 `liveChildren`）。 */
export { toChildSnapshot } from './transition.js';

/* ── 类型 ── */
export type {
	Card,
	CardId,
	CardSection,
	TaskState,
	Kind,
	LinkLabel,
	RelationEntry,
	Relations,
	TemplateRef,
	HistoryEntry,
	Principal,
	Actor,
	Reason,
	PlanItem,
	Plan,
	PlanResult,
	Rejection,
	RejectReason,
	RelationIssue,
	RelationsChange,
	RelationPatch,
	Ports,
	TypesPort,
	RelationPort,
	ActionPort,
	ResolvedTemplate,
	TemplateSection,
	LinkKind,
	RelationValidateResult,
	StatesTable,
	TransitionCtx,
	ChildSnapshot,
} from './types.js';
export type { CreateInput } from './create.js';
export type { BuildSectionsResult } from './create.js';
export type { ChangeInput, EditableFields } from './change.js';
export type { MergeLabelsResult } from './change.js';
export type {
	ForkInput,
	ForkPlan,
	ForkResult,
	DroppedSection,
	MissingSection,
	TransferItem,
	ForkTransfer,
} from './fork.js';
export type { AdoptInput, SupersedeEdge } from './adopt.js';
export type { ClaimContext } from './claim.js';
export type { ReleaseInput } from './release.js';
export type { DeleteInput } from './delete.js';
export type { TransitionInput } from './transition.js';

/** `taskboard2Cards` 服务的形状。**这是 ⑦ 对外唯一入口。** */
export interface CardsService {
	isDraft(card: Parameters<typeof isDraft>[0]): boolean;
	isFrozen(card: Parameters<typeof isFrozen>[0]): boolean;
	isDeleted(card: Parameters<typeof isDeleted>[0]): boolean;
	isClaimed(card: Parameters<typeof isClaimed>[0]): boolean;
	changeIntent(card: Parameters<typeof changeIntent>[0]): 'edit' | 'fork';

	planCreate(...args: OmitFirst<Parameters<typeof planCreate>>): ReturnType<typeof planCreate>;
	planChange(...args: OmitFirst<Parameters<typeof planChange>>): ReturnType<typeof planChange>;
	planFork(...args: OmitFirst<Parameters<typeof planFork>>): ReturnType<typeof planFork>;
	planForkTransfer(
		...args: OmitFirst<Parameters<typeof planForkTransfer>>
	): ReturnType<typeof planForkTransfer>;
	planAdopt(...args: OmitFirst<Parameters<typeof planAdopt>>): ReturnType<typeof planAdopt>;
	planClaim(...args: OmitFirst<Parameters<typeof planClaim>>): ReturnType<typeof planClaim>;
	planRelease(...args: OmitFirst<Parameters<typeof planRelease>>): ReturnType<typeof planRelease>;
	planDelete(...args: OmitFirst<Parameters<typeof planDelete>>): ReturnType<typeof planDelete>;
	planTransition(...args: OmitFirst<Parameters<typeof planTransition>>): ReturnType<typeof planTransition>;
}

/** 去掉函数签名的第一个参数（`ports`）—— 端口由服务闭包绑定，调用方不需要知道它。 */
type OmitFirst<T extends readonly unknown[]> = T extends readonly [unknown, ...infer Rest] ? Rest : never;

/**
 * 把 ③ 的"抛错"收成 `undefined`（**⑦ 的异常收口点，全包只有这一处**）。
 *
 * ## 为什么要有它
 *
 * ③ 的 `initialStatus` / `adoptTargetOf` / `canTransition` 对**未注册分类**一律抛错。
 * ⑦ 的契约是**纯函数、失败走 `Rejection`、不抛**（`docs` §6.5）——
 * 若让异常漏出去，**每个调用方（⑧⑨⑩）都要各写一份 `try/catch`** ⇒ N 份兜底 = 同一逻辑多处实现。
 *
 * ⚠ **只该捕 ③ 的"数据问题"类异常**。这不是在掩盖 bug：
 * · ⑦ 侧的**装配缺陷**（如 `planClaim` 漏传 `ctx`）**仍然抛** —— 那是调用方违约，早炸早好；
 * · 这里捕的是"卡上的 `template.kind` 指向一个已注销的分类"这类**数据不一致**，
 *   它的正确归宿是 `{ ok:false, reason:{ kind:'kind-unavailable' } }`，让用户看到。
 *
 * ⇒ 判据与全包一致：**调用方违约 ⇒ 抛；数据/环境问题 ⇒ 走 reason。**
 */
function guarded<T>(call: () => T): T | undefined {
	try {
		return call();
	} catch {
		return undefined;
	}
}

export function apply(ctx: any): void {
	/*
	 * 端口**惰性取**：`apply` 执行时三个服务未必已经 provide 完成
	 * （inject 只保证对方的 apply 先跑），所以每次调用时再读。
	 *
	 * ⚠ **这里只做"键名 / 形状"适配，不做语义映射**：
	 *
	 *   1. **键名**：③ 用 `TaskState` / `isEndedStatus`；⑦ 内部叫 `states` / `isCompletedGroup`。
	 *      （"完成"组 = 终态组，是同一个集合，改的只是名字。）
	 *   2. **`canTransition` 的返回**：③ 返回**判决对象** `{ ok } | { ok:false, reason }`；
	 *      ⑦ 只关心"行不行" ⇒ 取 `.ok`。
	 *      ⚠ 若直接把判决对象当布尔用，`if (!verdict)` **永远为假**（对象恒真）
	 *      ⇒ 每一次转移都会被放行，而且**编译不会报错**。这正是"编译过、运行时错"。
	 *   3. **`actor`：原样直传，不映射**。⑦ 的 `Actor` 与 ③ 的 `Actor` **同值**
	 *      （`'user' | 'ai' | 'host'`）。`Principal`（身份）与 `Actor`（权限类别）
	 *      是两个不同语义，由 ⑧ 分别给出（`【用户指令，2026-11-02 14:05】`
	 *      「各用各的不要映射」「我更加希望他们是两个名字」）。
	 */
	const ports = (): Ports => {
		const types = ctx.taskboard2Types;
		return {
			types: {
				states: types.TaskState,
				DRAFT: types.DRAFT,
				/*
				 * ↓ 以下三个方法在 **③ 侧对未注册分类一律抛错**。
				 *   ⑦ 的契约是"纯函数、失败走 Rejection、不抛" ⇒ **在这一层统一转成 `undefined`**，
				 *   业务函数看到 `undefined` 就返回 `kind-unavailable`。
				 *
				 * ⚠ **为什么收口在适配层而不是 7 个业务函数各写 try/catch**：
				 *   ① 一处收口胜过 7 处；② 这层**本来就**在处理"③ 与 ⑦ 的形状不匹配"
				 *   （判决对象 → boolean），"异常不匹配"是同一类事；
				 *   ③ 若将来 ③ 改成不抛（返回 undefined），只需删这里的 try/catch。
				 */
				initialStatus: (kind: string) => guarded(() => types.initialStatus(kind)),
				// 采纳目的地按分类定（goal/work → 提交，design/record → 需要授权）。
				// 规则只有 ③ 一份，⑦ 不写分类名单。
				adoptTargetOf: (kind: string) => guarded(() => types.adoptTargetOf(kind)),
				canTransition: (
					kind: string,
					from: string,
					to: string,
					actor: Actor,
					transitionCtx?: TransitionCtx,
				) => guarded(() => types.canTransition(kind, from, to, actor, transitionCtx).ok === true),
				isCompletedGroup: (status: string) => types.isEndedStatus(status),
				liveChildren: (children: readonly ChildSnapshot[]) => types.liveChildren(children),
				resolve: (name: string) => types.resolve(name),
			},
			relation: ctx.taskboard2Relation as RelationPort,
			action: ctx.taskboard2Actions as ActionPort,
		};
	};

	const service: CardsService = {
		/* ── 纯查询（不产生计划） ── */
		isDraft: (card) => isDraft(card, ports()),
		isFrozen: (card) => isFrozen(card, ports()),
		isDeleted: (card) => isDeleted(card),
		isClaimed: (card) => isClaimed(card),
		changeIntent: (card) => changeIntent(card, ports()),

		/* ── 计划（⑧ 消费并落盘） ── */
		planCreate: (input, all) => planCreate(ports(), input, all),
		planChange: (card, input) => planChange(ports(), card, input),
		planFork: (src, sections, input) => planFork(ports(), src, sections, input),
		planForkTransfer: (src, all) => planForkTransfer(ports(), src, all),
		planAdopt: (card, all, input) => planAdopt(ports(), card, all, input),
		planClaim: (card, principal, actor, claimCtx) =>
			planClaim(ports(), card, principal, actor, claimCtx),
		planRelease: (card, principal, actor, input) =>
			planRelease(ports(), card, principal, actor, input),
		planDelete: (card, input) => planDelete(ports(), card, input),
		planTransition: (card, all, input) => planTransition(ports(), card, all, input),
	};

	ctx.provide('taskboard2Cards', service);
}
