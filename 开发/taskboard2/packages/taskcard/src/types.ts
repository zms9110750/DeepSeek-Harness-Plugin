/**
 * ⑦ 任务卡 —— 类型与跨包契约。
 *
 * 本文件同时承担两件事：
 *
 *   1. **卡的形状**（`Card`）—— 本包拥有，见 `docs/07-taskcard.md` §2.1。
 *   2. **所依赖服务的结构契约**（`TypesPort` / `RelationPort` / `ActionPort`）。
 *
 * 为什么依赖用"结构接口"而不是 `import type { … } from '@local/taskboard2-types'`：
 *   · 包级依赖只应是**运行时 inject**，编译期不该把本包焊死在某一份 `.d.ts` 上；
 *   · 结构类型让 ③④② 的实现**天然兼容**（它们只需多些成员），本包不需要跟着改。
 *
 * ⚠ 本包**不 import 任何其它包的运行时值**（只有 `import type` 都不需要）。
 */

/** 卡的编号。不透明字符串 —— ⑦ 不解析格式、不从它反推任何东西。 */
export type CardId = string;

/**
 * 九态之一（A2A 全名，如 `'TASK_STATE_WORKING'`）。
 *
 * ⚠ 故意是 `string`：**状态字面量只有一个来源（③）**，⑦ 不得书写状态字符串字面量
 * （`docs/07-taskcard.md` §3.7 第 23 条，配套两条 lint）。
 */
export type TaskState = string;

/** 分类英文 id。由 ③ 拥有，⑦ 不写死字面量。 */
export type Kind = string;

/** 关系标签。由 ④ 的词汇表拥有。 */
export type LinkLabel = string;

/** 一条关系边。 */
export interface RelationEntry {
	label: LinkLabel;
	to: CardId;
}

/**
 * 一份关系集合的**结构**。
 *
 * 权威定义在 ④（带品牌、只能由 `validateRelations` 产出）。这里只声明结构，
 * 因此 ④ 的品牌值可以赋给本类型（结构超集）；反向需要 ④ 自己的收口函数。
 */
export interface Relations {
	/** 父卡编号；顶层用 `''`（不用 `null`、不用缺字段，`docs` §3.1 第 1 条）。 */
	parent: CardId | '';
	links: RelationEntry[];
}

/** 卡上的模板实例快照。**创建即固定、终身不变**（§2.3 不变量 3）。 */
export interface TemplateRef {
	/** ③ 的模板稳定引用；**其值就是模板 `name`**（`resolve(ref)` 与 `resolve(name)` 同一调用）。 */
	ref: string;
	/** 分类英文 id。 */
	kind: Kind;
	/**
	 * 领域。**快照字段**（`【用户指令，2026-11-02 00:23】`「template 要有领域的」）。
	 * 纯展示：不校验语言、不建注册表；卡上存它是为了**按领域筛选**（不回查模板，因为模板可改版）。
	 */
	domain: string;
}

/** 历史条目。`action` 是**封闭的机器可读标识**（英文），不是文案（§3.1 第 2 条）。 */
export interface HistoryEntry {
	/** 毫秒时间戳。由 ⑧ 在事务内盖；⑦ 不取时钟。 */
	at: number;
	action: string;
	detail?: unknown;
}

/** 一张任务卡。必须项恰好 5 个：`id` / `title` / `relations` / `template` / `status`。 */
export interface Card {
	id: CardId;
	title: string;
	status: TaskState;
	template: TemplateRef;
	relations: Relations;
	/** `{ [sectionId]: payload }` 单层映射；**⑦ 零参与校验，只整体透传**。 */
	sections: Record<string, unknown>;
	/** 追加项。**永远可写，不随采纳清空**。 */
	note: string;
	/** 追加项，只读。 */
	history: HistoryEntry[];
	/** 墓碑标记（独立字段，不是状态值）。仅草稿期可为 `true`。 */
	deleted: boolean;
	/** 当前占用者 = **消息循环 id**（不是会话 id）；`''` = 无。语义 = "谁在占用"，非"谁有权释放"。 */
	claimedBy: string;
	/** 占用起始时间；与 `claimedBy` 同生同灭。 */
	claimedAt: number;
}

// ─────────────────────────────────────────────────────────────
// 主体
// ─────────────────────────────────────────────────────────────

/**
 * 主体。
 *
 * 用户与 AI 权限不同（`【用户指令，2026-11-01 07:00】`「用户可以释放。用户权限和 ai 权限是不同的。」），
 * 所以释放等动作要能区分"某个循环"与"用户"。`loop.id` 是**消息循环 id**。
 */
export type Principal = { type: 'user' } | { type: 'loop'; id: string };

