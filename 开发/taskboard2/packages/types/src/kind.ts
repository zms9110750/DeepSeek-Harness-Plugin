/**
 * ③ kind —— 分类：一组可注册的规则数据，不是 `switch`。
 *
 * 分类自带「行为」= 状态的转移逻辑（用户 06:43）。本文件提供：
 *   - `Kind` 类型：**从注册表 key 派生**（`keyof typeof KIND_DEFS`），新增分类时自动加宽；
 *   - `initialStatus(kind)`：建卡时的初始状态；
 *   - `registerKind` / `getKind` / `listKinds`；
 *   - 计算态的求值函数 `deriveStatus`（有序规则 + 基底）。
 *
 * 本文件不读存储、不查别的卡、不写任何东西：子任务列表由调用方作为参数传入。
 */

import { type TaskState, TaskState as S } from './status.js';

/**
 * 判定用的卡快照（只含本包需要的字段）。
 *
 * `template` 是模板 ref（= 模板的 `name`，即卡上 `template.ref` 的值）。
 * **必填**：`design.2.2` 要判「子任务是否为 `research` 模板」，这是用户 `13:20` 明确的口径。
 */
export type ChildSnapshot = {
	readonly id: string;
	readonly kind: string;
	/** 模板 ref（= `card.template.ref` = 模板 `name`）。 */
	readonly template: string;
	readonly status: TaskState;
	readonly deleted: boolean;
};

/** 计算规则的输入。所有"外部世界的事实"都由调用方传入。 */
export type RuleInput = {
	/** 该卡当前状态。 */
	readonly status: TaskState;
	/** 该卡此刻是否被某个 actor 持有（由 ⑧ 从 `claimedBy` 判空得到）。 */
	readonly isHeld: boolean;
	/** 完整子任务列表：**含草稿与终态，调用方不得预过滤**。 */
	readonly children: readonly ChildSnapshot[];
};

/** 一条计算规则：有序，首个 `when` 为真者胜。 */
export type ComputeRule = {
	/** 具名标识，便于契约引用与排查。 */
	readonly id: string;
	readonly when: (input: RuleInput) => boolean;
	readonly then: TaskState;
};

/** 一个分类的注册项。 */
export type KindDef = {
	readonly id: string;
	/**
	 * 分类的编号字母：**单个大写字母**（`A`–`Z`）。
	 *
	 * 它是编号前缀的第一段（`前缀 = 分类字母 + 模板 codePrefix`）。
	 * 由分类定义提供，**模板配置不写这一位**。
	 * 注册期校验：必须是单个大写字母，且**所有已注册分类之间不得重复** ——
	 * 两个分类同字母会让编号前缀撞车，而 `nextId` 只按前缀分桶，查不出这是两个分类。
	 */
	readonly letter: string;
	/** 建卡时的初始状态。 */
	readonly initialStatus: TaskState;
	/** 所有计算规则都不成立时的落点。 */
	readonly baseStatus: (input: RuleInput) => TaskState;
	/** 有序计算规则。 */
	readonly computeRules: readonly ComputeRule[];
	/** 占位判定用的状态集合（仅 `work` 非空）。 */
	readonly quota: readonly TaskState[];
};

/** 合法的分类字母：单个大写字母。 */
const KIND_LETTER_RE = /^[A-Z]$/;

/** 是否已处「完成」组（= 终态）。终态不再参与计算。 */
export function isEndedStatus(status: TaskState): boolean {
	return (
		status === S.COMPLETED ||
		status === S.FAILED ||
		status === S.CANCELED ||
		status === S.REJECTED
	);
}

/** 是否处于「搁置」组（中断态，不是终结）。 */
export function isShelvedStatus(status: TaskState): boolean {
	return status === S.INPUT_REQUIRED || status === S.AUTH_REQUIRED;
}

/** 是否处于「进行」组。 */
export function isActiveStatus(status: TaskState): boolean {
	return status === S.SUBMITTED || status === S.WORKING;
}

/** 是否处于草稿（草稿不参与计算：只有脱离草稿的东西才计入）。 */
export function isDraftStatus(status: TaskState): boolean {
	return status === S.UNSPECIFIED;
}

