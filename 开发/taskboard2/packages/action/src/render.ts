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
 * **态回退**：`create → active → ended → plain`。
 * 例如某 action 只写了 `create` 与 `plain`，请求 `ended` 会退到 `plain`。
 *
 * **校验拒 vs 渲染不拒**：`validateForCreate` 对未注册 `$type` 会拒（`UNKNOWN_TYPE`），
 * 但渲染必须能显示它 —— "能不能落库"与"能不能显示"是两个问题。
 */

import { getAction } from './registry.js';
import {
	element,
	fragment,
	isPlainObject,
	raw as rawNode,
	text,
	unregistered as unregisteredNode,
	type Node,
} from './nodes.js';
import type { ActionPayload, RenderPhase, Renderer } from './types.js';

/** 回退顺序。 */
const PHASE_FALLBACK: readonly RenderPhase[] = ['create', 'active', 'ended', 'plain'];

/** 是否是"看起来像 payload"的输入（object 且有 `$type`）。 */
function payloadTypeOf(value: unknown): string | undefined {
	if (!isPlainObject(value)) return undefined;
	const $type = value.$type;
	return typeof $type === 'string' && $type.trim() !== '' ? $type.trim() : undefined;
}

/** 在 action 的渲染字典里找该态（按回退顺序）。 */
function pickRenderer(
	render: Partial<Record<RenderPhase, Renderer>>,
	phase: RenderPhase,
): Renderer | undefined {
	/* 先从请求的态开始往后找，再从前面补 */
	const order = [
		...PHASE_FALLBACK.slice(PHASE_FALLBACK.indexOf(phase)),
		...PHASE_FALLBACK.slice(0, PHASE_FALLBACK.indexOf(phase)),
	];
	for (const candidate of order) {
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
		return run();
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

/** 供 ⑩ 直接构造（避免它自己拼 props 不一致）。 */
export const builders = { element, fragment, text };
