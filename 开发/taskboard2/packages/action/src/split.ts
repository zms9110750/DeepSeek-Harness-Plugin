/**
 * ② action —— 声明 / 答案的切分。
 *
 * 答案位置因 action 而异：
 *   text / markdown → 顶层 `value`
 *   ask             → `items[i].picked`
 *
 * ⑦ 需要 `isDeclarationOnlyChange(prev, next)` 判"只改了答案"（声明冻结、答案可变），
 * 但 ⑦ 对 payload 不透明 —— 所以由 ② 提供。
 */

import type { SplitPayload } from './types.js';
import { isPlainObject } from './nodes.js';

/** 答案所在位置（每个 `$type` 一份；外来 action 默认按顶层 `value`）。 */
type AnswerShape =
	| { readonly where: 'top'; readonly keys: readonly string[] }
	| { readonly where: 'items'; readonly keys: readonly string[] };

const ANSWERS: Readonly<Record<string, AnswerShape>> = Object.freeze({
	text: { where: 'top', keys: ['value'] },
	markdown: { where: 'top', keys: ['value'] },
	ask: { where: 'items', keys: ['picked'] },
});

const DEFAULT_ANSWERS: AnswerShape = { where: 'top', keys: ['value'] };

function answersOf($type: string): AnswerShape {
	return ANSWERS[$type] ?? DEFAULT_ANSWERS;
}

/* ─────────────────────────────────────────────────────────────
 * splitPayload
 * ───────────────────────────────────────────────────────────── */

/**
 * 把一份 payload 切成「声明」与「答案」。
 *
 * - 声明 = 去掉所有答案字段后的结构（含 `$type`、`items` 长度与顺序、每个 item 除答案外的字段）
 * - 答案 = 按 `items` 顺序排列的答案值
 *
 * **非对象输入不抛异常**：声明就是原值，答案为空数组。
 */
export function splitPayload(payload: unknown): SplitPayload {
	if (!isPlainObject(payload)) {
		return { declaration: payload, answer: [] };
	}

	const $type = typeof payload.$type === 'string' ? payload.$type : '';
	const shape = answersOf($type);

	if (shape.where === 'items') {
		const items = payload.items;
		if (!Array.isArray(items)) {
			const declaration = omitKeys(payload, shape.keys);
			return { declaration, answer: [] };
		}
		const declarationItems = items.map((item) =>
			isPlainObject(item) ? omitKeys(item, shape.keys) : item,
		);
		const answer = items.map((item) => {
			if (!isPlainObject(item)) return undefined;
			return shape.keys.length === 1 ? item[shape.keys[0] as string] : pickKeys(item, shape.keys);
		});
		return {
			declaration: { ...payload, items: declarationItems },
			answer,
		};
	}

	const answer = shape.keys.length === 1 ? [payload[shape.keys[0] as string]] : [pickKeys(payload, shape.keys)];
	return { declaration: omitKeys(payload, shape.keys), answer };
}

function omitKeys(source: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(source)) {
		if (!keys.includes(key)) out[key] = value;
	}
	return out;
}

function pickKeys(source: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const key of keys) {
		if (Object.prototype.hasOwnProperty.call(source, key)) out[key] = source[key];
	}
	return out;
}

/* ─────────────────────────────────────────────────────────────
 * isDeclarationOnlyChange
 * ───────────────────────────────────────────────────────────── */

/**
 * 是否**只改了答案**。
 *
 * - 真 = 只有答案变了（元素增删 / 顺序变化 / 任一声明字段变化 都判假）
 * - **唯一出参是布尔**：不存在返回 diff 的重载或兄弟函数
 *   （否则 ⑦ 会开始理解字段语义，与"对 payload 零参与"冲突）
 */
export function isDeclarationOnlyChange(prev: unknown, next: unknown): boolean {
	return deepEqual(splitPayload(prev).declaration, splitPayload(next).declaration);
}

/* ─────────────────────────────────────────────────────────────
 * 两个"空"—— 判据相反，所以用两个名字
 * ───────────────────────────────────────────────────────────── */

/**
 * 合法性视角的"空"：字段没有值。
 *
 * `ask.picked = []`、`text.value = ""`、`ask.items = []` 都算空。
 */
export function isEmptyForValidity(payload: unknown): boolean {
	if (!isPlainObject(payload)) return true;

	const $type = typeof payload.$type === 'string' ? payload.$type : '';
	const shape = answersOf($type);

	if (shape.where === 'items') {
		const items = payload.items;
		if (!Array.isArray(items) || items.length === 0) return true;
		return items.every((item) => {
			if (!isPlainObject(item)) return true;
			for (const key of shape.keys) {
				const value = item[key];
				if (Array.isArray(value) ? value.length > 0 : value !== undefined && value !== '') return false;
			}
			return true;
		});
	}

	for (const key of shape.keys) {
		const value = payload[key];
		if (Array.isArray(value) ? value.length > 0 : value !== undefined && value !== '') return false;
	}
	return true;
}

/**
 * 用户表达视角的"有内容"。
 *
 * **⚠ `ask.picked === []` ⇒ `true`**：用户主动表达"都不要"是有信息量的，丢了就是丢信息。
 * 若不这样判，fork 时会静默丢掉用户的"都不要"表态。
 */
export function hasUserContent(payload: unknown): boolean {
	if (!isPlainObject(payload)) return false;

	const $type = typeof payload.$type === 'string' ? payload.$type : '';
	const shape = answersOf($type);

	if (shape.where === 'items') {
		const items = payload.items;
		if (!Array.isArray(items)) return false;
		return items.some((item) => {
			if (!isPlainObject(item)) return false;
			for (const key of shape.keys) {
				// 键存在即算"有表达"（哪怕是空数组 —— "都不要"也是表达）
				if (Object.prototype.hasOwnProperty.call(item, key)) return true;
			}
			return false;
		});
	}

	for (const key of shape.keys) {
		if (Object.prototype.hasOwnProperty.call(payload, key)) {
			const value = payload[key];
			// 空串是"没填"，不是"有表达"
			if (value === '' || value === undefined) continue;
			return true;
		}
	}
	return false;
}

/* ─────────────────────────────────────────────────────────────
 * deepEqual
 * ───────────────────────────────────────────────────────────── */

function deepEqual(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (typeof a !== typeof b) return false;
	if (Array.isArray(a) || Array.isArray(b)) {
		if (!Array.isArray(a) || !Array.isArray(b)) return false;
		if (a.length !== b.length) return false;
		return a.every((item, index) => deepEqual(item, b[index]));
	}
	if (isPlainObject(a) && isPlainObject(b)) {
		const aKeys = Object.keys(a);
		const bKeys = Object.keys(b);
		if (aKeys.length !== bKeys.length) return false;
		return aKeys.every(
			(key) => Object.prototype.hasOwnProperty.call(b, key) && deepEqual(a[key], b[key]),
		);
	}
	return false;
}