/**
 * 参与推导的子任务 = **有效卡**：还活着（非墓碑）**且已脱离草稿**。
 *
 * 依据：
 *   - 用户 `12:46`「新卡默认草稿。而草稿不是有效卡，创建一个草稿是不广播的。」
 *   - 用户 `13:15`「这里的计算都要是有效卡，就是进行，或者搁置。草稿是不算的。」
 *
 * 为什么草稿要在这里滤、而不是让调用方先滤：
 *   过滤口径**只有这一处**。⑧ 传完整列表（含墓碑、含草稿、含终态），③ 在这里统一裁。
 *   两处都滤 ⇒ 将来口径一变就会不一致。
 *
 * ⚠️⚠️ **跨包提醒（改本函数前必读）**
 *
 * ⑧ 的「**删除不广播**」（`packages/core/src/claims.ts`）**依赖本函数同时滤墓碑与草稿**。
 * 改本函数的过滤口径会让那条实现**静默失效**（不报错、类型也不报）。
 *
 * 那条结论由**三个前提**共同支撑，缺一即失效：
 *   1. **本函数滤草稿** ← 这里；
 *   2. **本函数滤墓碑** ← 这里；
 *   3. **归档的对象在其被标记为墓碑之前必须是草稿**（用户 `13:15`「归档在现阶段只有草稿才能归档」）
 *      —— 执行点：⑦ 的 `planDelete`（`packages/taskcard/src/delete.ts`）**L42-45**
 *      强制 `status === DRAFT`，**非草稿直接拒绝**。
 *      ⚠ **L36-40 另有一处幂等早退**（`if (card.deleted)` ⇒ 返回空计划），
 *      所以上面那条**只对「非墓碑的卡」成立** —— 已墓碑的卡再归档，什么都不会发生。
 *
 * 因果链：
 *   归档前 —— 该子卡是草稿 ⇒ 前提 1 已让它对父卡**不可见**；
 *   归档后 —— 该子卡是墓碑 ⇒ 前提 2 让它对父卡**仍不可见**；
 *   ⇒ **父卡看到的东西前后没变** ⇒ 无需广播。
 *
 * ⇒ **改这里之前，先去 `claims.ts` 看那条警告；反之改那边也要回来看这里。**
 *   （跨包依赖的失效条件，单向留痕必然有一边看不到，所以两边都写。）
 */
function liveChildren(children: readonly ChildSnapshot[]): readonly ChildSnapshot[] {
	return children.filter((child) => !child.deleted && !isDraftStatus(child.status));
}

/* ─────────────────────────── 内置四类 ─────────────────────────── */

const GOAL: KindDef = {
	id: 'goal',
	letter: 'G',
	initialStatus: S.UNSPECIFIED,
	baseStatus: () => S.SUBMITTED,
	computeRules: [
		{
			id: 'goal.1.3',
			when: (input) =>
				liveChildren(input.children).some(
					(child) => child.status === S.WORKING || child.status === S.SUBMITTED,
				),
			then: S.WORKING,
		},
		{
			id: 'goal.1.4',
			when: (input) =>
				liveChildren(input.children).some((child) => child.status === S.INPUT_REQUIRED),
			then: S.INPUT_REQUIRED,
		},
		{
			id: 'goal.1.5',
			when: (input) =>
				liveChildren(input.children).some((child) => child.status === S.AUTH_REQUIRED),
			then: S.AUTH_REQUIRED,
		},
		{
			id: 'goal.1.6',
			when: (input) => {
				const live = liveChildren(input.children);
				const hasFailed = live.some((child) => child.status === S.FAILED);
				const hasCompleted = live.some((child) => child.status === S.COMPLETED);
				return hasFailed && !hasCompleted;
			},
			then: S.FAILED,
		},
		{
			id: 'goal.1.7',
			when: (input) => liveChildren(input.children).some((child) => child.status === S.COMPLETED),
			then: S.COMPLETED,
		},
	],
	quota: [],
};

