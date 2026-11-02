/**
 * ⑧ core —— 上游服务的结构契约 + 卡的最小形状。
 *
 * ## 为什么用结构类型而不是 `import type` 整个包
 *
 * 与 ⑦ 同一理由：包级依赖应当是**运行时 inject**，编译期不该把本包焊死在某一份 `.d.ts` 上。
 * 结构类型让实现方天然兼容（它们只需多出成员），本包不需要跟着改。
 *
 * **并且**：`@local/*` 在编译期没有 `node_modules` 可解析
 * ⇒ 一旦 `import type { Card } from '@local/taskboard2-taskcard'`，本包就**编译不过**。
 * ⇒ **本包零 `@local/*` import**，卡与模板的形状在这里按结构声明。
 *
 * ## ⚠ 这里每个成员都对应一处"上游必须提供"的契约
 *
 * 契约不一致时**不要在本包里加适配别名** —— 那会让"服务名是契约"失效。
 * 缺什么就在这里显式写出来，让编译期/启动期立刻报，而不是运行时才发现。
 *
 * 标注：
 *   【必需】— 缺了本包跑不起来
 *   【可选】— 缺了本包能跑，但某项能力降级（必须显式判 `undefined`，不得默认值）
 */

/* ─────────────────────────────────────────────────────────────
 * 卡的最小形状（结构，不 import ⑦）
 * ───────────────────────────────────────────────────────────── */

/** 一条关系边。 */
export interface RelationEntry {
	readonly label: string;
	readonly to: string;
}

/** 关系集合。`parent === ''` 表示顶层（不用 `null`、不用缺字段）。 */
export interface Relations {
	readonly parent: string;
	readonly links: readonly RelationEntry[];
}

/** 模板实例快照。**创建即固定、终身不变**。 */
export interface TemplateRef {
	/** ③ 的模板稳定引用（值 = 模板 `name`）。 */
	readonly ref: string;
	/** 分类英文 id。 */
	readonly kind: string;
	/** 领域快照（建卡那一刻的值，此后不回查模板）。 */
	readonly domain: string;
}

/** 一条历史。`action` 是封闭的机器可读标识，不是文案。 */
export interface HistoryEntry {
	readonly at: number;
	readonly action: string;
	readonly detail?: unknown;
}

/* ─────────────────────────────────────────────────────────────
 * 卡（⑦ 拥有，⑧ 只按结构消费）
 * ───────────────────────────────────────────────────────────── */

/**
 * 卡上的一个章节：**名字副本 + payload**。
 *
 * `【用户指令，2026-11-02 14:47】`：
 * > 「是的，任务卡要存一个章节名字的副本。以防止万一。因为考虑领域类模板是mod携带的。
 * >   就可能关闭mod而无法加载模板。**任务卡必须在无模板的情况下正常显示。**」
 *
 * ⇒ `label` 是**建卡那一刻从模板抄下来的副本**，此后**不回查模板**（与 `template.domain` 同理）。
 * ⇒ 模板被卸载 / mod 被关掉 ⇒ 卡照样能显示（只是没有行为，见降级模式）。
 */
export interface CardSection {
	/** 章节名（模板 `sections[].label` 的副本，中文显示名）。 */
	readonly label: string;
	/** 该章的 payload（② 拥有语义，⑧ 只搬运）。 */
	readonly payload: unknown;
}

/** 一张任务卡（⑦ 拥有，本包只按结构消费）。 */
export interface Card {
	readonly id: string;
	readonly title: string;
	readonly status: string;
	readonly template: TemplateRef;
	readonly relations: Relations;
	/** `{ [sectionId]: { label, payload } }` —— **label 是模板的副本，卡不依赖模板显示。** */
	readonly sections: Readonly<Record<string, CardSection>>;
	readonly note: string;
	readonly history: readonly HistoryEntry[];
	readonly deleted: boolean;
	/** 当前占用者（消息循环 id / `user`）；`''` = 无。 */
	readonly claimedBy: string;
	readonly claimedAt: number;
}

/* ─────────────────────────────────────────────────────────────
 * ① store
 * ───────────────────────────────────────────────────────────── */

/** 工作空间枚举项。 */
export interface WorkspaceEntry {
	readonly id: string;
	readonly archived: boolean;
}

/** 事务内受限句柄（`fn` 内只能用它；用 public 面会抛错）。 */
export interface Tx {
	readAll(): Card[];
	read(id: string): Card | undefined;
	write(cards: readonly Card[]): void;
	purgePhysical(ids: readonly string[]): void;
}

