/**
 * ⑧ 核心 —— Cordis 入口。
 *
 * 唯一编排入口：事务边界、调用顺序、对外门面。
 *
 * ## 为什么依赖都挂在这里
 *
 * ①–⑦ 各自只做自己的判断，**谁先问谁、问完写什么**只有核心知道。
 * 所以核心是唯一允许有包依赖的层：它 inject 全部 0–1 层，并额外持有 YAML 解析器
 * （模板文件由核心读取并解析 —— ③ 只收已解析对象，③ 零依赖、不碰 I/O）。
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
 * ① 等 ②③ 就绪（inject 保证对方的 apply 先跑）
 * ② 读 templates/ → 注册进 ③ → 标记注册表就绪
 * ③ 延迟构造门面：不在 apply 里读 ctx.<service>（后续服务可能还没 provide）
 * ④ provide('taskboard2Core', facade)
 * ```
 *
 * 职责边界见 `docs/08-core.md`。
 */

import type { CoreError } from './errors.js';
import { createFacade, type CoreService } from './facade.js';
import type { Ports, TypesRegistry } from './ports.js';
import { loadTemplates, type LoadTemplatesResult } from './templates.js';

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
 * ⚠ ③④⑤ 目前只有静态导出、尚**未** `provide`。若它们不补 `provide`，
 *   ⑧ 会永远停在「等待依赖」。⇒ **服务名由上游定，本表跟随上游，不在核心里加别名映射。**
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

/** 启动期编排的结果（供测试与诊断读）。 */
export interface StartupReport {
	readonly templates: LoadTemplatesResult;
	/** 非空 ⇒ 启动应被视为失败（调用方 / 宿主决定是否中止）。 */
	readonly failures: readonly CoreError[];
}

/**
 * 启动期：读模板并注册进 ③。
 *
 * 单独导出，便于测试直接调用（不必跑 Cordis）。
 *
 * @param registry ③ 的注册面（`registerTemplate` / `markTemplateRegistryReady`）。
 * @param actionTypes ② 已注册的 `$type` 列表（`taskboard2Actions.list()`）。
 */
export function bootstrapTemplates(
	registry: TypesRegistry,
	actionTypes: readonly string[],
): StartupReport {
	const templates = loadTemplates({ registry, actionTypes });
	return { templates, failures: templates.failures };
}

export function apply(ctx: ApplyContext): void {
	/*
	 * ① 模板注册要等 ② 的 action 就绪（`accepts ⊆ actionTypes` 校验需要它），
	 *    也需要 ③ 的注册面。`inject` 保证上游的 `apply` 先跑。
	 */
	const actions = ctx['taskboard2Actions'] as { list(): string[] } | undefined;
	const registry = ctx['taskboard2Types'] as TypesRegistry | undefined;

	if (
		actions !== undefined &&
		typeof actions.list === 'function' &&
		registry !== undefined &&
		typeof registry.registerTemplate === 'function'
	) {
		const report = bootstrapTemplates(registry, actions.list());
		/*
		 * 模板加载失败**不静默**：打印出来（宿主能看见），但**不抛** ——
		 * 抛错会让整个 bundle 装配失败，而其它包仍可能可用（诊断价值更高）。
		 * 就绪状态由 `markTemplateRegistryReady` 控制：零失败时才标记就绪，
		 * 于是"未就绪"会在第一次 `resolve` 时以一条明确的错误暴露，而不是半套模板静默生效。
		 */
		if (report.failures.length > 0) {
			console.error('[taskboard2-core] 模板加载失败：');
			for (const failure of report.failures) console.error(`  · [${failure.code}] ${failure.message}`);
		}
	} else {
		console.error('[taskboard2-core] 模板未加载：缺少 taskboard2Actions 或 taskboard2Types 服务。');
	}

	/*
	 * ② 门面**延迟构造**：`apply` 执行时后续服务未必已经 provide
	 * （inject 只保证对方的 apply 先跑，不保证 `ctx.<name>` 此刻可读）。
	 * 所以这里不抓取端口，只提供一个"每次访问时现取"的转发层。
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
export { coreError, describeReject, type CoreError, type CoreErrorCode } from './errors.js';
export {
	loadTemplates,
	findTemplatesDir,
	presetPayloadsOf,
	type LoadTemplatesResult,
} from './templates.js';
export { allocateId, prefixOf, type AllocateIdResult } from './ids.js';
export { assertSectionsComplete, issuesForUI } from './validate.js';
export {
	recomputeUpward,
	RECOMPUTE_ACTION,
	type RecomputeOptions,
	type RecomputeResult,
} from './recompute.js';
export { interpretCurrent, visibleCards, findCard, usedIdsOf, type ActiveWorkspace } from './workspace.js';
export { actorHasActiveWork, depsAllEnded } from './claims.js';
export type * from './ports.js';
