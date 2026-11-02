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
 * 主体（**身份**）。「谁在做这件事」。
 *
 * 用户与 AI 权限不同（`【用户指令，2026-11-01 07:00】`「用户可以释放。用户权限和 ai 权限是不同的。」），
 * 所以释放等动作要能区分"某个 agent 消息循环"与"用户"。
 *
 * `agentMessageLoop.id` 是 **agent 消息循环 id**（`【用户指令，2026-11-02 13:30】`
 * 「loop 也要改名……agentMessageLoop」）。它会被序列化进 `claimedBy`
 * （`'user'` / `'agentMessageLoop:<id>'`）—— **领取是消息循环级别的**。
 *
 * ⚠ **与 `Actor` 是两个不同的东西，不做映射**（`【用户指令，2026-11-02 14:05】`
 * 「除非把这两个语义进行了绑定或者就是一个语义。否则各用各的不要映射。」
 * 「我更加希望他们是两个名字。这是两个不同的东西。领取是消息循环级别的。权限是 ai 这个类别的。」）。
 * ⇒ 调用方（⑧）**同时**给出 `principal` 与 `actor`；⑦ 不推断、不转换。
 */
export type Principal = { type: 'user' } | { type: 'agentMessageLoop'; id: string };

/**
 * 权限类别（**③ 的 `Actor` 同值**）。「这件事属于哪一类权限」。
 *
 * `【用户指令，2026-11-02 14:05】`「任务版领取用 ai 消息循环。这里的权限问题使用 ai 这个名字。」
 * ⇒ 权限层用 `'ai'`，**不用** `'agentMessageLoop'`。
 *
 * ⚠ 与 `Principal` **不是同一个语义**，也**不做映射函数**：
 * 两者名字不同、编译后的 JS 里两个字符串都在。
 */
export type Actor = 'user' | 'ai' | 'host';

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
	| { kind: 'relations-invalid'; issues: readonly RelationIssue[] }
	/**
	 * ③ 的 `canTransition` 判否。
	 *
	 * ⚠ **不用于"同值"**：目标状态 === 当前状态时**不是拒绝**，而是**成功 + 空计划**
	 * （`【用户指令，2026-11-02 12:35】`「不切是必要的。因为状态转移会在"历史"里面留下一个记录」）。
	 */
	| { kind: 'transition-not-allowed' }
	/** agent 成功闸 1：没有「成功」的「交付」子任务。 */
	| { kind: 'no-success-delivery' }
	/**
	 * agent 成功闸 2：直接子任务未全部处于「完成」组。
	 *
	 * `children` **必须带 `{ id, status }`** ——
	 * `【用户指令，2026-11-02 13:50】`「报错。作为工具返回值。说为什么，哪一个子任务导致的。」
	 * ⑦ 只给数据，**文案由 ⑧ 查表转**。
	 */
	| {
			kind: 'children-not-completed';
			children: readonly { id: CardId; status: TaskState }[];
	  }
	/** agent 失败闸：没有「失败」的「交付」或「阻碍」子任务。 */
	| { kind: 'no-failed-evidence' }
	/**
	 * agent 成功闸 3：**依赖对象没有全部进入「完成」组**。
	 *
	 * 矩阵 154/165 行的"依赖的对象都为`完成`"。**这条 ③ 不覆盖**（它的 `DEPENDS_ON_GATE`
	 * 只管「提交 → 处理中」）⇒ 由 ⑦ 的 `planTransition` 自己判。
	 * `depsAllEnded` 缺失时**同样拒**（fail-closed：不知道 ≠ 满足）。
	 */
	| { kind: 'deps-not-ended' };

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

/**
 * 转移判决所需的外部事实。**按需提供**（③ 只在真正用到某字段的分支才 require 它）。
 *
 * · `depsAllEnded`：依赖目标是否全部处于「完成」组。只被「工作：提交 → 处理中」用到。
 * · `actorHasActiveWork`：该 actor 名下是否已有「处理中的工作」卡。同上。
 *
 * ⚠ ⑦ **不编造**这两个值：用不到时整个 `ctx` 都不传（采纳 / 释放等）。
 */
export interface TransitionCtx {
	readonly depsAllEnded: boolean;
	readonly actorHasActiveWork: boolean;
}

/**
 * 子任务快照（与 ③ 的 `ChildSnapshot` 同形）。
 *
 * ⑦ 用它把 `Card` 投影成 ③ 能吃的形状，再交给 **③ 导出的 `liveChildren`** 做过滤 ——
 * 「滤墓碑 + 滤草稿」这条**策略只活在 ③ 一处**，⑦ 不复制。
 *
 * ⚠ 形状必须与 ③ 的 `ChildSnapshot` **逐字段一致**（结构类型"能多不能少"）：
 * 字段名对不上就编译报错，**这正是我们要的**。
 */
export interface ChildSnapshot {
	readonly id: string;
	readonly kind: Kind;
	/** 模板 ref（= `card.template.ref`）。 */
	readonly template: string;
	readonly status: TaskState;
	readonly deleted: boolean;
}

/** ③ types 的服务面（⑦ 用到的子集）。 */
export interface TypesPort {
	/** 九态常量表。 */
	readonly states: StatesTable;
	/** 草稿态常量：`states.UNSPECIFIED`（单独给出便于判定式读起来像一句话）。 */
	readonly DRAFT: TaskState;
	/** 建卡时的初始状态（按分类）。 */
	initialStatus(kind: Kind): TaskState;
	/**
	 * 转移判决（⑦ 不自己判，只转问）。
	 *
	 * `actor` 是**权限类别**（`'user' | 'ai' | 'host'`），**不是** `Principal`。
	 * 调用方（⑧）自己知道"这个消息循环属于 ai 权限"并把两者分别给出 —— ⑦ 不映射。
	 *
	 * `ctx` **按需**：③ 只在真正用到某个事实的分支才 require 它，用不到的分支可以不传。
	 * 已传就必须是完整对象（两个字段都是 boolean），不许只给一半。
	 */
	canTransition(
		kind: Kind,
		from: TaskState,
		to: TaskState,
		actor: Actor,
		ctx?: TransitionCtx,
	): boolean;
	/** 是否属于「完成」组（成功 / 失败 / 取消 / 拒绝）。⑦ 不写状态字面量，只调它。 */
	isCompletedGroup(status: TaskState): boolean;
	/**
	 * 子任务过滤：**滤墓碑、滤草稿**。
	 *
	 * ⚠ **策略只有 ③ 这一份**（`kind.ts` 里带跨包警告）。⑦ **不复制**它 ——
	 * ⑦ 只做 `Card → ChildSnapshot` 的**纯字段投影**（`toChildSnapshot`），
	 * 投影必然是机械的、不可能出现第二版口径。
	 */
	liveChildren(children: readonly ChildSnapshot[]): readonly ChildSnapshot[];
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
