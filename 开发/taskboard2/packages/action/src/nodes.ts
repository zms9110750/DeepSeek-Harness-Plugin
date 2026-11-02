/**
 * ② action —— 节点描述。
 *
 * `view` / `edit` 的产物是**节点描述**，不是真实 DOM、不依赖 React。
 * 理由：渲染器是开发者侧冻结的东西，产物要能跨宿主/浏览器边界（数据能过，函数不能过）。
 *
 * 本文件同时提供**节点构造器**与**安全字段读取器**：
 * 渲染器必须能渲染任何输入（四级降级），安全读取器是"字段坏了"这一级的唯一入口。
 */

import type { ActionPayload } from './types.js';

/* ─────────────────────────────────────────────────────────────
 * 节点
 * ───────────────────────────────────────────────────────────── */

/** 一级降级：正常控件。 */
export interface FragmentNode {
	readonly kind: 'fragment';
	readonly children: readonly Node[];
}

/** 交给 ⑩ 渲染的 Markdown 源文本（② 只产出，不渲染）。 */
export interface MdNode {
	readonly kind: 'md';
	readonly source: string;
}

/** 纯文本 —— **永远不当 MD 渲染**（用户 02:35：文本框内的不渲染）。 */
export interface TextNode {
	readonly kind: 'text';
	readonly text: string;
}

export interface ElementNode {
	readonly kind: 'element';
	readonly tag: string;
	readonly props: Readonly<Record<string, unknown>>;
	readonly children: readonly Node[];
}

/** 二级降级：已注册的 action，但字段坏了（required 缺失 / 类型不符）。 */
export interface BrokenNode {
	readonly kind: 'broken';
	readonly actionType: string;
	readonly code: 'MISSING_REQUIRED' | 'TYPE_MISMATCH';
	readonly field: string;
	readonly expected?: string;
	readonly actual?: string;
}

/** 三级降级：`$type` 未注册。⑩ 画成「未注册的动作」按钮，点击展开原始 JSON。 */
export interface UnregisteredNode {
	readonly kind: 'unregistered';
	/** 原始 `$type`（连 `$type` 都没有时为空串）。 */
	readonly typeText: string;
	/** 展开后展示的原始 JSON 文本。 */
	readonly json: string;
}

/** 四级降级：连 object 都不是（`null` / `42` / 字符串 / 数组）。 */
export interface RawNode {
	readonly kind: 'raw';
	/** 原值的 JSON 文本。 */
	readonly json: string;
}

export type Node =
	| FragmentNode
	| MdNode
	| TextNode
	| ElementNode
	| BrokenNode
	| UnregisteredNode
	| RawNode;

/* ─────────────────────────────────────────────────────────────
 * 构造器
 * ───────────────────────────────────────────────────────────── */

export function fragment(children: readonly Node[]): FragmentNode {
	return { kind: 'fragment', children };
}

export function md(source: string): MdNode {
	return { kind: 'md', source };
}

export function text(value: string): TextNode {
	return { kind: 'text', text: value };
}

export function element(
	tag: string,
	props: Readonly<Record<string, unknown>> = {},
	children: readonly Node[] = [],
): ElementNode {
	return { kind: 'element', tag, props, children };
}

export function broken(
	actionType: string,
	code: BrokenNode['code'],
	field: string,
	detail?: { expected?: string; actual?: string },
): BrokenNode {
	const node: BrokenNode = { kind: 'broken', actionType, code, field };
	if (detail?.expected !== undefined || detail?.actual !== undefined) {
		return {
			...node,
			...(detail.expected === undefined ? {} : { expected: detail.expected }),
			...(detail.actual === undefined ? {} : { actual: detail.actual }),
		};
	}
	return node;
}

export function unregistered(typeText: string, value: unknown): UnregisteredNode {
	return { kind: 'unregistered', typeText, json: stringify(value) };
}

export function raw(value: unknown): RawNode {
	return { kind: 'raw', json: stringify(value) };
}

/* ─────────────────────────────────────────────────────────────
 * 安全字段读取（"字段坏了"这一级的唯一入口）
 * ───────────────────────────────────────────────────────────── */

/**
 * 读取结果。
 *
 * `missing` 与 `wrong-type` 分开：前者只有在字段是 required 时才算坏；
 * 后者一律算坏（存在但类型不符 = 上游出错）。
 */
export type FieldRead<T> =
	| { readonly ok: true; readonly value: T | undefined }
	| { readonly ok: false; readonly issue: BrokenNode };

/**
 * 安全读字段。
 *
 * @param payload  待读 payload
 * @param field    字段名
 * @param kind     期望类型（只支持渲染器实际会读的几种）
 * @param required 该字段在 schema 里是否 required
 */
export function readField<T>(
	payload: ActionPayload,
	field: string,
	kind: 'string' | 'boolean' | 'array' | 'object' | 'integer',
	required = false,
): FieldRead<T> {
	const actionType = typeof payload.$type === 'string' ? payload.$type : '';
	const holder = payload as unknown as Record<string, unknown>;
	const present = Object.prototype.hasOwnProperty.call(holder, field);
	const value = holder[field];

	if (!present || value === undefined) {
		if (required) {
			return { ok: false, issue: broken(actionType, 'MISSING_REQUIRED', field) };
		}
		return { ok: true, value: undefined };
	}

	if (!matchesKind(kind, value)) {
		return {
			ok: false,
			issue: broken(actionType, 'TYPE_MISMATCH', field, {
				expected: expectedName(kind),
				actual: actualName(value),
			}),
		};
	}

	return { ok: true, value: value as T };
}

function matchesKind(kind: string, value: unknown): boolean {
	switch (kind) {
		case 'string':
			return typeof value === 'string';
		case 'boolean':
			return typeof value === 'boolean';
		case 'array':
			return Array.isArray(value);
		case 'object':
			return isPlainObject(value);
		case 'integer':
			return typeof value === 'number' && Number.isInteger(value);
		default:
			return false;
	}
}

function expectedName(kind: string): string {
	return kind;
}

function actualName(value: unknown): string {
	if (value === null) return 'null';
	if (Array.isArray(value)) return 'array';
	return typeof value;
}

/* ─────────────────────────────────────────────────────────────
 * 通用小工具
 * ───────────────────────────────────────────────────────────── */

/** 是否是朴素对象（非 null / 非数组 / 非标量）。 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
	const proto = Object.getPrototypeOf(value) as unknown;
	return proto === Object.prototype || proto === null;
}

/** 安全 stringify（循环引用/函数等不会抛）。 */
export function stringify(value: unknown): string {
	try {
		const out: string | undefined = JSON.stringify(
			value,
			(_key, item: unknown) => (typeof item === 'function' ? '[function]' : item),
			2,
		);
		return out === undefined ? String(value) : out;
	} catch {
		return String(value);
	}
}
