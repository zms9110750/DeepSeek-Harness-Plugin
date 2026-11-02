/**
 * ⑧ core —— 建卡校验（三入口共用，**无开关参数**）。
 *
 * ## 为什么是"一个入口、不给开关"
 *
 * 三个建卡入口（面板新建 / fork / AI 传参）都走同一条校验。
 * `requireItems` 漏传若默认为 `false`，**等于把用户规则「提交时必须要有行为」静默关掉**，
 * 且没有任何其它闸门补上（③ 的 `accepts` 只管 `$type`，不管 `items` 非空）。
 *
 * ⇒ 两个函数各自写死自己的强度：
 *   · `assertSectionsComplete`  —— 建卡（L1 + L2 + 缺章 / 多章）
 *   · `updateBody`（在 edit.ts）—— 编辑单章（只 L1）
 *
 * **不给参数、不给默认、不给公共常量。**
 */

import { coreError, type CoreError } from './errors.js';
import type { ActionsPort, Issue, TypesPort } from './ports.js';

/** 校验结果：通过 / 失败（带 ② 的 issues）。 */
export type CheckResult =
	| { readonly ok: true }
	| {
			readonly ok: false;
			readonly error: CoreError;
			/** ⑩ 用的投影（`diagnostic` 已丢）。 */
			readonly issuesForUI?: readonly unknown[];
	  };

/**
 * 建卡前的章节校验。
 *
 * 步骤：
 *   1. 从 ③ 取该模板的权威章节清单（**核心不自己算"该有哪几章"**）；
 *   2. `sectionsOf` 返回 `undefined` ⇒ fail-closed（模板不存在）；
 *   3. 一次性交给 ② 的 `validateForCreate`（缺章 / 多章 / L1 / L2 全由 ② 判）。
 *
 * ⚠ **core 不造 issue**：`MISSING_SECTION` / `SECTION_NOT_IN_TEMPLATE` 都由 ② 造。
 * 核心里若再循环造一遍，issue 就有了两份来源。
 */
export function assertSectionsComplete(
	ports: {
		readonly types: Pick<TypesPort, 'resolve' | 'sectionsOf'>;
		readonly actions: Pick<ActionsPort, 'validateForCreate' | 'toIssueForUI'>;
	},
	templateRef: string,
	payloads: Readonly<Record<string, unknown>>,
): CheckResult {
	/* ① 模板必须存在（注册表未初始化会抛 —— 那是装配问题，原样上抛）。 */
	const sections = ports.types.sectionsOf(templateRef);
	if (sections === undefined) {
		return {
			ok: false,
			error: coreError('TEMPLATE_MISSING', `找不到模板「${templateRef}」，无法校验章节`, {
				templateRef,
			}),
		};
	}

	/* ② 一次性交给 ②：`sections` 用 ③ 的清单原样转传，core 不包装、不加工。 */
	const result = ports.actions.validateForCreate(payloads, sections);
	if (result.ok) return { ok: true };

	return {
		ok: false,
		error: coreError('CREATE_VALIDATION_FAILED', '建卡校验未通过。', {
			templateRef,
			issues: result.issues,
		}),
		/* ⑩ 拿到的对象里没有 `diagnostic`（② 真正删除，不是类型收窄）。 */
		issuesForUI: result.issues.map((issue) => ports.actions.toIssueForUI(issue)),
	};
}

/**
 * 把 ② 的 issues 投影成给 ⑩ 的形状（**丢 `diagnostic`**）。
 *
 * 两处调用：建卡校验返回、编辑期校验转发。**⑩ 拿不到 `diagnostic`**。
 */
export function issuesForUI(actions: Pick<ActionsPort, 'toIssueForUI'>, issues: readonly Issue[]): unknown[] {
	return issues.map((issue) => actions.toIssueForUI(issue));
}
