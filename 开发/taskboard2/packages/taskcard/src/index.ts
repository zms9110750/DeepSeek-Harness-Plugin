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
 * · ③：`DRAFT` / `Kind` / `initialStatus` / `canTransition` / `isCompletedGroup` / `resolve`
 * · ④：`validateRelations` / `applyRelationsChange` / `LINK_KINDS`
 * · ②：**只调 `isDeclarationOnlyChange`**（经服务面，**不 import 运行时值** —— 它依赖
 *   `$type → 答案位置` 的注册数据，不是纯函数）
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

import type { ActionPort, Ports, RelationPort, TypesPort } from './types.js';

import { planCreate } from './create.js';
import { planChange } from './change.js';
import { planFork, planForkTransfer } from './fork.js';
import { planAdopt } from './adopt.js';
import { planClaim } from './claim.js';
import { planRelease } from './release.js';
import { planDelete } from './delete.js';
import { changeIntent, isClaimed, isDeleted, isDraft, isFrozen } from './query.js';

export const name = 'taskboard2-taskcard';

/** 运行时依赖三个服务；**不 import 它们的任何运行时值**。 */
export const inject = ['taskboard2Types', 'taskboard2Relation', 'taskboard2Actions'];

/* ── 常量（历史动作名 / 建卡默认值），供 ⑤⑧⑨⑩ 引用而不必自己写字面量 ── */
export { ADOPT_ACTION, SUPERSEDE_ACTION } from './query.js';
export { CREATE_ACTION, emptyRelations } from './create.js';
export { EDIT_ACTION } from './change.js';
export { FORK_ACTION } from './fork.js';
export { CLAIM_ACTION, describePrincipal, principalOfClaim } from './claim.js';
export { RELEASE_ACTION, FORCE_RELEASE_ACTION } from './release.js';
export { DELETE_ACTION } from './delete.js';

/* ── 不依赖任何服务、可安全直接 import 的纯判定 ── */
export { isDeleted, isClaimed } from './query.js';
export { supersedeEdges } from './adopt.js';
export { parentOf, linkTargets } from './relations.js';

/* ── 类型 ── */
export type {
	Card,
	CardId,
	TaskState,
	Kind,
	LinkLabel,
	RelationEntry,
	Relations,
	TemplateRef,
	HistoryEntry,
	Principal,
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
} from './types.js';
export type { CreateInput } from './create.js';
export type { ChangeInput, EditableFields } from './change.js';
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
}

/** 去掉函数签名的第一个参数（`ports`）—— 端口由服务闭包绑定，调用方不需要知道它。 */
type OmitFirst<T extends readonly unknown[]> = T extends readonly [unknown, ...infer Rest] ? Rest : never;

export function apply(ctx: any): void {
	/*
	 * 端口**惰性取**：`apply` 执行时三个服务未必已经 provide 完成
	 * （inject 只保证对方的 apply 先跑），所以每次调用时再读。
	 */
	const ports = (): Ports => ({
		types: ctx.taskboard2Types as TypesPort,
		relation: ctx.taskboard2Relation as RelationPort,
		action: ctx.taskboard2Actions as ActionPort,
	});

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
		planClaim: (card, actor, claimCtx) => planClaim(ports(), card, actor, claimCtx),
		planRelease: (card, principal, input) => planRelease(ports(), card, principal, input),
		planDelete: (card, input) => planDelete(ports(), card, input),
	};

	ctx.provide('taskboard2Cards', service);
}