const DESIGN: KindDef = {
	id: 'design',
	letter: 'D',
	initialStatus: S.AUTH_REQUIRED,
	baseStatus: () => S.AUTH_REQUIRED,
	computeRules: [
		{
			/*
			 * 设计卡：有**调研**子任务且它没结束 ⇒ 需要信息。
			 *
			 * ⚠ 判的是**模板**（`research`），不是分类（`work`）——
			 * 用户 13:20：「出现子任务为调研，这是明确的模板类型。因为调研是真的需要调研。
			 *             别的工作，我不知道你实际上是做什么。比如写代码。
			 *             那这个事情跟我的状态是没关系的。」
			 * ⇒ 校验 / 编写代码 这些 work 子卡**不该**把设计卡顶成需要信息。
			 */
			id: 'design.2.2',
			when: (input) =>
				liveChildren(input.children).some(
					(child) => child.template === 'research' && !isEndedStatus(child.status),
				),
			then: S.INPUT_REQUIRED,
		},
	],
	quota: [],
};

const WORK: KindDef = {
	id: 'work',
	letter: 'W',
	initialStatus: S.UNSPECIFIED,
	baseStatus: (input) => (input.isHeld ? S.WORKING : S.SUBMITTED),
	computeRules: [
		{
			/*
			 * 工作卡：**有子任务处于「需要信息」⇒ 自己也需要信息**。
			 *
			 * ⚠ 纯状态判据，**不看分类、不看模板**。
			 * 用户 13:20：「子任务能执行才是能执行。如果子任务是被搁置的。
			 *             那自己的进行依赖子任务。那自己肯定要被搁置。子任务都不做，自己怎么做。」
			 * ⇒ 任何子任务被搁置在「需要信息」，父工作卡都跟着搁置。
			 */
			id: 'work.3.3',
			when: (input) =>
				liveChildren(input.children).some((child) => child.status === S.INPUT_REQUIRED),
			then: S.INPUT_REQUIRED,
		},
		{
			/*
			 * 工作卡：**有子任务处于「需要授权」⇒ 自己也需要授权**。
			 *
			 * ⚠ 纯状态判据。**改前只认 `record` 类**（`kind === 'record' && AUTH_REQUIRED`），
			 * 改后**任何子任务**的「需要授权」都触发 —— 用户 13:20 同句「子任务是被搁置的 ⇒ 自己要被搁置」。
			 *
			 * ⚠ **顺序**：本条在 `work.3.3` 之后 ⇒ 「需要信息」优先于「需要授权」。
			 * 与矩阵一致：「子任务有需要信息 ⇒ 需要信息；**没有**需要信息，且具有需要授权 ⇒ 需要授权」。
			 */
			id: 'work.3.4',
			when: (input) =>
				liveChildren(input.children).some((child) => child.status === S.AUTH_REQUIRED),
			then: S.AUTH_REQUIRED,
		},
	],
	quota: [S.WORKING],
};

const RECORD: KindDef = {
	id: 'record',
	letter: 'R',
	initialStatus: S.AUTH_REQUIRED,
	baseStatus: () => S.AUTH_REQUIRED,
	computeRules: [],
	quota: [],
};

/**
 * 内置四类的默认注册值。
 *
 * 它们与外部注册项走同一条 `registerKind`，**零特权分支**。
 */
export const KIND_DEFS = {
	goal: GOAL,
	design: DESIGN,
	work: WORK,
	record: RECORD,
} as const;

/**
 * 分类的合法 id 联合 —— **从注册表 key 派生，不是手写四值**。
 *
 * 新增分类时自动加宽；使用方的 `switch (kind)` 必须带 `default` 分支。
 */
export type Kind = keyof typeof KIND_DEFS;

/* ─────────────────────────── 注册表 ─────────────────────────── */

/** 分类注册表。key = `id`。 */
const KINDS = new Map<string, KindDef>();

/** 九态的字符串集合，供注册期校验用。 */
const TASK_STATE_SET: ReadonlySet<string> = new Set<string>(Object.values(S));

for (const def of Object.values(KIND_DEFS)) KINDS.set(def.id, def);