/** 全局键值。key 不透明、不做命名空间隔离。 */
export interface GlobalKv {
	get(key: string): unknown;
	set(key: string, value: unknown): void;
	delete(key: string): void;
}

/** ① 的服务面（本包用到的子集）。全同步。 */
export interface StorePort {
	readonly dir: string;
	readAll(wsId: string): Card[];
	read(wsId: string, id: string): Card | undefined;
	write(wsId: string, cards: readonly Card[]): void;
	purgePhysical(wsId: string, ids: readonly string[]): void;
	transaction<T>(wsId: string, fn: (tx: Tx) => T): T;
	listWorkspaces(includeArchived?: boolean): WorkspaceEntry[];
	dbPath(wsId: string, archived: boolean): string;
	archiveDb(wsId: string): void;
	unarchiveDb(wsId: string): void;
	readMeta(wsId: string): Record<string, unknown>;
	writeMetaKey(wsId: string, key: string, value: unknown): void;
	readonly globalKv: GlobalKv;
}

/* ─────────────────────────────────────────────────────────────
 * ② action
 * ───────────────────────────────────────────────────────────── */

/**
 * 章节规格（③ 的清单转来）。
 *
 * ⚠ **`accepts` 已彻底移除**（用户 11:26 裁决）：章节不再声明"接受哪些 action"。
 * 取而代之的是 **`default`** —— 该章初始化时的 payload（fork 补缺章用它）。
 */
export interface SectionSpec {
	readonly id: string;
	/** 章节名（中文显示名）。**建卡时抄进 `CardSection.label`**，卡此后不依赖模板。 */
	readonly label: string;
	/** 该章初始化时的 payload。**可能缺**（模板没写）⇒ 调用方必须显式处理"没有默认值"。 */
	readonly default?: unknown;
}

/** 校验问题的层级。`L3` 已作废，永不复用。 */
export type IssueLevel = 'L1' | 'L2' | 'template';

/** 校验问题（② 产出）。`diagnostic` 只给 ⑨，⑩ 走 `toIssueForUI`。 */
export interface Issue {
	readonly level: IssueLevel;
	readonly code: string;
	readonly sectionId: string;
	readonly field?: string;
	readonly path?: string;
	readonly diagnostic?: string;
}

/** 给 ⑩ 的投影（无 `diagnostic`）。 */
export interface IssueForUI {
	readonly level: IssueLevel;
	readonly code: string;
	readonly sectionId: string;
	readonly field?: string;
	readonly path?: string;
}

export interface ValidateResult {
	readonly ok: boolean;
	readonly issues: readonly Issue[];
}

/** ② 的服务面（本包用到的子集）。 */
export interface ActionsPort {
	validateForCreate(
		payloads: Readonly<Record<string, unknown>>,
		sections: readonly SectionSpec[],
	): ValidateResult;
	/**
	 * 编辑期校验（只跑 L1）。
	 *
	 * ⚠ **不再收 `accepts`**（用户 11:26 裁决：`accepts` 彻底移除）——
	 * 只剩 `sectionId`，用于把问题定位回章节。
	 */
	validateForEdit(payload: unknown, opts: { readonly sectionId?: string }): ValidateResult;
	toIssueForUI(issue: Issue): IssueForUI;
	/** 声明 / 答案切分；本包用它判 fork 丢弃的章节「有没有用户内容」。 */
	splitPayload(payload: unknown): { readonly declaration: unknown; readonly answer: readonly unknown[] };
	/** 用户表达视角的「有内容」（`ask.picked = []` 算有内容）。 */
	hasUserContent(payload: unknown): boolean;
}

/* ─────────────────────────────────────────────────────────────
 * ③ types
 * ───────────────────────────────────────────────────────────── */

/**
 * 九态常量表。**本包从不写状态字面量**，只从这里取。
 *
 * 名字叫 `TaskState` 而不是 `states`：**它是九态词表本身的名字**（A2A 协议里的名字），
 * 起别名会让「协议词汇单源」这条变模糊。③ 的 `provide` 键也是 `TaskState`。
 */
export interface StatesTable {
	readonly UNSPECIFIED: string;
	readonly SUBMITTED: string;
	readonly WORKING: string;
	readonly INPUT_REQUIRED: string;
	readonly AUTH_REQUIRED: string;
	readonly COMPLETED: string;
	readonly FAILED: string;
	readonly CANCELED: string;
	readonly REJECTED: string;
}

