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
import type { ActionsPort, CardSection, Issue, TypesPort } from './ports.js';

/**
 * 从卡上的 `{ [sectionId]: { label, payload } }` 剥出 `{ [sectionId]: payload }`。
 *
 * **② 只认 payload** —— `label` 是显示副本，不参与 schema 校验。
 *
 * ⚠ **剥的动作只有这一处**：若在几个调用点各写一遍 `Object.entries(...).map(([k,v]) => [k, v.payload])`，
 * 将来 `CardSection` 加字段（比如 `hint`）时就要改多处，而漏一处**不报错**、只会把整个
 * `{label, payload}` 对象当 payload 交给 ②（于是 schema 校验莫名失败）。
 */
export function payloadsOf(
	sections: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [id, value] of Object.entries(sections)) {
		const section = value as Partial<CardSection> | undefined;
		/* 兼容两种形状：`{ label, payload }` 与裸 payload（迁移期 / 测试数据）。 */
		out[id] = section !== null && typeof section === 'object' && 'payload' in section
			? section.payload
			: value;
	}
	return out;
}

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
 *
 * ⚠ **卡上的 `sections` 是 `{ label, payload }`，② 只认 payload** ⇒
 *   **校验前必须把 payload 剥出来**。`label` 是显示用的副本，不参与 schema 校验。
 *   剥的动作用 `payloadsOf` 一处完成（不在这里手写循环）。
 */
export function assertSectionsComplete(
	ports: {
		readonly types: Pick<TypesPort, 'resolve' | 'sectionsOf'>;
		readonly actions: Pick<ActionsPort, 'validateForCreate' | 'toIssueForUI'>;
	},
	templateRef: string,
	sections: Readonly<Record<string, unknown>>,
): CheckResult {
	/* ① 模板必须存在（注册表未初始化会抛 —— 那是装配问题，原样上抛）。 */
	const specs = ports.types.sectionsOf(templateRef);
	if (specs === undefined) {
		return {
			ok: false,
			error: coreError('TEMPLATE_MISSING', `找不到模板「${templateRef}」，无法校验章节`, {
				templateRef,
			}),
		};
	}

	/* ② 剥出 payload 再交给 ②（② 只认 payload；label 是显示副本）。 */
	const result = ports.actions.validateForCreate(payloadsOf(sections), specs);
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