/**
 * 注册（或替换）一个分类。
 *
 * 注册期校验（全部 fail-closed，不做静默降级）：
 *   - `id` 非空；
 *   - `letter` 是单个大写字母，**且与其它已注册分类不重复**；
 *   - `initialStatus` 与每条规则的 `then` 都是九态之一。
 */
export function registerKind(def: KindDef): void {
	if (typeof def?.id !== 'string' || def.id === '') {
		throw new Error('taskboard2-types: 分类必须有非空 id');
	}
	if (typeof def.letter !== 'string' || !KIND_LETTER_RE.test(def.letter)) {
		throw new Error(
			`taskboard2-types: 分类 "${def.id}" 的 letter 非法（${String(def.letter)}），必须是单个大写字母`,
		);
	}
	for (const [otherId, other] of KINDS) {
		if (otherId === def.id) continue;
		if (other.letter === def.letter) {
			throw new Error(
				`taskboard2-types: 分类 "${def.id}" 的 letter "${def.letter}" 与分类 "${otherId}" 重复（编号前缀会撞车）`,
			);
		}
	}
	if (!TASK_STATE_SET.has(def.initialStatus)) {
		throw new Error(
			`taskboard2-types: 分类 "${def.id}" 的 initialStatus 非法（${String(def.initialStatus)}）`,
		);
	}
	for (const rule of def.computeRules) {
		if (!TASK_STATE_SET.has(rule.then)) {
			throw new Error(
				`taskboard2-types: 分类 "${def.id}" 的规则 "${rule.id}" 产出非法状态（${String(rule.then)}）`,
			);
		}
	}
	KINDS.set(def.id, def);
}

/**
 * 取分类的编号字母（单个大写字母）。
 *
 * 编号前缀 = **分类字母 + 模板的 `codePrefix`**；分类这一段只能从这里取，
 * **模板配置不写它**。未注册的分类 ⇒ 抛错（调用方违约，不猜字母 ——
 * 猜一个会造出撞号的前缀，比失败更糟）。
 */
export function kindLetter(kind: string): string {
	const def = KINDS.get(kind);
	if (def === undefined) {
		throw new Error(`taskboard2-types: 未注册的分类 "${kind}"，无法取编号字母`);
	}
	return def.letter;
}

/** 取分类定义。未注册 ⇒ `undefined`（不猜、不抛错）。 */
export function getKind(kind: string): KindDef | undefined {
	return KINDS.get(kind);
}

/** 列出全部已注册分类（按注册顺序）。 */
export function listKinds(): readonly KindDef[] {
	return [...KINDS.values()];
}

/**
 * 建卡时的初始状态。
 *
 * 分类未注册 ⇒ 抛错（**调用方违约**，不是数据问题）。
 */
export function initialStatus(kind: string): TaskState {
	const def = KINDS.get(kind);
	if (def === undefined) {
		throw new Error(`taskboard2-types: 未注册的分类 "${kind}"，无法取初始状态`);
	}
	return def.initialStatus;
}

/** 某分类的占位状态集合（仅 `work` 非空）。 */
export function quotaStatesOf(kind: string): readonly TaskState[] {
	return KINDS.get(kind)?.quota ?? [];
}

/**
 * 计算态：按分类规则推导「此刻应该是什么状态」。
 *
 * 判定顺序固定（形状固定，不是配置）：
 *   1) 已处终态 ⇒ 不重算（终态粘滞）；
 *   2) 处草稿 ⇒ 不重算（草稿不参与）；
 *   3) 顺序跑 `computeRules`，首个 `when` 为真者胜；
 *   4) 全不成立 ⇒ `baseStatus`。
 *
 * 分类未注册 ⇒ 抛错。
 */
export function deriveStatus(kind: string, input: RuleInput): TaskState {
	const def = KINDS.get(kind);
	if (def === undefined) {
		throw new Error(`taskboard2-types: 未注册的分类 "${kind}"，无法计算状态`);
	}
	if (isEndedStatus(input.status)) return input.status;
	if (isDraftStatus(input.status)) return input.status;
	for (const rule of def.computeRules) {
		if (rule.when(input)) return rule.then;
	}
	return def.baseStatus(input);
}