/** ③ 的模板解析结果（本包用到的子集）。 */
export interface ResolvedTemplate {
	readonly name: string;
	/** 中文显示名。**派生按钮拼标题要用它**（`label` 缺失时回落）。 */
	readonly displayName: string;
	readonly kind: string;
	readonly domain: string;
	readonly codePrefix: string;
	readonly sections: readonly SectionSpec[];
	/** 派生按钮（并列、有序）。`deriveDefaults` 用它拼建卡预填值。 */
	readonly derive?: readonly DeriveButton[];
}

/**
 * 一个派生按钮。
 *
 * 用户 11:26：按钮的行为**写死在代码里**（`create.ts` 的 `deriveDefaults`）：
 * 模板 = `template`、父任务 = 当前卡、标题 = `父标题-label`（`label` 缺 ⇒ `displayName`）。
 *
 * ⚠ **⑧ 仍需这个类型**（`deriveDefaults` 的入参）—— 虽然模板注册归了 ③，
 *   `derive` 数组的内容要由 ③ 在 `resolve` / `templateMeta` 里给出来。
 */
export interface DeriveButton {
	/** 指向的模板 `name`。 */
	readonly template: string;
	/** 按钮文字；**也是拼标题的后半段**。缺了就用模板的 `displayName`。 */
	readonly label?: string;
	/** 按钮悬浮描述（纯展示）。 */
	readonly description?: string;
}

/** 转移判决所需的外部事实。两个字段都必须由本包算好传入。 */
export interface TransitionCtx {
	readonly depsAllEnded: boolean;
	readonly actorHasActiveWork: boolean;
}

/** ③ 的服务面（本包用到的子集）。键名与 ③ 的 `provide('taskboard2Types', {…})` 逐项一致。 */
export interface TypesPort {
	/** 九态词表（③ 的 provide 键就叫 `TaskState`）。 */
	readonly TaskState: StatesTable;
	/** 草稿态常量（= `TaskState.UNSPECIFIED`）。 */
	readonly DRAFT: string;
	initialStatus(kind: string): string;
	canTransition(
		kind: string,
		from: string,
		to: string,
		actor: 'user' | 'ai' | 'host',
		ctx: TransitionCtx,
	): { readonly ok: boolean; readonly reason?: string };
	/** 是否「完成」组（成功 / 失败 / 取消 / 拒绝）。本包不写状态字面量。 */
	isEndedStatus(status: string): boolean;
	/** 是否「进行」组（提交 / 处理中）。 */
	isActiveStatus(status: string): boolean;
	resolve(ref: string): ResolvedTemplate | undefined;
	sectionsOf(ref: string): readonly SectionSpec[] | undefined;
	/**
	 * 模板注册表是否就绪（模板加载归 ③，`【用户指令，2026-11-02 14:50】`「他要去读yaml」）。
	 *
	 * ⑧ 用它决定走**降级模式**：未就绪 ⇒ 只能读卡、不能转移 / 建卡 / 级联
	 * （用户：「可以展示，没有行为，状态的切换按钮都不给。创建新卡没有模板选创建不了。」）。
	 *
	 * ⚠ 这与 `TEMPLATE_REGISTRY_NOT_READY` 不是一回事：
	 *   · 就绪 = 模板加载成功 ⇒ 一切正常；
	 *   · **未就绪但这是正常状态**（③ 加载失败但 ⑧ 仍可开）⇒ `TEMPLATES_UNAVAILABLE`；
	 *   · `TEMPLATE_REGISTRY_NOT_READY` 是**时序 bug**（⑧ 认为该就绪、③ 说没有）。
	 */
	isTemplateRegistryReady(): boolean;
	nextId(prefix: string, usedIds: readonly string[]): string;
	/** 转展示形（插连字符）。缺失时本包退回原样返回 —— 展示形只影响 UI，不影响身份。 */
	toDisplay?(id: string): string;
	/**
	 * 分类字母（编号前缀的第一段）。
	 *
	 * 用户模板只写 `codePrefix`（模板段），分类段由 ③ 从分类定义取。
	 * ⚠ **未注册分类时 ③ 会抛错**；`allocateId` 捕获并转成 `ID_PREFIX_UNAVAILABLE`（**不猜字母**）。
	 */
	kindLetter?(kind: string): string;
	/**
	 * 计算态求值：**每层只算一层**（只看该卡的直接子任务）。
	 *
	 * 递归由 ⑧ 在外层循环做（`recompute.ts` 的监听链）—— ③ 天然不递归。
	 * 规则全在 ③（`KIND_DEFS[*].computeRules` + `baseStatus`），**⑧ 不含任何规则判断**。
	 */
	deriveStatus(kind: string, input: RuleInput): string;
}

