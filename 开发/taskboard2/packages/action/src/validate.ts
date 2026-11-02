/**
 * ② action —— 校验。
 *
 * 两个公开函数：
 *   validateForEdit    → 只跑 L1（编辑期，允许中间态，不跑 schema）
 *   validateForCreate  → L1 + L2 + 完整 schema + 缺章 / 多章
 *
 * **schema 只在创建时校验。** 运行中不校验 —— 可以有额外字段，只要渲染器看得懂。
 * **两个函数都不假设输入经过任何前置校验** —— 要"任意输入 → 判断"。
 */

import { getAction } from './registry.js';
import type {
	ActionPayload,
	Issue,
	IssueCode,
	SchemaNode,
	SectionSpec,
	ValidateOptions,
	ValidateResult,
} from './types.js';
import { isPlainObject } from './nodes.js';

/* ─────────────────────────────────────────────────────────────
 * L1
 * ───────────────────────────────────────────────────────────── */

/**
 * L1 —— 结构 / 存在性，只有 3 条。
 *
 * **L1 不含任何字段级检查**：L1 若能检查 action 私有字段，就等于 ② 硬编码了
 * action 的形状；而 action 可注册（含外来）⇒ 硬编码必然漏检或误判。
 */
function runL1(payload: unknown, opts: ValidateOptions): Issue[] {
	const at = opts.sectionId ?? '';

	// 1. payload 是 object
	if (!isPlainObject(payload)) {
		return [
			issue('L1', 'INVALID_PAYLOAD', at, undefined, undefined, `payload 必须是对象，实际是 ${typeName(payload)}`),
		];
	}

	// 2. $type 是非空字符串
	const rawType = (payload as Record<string, unknown>).$type;
	if (typeof rawType !== 'string' || rawType.trim() === '') {
		return [issue('L1', 'MISSING_TYPE', at, '$type', '$type', '$type 缺失或不是非空字符串')];
	}
	const $type = rawType.trim();

	// 3. $type 已注册
	if (getAction($type) === undefined) {
		return [
			issue(
				'L1',
				'UNKNOWN_TYPE',
				at,
				'$type',
				'$type',
				`action「${$type}」未注册（可能是模板与行为版本不匹配）`,
			),
		];
	}

	return [];
}

/* ─────────────────────────────────────────────────────────────
 * L2
 * ───────────────────────────────────────────────────────────── */

/** L2 —— 按该 action 的 schema 校验字段形状。**只在创建时跑。** */
function runL2(payload: ActionPayload, sectionId: string): Issue[] {
	const action = getAction(payload.$type);
	if (action === undefined) return []; // L1 已拦
	const issues: Issue[] = [];
	walk(action.schema, payload, '', sectionId, issues);
	return issues;
}

function walk(
	schema: SchemaNode,
	value: unknown,
	path: string,
	sectionId: string,
	issues: Issue[],
): void {
	/* const —— 用于 $type 自校验 */
	if (schema.const !== undefined && value !== schema.const) {
		issues.push(
			issue('L2', 'INVALID_FIELD', sectionId, fieldOf(path), path, `应为 ${JSON.stringify(schema.const)}，实际是 ${JSON.stringify(value)}`),
		);
		return;
	}

	/* enum */
	if (Array.isArray(schema.enum) && !schema.enum.some((item) => item === value)) {
		issues.push(
			issue(
				'L2',
				'INVALID_FIELD',
				sectionId,
				fieldOf(path),
				path,
				`只能是 ${schema.enum.map((item) => JSON.stringify(item)).join(' / ')}，实际是 ${JSON.stringify(value)}`,
			),
		);
	}

	/* type */
	if (schema.type !== undefined && !matchesType(schema.type, value)) {
		issues.push(
			issue(
				'L2',
				'INVALID_FIELD',
				sectionId,
				fieldOf(path),
				path === '' ? '(根)' : path,
				`应为 ${schema.type}，实际是 ${typeName(value)}`,
			),
		);
		return; // 类型都不对，后续判断没有意义
	}

	/* 数组 */
	if (Array.isArray(value)) {
		if (typeof schema.minItems === 'number' && value.length < schema.minItems) {
			issues.push(
				issue('L2', 'INVALID_FIELD', sectionId, fieldOf(path), path, `至少 ${schema.minItems} 项，实际 ${value.length} 项`),
			);
		}
		if (schema.items !== undefined) {
			const itemSchema: SchemaNode = schema.items;
			value.forEach((item, index) => {
				walk(itemSchema, item, join(path, String(index)), sectionId, issues);
			});
		}
		return;
	}

	/* 对象 */
	if (isPlainObject(value)) {
		const properties = schema.properties ?? {};
		const required = schema.required ?? [];

		for (const key of required) {
			const field = value[key];
			if (field === undefined) {
				issues.push(issue('L2', 'INVALID_FIELD', sectionId, key, join(path, key), '必填，但没给'));
			}
		}

		for (const [key, child] of Object.entries(properties)) {
			const field = value[key];
			if (field === undefined) continue;
			walk(child, field, join(path, key), sectionId, issues);
		}
		// additionalProperties 不实现（裁决放宽），未知字段直接穿过
	}
}

