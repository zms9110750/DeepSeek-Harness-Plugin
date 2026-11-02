/**
 * ② action —— 类型定义。
 *
 * ② 是第 0 层、零依赖：不认识模板 / 章节 / 状态 / 卡片 / 存储。
 * 只认识两样输入：`payload`（一份 `{ $type, ... }`）与 `phase`（渲染态）。
 *
 * **schema 只在「创建」时校验参数合法性。**
 * 运行中不校验 schema —— 可以有额外字段，只要渲染器看得懂。
 */

import type { Node } from './nodes.js';

/* ─────────────────────────────────────────────────────────────
 * schema（JSON Schema 子集）
 * ───────────────────────────────────────────────────────────── */

/** 支持的 schema 类型。 */
export type SchemaType = 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null';

/**
 * 一个 schema 节点。
 *
 * **只实现实际用到的关键字**：
 * `type` / `properties` / `required` / `items` / `minItems` / `const` / `enum`。
 * `additionalProperties` 不实现 —— 裁决为放宽（等价于 JSON Schema 默认 `true`），永不产生拒绝。
 *
 * **它描述的是「创建时参数应该长什么样」，不是「运行中必须一直符合」。**
 * 渲染器需要处理的字段写在这里，供未来的开发者参考；运行中多出的字段一律不管。
 */
export interface SchemaNode {
	readonly type?: SchemaType;
	readonly properties?: Readonly<Record<string, SchemaNode>>;
	readonly required?: readonly string[];
	readonly items?: SchemaNode;
	readonly minItems?: number;
	readonly const?: unknown;
	readonly enum?: readonly unknown[];
	/** 仅用于人类阅读与 issue 文案，不参与校验。 */
	readonly description?: string;
}

/* ─────────────────────────────────────────────────────────────
 * payload
 * ───────────────────────────────────────────────────────────── */

/**
 * 一份 payload。
 *
 * 最外层必须是 object（用户 02:35：「json架构必须是object最外层。因为元数据是必须要的」），
 * `$type` 必填 —— 工具侧无法按字段形状判别是哪个 action。
 */
export interface ActionPayload {
	readonly $type: string;
	readonly [key: string]: unknown;
}

/* ─────────────────────────────────────────────────────────────
 * 校验结果
 * ───────────────────────────────────────────────────────────── */

/** 校验层级。`L3` 已作废（用户 07:00 驳回「章节内容填齐」），永不复用该编号。 */
export type IssueLevel = 'L1' | 'L2' | 'template';

/** 问题代码。 */
export type IssueCode =
	/* L1 结构 / 存在性 */
	| 'INVALID_PAYLOAD'
	| 'MISSING_TYPE'
	| 'UNKNOWN_TYPE'
	/* L2 字段形状 */
	| 'INVALID_FIELD'
	/* template 层：payload 与模板章节清单的关系 */
	| 'MISSING_SECTION'
	| 'SECTION_NOT_IN_TEMPLATE';

/**
 * 一条校验问题。
 *
 * 无 `severity` 字段：`SECTION_NOT_IN_TEMPLATE` 升 error 后没有任何 `warning` 级 code，
 * 留着会变成"永不可能出现的值"。
 */
export interface Issue {
	readonly level: IssueLevel;
	readonly code: IssueCode;
	/** 章节 id（不透明字符串）。单章校验且调用方没给时为 `''`。 */
	readonly sectionId: string;
	/** 机器可读字段名，如 `multi_select`。 */
	readonly field?: string;
	/** 人读路径，如 `items[2].options`。只给人看，不作稳定键。 */
	readonly path?: string;
	/** 给 ⑨ 转述给模型的诊断文本。**⑩ 不可见**（见 `IssueForUI`）。 */
	readonly diagnostic?: string;
}

/** 给 ⑩ 的投影：**丢弃 `diagnostic`**（真正删除，不是类型收窄）。 */
export interface IssueForUI {
	readonly level: IssueLevel;
	readonly code: IssueCode;
	readonly sectionId: string;
	readonly field?: string;
	readonly path?: string;
}

export interface ValidateResult {
	/** `issues.length === 0`。 */
	readonly ok: boolean;
	readonly issues: readonly Issue[];
}

/* ─────────────────────────────────────────────────────────────
 * 校验入参
 * ───────────────────────────────────────────────────────────── */

export interface ValidateOptions {
	/** 章节 id，只用于把问题定位回章节。 */
	readonly sectionId?: string;
}

/** `validateForCreate` 需要的章节规格（由 ⑧ 从 ③ 的清单转来）。 */
export interface SectionSpec {
	readonly id: string;
}

/* ─────────────────────────────────────────────────────────────
 * 渲染器
 * ───────────────────────────────────────────────────────────── */

/**
 * 渲染态。
 *
 * - `create` —— 创建：只有"定义"可编辑（如 text 的灰色字），内容不由用户填
 * - `active` —— 进行：内容可编辑
 * - `ended`  —— 终结：只读，且允许刮取（选中复制由 CSS/组件负责，不是节点字段）
 * - `plain`  —— 纯文本：给 AI tool / 指令调用，返回字符串，不是节点
 */
export type RenderPhase = 'create' | 'active' | 'ended' | 'plain';

/**
 * 渲染器。
 *
 * **四态都收 `onChange`** —— 只读态可以不用它。
 * **返回值**：`plain` 返回 `string`，其余三态返回 `Node`。
 */
export type Renderer = (
	payload: unknown,
	onChange: (next: ActionPayload) => void,
) => Node | string;

/** 一个 action 的注册定义。 */
export interface ActionDefinition {
	/** 稳定标识，如 `text`。注册后不可复用、不可覆盖。 */
	readonly $type: string;
	/** 给 AI 看的一句话：这个 action 能提供什么输入能力。 */
	readonly summary: string;
	/** JSON Schema —— **只描述创建时参数长什么样**。 */
	readonly schema: SchemaNode;
	/**
	 * 态 → 渲染函数 的字典。
	 *
	 * 只写关心的态即可；缺的态按 `create → active → ended → plain` 顺序回退。
	 */
	readonly render: Partial<Record<RenderPhase, Renderer>>;
}

/* ─────────────────────────────────────────────────────────────
 * 声明 / 答案
 * ───────────────────────────────────────────────────────────── */

/** `splitPayload` 的产物。 */
export interface SplitPayload {
	/** 去掉所有答案字段后的结构（含 `$type`、`items` 长度与顺序、每个 item 除答案外的字段）。 */
	readonly declaration: unknown;
	/** 按 `items` 顺序排列的答案值。 */
	readonly answer: readonly unknown[];
}