/**
 * ③ `deriveStatus` 的入参（结构形状）。
 *
 * ⚠ `children` = **完整子任务列表**（含墓碑 / 草稿 / 终态），**⑧ 不预先过滤**：
 * ③ 的 `liveChildren` 在每条规则里都滤过，**过滤动作只有那一处**。
 */
export interface RuleInput {
	readonly status: string;
	/** 是否被某 actor 持有（= `claimedBy` 非空）。**不是**"是否正在处理中"。 */
	readonly isHeld: boolean;
	readonly children: readonly ChildSnapshot[];
}

/**
 * 判定用的子任务快照（③ 的结构形状）。
 *
 * ⚠ **`template` 是模板 `name`（如 `'research'`），不是分类 `kind`（如 `'work'`）**。
 * `card.template` 是 `TemplateRef`，它同时有 `ref` 与 `kind` 两个字段 ——
 * 填错不会报错（都是 `string`），只会让依赖它的规则（如 `design.2.2`）**静默永不命中**。
 */
export interface ChildSnapshot {
	readonly id: string;
	readonly kind: string;
	/** 模板 `name`（= `card.template.ref`）。**不是** `card.template.kind`。 */
	readonly template: string;
	readonly status: string;
	readonly deleted: boolean;
}

/* ─────────────────────────────────────────────────────────────
 * ④ relation
 * ───────────────────────────────────────────────────────────── */

/** 一条关系边（④ 的角度）。 */
export interface RelationEntry {
	readonly label: string;
	readonly to: string;
}

/** ④ 的级联词汇（由本包以**数据**传入，④ 不认识状态）。 */
export interface CascadeVocabulary {
	readonly activeStatuses: readonly string[];
	readonly completedStatuses: readonly string[];
	readonly canceledStatus: string;
}

/** ④ 看到的卡的最小面。 */
export interface CascadeCard {
	readonly id: string;
	readonly status: string;
	readonly relations: unknown;
}

/** 级联里的因果依据（结构化、可写历史、可被程序读）。 */
export type Reason =
	| { readonly kind: 'path-hit'; readonly via: 'parent' | { readonly label: string; readonly from: string } }
	| { readonly kind: 'superseded-incomplete' }
	| { readonly kind: 'superseded-noop' };

/** 改关系的计划项。 */
export interface RelationsItem {
	readonly kind: 'patchRelations';
	readonly cardId: string;
	/** ⚠ 复数（④ 的实现）：同一张卡可能带多条补丁。 */
	readonly relationPatches: readonly RelationPatch[];
	readonly reasons: readonly Reason[];
}

/** 改状态的计划项。 */
export interface StatusItem {
	readonly kind: 'setStatus';
	readonly cardId: string;
	readonly targetStatus: string;
	readonly reasons: readonly Reason[];
}

/** 一份级联计划：**两阶段、phase 内按 cardId 升序**。 */
export interface CascadePlan {
	readonly relationsPhase: readonly RelationsItem[];
	readonly statusPhase: readonly StatusItem[];
	readonly issues: readonly unknown[];
}

/** 一条最小关系操作（④ 的 patch 形状）。 */
export interface RelationPatch {
	readonly op: 'retargetLink';
	readonly from: string;
	readonly to: string;
	readonly label: string;
}

/** 关系变更的两种来源。 */
export type RelationsChange =
	| { readonly kind: 'edit'; readonly value: unknown }
	| { readonly kind: 'patch'; readonly patches: readonly RelationPatch[] };

/** 关系校验 / 变更结果。 */
export type RelationsResult =
	| { readonly ok: true; readonly value: unknown }
	| { readonly ok: false; readonly issues: readonly unknown[] };

