/**
 * ② action —— Cordis 入口。
 *
 * 两个服务：
 *   `taskboard2Actions`   —— 校验面（⑦⑧⑨ 用）
 *   `taskboard2Renderer`  —— 渲染面（⑩ 用）
 *
 * 拆开服务的原因：⑩ 拿不到 `validateForEdit`，就 structurally 拿不到含 `diagnostic` 的 `Issue`
 * —— 把"中文诊断不出 ②"从约定变成接口事实。
 *
 * `inject = []`：② 是第 0 层，不认识任何其它包。
 * **模块顶层无副作用**：内置 action 只在 `apply` 内注册 —— ⑦ 会静态 import ② 的类型，
 * 顶层若有调用语句，它会在 ⑦ 加载时提前执行。
 */

import { askAction, askEditable, askEnded, askPlain } from './builtin/ask.js';
import { markdownAction, markdownCreate, markdownPlain, markdownView } from './builtin/markdown.js';
import { textAction, textActive, textCreate, textEnded, textPlain } from './builtin/text.js';
import { emptyPayloadFor } from './empty.js';
import { toIssueForUI } from './issue.js';
import { registerAction, list } from './registry.js';
import { NodeTypes, render } from './render.js';
import {
	hasUserContent,
	isDeclarationOnlyChange,
	isEmptyForValidity,
	splitPayload,
} from './split.js';
import { validateForCreate, validateForEdit } from './validate.js';
import type { ActionDefinition } from './types.js';

export const name = 'taskboard2-action';

/** 零依赖 —— ② 不 inject 任何东西。 */
export const inject: string[] = [];

/**
 * 9 个具名渲染函数 —— 与 `templates/actions/*.yaml` 的 `renderer:` 名字一一对应。
 *
 * ⚠ 它们不是给 inject 方用的：调用方应该用任务板服务面的 `render(payload, phase)`，
 *   它会按 `$type` 查表、按态回退、并做降级。这些导出只是「YAML 里的名字确实存在」的锚点。
 *
 * 共用关系是有意的，不要拆：
 *   · `markdown` 的 `active` / `ended` 共用 `markdownView`
 *   · `ask` 的 `create` / `active` 共用 `askEditable`
 */
export {
	textCreate,
	textActive,
	textEnded,
	textPlain,
	markdownCreate,
	markdownView,
	markdownPlain,
	askEditable,
	askEnded,
	askPlain,
};

/** 内置 action（在 `apply` 内注册，不在此处注册）。 */
const BUILTINS: readonly ActionDefinition[] = [textAction, askAction, markdownAction];

/** Cordis 上下文的最小形状（② 只用到这两个方法）。 */
interface ApplyContext {
	provide(serviceName: string, api: unknown): void;
	effect?(run: () => (() => void) | void, label?: string): void;
}

export function apply(ctx: ApplyContext): void {
	/* 内置 action 的注册与注销都在 effect 内（Cordis 要求资源在 effect 中持有）。
	 * 先注册、后 provide —— 避免"服务已存在但内置 action 还没注册"的窗口。 */
	const registerBuiltins = (): (() => void) => {
		const disposers = BUILTINS.map((builtin) => registerAction(builtin));
		return () => {
			for (const dispose of disposers) dispose();
		};
	};

	if (typeof ctx.effect === 'function') {
		const effect = ctx.effect.bind(ctx);
		effect(registerBuiltins, 'taskboard2-action: 内置 action');
	} else {
		registerBuiltins();
	}

	/* ── 校验面 —— ⑦⑧⑨ ── */
	const actionsApi = {
		validateForEdit,
		validateForCreate,
		isDeclarationOnlyChange,
		toIssueForUI,
		registerAction,
		list,
		splitPayload,
		emptyPayloadFor,
		isEmptyForValidity,
		hasUserContent,
	};

	/* ── 渲染面 —— ⑩（只有渲染，没有任何校验方法） ── */
	const rendererApi = {
		render,
		NodeTypes,
	};

	ctx.provide('taskboard2Actions', actionsApi);
	ctx.provide('taskboard2Renderer', rendererApi);
}

export type {
	ActionDefinition,
	ActionPayload,
	Issue,
	IssueCode,
	IssueForUI,
	IssueLevel,
	Renderer,
	RenderPhase,
	SectionSpec,
	SplitPayload,
	ValidateOptions,
	ValidateResult,
} from './types.js';

export type {
	BrokenNode,
	ElementNode,
	FragmentNode,
	MdNode,
	Node,
	RawNode,
	TextNode,
	UnregisteredNode,
} from './nodes.js';
