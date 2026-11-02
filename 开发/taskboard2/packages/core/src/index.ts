/**
 * ⑧ 核心 —— Cordis 入口。
 *
 * 唯一编排入口：事务边界、调用顺序、对外门面。
 *
 * ## 为什么依赖都挂在这里
 *
 * ①–⑦ 各自只做自己的判断，**谁先问谁、问完写什么**只有核心知道。
 * 所以核心是唯一允许有包依赖的层：它 inject 全部 0–1 层。
 *
 * ## ⚠ 模板加载**不在**本包（`【用户指令，2026-11-02 14:50】`）
 *
 * > 「那他就管。他的行为确实是注册的。但是初始化的时候自己注册一些默认的也很合理吧。」
 * > 「是的。他要去读yaml。读失败了要提供报错能力。」
 * > 「但是如果他出错了，core可以继续开。」
 *
 * ⇒ **读 YAML / 解析 / 注册 / 标记就绪，全部归 ③**。⑧ **不再读文件、不再有 `yaml` 依赖**。
 * ⇒ ⑧ 只从 ③ 读**一个事实**：`isTemplateRegistryReady()`，用它决定走不走降级模式。
 *
 * ## 降级模式（用户 14:50「可以展示，没有行为」）
 *
 * 模板未就绪时：**读卡照常**（卡上存了章节名副本）、**状态转移 / 建卡 / 级联全拒**。
 * ⇒ 具体哪些方法过闸见 `facade.ts` 的 `requireTemplates`。
 *
 * ## 核心的三条硬边界
 *
 *   1. **不实现业务规则**：关系语义在 ④、payload 语义在 ②、状态规则在 ③。
 *      `if (kind === …)` / `if (status === …)` 出现在核心里就是错的。
 *      常量比较不算业务规则 —— 知识在 ③，核心只做机械比较。
 *   2. **不 import ⑨⑩⑪**：方向是它们依赖核心。
 *   3. **不产最终文案**：拒绝原因 → 文案是查表映射，不写 `if (reason.kind === …)`。
 *
 * ## 启动顺序（`apply` 内）
 *
 * ```
 * ① 等各上游就绪（inject 保证对方的 apply 先跑）
 * ② 延迟构造门面：不在 apply 里读 ctx.<service>（后续服务可能还没 provide）
 * ③ provide('taskboard2Core', facade)
 * ```
 *
 * 职责边界见 `docs/08-core.md`。
 */

import { createFacade, type CoreService } from './facade.js';
import type { Ports } from './ports.js';

export const name = 'taskboard2-core';

/**
 * 前置服务。
 *
 * 八个名字 = ①–⑦ 的七个包提供的服务 + ② 的渲染面：
 *
 *   taskboard2Store      ← ① store
 *   taskboard2Actions    ← ② action（校验面）
 *   taskboard2Renderer   ← ② action（渲染面；与校验面分开，⑩ 拿不到 `diagnostic`）
 *   taskboard2Types      ← ③ types
 *   taskboard2Relation   ← ④ relation
 *   taskboard2Search     ← ⑤ search
 *   taskboard2Workgroup  ← ⑥ workgroup
 *   taskboard2Cards      ← ⑦ taskcard
 *
 * ⚠ **`taskboard2Types` 仍然必需** —— 虽然模板加载归了 ③，但 `resolve` / `sectionsOf` /
 *   `TaskState` / `deriveStatus` / `isTemplateRegistryReady` 都还在用它。
 *   ⇒ 删模板加载**不动 inject 清单**。
 */
export const inject = [
	'taskboard2Store',
	'taskboard2Types',
	'taskboard2Actions',
	'taskboard2Renderer',
	'taskboard2Relation',
	'taskboard2Search',
	'taskboard2Workgroup',
	'taskboard2Cards',
];

/**
 * `apply` 的最小上下文形状。
 *
 * 用索引签名而不是逐字段声明：Cordis 的服务是**按名字动态挂载**的，
 * 声明成固定字段会让人以为"这些服务在 apply 阶段一定可读" —— 事实上不一定。
 */
interface ApplyContext {
	provide(serviceName: string, api: unknown): void;
	readonly [service: string]: unknown;
}

export function apply(ctx: ApplyContext): void {
	/*
	 * 门面**延迟构造**：`apply` 执行时后续服务未必已经 provide
	 * （inject 只保证对方的 apply 先跑，不保证 `ctx.<name>` 此刻可读）。
	 * 所以这里不抓取端口，只提供一个"每次访问时现取"的转发层。
	 *
	 * ⚠ **本函数不再做任何事**（模板加载已交给 ③）——
	 *   只构造门面并 provide。原来那段"读模板 → 注册 → 标记就绪"整体删除。
	 */
	let facade: CoreService | undefined;

	const portsOf = (): Ports => ({
		store: ctx['taskboard2Store'] as Ports['store'],
		actions: ctx['taskboard2Actions'] as Ports['actions'],
		types: ctx['taskboard2Types'] as Ports['types'],
		relation: ctx['taskboard2Relation'] as Ports['relation'],
		workgroup: ctx['taskboard2Workgroup'] as Ports['workgroup'],
		cards: ctx['taskboard2Cards'] as Ports['cards'],
		...(ctx['taskboard2Search'] === undefined
			? {}
			: { search: ctx['taskboard2Search'] as Ports['search'] }),
	});

	/**
	 * 对外服务：**每次属性访问都转发到当前门面**。
	 *
	 * 为什么不直接 `provide` 门面实例：门面在首次调用时才构造，
	 * 而 `provide` 只能给一个对象 —— 用 Proxy 转发让"构造时机"对调用方透明。
	 */
	const service = new Proxy(
		{},
		{
			get(_target, property) {
				if (facade === undefined) {
					facade = createFacade({
						ports: portsOf(),
						sessionId: () => String((ctx['session'] as { id?: string } | undefined)?.id ?? ''),
						now: () => Date.now(),
					});
				}
				const value = (facade as unknown as Record<string | symbol, unknown>)[property];
				return typeof value === 'function'
					? (value as (...args: unknown[]) => unknown).bind(facade)
					: value;
			},
		},
	);

	ctx.provide('taskboard2Core', service);
}

/* ── 导出（供 ⑨⑪ 与测试直接使用） ── */

export { createFacade, type CoreService, type FacadeOptions, type Failure, type WriteResult } from './facade.js';
export {
	coreError,
	describeReject,
	fromTemplateCode,
	type CoreError,
	type CoreErrorCode,
} from './errors.js';
export {
	createCard,
	deriveDefaults,
	sectionsFromDefaults,
	checkRelationTargets,
	type CreateCardInput,
	type CreateOrigin,
	type CreateResult,
	type DeriveInit,
} from './create.js';
export { allocateId, prefixOf, type AllocateIdResult } from './ids.js';
export {
	applyStatus,
	appendHistory,
	type StatusWriteOutcome,
	type HistoryEvent,
} from './status-write.js';
export { assertSectionsComplete, issuesForUI, payloadsOf } from './validate.js';
export {
	recomputeUpward,
	RECOMPUTE_ACTION,
	type RecomputeOptions,
	type RecomputeResult,
} from './recompute.js';
export { interpretCurrent, visibleCards, findCard, usedIdsOf, type ActiveWorkspace } from './workspace.js';
export {
	actorHasActiveWork,
	depsAllEnded,
	claimCard,
	releaseClaim,
	transitionCard,
	deleteCard,
	isHeldBy,
	type ClaimResult,
	type ClaimSuccess,
} from './claims.js';
export type * from './ports.js';
