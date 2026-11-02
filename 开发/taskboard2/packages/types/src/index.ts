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
 * ## 硬边界（本批已按用户裁决修订）
 *
 *   1. **依赖**：只用 `yaml`（读模板）与 Node 内置模块（`node:fs` / `node:path`）。
 *      **仍然不 import 任何 `@local/*` 包**（那会成环）。
 *   2. **碰 I/O 的地方只有 `templates.ts`**（加载器）：读 YAML、扫目录。
 *      **其余文件仍是纯函数、零 I/O。**
 *   3. **`apply` 里做两件事**：① 读模板并注册（失败只打日志、不抛）；② `provide` 服务面。
 *      **顺序固定：先注册、再 provide** —— 这样 `inject` 了本包的 ⑦ / ⑧ 一启动模板就已经在了。
 *   4. **不 provide 的后果**：`inject` 了本包的 ⑦ / ⑧ 会永远停在 `PENDING`
 *      （Cordis：`inject` 里任一项没人 provide ⇒ 该插件不启动）。
 *
 * ## 为什么 ③ 要自己读 YAML（历史）
 *
 * 用户 `14:50`：「那他就管……**初始化的时候自己注册一些默认的也很合理吧**。」
 * 「**是的。他要去读 yaml。读失败了要提供报错能力。**」
 * ⇒ 模板是 ③ 的词汇，加载也归 ③；⑧ 只调 `apply`。
 *
 * ## 对外面
 *
 *   加载：loadTemplates / findTemplatesDir（给测试与诊断）
 *   注册：registerTemplate / markTemplateRegistryReady / isTemplateRegistryReady
 *   查询：resolve / sectionsOf / templateMeta / getTemplate / listTemplates / findByFullName
 *   词表：TaskState / DRAFT / type Kind
 *   规则：initialStatus / kindLetter / canTransition / deriveStatus / liveChildren
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
	liveChildren,
} from './kind.js';

import {
	type SectionDef,
	type TemplateDef,
	type DeriveDef,
	type ResolvedTemplate,
	type SectionInfo,
	type TemplateMeta,
	registerTemplate,
	resetTemplateRegistry,
	markTemplateRegistryReady,
	isTemplateRegistryReady,
	templateCount,
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

import {
	loadTemplates,
	findTemplatesDir,
	type LoadTemplatesOptions,
	type LoadTemplatesResult,
} from './templates.js';

import type { TemplateIssue, TemplateIssueCode } from './errors.js';

export const name = 'taskboard2-types';

/** 不依赖任何其它包的服务（`yaml` 与 Node 内置不算"服务"）。 */
export const inject = [];

/** Cordis `Context` 里本包用到的部分（结构化声明，避免引入类型依赖）。 */
type ProvideContext = {
	provide(name: string, value: unknown): void;
};

/**
 * 包壳。
 *
 * **顺序固定：先注册模板、再 `provide`。**
 *   - 先注册 ⇒ `inject` 了本包的 ⑦ / ⑧ 一启动模板就已经在了（不用等第二次交互）；
 *   - 但**注册必须包 try/catch**：否则注册抛错会跳过 `provide` ⇒ ⑦⑧ 永不启动
 *     ⇒ 用户要的「他出错了，core 可以继续开」直接落空。
 *
 * 失败只打日志、不抛（用户 `14:50`「core 可以继续开」「可以展示，没有行为」）。
 */
export function apply(ctx: ProvideContext): void {
	/*
	 * ① 加载模板。
	 *
	 * `loadTemplates` 设计上不抛（逐个收集失败），但**扫目录本身可能抛**
	 * （权限、路径异常等）⇒ 外层再包一层，保证 `provide` 一定执行。
	 */
	try {
		const result = loadTemplates();
		if (result.failures.length > 0) {
			console.error(
				`[taskboard2-types] 模板加载有 ${result.failures.length} 处失败（降级运行，已注册 ${result.registered.length} 个）：`,
			);
			for (const issue of result.failures) {
				console.error(`  · [${issue.code}] ${issue.message}`);
			}
		}
	} catch (error) {
		console.error(
			'[taskboard2-types] 模板加载异常（继续启动，模板不可用）：',
			error instanceof Error ? error.message : String(error),
		);
	}

	/*
	 * ② provide。
	 *
	 * **必须在加载之后**执行，但也**不能被加载的异常跳过** ⇒ 所以加载包了 try/catch。
	 */
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
		/* 子任务过滤（⑦ 的转移闸复用，策略只在此一处） */
		liveChildren,
		canTransition,
		deriveStatus,
		/* 模板（③ 自己加载；⑦⑧ 只读查询） */
		registerTemplate,
		markTemplateRegistryReady,
		isTemplateRegistryReady,
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

/* ─────────────────────────── 模板加载（I/O 在这一条链上） ─────────────────────────── */

export {
	loadTemplates,
	findTemplatesDir,
	type LoadTemplatesOptions,
	type LoadTemplatesResult,
	type TemplateIssue,
	type TemplateIssueCode,
};

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
	liveChildren,
	/* template */
	type SectionDef,
	type TemplateDef,
	type DeriveDef,
	type ResolvedTemplate,
	type SectionInfo,
	type TemplateMeta,
	registerTemplate,
	resetTemplateRegistry,
	markTemplateRegistryReady,
	isTemplateRegistryReady,
	templateCount,
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
