/**
 * ③ 类型体系 —— 包壳与导出汇总。
 *
 * 这个包装着任务类型的整套词汇与规则，四块，严格单向：
 *
 *   status  →  kind  →  template  →  id
 *   状态        分类      模板        编号
 *
 * 为什么四块在同一个包里：拆开会形成包级 `inject` 环 —— 那是死锁，不是慢。
 *
 * ## 四条硬边界
 *
 *   1. **零依赖**：不 import 任何 `@local/*` 包、不用第三方库。
 *   2. **不碰 I/O**：不读文件、不读 YAML、不碰 store、不写任何东西。
 *   3. **`apply` 里不注册任何模板**：模板注册由 ⑧ 读 YAML 解析后显式调用
 *      `registerTemplate`，注册完再调 `markTemplateRegistryReady`。
 *   4. **`apply` 里唯一做的事是 `provide`**：不 provide 的话，`inject` 了本包的
 *      ⑦ / ⑧ 会永远停在 `PENDING`（Cordis：`inject` 里任一项没人 provide ⇒ 该插件不启动）。
 *
 * ## 对外面
 *
 *   注册：registerTemplate / markTemplateRegistryReady
 *   查询：resolve / sectionsOf / templateMeta
 *   词表：TaskState / DRAFT / type Kind
 *   规则：initialStatus / kindLetter / canTransition
 *   编号：nextId / parse / normalize / toDisplay
 */

import {
	TaskState,
	DRAFT,
	TASK_STATES,
	type ActiveStatus,
	type ShelvedStatus,
	type EndedStatus,
} from './status.js';

import {
	type Kind,
	type KindDef,
	type ComputeRule,
	type RuleInput,
	type ChildSnapshot,
	KIND_DEFS,
	registerKind,
	getKind,
	listKinds,
	initialStatus,
	kindLetter,
	quotaStatesOf,
	deriveStatus,
	isEndedStatus,
	isShelvedStatus,
	isActiveStatus,
	isDraftStatus,
} from './kind.js';

import {
	type Accept,
	type SectionDef,
	type TemplateDef,
	type RegisterTemplateOptions,
	type ResolvedTemplate,
	type SectionAccepts,
	type TemplateMeta,
	registerTemplate,
	resetTemplateRegistry,
	markTemplateRegistryReady,
	isTemplateRegistryReady,
	getTemplate,
	listTemplates,
	resolve,
	sectionsOf,
	templateMeta,
	findByFullName,
} from './template.js';

import {
	type Actor,
	type TransitionCtx,
	type TransitionVerdict,
	canTransition,
} from './transition.js';

import { type ParsedId, parse, normalize, toDisplay, nextId } from './id.js';

export const name = 'taskboard2-types';

/** 不依赖任何其它包的服务。 */
export const inject = [];

/** Cordis `Context` 里本包用到的部分（结构化声明，避免引入类型依赖）。 */
type ProvideContext = {
	provide(name: string, value: unknown): void;
};

/**
 * 包壳。
 *
 * **这里不注册任何模板** —— 分类的内置四类在模块加载时已注册；模板必须由 ⑧ 显式注册。
 * 这里**只把本包的能力 provide 出去**：否则 `inject: ['taskboard2Types']` 的 ⑦ / ⑧
 * 会永远停在 `PENDING`，`apply` 永远不执行。
 */
export function apply(ctx: ProvideContext): void {
	ctx.provide('taskboard2Types', {
		/* 词表（⑦⑧） */
		TaskState,
		DRAFT,
		/* 组判定（⑧ 的级联 / 领取用） */
		isEndedStatus,
		isShelvedStatus,
		isActiveStatus,
		isDraftStatus,
		/* 规则（⑦ 判决 / ⑧ 计算态重算） */
		initialStatus,
		kindLetter,
		canTransition,
		deriveStatus,
		/* 模板（⑧ 启动编排；⑦ 只读 resolve） */
		registerTemplate,
		markTemplateRegistryReady,
		resolve,
		sectionsOf,
		templateMeta,
		/* 编号（⑧） */
		nextId,
		parse,
		normalize,
		toDisplay,
	});
}

export {
	/* status */
	TaskState,
	TASK_STATES,
	DRAFT,
	type ActiveStatus,
	type ShelvedStatus,
	type EndedStatus,
	/* kind */
	type Kind,
	type KindDef,
	type ComputeRule,
	type RuleInput,
	type ChildSnapshot,
	KIND_DEFS,
	registerKind,
	getKind,
	listKinds,
	initialStatus,
	kindLetter,
	quotaStatesOf,
	deriveStatus,
	isEndedStatus,
	isShelvedStatus,
	isActiveStatus,
	isDraftStatus,
	/* template */
	type Accept,
	type SectionDef,
	type TemplateDef,
	type RegisterTemplateOptions,
	type ResolvedTemplate,
	type SectionAccepts,
	type TemplateMeta,
	registerTemplate,
	resetTemplateRegistry,
	markTemplateRegistryReady,
	isTemplateRegistryReady,
	getTemplate,
	listTemplates,
	resolve,
	sectionsOf,
	templateMeta,
	findByFullName,
	/* transition */
	type Actor,
	type TransitionCtx,
	type TransitionVerdict,
	canTransition,
	/* id */
	type ParsedId,
	parse,
	normalize,
	toDisplay,
	nextId,
};