/** ④ 的服务面（本包用到的子集）。 */
export interface RelationPort {
	applyRelationsChange(current: unknown, change: RelationsChange): RelationsResult;
	planCascade(
		cards: readonly CascadeCard[],
		rootId: string,
		vocabulary: CascadeVocabulary,
		closeDependents: boolean,
	): CascadePlan;
	planSupersede(
		cards: readonly CascadeCard[],
		newCardId: string,
		oldCardIds: readonly string[],
		vocabulary: CascadeVocabulary,
	): CascadePlan;
}

/* ─────────────────────────────────────────────────────────────
 * ⑤ search
 * ───────────────────────────────────────────────────────────── */

/** 搜索条件（**纯数据、可序列化** —— 它要跨「浏览器 → 宿主」边界）。 */
export interface SearchCondition {
	readonly keyword?: string;
	readonly status?: readonly string[];
	readonly group?: readonly string[];
	readonly domain?: readonly string[];
}

/** ⑤ 的服务面（本包用到的子集）。 */
export interface SearchPort {
	search(cards: readonly unknown[], condition: SearchCondition): readonly unknown[];
	searchAll(
		cards: readonly unknown[],
		condition: SearchCondition,
	): { readonly matched: readonly unknown[]; readonly missingAdoption: readonly unknown[] };
}

/* ─────────────────────────────────────────────────────────────
 * ⑥ workgroup
 * ───────────────────────────────────────────────────────────── */

/**
 * 当前空间的解析结果。
 *
 * 三态**不合并**：`none`（从没设过）与 `stale`（设过但空间没了）对用户是不同信息。
 * ⑥ 只返回状态，**不抛业务错、不出文案** —— 报错出口在 ⑧。
 */
export type CurrentWorkspace =
	| { readonly status: 'none' }
	| { readonly status: 'ok'; readonly workspaceId: string }
	| { readonly status: 'stale'; readonly lastWorkspaceId: string };

/** ⑥ 的服务面（本包用到的子集）。 */
export interface WorkgroupPort {
	resolveCurrent(sessionId: string): CurrentWorkspace;
	/** 【可选】设置当前空间（用户切换时）。缺了则本包不能切空间。 */
	setCurrent?(sessionId: string, workspaceId: string): void;
}

/* ─────────────────────────────────────────────────────────────
 * ⑦ taskcard
 * ───────────────────────────────────────────────────────────── */

/**
 * 主体身份（用户 / 消息循环）。**这是"谁在操作"，不是"什么权限"。**
 *
 * ⚠ **类型名 `agentMessageLoop`**（`【用户指令，2026-11-02 13:30】`）：
 * > 「loop确实是ai。但我希望改名。loop名字太离谱里。我说的是"消息循环"。消息必须体现出来。
 * >   loop要改名，前缀改就一起改。agentMessageLoop」
 *
 * ⇒ `"loop"` 这个名字丢掉了"消息"这个关键语义；`"agentMessageLoop"` 才说出它是什么。
 * ⇒ **这个类型名同时决定了写进 `claimedBy` 的前缀**（见 `claims.ts` 的 `claimValueOf`）。
 */
export type Principal = { readonly type: 'user' } | { readonly type: 'agentMessageLoop'; readonly id: string };

/**
 * 权限类别（③ 的 `canTransition` 收这个）。**与 `Principal` 是两件事。**
 *
 * `【用户指令，2026-11-02 14:05】`：
 * > 「这里的权限问题使用ai这个名字。」
 * > 「除非把这两个语义进行了绑定或者就是一个语义。否则各用各的不要映射。」
 * > 「我更加希望他们是两个名字。这是两个不同的东西。领取是消息循环级别的。权限是ai这个类别的。」
 *
 * ⇒ **身份有 id（领取是消息循环级别的）、权限无 id（只是一个类别）** ⇒ **两个类型、两个名字、零映射函数。**
 *
 * ## ⚠ `actor` 是**调用入口写死的**，不是推断出来的
 *
 * `【用户指令，2026-11-02 14:10】`：
 * > 「ai不知道他是ai权限。但是ai的tool工具里面调用那个方法的时候会写死那个参数是ai」
 *
 * | 调用入口 | 传什么 |
 * |---|---|
 * | ⑨ AI tool | **写死 `'ai'`** |
 * | ⑩ UI | **写死 `'user'`** |
 * | ⑧ 内部（`recompute`） | **不传**（系统走 `deriveStatus`，不走 `canTransition`） |
 *
 * ⇒ **⑧ 收到什么传什么，零推断。** 若 ⑧ 也猜一次，同一个判断就存在两处（⑧ 猜 + ⑨ 写死），
 *   两处漂移时**不报错**，只会让权限判定按错误的那一处走。
 */