// ─────────────────────────────────────────────────────────────
// 因果依据 / 计划项 / 拒绝原因（纯数据，非文案；⑧ 查表转文案）
// ─────────────────────────────────────────────────────────────

/** 取代 / 级联的因果依据。⑦ 产出、⑧ 落历史。 */
export type Reason =
	/** 取代边（`from` = 新卡，`to` = 旧卡）。方向写死"新 → 旧"。 */
	| { kind: 'supersede'; edge: { from: CardId; to: CardId } }
	/** 旧卡不在「完成」组 ⇒ 转取消。 */
	| { kind: 'superseded-incomplete' }
	/** 旧卡已在「完成」组 ⇒ 不动。 */
	| { kind: 'superseded-noop' }
	/** 用户强制释放（持有者已消失）。 */
	| { kind: 'force-release'; previousHolder: string }
	/** 被级联命中的路径。同一张卡可能同时命中多条（去重键 = (kind, 依据)）。 */
	| { kind: 'path-hit'; via: 'parent' | { label: LinkLabel; from: CardId } };

/** ⑧ 要执行的一条最小动作。 */
export type PlanItem =
	| { op: 'createCard'; card: Card }
	| { op: 'updateCard'; card: Card }
	| { op: 'appendHistory'; cardId: CardId; entry: HistoryEntry }
	/**
	 * 改状态。`reason` **只在"因为别的事被动改"时给**（取代 / 级联）；
	 * 由本卡自身发起的转移（采纳 / 领取 / 释放）**不带 reason** —— 它的动因在 `events` 里。
	 */
	| { op: 'setStatus'; cardId: CardId; to: TaskState; reason?: Reason }
	| { op: 'setRelations'; cardId: CardId; relations: Relations }
	| { op: 'releaseClaim'; cardId: CardId };

/** 一份可执行的计划。⑦ 只产出，不执行、不写盘。 */
export interface Plan {
	ok: true;
	items: PlanItem[];
	/** 需要 ⑧ 补写的历史事件（便于 ⑧ 统一在事务内落盘）。 */
	events: HistoryEntry[];
}

/** 拒绝原因。封闭枚举；⑧ 查表转文案，**不写 `if reason.kind`**。 */
export type RejectReason =
	/** 已冻结（`status !== DRAFT`）时试图改非 `note` 字段。 */
	| { kind: 'frozen'; field: 'title' | 'template' | 'relations' | 'sections' }
	/** 草稿期删掉了已有 `sectionId` 键。 */
	| { kind: 'section-key-removed'; sectionIds: string[] }
	/** 已冻结时改动了 `sections` 的声明部分（答案可改，声明不可改）。 */
	| { kind: 'declaration-changed'; sectionIds: string[] }
	| { kind: 'already-deleted' }
	/** 需要草稿态但当前不是。 */
	| { kind: 'not-draft' }
	/** 需要非草稿态（fork / 采纳）但当前是草稿。 */
	| { kind: 'is-draft'; action: 'fork' | 'adopt' }
	| { kind: 'not-claimable'; why: 'already-claimed' | 'not-submitted' | 'quota-exhausted' }
	| { kind: 'not-releasable'; why: 'not-working' | 'not-holder' }
	| { kind: 'template-missing'; ref: string }
	| { kind: 'template-registry-unavailable' }
	| { kind: 'relations-invalid'; issues: readonly RelationIssue[] };

/** 拒绝结果。 */
export interface Rejection {
	ok: false;
	reason: RejectReason;
}

/** 任一结果。 */
export type PlanResult = Plan | Rejection;

/** 关系校验问题（形状与 ④ 的 `Issue` 对齐；⑦ 只搬运、不解释）。 */
export interface RelationIssue {
	kind: 'link' | 'parent';
	index?: number;
	to?: string;
	reason: string;
}

// ─────────────────────────────────────────────────────────────
// 对外服务的结构契约（③④② 实现，⑦ 通过 inject 消费）
// ─────────────────────────────────────────────────────────────

/** 九态常量表（③ 的 `TaskState`）。⑦ 用它取状态值，**从不写字面量**。 */
export interface StatesTable {
	readonly UNSPECIFIED: TaskState;
	readonly SUBMITTED: TaskState;
	readonly WORKING: TaskState;
	readonly INPUT_REQUIRED: TaskState;
	readonly AUTH_REQUIRED: TaskState;
	readonly COMPLETED: TaskState;
	readonly FAILED: TaskState;
	readonly CANCELED: TaskState;
	readonly REJECTED: TaskState;
}

