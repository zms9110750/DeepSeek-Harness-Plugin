/**
 * ② action —— 注册表。
 *
 * 只在 `apply(ctx)` 内注册（`registerAction`），**模块顶层无副作用**：
 * ⑦ 需要静态 import ② 的类型，若顶层有调用语句，它会在 ⑦ 加载时提前执行。
 */

import type { ActionDefinition, RenderPhase, Renderer } from './types.js';

/** 全部渲染态（顺序与 「create → active → ended → plain」的回退方向一致）。 */
const PHASES: readonly RenderPhase[] = ['create', 'active', 'ended', 'plain'];

/** `$type` → 行为定义。注册顺序即 `list()` 顺序。 */
const actions = new Map<string, ActionDefinition>();

/** 行为名格式：小写字母开头，字母数字下划线。 */
const NAME_PATTERN = /^[a-z][a-z0-9_]*$/u;

function isPhase(key: string): key is RenderPhase {
	return key === 'create' || key === 'active' || key === 'ended' || key === 'plain';
}

/**
 * 注册一个 action。
 *
 * @returns 注销函数
 * @throws 名字非法 / 已注册 / schema 非法 / 一个渲染器都没有 / 出现未知态
 */
export function registerAction(def: ActionDefinition): () => void {
	if (def === null || typeof def !== 'object') {
		throw new TypeError('taskboard2-action: registerAction 需要一个对象');
	}
	if (typeof def.$type !== 'string' || def.$type === '') {
		throw new TypeError('taskboard2-action: action 必须有 $type');
	}
	if (!NAME_PATTERN.test(def.$type)) {
		throw new TypeError(
			`taskboard2-action: action 名「${def.$type}」只能是小写字母开头、字母数字下划线`,
		);
	}
	if (actions.has(def.$type)) {
		throw new TypeError(`taskboard2-action: action「${def.$type}」已注册`);
	}
	if (typeof def.summary !== 'string' || def.summary === '') {
		throw new TypeError(`taskboard2-action: action「${def.$type}」必须有 summary`);
	}
	if (def.schema === null || typeof def.schema !== 'object') {
		throw new TypeError(`taskboard2-action: action「${def.$type}」的 schema 必须是对象`);
	}
	if (def.render === null || typeof def.render !== 'object') {
		throw new TypeError(`taskboard2-action: action「${def.$type}」缺 render`);
	}

	/* 逐个态校验：未知键直接拒（拼错态名会静默失效，而类型拦不住外来注册的 JS 对象）。 */
	const kept: Partial<Record<RenderPhase, Renderer>> = {};
	let count = 0;
	for (const [key, value] of Object.entries(def.render as Record<string, unknown>)) {
		if (!isPhase(key)) {
			throw new TypeError(
				`taskboard2-action: action「${def.$type}」出现未知渲染态「${key}」（只允许 ${PHASES.join(' / ')}）`,
			);
		}
		if (typeof value !== 'function') {
			throw new TypeError(
				`taskboard2-action: action「${def.$type}」的「${key}」渲染器不是函数`,
			);
		}
		kept[key] = value as Renderer;
		count += 1;
	}
	/* 一个渲染器都不给 ⇒ 它永远只能走降级节点，注册它没有意义。 */
	if (count === 0) {
		throw new TypeError(
			`taskboard2-action: action「${def.$type}」一个渲染器都没有（至少给 ${PHASES[0]} / ${PHASES[PHASES.length - 1]} 之一）`,
		);
	}

	const stored: ActionDefinition = Object.freeze({
		$type: def.$type,
		summary: def.summary,
		schema: def.schema,
		render: Object.freeze(kept),
	});

	actions.set(def.$type, stored);
	return () => {
		actions.delete(def.$type);
	};
}

/** 取一个 action（未注册返回 `undefined`）。 */
export function getAction($type: string): ActionDefinition | undefined {
	return actions.get($type);
}

/** 是否已注册。 */
export function hasAction($type: string): boolean {
	return actions.has($type);
}

/** 全部已注册 `$type`（按注册顺序，含外来注册）。 */
export function list(): string[] {
	return [...actions.keys()];
}

/** 全部 action 定义（只读视图）。 */
export function listDefinitions(): ActionDefinition[] {
	return [...actions.values()];
}