function matchesType(type: string, value: unknown): boolean {
	switch (type) {
		case 'object':
			return isPlainObject(value);
		case 'array':
			return Array.isArray(value);
		case 'string':
			return typeof value === 'string';
		case 'number':
			return typeof value === 'number' && Number.isFinite(value);
		case 'integer':
			return typeof value === 'number' && Number.isInteger(value);
		case 'boolean':
			return typeof value === 'boolean';
		case 'null':
			return value === null;
		default:
			return true;
	}
}

function join(parent: string, key: string): string {
	return parent === '' ? key : `${parent}.${key}`;
}

/** 从 `items[2].options` 这样的路径里取出机器可读字段名（`options`）。 */
function fieldOf(path: string): string | undefined {
	if (path === '') return undefined;
	const tail = path.split('.').pop() ?? '';
	const cleaned = tail.replace(/\[\d+\]$/u, '');
	return cleaned === '' ? undefined : cleaned;
}

/* ─────────────────────────────────────────────────────────────
 * 公开入口
 * ───────────────────────────────────────────────────────────── */

/**
 * 编辑期校验 —— **只跑 L1**，不跑 schema。
 *
 * 编辑期若跑 schema，用户"删到 `ask` 最后一项"就存不下来（`minItems: 1` 会拒），
 * 且无法绕过（必须先加一项才能删）。编辑期的正确性由渲染器健壮性兜底。
 */
export function validateForEdit(payload: unknown, opts: ValidateOptions = {}): ValidateResult {
	const issues = runL1(payload, opts);
	return { ok: issues.length === 0, issues };
}

/**
 * 建卡期校验 —— L1 + L2 + 完整 schema + 缺章 / 多章。
 *
 * **不假设输入经过任何前置校验。**
 */
export function validateForCreate(
	payloads: Readonly<Record<string, unknown>>,
	sections: readonly SectionSpec[],
): ValidateResult {
	if (!isPlainObject(payloads)) {
		throw new TypeError('taskboard2-action: validateForCreate 的 payloads 必须是对象');
	}
	if (!Array.isArray(sections)) {
		throw new TypeError('taskboard2-action: validateForCreate 的 sections 必须是数组');
	}

	const issues: Issue[] = [];

	const wanted = new Set(sections.map((section) => section.id));
	const given = Object.keys(payloads);

	/* 缺章：模板有、payloads 没有 */
	for (const section of sections) {
		if (!Object.prototype.hasOwnProperty.call(payloads, section.id)) {
			issues.push(
				issue('template', 'MISSING_SECTION', section.id, undefined, undefined, `缺少章节「${section.id}」`),
			);
			continue;
		}

		/* 该章存在 ⇒ 跑 L1 + L2 */
		const payload = payloads[section.id];
		const l1 = runL1(payload, { sectionId: section.id });
		issues.push(...l1);
		if (l1.length > 0) continue;

		issues.push(...runL2(payload as ActionPayload, section.id));
	}

	/* 多章：payloads 有、模板没有 */
	for (const id of given) {
		if (!wanted.has(id)) {
			issues.push(
				issue(
					'template',
					'SECTION_NOT_IN_TEMPLATE',
					id,
					undefined,
					undefined,
					`章节「${id}」不在模板里`,
				),
			);
		}
	}

	return { ok: issues.length === 0, issues };
}

/* ─────────────────────────────────────────────────────────────
 * 辅助
 * ───────────────────────────────────────────────────────────── */

function issue(
	level: Issue['level'],
	code: IssueCode,
	sectionId: string,
	field: string | undefined,
	path: string | undefined,
	diagnostic: string,
): Issue {
	return {
		level,
		code,
		sectionId,
		...(field === undefined ? {} : { field }),
		...(path === undefined ? {} : { path }),
		diagnostic,
	};
}

function typeName(value: unknown): string {
	if (value === null) return 'null';
	if (Array.isArray(value)) return 'array';
	return typeof value;
}