/** ③ types 的服务面（⑦ 用到的子集）。 */
export interface TypesPort {
	/** 九态常量表。 */
	readonly states: StatesTable;
	/** 草稿态常量：`states.UNSPECIFIED`（单独给出便于判定式读起来像一句话）。 */
	readonly DRAFT: TaskState;
	/** 建卡时的初始状态（按分类）。 */
	initialStatus(kind: Kind): TaskState;
	/** 转移判决（⑦ 不自己判，只转问）。 */
	canTransition(kind: Kind, from: TaskState, to: TaskState, actor: Principal, ctx?: unknown): boolean;
	/** 是否属于「完成」组（成功 / 失败 / 取消 / 拒绝）。⑦ 不写状态字面量，只调它。 */
	isCompletedGroup(status: TaskState): boolean;
	/**
	 * 模板解析。
	 * · **未命中 ⇒ `undefined`**（数据问题 ⇒ ⑦ fail-closed 拒绝建卡）
	 * · **注册表未初始化 ⇒ 抛错**（时序问题 ⇒ ⑦ 原样上抛，不当作"模板不存在"）
	 */
	resolve(name: string): ResolvedTemplate | undefined;
}

/** `resolve` 的命中结果。 */
export interface ResolvedTemplate {
	name: string;
	kind: Kind;
	domain: string;
	codePrefix: string;
	sections: readonly TemplateSection[];
}

/**
 * 模板里的一章。**⑦ 只用到 `id`**。
 *
 * ⚠ 这里**故意只有 `id`**：
 * · `accepts` 已由 ③ 彻底移除（`sectionsOf` 不再返回它）⇒ 若这里还留着，运行时会是
 *   `undefined`，而**结构类型多一个字段不会编译报错** —— 正是"编译过、运行时错"那类。
 * · ③ 的 `sectionsOf` 现在带 `default?`，但**⑦ 不需要**：`default` 是补空 payload 的原料，
 *   由 ⑧ 自己从 ③ 拿；⑦ 只负责把"缺哪几章"告诉 ⑧。
 */
export interface TemplateSection {
	id: string;
}

/** ④ relation 的服务面（⑦ 用到的子集）。 */
export interface RelationPort {
	/** 形状 + 词汇校验并定型。 */
	validateRelations(input: unknown): RelationValidateResult;
	/** 在 `current` 之上应用一次变更（内部固定三步：先校验 `current`）。 */
	applyRelationsChange(current: unknown, change: RelationsChange): RelationValidateResult;
	/** 词汇表（⑦ 只做透传，不读它做任何判定 —— 语义判定归 ④）。 */
	readonly LINK_KINDS: readonly LinkKind[];
}

/** 关系校验结果（与 ④ 的返回对齐）。 */
export type RelationValidateResult =
	| { ok: true; value: Relations }
	| { ok: false; issues: readonly RelationIssue[] };

/**
 * 词汇表条目。**与 ④ 的 `LINK_KINDS` 完全一致**（结构类型"能多不能少"，
 * 所以这里不保留任何 ④ 没有的字段 —— 曾经有过 `editable`，已随用户 13:18
 * "取代也可编辑"而删除）。
 */
export interface LinkKind {
	id: LinkLabel;
	/** 显示名。中文只在展示层用；⑦ **不消费**它，只为与 ④ 的结构对齐。 */
	displayName: string;
	/** 方向。`related` 是唯一的双向；⑦ 只透传，不做语义判断。 */
	direction: 'forward' | 'both';
	/** 是否作为状态转移的准入条件（只有「依赖」为真；判据见 docs §6.6.1）。 */
	hasBehavior: boolean;
}

/** 关系变更的两种来源。 */
export type RelationsChange =
	/** 用户 / AI 提交的完整可编辑视图。 */
	| { kind: 'edit'; value: Relations }
	/** 计划项式最小操作（④ 的级联计划）。 */
	| { kind: 'patch'; patches: readonly RelationPatch[] };

/** 一条最小关系操作。判别式联合：以后加 `op` 不破坏签名。 */
export type RelationPatch = {
	op: 'retargetLink';
	/** 原目标（被改的那条边的 `to`）。 */
	from: CardId;
	/** 新目标。 */
	to: CardId;
	label: LinkLabel;
};

/** ② action 的服务面（⑦ **只调** `isDeclarationOnlyChange`）。 */
export interface ActionPort {
	/**
	 * 真 = 只改了答案；假 = 动了声明（含元素增删、顺序变化）。
	 * 唯一出参是布尔，不存在 diff 重载 —— ⑦ 拿不到字段名，也就不会去理解字段语义。
	 */
	isDeclarationOnlyChange(prev: unknown, next: unknown): boolean;
}

/** ⑦ 依赖的三个服务。 */
export interface Ports {
	types: TypesPort;
	relation: RelationPort;
	action: ActionPort;
}