export type Actor = 'user' | 'ai' | 'host';

/** 一条计划项（⑦ 产出、⑧ 执行）。 */
export type PlanItem =
	| { readonly op: 'createCard'; readonly card: Card }
	| { readonly op: 'updateCard'; readonly card: Card }
	| { readonly op: 'appendHistory'; readonly cardId: string; readonly entry: unknown }
	| { readonly op: 'setStatus'; readonly cardId: string; readonly to: string; readonly reason?: unknown }
	| { readonly op: 'setRelations'; readonly cardId: string; readonly relations: unknown }
	| { readonly op: 'releaseClaim'; readonly cardId: string };

/** ⑦ 的计划 / 拒绝。 */
export type PlanResult =
	| { readonly ok: true; readonly items: readonly PlanItem[]; readonly events: readonly unknown[] }
	| { readonly ok: false; readonly reason: { readonly kind: string; readonly [key: string]: unknown } };

/** fork 计划（带两个清单）。 */
export interface ForkPlan {
	readonly ok: true;
	readonly newCard: Card;
	readonly relations: unknown;
	readonly events: readonly unknown[];
	readonly droppedSections: readonly { readonly sectionId: string; readonly payload: unknown }[];
	/** 新模板有、源卡无的章节。**只给 id** —— 补什么由 ⑧ 从 ③ 的 `default` 取。 */
	readonly missingSections: readonly { readonly sectionId: string }[];
}

export type ForkResult = ForkPlan | Extract<PlanResult, { ok: false }>;

/** ⑦ 的服务面（本包用到的子集）。**⑦ 对外唯一入口。** */
export interface CardsPort {
	isDraft(card: Card): boolean;
	isDeleted(card: Card): boolean;
	isClaimed(card: Card): boolean;
	changeIntent(card: Card): 'edit' | 'fork';

	planCreate(input: unknown, all: readonly Card[]): PlanResult;
	planChange(card: Card, input: unknown): PlanResult;
	planFork(
		src: Card,
		newTemplateSections: readonly SectionSpec[],
		input: unknown,
	): ForkResult;
	/** 采纳计划：⑦ 要 `{ principal, actor, at }`（身份 + 权限分开传）。 */
	planAdopt(
		card: Card,
		all: readonly Card[],
		input: { readonly principal: Principal; readonly actor: Actor; readonly at?: number },
	): PlanResult;
	/**
	 * 领取计划。
	 *
	 * ⚠ `principal`（谁在领）与 `actor`（什么权限）**是两个参数** —— 用户 14:05：
	 * 「这是两个不同的东西。领取是消息循环级别的。权限是ai这个类别的。」
	 */
	planClaim(card: Card, principal: Principal, actor: Actor, ctx: unknown): PlanResult;
	planRelease(
		card: Card,
		principal: Principal,
		actor: Actor,
		input?: unknown,
	): PlanResult;
	planDelete(card: Card, input?: unknown): PlanResult;
	/**
	 * 纯状态转移计划（成功 / 失败 / 取消 / 拒绝 / 搁置）。
	 *
	 * **⑦ 管单卡、管准入与三道闸**（有成功交付 / 所有子任务完成 / 有失败交付或阻碍），
	 * 用 `all`（全量卡）自己判 —— ⑧ **只传 `depsAllEnded`**，其它事实不进这个签名。
	 *
	 * ⚠ `to` 用 `string` 而不是封闭枚举：**5 个目标状态是 ③ 的知识**，⑧ 不写状态字面量。
	 */
	planTransition(
		card: Card,
		all: readonly Card[],
		input: {
			readonly to: string;
			readonly principal: Principal;
			readonly actor: Actor;
			readonly depsAllEnded: boolean;
			readonly at?: number;
		},
	): PlanResult;
}

/* ─────────────────────────────────────────────────────────────
 * 汇总
 * ───────────────────────────────────────────────────────────── */

/** 本包依赖的全部上游服务。 */
export interface Ports {
	readonly store: StorePort;
	readonly actions: ActionsPort;
	readonly types: TypesPort;
	readonly relation: RelationPort;
	readonly workgroup: WorkgroupPort;
	readonly cards: CardsPort;
	/** 【可选】⑤：纯函数包，缺了搜索能力降级，其它照常。 */
	readonly search?: SearchPort;
}
