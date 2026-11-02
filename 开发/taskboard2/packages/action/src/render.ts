/**
 * ② action —— 渲染门面。
 *
 * **渲染器必须能渲染任何输入**（四级降级），不许抛异常、不许白屏：
 *
 *   1 正常        已注册 + 该态有渲染器   → 正常控件
 *   2 broken      已注册 + 字段坏了        → broken 节点
 *   3 unregistered `$type` 不在注册表       → 按钮「未注册的动作」+ 展开原始 JSON
 *   4 raw         连 object 都不是          → 原始值 + 展开
 *
 * **态回退**：节点态按 `create → active → ended` 的顺序（见 `NODE_FALLBACK`）；
 * **`plain` 不参与节点回退** —— 它只在请求 `plain` 时使用。
 * 例：某 action 只写了 `create`，请求 `ended` 会退到 `create`（仍是节点）；
 *     但请求 `plain` 而没写 `plain` ⇒ 走降级节点，**不会拿 `create` 顶替**。
 *
 * **校验拒 vs 渲染不拒**：`validateForCreate` 对未注册 `$type` 会拒（`UNKNOWN_TYPE`），
 * 但渲染必须能显示它 —— "能不能落库"与"能不能显示"是两个问题。
 */

import { getAction } from './registry.js';
import {
	isPlainObject,
	raw as rawNode,
	stringify,
	text,
	unregistered as unregisteredNode,
	type Node,
} from './nodes.js';
import type { ActionPayload, RenderPhase, Renderer } from './types.js';

/**
 * 节点态的回退表。
 *
 * **`plain` 不在任何一张表里** —— 它只在请求 `plain` 时使用，永不作为节点态的替代。
 * 若把 `plain` 混进回退链，请求 `ended` 时会拿到 `string`，
 * 而调用方期望的是 `Node` —— 那是类型错误，不是降级。
 */
const NODE_FALLBACK: Readonly<Record<'create' | 'active' | 'ended', readonly RenderPhase[]>> =
	Object.freeze({
		create: ['create', 'active', 'ended'],
		active: ['active', 'ended', 'create'],
		ended: ['ended', 'active', 'create'],
	});

/** 是否是"看起来像 payload"的输入（object 且有 `$type`）。 */
function payloadTypeOf(value: unknown): string | undefined {
	if (!isPlainObject(value)) return undefined;
	const $type = value.$type;
	return typeof $type === 'string' && $type.trim() !== '' ? $type.trim() : undefined;
}

/**
 * 在 action 的渲染字典里找该态。
 *
 * - 请求 `plain` ⇒ 只查 `render.plain`，**不参与节点回退**
 * - 请求节点态 ⇒ 按 `NODE_FALLBACK` 查，都不命中返回 `undefined`（走降级节点）
 */
function pickRenderer(
	render: Partial<Record<RenderPhase, Renderer>>,
	phase: RenderPhase,
): Renderer | undefined {
	if (phase === 'plain') return render.plain;

	for (const candidate of NODE_FALLBACK[phase]) {
		const found = render[candidate];
		if (found !== undefined) return found;
	}
	return undefined;
}

/**
 * 渲染。
 *
 * @param payload 任意输入
 * @param phase   渲染态
 * @param onChange 内容变更回调（只读态可以不用）
 */
export function render(
	payload: unknown,
	phase: RenderPhase,
	onChange: (next: ActionPayload) => void = () => {},
): Node | string {
	/* 4 级：连 object 都不是 */
	if (!isPlainObject(payload)) {
		const fallback = rawNode(payload);
		return phase === 'plain' ? fallback.json : fallback;
	}

	const $type = payloadTypeOf(payload);
	/* 3 级：object 但没有 `$type` */
	if ($type === undefined) {
		const fallback = unregisteredNode('', payload);
		return phase === 'plain' ? fallback.json : fallback;
	}

	const action = getAction($type);
	/* 3 级：`$type` 未注册 */
	if (action === undefined) {
		const fallback = unregisteredNode($type, payload);
		return phase === 'plain' ? fallback.json : fallback;
	}

	const renderer = pickRenderer(action.render, phase);
	/* 该 action 一个渲染器都没注册 —— 也算未注册 */
	if (renderer === undefined) {
		const fallback = unregisteredNode($type, payload);
		return phase === 'plain' ? fallback.json : fallback;
	}

	return safeRender(() => renderer(payload, onChange), $type, payload, phase);
}

/**
 * 把渲染结果规整到该态应有的类型。
 *
 * 正常情况下不会触发（`plain` 的渲染器返回 `string`，节点态的返回 `Node`）；
 * 但它兜的是**渲染器写错返回类型**的情况 —— 宁可给降级结果，也不把 `string`
 * 当成 `Node` 交给 ⑩（那会在 ⑩ 里炸，且炸点离根因很远）。
 *
 * ⚠ 这里用的 `stringify` 是 `nodes.ts` 里的**安全版**（内部 try/catch，不抛）——
 * 不能用裸 `JSON.stringify`：循环引用会抛，那就等于在兜底里再炸一次。
 */
function normalizeResult(result: Node | string, phase: RenderPhase): Node | string {
	if (phase === 'plain') {
		return typeof result === 'string' ? result : stringify(result);
	}
	if (typeof result === 'string') {
		/* 节点态却返回了字符串 —— 当纯文本节点处理，不丢内容 */
		return text(result);
	}
	return result;
}

/**
 * 渲染器不得抛。若某个 action 的渲染器抛了，退化为"这条坏了"而不是白屏。
 *
 * 它兜的是**渲染器自身的 bug**，不是数据问题（数据问题由 `readField` 在 action 内部处理）。
 */
function safeRender(
	run: () => Node | string,
	$type: string,
	payload: unknown,
	phase: RenderPhase,
): Node | string {
	try {
		return normalizeResult(run(), phase);
	} catch {
		const fallback = unregisteredNode($type, payload);
		return phase === 'plain' ? fallback.json : fallback;
	}
}

/** 节点类型字面量 —— 给 ⑩ 做穷举检查用。 */
export const NodeTypes: readonly string[] = [
	'fragment',
	'md',
	'text',
	'element',
	'broken',
	'unregistered',
	'raw',
];
