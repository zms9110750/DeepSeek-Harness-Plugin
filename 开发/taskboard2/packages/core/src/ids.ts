/**
 * ⑧ core —— 编号分配（发号）。
 *
 * ## 发号点
 *
 * `【用户指令，2026-11-01 06:43】`「**建卡是提交时发号。**」
 * ⇒ 发号发生在**建卡那一刻**，不在采纳时。
 *
 * ## 前缀怎么拼
 *
 * 编号 = **分类字母 + 模板段 + 流水**（③ 的 `id.ts` 头注释）：
 *   - 模板段 = 模板的 `codePrefix`（`''` 合法 = 不提供字母段）；
 *   - 分类段 = **从分类定义取**，模板文件不写。
 *
 * ⚠ **分类字母从哪来是 ③ 的接口问题**：③ 目前**没有**导出"分类字母"访问器。
 * ⇒ 本函数显式要求 ③ 提供 `kindLetter(kind)`；
 * **缺了就抛 `ID_PREFIX_UNAVAILABLE`，不猜字母**（猜字母 = 造一个会撞号的前缀）。
 *
 * ## `usedIds` 必须含墓碑
 *
 * 删除是标记删除 ⇒ 墓碑仍占号。`workspace.usedIdsOf` 已经不过滤，这里不再处理。
 */

import { coreError, type CoreError } from './errors.js';
import type { TypesPort } from './ports.js';

/** 发号失败。 */
export interface AllocateIdFailure {
	readonly ok: false;
	readonly error: CoreError;
}

/** 发号成功。 */
export interface AllocateIdSuccess {
	readonly ok: true;
	/** 规范形编号（大写、无连字符），如 `GU01`。 */
	readonly id: string;
	/** 展示形（插连字符），如 `GU-01`。 */
	readonly display: string;
}

export type AllocateIdResult = AllocateIdSuccess | AllocateIdFailure;

/**
 * 拼编号前缀：分类字母 + 模板 `codePrefix`。
 *
 * 两个来源都不写死：分类字母问 ③，模板段问 ③ 的 `resolve`。
 */
export function prefixOf(types: TypesPort, templateRef: string): AllocateIdResult {
	const template = types.resolve(templateRef);
	if (template === undefined) {
		return {
			ok: false,
			error: coreError('TEMPLATE_MISSING', `找不到模板「${templateRef}」，无法发号`, {
				templateRef,
			}),
		};
	}

	/*
	 * 取分类字母。
	 *
	 * ③ 的 `kindLetter` **未注册分类会抛错**（它刻意不返回 `undefined`、不猜字母）。
	 * 但"旧卡引用了已注销的分类"在运行期是**可发生的**，不该让整个门面抛异常
	 * ⇒ 在这里把抛错转成 `ID_PREFIX_UNAVAILABLE`（⑧ 的契约是"返回结果、不抛业务异常"）。
	 */
	if (typeof types.kindLetter !== 'function') {
		return {
			ok: false,
			error: coreError(
				'ID_PREFIX_UNAVAILABLE',
				'③ 未提供分类字母访问器（kindLetter），无法拼编号前缀；不猜字母。',
				{ kind: template.kind },
			),
		};
	}

	let kindLetter: string;
	try {
		kindLetter = types.kindLetter(template.kind);
	} catch (error) {
		return {
			ok: false,
			error: coreError(
				'ID_PREFIX_UNAVAILABLE',
				`取分类「${template.kind}」的编号字母失败：${error instanceof Error ? error.message : String(error)}`,
				{ kind: template.kind },
			),
		};
	}

	const prefix = `${kindLetter}${template.codePrefix}`;

	/* 前缀必须是 `[A-Z]+`（③ 的 `nextId` 会再校验一次，这里提前给可读错误）。 */
	if (!/^[A-Z]+$/.test(prefix)) {
		return {
			ok: false,
			error: coreError(
				'ID_PREFIX_UNAVAILABLE',
				`拼出的编号前缀非法（${prefix}）：分类字母与模板 codePrefix 都必须是大写字母。`,
				{ kind: template.kind, codePrefix: template.codePrefix, prefix },
			),
		};
	}

	return { ok: true, id: prefix, display: prefix };
}

/**
 * 发号：**纯计算**，不读存储、不管并发（并发安全靠"发号与写卡同事务"）。
 *
 * @param usedIds 该空间**全部**已用编号（**含墓碑**）。
 */
export function allocateId(
	types: TypesPort,
	templateRef: string,
	usedIds: readonly string[],
): AllocateIdResult {
	const prefix = prefixOf(types, templateRef);
	if (!prefix.ok) return prefix;

	let id: string;
	try {
		id = types.nextId(prefix.id, usedIds);
	} catch (error) {
		return {
			ok: false,
			error: coreError(
				'ID_PREFIX_UNAVAILABLE',
				`发号失败：${error instanceof Error ? error.message : String(error)}`,
				{ prefix: prefix.id },
			),
		};
	}

	return { ok: true, id, display: typeof types.toDisplay === 'function' ? types.toDisplay(id) : id };
}
