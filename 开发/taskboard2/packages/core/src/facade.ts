/**
 * ⑧ core —— 对外门面（`taskboard2Core` 服务）。
 *
 * ## 谁调它
 *
 * · ⑨ ai-tool —— 把方法包成模型工具
 * · ⑪ dsh-command —— 包成斜杠命令
 * · ⑩ ui —— 浏览器是自有终端，**直接调**（不需要中间桥接层）
 *
 * ## 门面做什么 / 不做什么
 *
 * **做**：取当前空间 → 装载内存卡集 → 调具体流程模块 → 回写内存 → 返回结果。
 * **不做**：不判业务（判决来自 ②③④⑦）、不产文案（除 `errors.ts` 的查表）、不抛业务异常
 * （返回 `{ ok: false, error }`；**装配缺陷才抛**）。
 *
 * ## 内存一致性
 *
 * 每个写操作结束时用返回的卡**就地替换**内存副本里那张 —— 不整表重读
 * （`readAll` 是全量 `JSON.parse`，循环里调会退化）。
 */

import { adoptCard } from './adopt.js';
import { runCascade } from './cascade.js';
import { claimCard, deleteCard, releaseClaim, transitionCard } from './claims.js';
import { createCard, type CreateOrigin } from './create.js';
import { updateBody, updateCard } from './edit.js';
import { coreError, type CoreError } from './errors.js';
import { forkCard } from './fork.js';
import type { Actor, Card, Ports, Principal, SearchCondition } from './ports.js';
import { SEARCH_CONDITION_KEYS } from './ports.js';
import type { ActiveWorkspace } from './workspace.js';
import { findCard, loadWorkspace, resolveCurrentWorkspace, visibleCards } from './workspace.js';

/** 门面构造参数。 */
export interface FacadeOptions {
	readonly ports: Ports;
	/** 取会话 id（由宿主给；门面不猜）。 */
	readonly sessionId: () => string;
	/** 取当前时间（毫秒）。门面不直接读时钟 —— 方便测试注入。 */
	readonly now: () => number;
}

/** 统一的失败形状。 */
export interface Failure {
	readonly ok: false;
	readonly error: CoreError;
	readonly issuesForUI?: readonly unknown[];
}

/** `taskboard2Core` 服务的形状。 */
export interface CoreService {
	/* ── 空间 ── */
	listWorkspaces(includeArchived?: boolean): readonly { readonly id: string; readonly archived: boolean }[];
	currentWorkspaceId(): { readonly ok: true; readonly workspaceId: string } | Failure;
	/** 激活一个空间：读一次全量卡，之后长期持有。 */
	activate(wsId: string): { readonly ok: true; readonly count: number } | Failure;
	/* ── 读 ── */
	list(): readonly Card[];
	/**
	 * **精确搜索：参数是编号**（用户 11-02 17:37「精确搜索由core提供。参数是编号。」）。
	 *
	 * ⇒ 这就是精确搜索的实现 —— **不需要另加 `searchById`**：
	 *   用户要的是"按编号查一张卡"，`get(cardId)` 就是它，**且跨空间一致性更好**
	 *   （它按 id 直查当前空间内存，不过滤墓碑）。
	 *
	 * ⚠ 与 `search(condition)` 的分工：
	 *   · `get(cardId)` —— **精确**（编号），不经过 ⑤，不筛不模糊；
	 *   · `search(condition)` —— **模糊 / 筛选**（标题模糊 + 领域/分类/状态/模板），走 ⑤。
	 * ⇒ 两条路**不互相替代**：编号是身份，条件是筛选。
	 */
	get(cardId: string): { readonly ok: true; readonly card: Card } | Failure;
	/**
	 * 模板可用状态（给 ⑩ 展示降级提示用）。
	 *
	 * 用户 11-02 14:50：「可以展示，没有行为，状态的切换按钮都不给。」
	 * ⇒ ⑩ 需要知道"现在是降级模式"，才能把按钮变灰 / 隐藏。
	 *
	 * ⚠ **仍然返回 `ok: true`** —— 模板未就绪是**允许发生的正常状态**，不是失败。
	 *   失败的是"有行为的操作"（它们各自返回 `TEMPLATES_UNAVAILABLE`）。
	 */
	templatesStatus(): { readonly ok: true; readonly ready: boolean };
	/**
	 * 模糊 / 筛选搜索（走 ⑤；⑤ 缺省 ⇒ 报 `SEARCH_UNAVAILABLE`，不自己实现一套筛法）。
	 *
	 * ⚠ **搜索不过滤墓碑是有意的**（`【Lead 决定，2026-11-02 18:00】`）：
	 *   · 用户 03:32「墓碑默认读路径过滤，但按 id 直查可见」；
	 *   · **搜索 = 读路径** ⇒ 该过滤；
	 *   · **`get` = 按 id 直查** ⇒ 不过滤。
	 * ⇒ 所以"搜不到墓碑"**不是漏了**，是**两条路径的分工**。别在这里加墓碑。
	 *
	 * ⇒ 给 ⑤ 的卡集用 `visibleCards(...)`（**只滤墓碑、保留草稿**，
	 *   与 `list()` 同源）—— 草稿**可以搜到**。
	 */
	search(condition: SearchCondition): {
		readonly ok: true;
		readonly matched: readonly Card[];
		readonly missingAdoption: readonly Card[];
	} | Failure;
	/* ── 写 ── */
	create(input: {
		readonly templateRef: string;
		readonly title: string;
		readonly sections?: Readonly<Record<string, unknown>>;
		readonly relations?: { readonly parent?: string; readonly links?: readonly { readonly label: string; readonly to: string }[] };
		readonly note?: string;
		readonly origin: CreateOrigin;
	}): WriteResult;
	/** UI 单章编辑（只校验 L1）。 */
	updateBody(cardId: string, sectionId: string, payload: unknown): WriteResult;
	/** 整卡编辑（标题 / 备注 / 章节 / 关系）。 */
	updateCard(cardId: string, editable: Readonly<Record<string, unknown>>): WriteResult;
	fork(cardId: string, options?: { readonly templateRef?: string }): ReturnType<typeof forkCard>;
	/**
	 * 采纳（**v2 签名**：加了 `principal` / `actor`）。
	 *
	 * ⚠ **破坏性变更**：v1 只收 `cardId`。加参数的原因是 `design` / `record` 的采纳
	 * `user` 与 `ai` 都可以做 ⇒ 不知道"这次是谁"就无法判权限。
	 * 现在只有 ⑨⑩ 会调，且它们尚未实现 ⇒ 无需兼容层。
	 */
	adopt(cardId: string, principal: Principal, actor: Actor): ReturnType<typeof adoptCard>;
	claim(cardId: string, principal: Principal, actor: Actor): WriteResult;
	release(cardId: string, principal: Principal, actor: Actor): WriteResult;
	/**
	 * 纯状态转移（成功 / 失败 / 取消 / 拒绝 / 搁置）。
	 *
	 * ⚠ `to` 收 `string` 而不是封闭枚举 —— **5 个目标状态是 ③ 的知识**，⑧ 不写状态字面量；
	 * 传错值由 ⑦ → ③ 拒绝（`TRANSITION_REJECTED`）。
	 */
	transition(cardId: string, to: string, principal: Principal, actor: Actor): WriteResult;
	remove(cardId: string): WriteResult;
	/**
	 * 执行一份已算好的级联计划（④ 产出）。
	 *
	 * ⚠ **必须带 `| Failure`**：没激活空间时它返回 `Failure`，而 `CascadeResult` 里没有
	 * `error`、`changed` 是必填 —— 漏了这两个就会有 `changed` 缺失的类型错误。
	 * 本门面**每个可能在"没空间"时失败的方法都带 `| Failure`**，所以这里不能例外。
	 */
	runPlan(plan: unknown): ReturnType<typeof runCascade> | Failure;
}

/**
 * 写操作的统一返回。
 *
 * `recomputed` = **沿监听链连带改变**的父卡。**每个写操作都可能触发重算**
 * （建卡 / 编辑 / 领取 / 释放 / 采纳 / 级联 / 删除），所以统一带上；
 * 调用方（⑩ / ⑨）需要刷新这些卡，否则界面会拿着旧状态。
 */
export interface WriteSuccess {
	readonly ok: true;
	readonly card: Card;
	readonly recomputed: readonly Card[];
}

export type WriteResult = WriteSuccess | Failure;

/**
 * 会被"最后一道网"包住的**写方法**名单。
 *
 * ## 为什么是显式列表，而不是"包所有方法"
 *
 * 读方法（`list` / `get` / `search` / `currentWorkspaceId` / `listWorkspaces` /
 * `activate` / `templatesStatus`）的返回形状**不是** `{ ok, error }` 系的：
 *   · `list` 返回 `Card[]`；
 *   · `activate` 返回 `{ ok:true, count } | Failure`（**没有 `card`**）。
 * ⇒ 把它们也包成 `{ ok:false, error }` 会**破坏返回类型**（调用方拿到的形状对不上）。
 *
 * ⇒ 只包**失败形状统一**的写方法，一个一个列出来（**不靠猜返回值形状**）。
 *
 * ⚠ `runPlan` 也在这个名单里 —— 它的成功形状是 `{ ok:true, changed, recomputed }`
 * （与 `WriteResult` 不同，**没有 `card`**），但**失败形状同样是 `Failure`**
 * ⇒ 兜底只产失败值，所以**同一个包装器适用**。
 */
const WRITE_METHODS = [
	'create',
	'updateBody',
	'updateCard',
	'fork',
	'adopt',
	'claim',
	'release',
	'remove',
	'transition',
	'runPlan',
] as const;

/**
 * 造门面。
 *
 * ⚠ **`apply` 阶段不要调用它** —— 七个服务由 Cordis 依次 provide，`apply` 执行时后置包
 * 可能还没就绪。改为**首次调用时惰性构造**（见 `index.ts`）。
 */
export function createFacade(options: FacadeOptions): CoreService {
	const { ports, sessionId, now } = options;

	/** 当前激活的空间（内存真值）。 */
	let active: ActiveWorkspace | undefined;

	/** 取当前空间并保证已装载。 */
	function ensureWorkspace():
		| { readonly ok: true; readonly workspace: ActiveWorkspace }
		| Failure {
		if (active !== undefined) return { ok: true, workspace: active };

		const resolved = resolveCurrentWorkspace(ports.workgroup, sessionId());
		if (!resolved.ok) return { ok: false, error: resolved.error };

		active = loadWorkspace(ports.store, resolved.workspaceId);
		return { ok: true, workspace: active };
	}

	/** 用返回的卡替换内存副本里那张（就地，不整表重读）。 */
	function patchMemory(cards: readonly Card[]): void {
		if (active === undefined) return;
		const byId = new Map<string, Card>();
		for (const card of active.cards) byId.set(card.id, card);
		for (const card of cards) byId.set(card.id, card);
		active = { wsId: active.wsId, cards: [...byId.values()] };
	}

	/**
	 * 搜索条件字段白名单守卫。
	 *
	 * ## 为什么需要（这不是重复校验）
	 *
	 * 本包的 `SearchCondition`（`ports.ts`）是 ⑤ 的条件的**第二份声明** ——
	 * ⑧ 零 `@local/*` import，收不到 ⑤ 的类型。
	 * ⇒ ⑤ 改了字段名而这里没跟上时：**编译不报错、运行不报错**，
	 *   条件被 ⑤ **静默忽略**（筛出全集）—— **这份漂移已经发生过一次**
	 *   （旧版是 `keyword` / `group`，新版是 `title` / `kind` / `template`）。
	 *
	 * ⇒ 这个守卫是**两份声明之间唯一的连接点**：让"字段名变了"变成**显式错误**。
	 *
	 * ⚠ **不接受"重复"这个批评**：两份声明是零依赖约束的**必要代价**；
	 *   我们要拒绝的是**静默失效**，不是重复。
	 *
	 * @returns 非法时返回 `CoreError`，合法时返回 `undefined`
	 */
	function assertSearchCondition(condition: SearchCondition): CoreError | undefined {
		const allowed = new Set<string>(SEARCH_CONDITION_KEYS);
		const record = condition as Readonly<Record<string, unknown>>;

		for (const key of Object.keys(record)) {
			/* ── ① 字段名白名单（防"⑤ 改了字段名而这里没跟上"） ── */
			if (!allowed.has(key)) {
				return coreError(
					'SEARCH_CONDITION_INVALID',
					`未知的搜索条件字段「${key}」；合法字段：${SEARCH_CONDITION_KEYS.join(' / ')}。` +
						'（若 ⑤ 刚改过字段名，⑧ 的 ports.ts 要同步对齐）',
					{ key, allowed: SEARCH_CONDITION_KEYS },
				);
			}

			/*
			 * ── ② 值是数组（防"传了字符串"这种同类的静默失效） ──
			 *
			 * 用户 17:50：「这几个过滤都要是数组。因为不排除多选的情况」「都是or。」
			 * ⇒ 若 ⑨⑩ 传 `title: '字符串'`，⑤ 按数组逻辑处理会**静默筛出空**，
			 *   看起来像"没找到"，实际是**参数形状错**。
			 * ⇒ 与"字段名漂移"是**同一类问题**：不报错、结果错。所以一并拦。
			 */
			const value = record[key];
			if (value === undefined) continue;
			if (!Array.isArray(value)) {
				return coreError(
					'SEARCH_CONDITION_INVALID',
					`搜索条件「${key}」必须是数组（同一字段内多值之间是 OR）；收到 ${typeof value}。`,
					{ key, received: typeof value },
				);
			}
		}

		return undefined;
	}

	/**
	 * 降级模式闸：模板注册表未就绪 ⇒ 拒绝"有行为"的操作。
	 *
	 * 用户 11-02 14:50：
	 * > 「但是如果他出错了，core可以继续开。」
	 * > 「可以展示，没有行为，状态的切换按钮都不给。创建新卡没有模板选创建不了。」
	 *
	 * ## 哪些操作过闸
	 *
	 * | 操作 | 过闸 | 理由 |
	 * |---|---|---|
	 * | `list` / `get` / `search` / `currentWorkspaceId` / `listWorkspaces` | ❌ 不过 | 「可以展示」—— 卡带 label 副本，不依赖模板 |
	 * | `updateBody` / `updateCard` | ❌ 不过 | 改**已有**章节不碰模板（见 `edit.ts`） |
	 * | `create` / `fork` | ✅ 过 | 「创建新卡没有模板选创建不了」 |
	 * | `claim` / `release` / `adopt` / `transition` / `runPlan` | ✅ 过 | 「状态的切换按钮都不给」 |
	 *
	 * ⚠ **这是前置闸，不依赖 `resolve` / `sectionsOf` 抛错** —— ⑧ 先问
	 *   `isTemplateRegistryReady()`，未就绪就根本不往下走。
	 *   （③ 那边"未初始化 ⇒ 抛、没这个模板 ⇒ 返回 undefined"的两种失败语义**不用改**。）
	 *
	 * ⚠ **与本包 `TEMPLATE_REGISTRY_NOT_READY` 的分工**：
	 *   这里返回的是 `TEMPLATES_UNAVAILABLE`（**允许发生的正常状态**）；
	 *   `TEMPLATE_REGISTRY_NOT_READY` 是时序 bug（不该发生），**当前无检测点**。
	 */
	function requireTemplates(): Failure | undefined {
		if (ports.types.isTemplateRegistryReady()) return undefined;
		return {
			ok: false,
			error: coreError(
				'TEMPLATES_UNAVAILABLE',
				'模板未加载：当前只能查看，不能新建、转移或级联。',
				{},
			),
		};
	}

	/** 按 id 从内存取（**不过滤墓碑** —— 按 id 直查可见）。 */
	function getCard(cardId: string): Card | undefined {
		return active === undefined ? undefined : findCard(active, cardId);
	}

	const facade: CoreService = {
		/* ── 空间 ── */
		listWorkspaces(includeArchived = false) {
			return ports.store.listWorkspaces(includeArchived);
		},

		currentWorkspaceId() {
			const resolved = resolveCurrentWorkspace(ports.workgroup, sessionId());
			if (!resolved.ok) return { ok: false, error: resolved.error };
			return { ok: true, workspaceId: resolved.workspaceId };
		},

		activate(wsId: string) {
			try {
				active = loadWorkspace(ports.store, wsId);
				return { ok: true, count: active.cards.length };
			} catch (error) {
				return {
					ok: false,
					error: coreError(
						'WORKSPACE_NOT_FOUND',
						`激活工作空间「${wsId}」失败：${error instanceof Error ? error.message : String(error)}`,
						{ wsId },
					),
				};
			}
		},

		/* ── 读 ── */
		/**
		 * **完整卡列表 —— 含草稿**（用户 11-02 17:50：「草稿不是有效的，但是core提供完整列表
		 * 会在里面。ui和命令都可以看到草稿」）。
		 *
		 * ⇒ `visibleCards` 只滤**墓碑**，**不滤草稿**（见 `workspace.ts:86-88` 的实现）。
		 * ⇒ 所以"草稿对 UI 可见、但不参与状态推导"这两件事**由不同层负责**：
		 *   · 可见性 —— ⑧ 的 `list()` **保留草稿**（本方法）；
		 *   · 推导性 —— ③ 的 `liveChildren` **滤掉草稿**（用户 14:50「草稿不是有效卡」）。
		 *
		 * ⚠ **不要把这两条混起来**：若为了"草稿不参与推导"而在 `list()` 里滤草稿，
		 *   用户就看不到草稿了 —— 而用户明确要求**能看到**。
		 */
		list() {
			return active === undefined ? [] : visibleCards(active);
		},

		get(cardId: string) {
			const card = getCard(cardId);
			if (card === undefined) {
				return { ok: false, error: coreError('CARD_NOT_FOUND', `找不到这张卡：${cardId}`, { cardId }) };
			}
			return { ok: true, card };
		},

		search(condition: SearchCondition) {
			if (ports.search === undefined) {
				return {
					ok: false,
					error: coreError('WORKSPACE_NOT_FOUND', '⑤ search 未接入，无法搜索。'),
				};
			}

			/*
			 * ⚠ **防静默失效**：本包的 `SearchCondition` 是 ⑤ 条件的**第二份声明**
			 * （本包零 `@local/*` import）⇒ ⑤ 改了字段名而这里没跟上时，
			 * 条件会被 ⑤ **静默忽略**（筛出全集、不报错）。
			 *
			 * ⇒ 这里做一次**字段名白名单**检查，让漂移变成**显式错误**。
			 *   这不是"重复校验"，而是**两份声明之间唯一的连接点**。
			 */
			const illegal = assertSearchCondition(condition);
			if (illegal !== undefined) return { ok: false, error: illegal };

			const workspace = ensureWorkspace();
			if (!workspace.ok) return workspace;
			/*
			 * ⚠ `visibleCards` = **只滤墓碑、保留草稿**（不是"滤掉一切无效卡"）。
			 * ⇒ **墓碑搜不到是有意的**（用户 03:32「墓碑默认读路径过滤」）：
			 *   搜索是读路径 ⇒ 该过滤；`get` 是按 id 直查 ⇒ 那才不过滤。
			 * ⇒ **草稿能搜到**（用户 17:50「ui和命令都可以看到草稿」）。
			 */
			const cards = visibleCards(workspace.workspace);
			const result = ports.search.searchAll(cards, condition);
			return {
				ok: true,
				matched: result.matched as readonly Card[],
				missingAdoption: result.missingAdoption as readonly Card[],
			};
		},

		/* ── 模板可用状态（给 ⑩ 展示降级提示） ── */
		templatesStatus() {
			return { ok: true, ready: ports.types.isTemplateRegistryReady() };
		},

		/* ── 写 ── */
		create(input) {			/* 降级模式：没有模板可选 ⇒ 建不了新卡（用户 14:50）。 */
			const allowed = requireTemplates();
			if (allowed !== undefined) return allowed;
			const workspace = ensureWorkspace();
			if (!workspace.ok) return workspace;
			const result = createCard(ports, workspace.workspace, { ...input, at: now() });
			if (!result.ok) {
				return {
					ok: false,
					error: result.error,
					...(result.issuesForUI === undefined ? {} : { issuesForUI: result.issuesForUI }),
				};
			}
			/* 连带重算的父卡也要回写内存，否则门面的 `list()` 会拿着旧状态。 */
			patchMemory([result.card, ...result.recomputed]);
			return { ok: true, card: result.card, recomputed: result.recomputed };
		},

		/**
		 * UI 单章编辑。
		 *
		 * ⚠ **不过降级闸** —— 改**卡上已有**章节不碰模板（label 在卡上）。
		 * 只有"新增章节"才需要模板提供 label，那种情况由 `edit.ts` 报 `SECTION_LABEL_UNAVAILABLE`。
		 */
		updateBody(cardId: string, sectionId: string, payload: unknown) {
			const workspace = ensureWorkspace();
			if (!workspace.ok) return workspace;
			const result = updateBody(ports, workspace.workspace, cardId, sectionId, payload, now());
			if (!result.ok) {
				return {
					ok: false,
					error: result.error,
					...(result.issuesForUI === undefined ? {} : { issuesForUI: result.issuesForUI }),
				};
			}
			patchMemory([result.card, ...result.recomputed]);
			return { ok: true, card: result.card, recomputed: result.recomputed };
		},

		/** 整卡编辑。⚠ **不过降级闸** —— 理由同 `updateBody`。 */
		updateCard(cardId: string, editable: Readonly<Record<string, unknown>>) {
			const workspace = ensureWorkspace();
			if (!workspace.ok) return workspace;
			const result = updateCard(ports, workspace.workspace, cardId, editable, now());
			if (!result.ok) {
				return {
					ok: false,
					error: result.error,
					...(result.issuesForUI === undefined ? {} : { issuesForUI: result.issuesForUI }),
				};
			}
			patchMemory([result.card, ...result.recomputed]);
			return { ok: true, card: result.card, recomputed: result.recomputed };
		},

		fork(cardId: string, options?: { readonly templateRef?: string }) {
			/* 降级模式：fork 要选新模板 ⇒ 过闸（用户 14:50）。 */
			const allowed = requireTemplates();
			if (allowed !== undefined) return allowed;
			const workspace = ensureWorkspace();
			if (!workspace.ok) return workspace;
			const result = forkCard(ports, workspace.workspace, cardId, {
				...(options?.templateRef === undefined ? {} : { templateRef: options.templateRef }),
				at: now(),
			});
			/*
			 * ⚠ fork **不触发**监听链重算：新卡是"新的一张"，它不是任何卡的子任务
			 * （`fork.ts` 里 `relations.parent = ''`），所以没有父卡需要重算。
			 */
			if (result.ok) patchMemory([result.card]);
			return result;
		},

		adopt(cardId: string, principal: Principal, actor: Actor) {
			/* 降级模式：采纳是状态转移 ⇒ 过闸。 */
			const allowed = requireTemplates();
			if (allowed !== undefined) return allowed;
			const workspace = ensureWorkspace();
			if (!workspace.ok) return workspace;
			const result = adoptCard(ports, workspace.workspace, cardId, principal, actor, now());
			if (result.ok) patchMemory([result.card, ...result.changed, ...result.recomputed]);
			return result;
		},

		claim(cardId: string, principal: Principal, actor: Actor) {
			/* 降级模式：领取是状态转移 ⇒ 过闸。 */
			const allowed = requireTemplates();
			if (allowed !== undefined) return allowed;
			const workspace = ensureWorkspace();
			if (!workspace.ok) return workspace;
			const result = claimCard(ports, workspace.workspace, cardId, principal, actor, now());
			if (result.ok) patchMemory([result.card, ...result.recomputed]);
			return result;
		},

		release(cardId: string, principal: Principal, actor: Actor) {
			/* 降级模式：释放也是状态切换（处理中 → 提交）⇒ 过闸。 */
			const allowed = requireTemplates();
			if (allowed !== undefined) return allowed;
			const workspace = ensureWorkspace();
			if (!workspace.ok) return workspace;
			const result = releaseClaim(ports, workspace.workspace, cardId, principal, actor, now());
			if (result.ok) patchMemory([result.card, ...result.recomputed]);
			return result;
		},

		transition(cardId: string, to: string, principal: Principal, actor: Actor) {
			/* 降级模式：状态转移 ⇒ 过闸。 */
			const allowed = requireTemplates();
			if (allowed !== undefined) return allowed;
			const workspace = ensureWorkspace();
			if (!workspace.ok) return workspace;
			const result = transitionCard(ports, workspace.workspace, cardId, to, principal, actor, now());
			if (result.ok) patchMemory([result.card, ...result.recomputed]);
			return result;
		},

		/** 删除。⚠ **不过降级闸** —— 墓碑只是标记，不依赖模板。 */
		remove(cardId: string) {
			const workspace = ensureWorkspace();
			if (!workspace.ok) return workspace;
			const result = deleteCard(ports, workspace.workspace, cardId, now());
			if (result.ok) patchMemory([result.card, ...result.recomputed]);
			return result;
		},

		runPlan(plan: unknown) {
			/* 降级模式：级联执行会改状态 ⇒ 过闸。 */
			const allowed = requireTemplates();
			if (allowed !== undefined) return allowed;
			const workspace = ensureWorkspace();
			if (!workspace.ok) return workspace;
			const result = runCascade(ports, workspace.workspace, plan as never, now());
			/* 级联会连带重算父卡，一并回写内存。 */
			if (result.ok) patchMemory([...result.changed, ...result.recomputed]);
			return result;
		},
	};

	/*
	 * ── 最后一道网：门面**绝不把业务异常抛给调用方** ──
	 *
	 * ## 为什么需要它（尽管它不该触发）
	 *
	 * ⑦ 的契约是「纯函数、返回拒绝原因、不抛错」。**但那个契约目前是假的** ——
	 * ⑦ 内部有 5 个 `canTransition` 调用点 + `adoptTargetOf` / `initialStatus`，
	 * 而 ③ 对这些**未注册分类一律抛错**（数据现实里"旧卡引用了已注销的分类"可达）。
	 * ⇒ ⑦ 的收口**已派但未完成** ⇒ ⑧ 不能假定它守约。
	 *
	 * ⑧ 是**对外契约的唯一保证人**（⑨⑩ 拿到的必须是 `Failure`，不是异常）。
	 * ⇒ 异常冒到 Cordis 的调用方会**炸掉整个插件** —— 代价远大于"多一层 try"。
	 *
	 * ## 为什么只包 10 个写方法（不是全部）
	 *
	 * 见 `WRITE_METHODS` 的注释：读方法的返回形状不是 `{ ok, error }` 系，
	 * 包成失败值会**破坏返回类型**。⇒ **显式列名，不靠猜形状。**
	 *
	 * ## 为什么是"一处循环"而不是"10 个方法各写 try"
	 *
	 * 兜底逻辑只有一份 ⇒ 不会出现"补了 9 处漏了 1 处"，
	 * 也不会出现 10 份实现各自漂移。
	 *
	 * ⚠ **触发即告警**：正常路径永不进入 `catch`。若真的进了，说明**上游又违约** ——
	 *   那是要修上游的信号，不是"用户操作失败"。
	 */
	const guarded = facade as unknown as Record<string, unknown>;
	for (const methodName of WRITE_METHODS) {
		const original = guarded[methodName];
		if (typeof original !== 'function') continue;

		guarded[methodName] = function guardedWrite(this: unknown, ...args: unknown[]): unknown {
			try {
				return (original as (...a: unknown[]) => unknown).apply(this, args);
			} catch (error) {
				console.error(
					`[taskboard2-core] 门面方法 ${methodName} 抛出异常（上游违约，应修上游）：`,
					error,
				);
				return {
					ok: false,
					error: coreError(
						'INTERNAL_ERROR',
						`${methodName} 执行失败（这是内部错误，不是操作被拒）：${error instanceof Error ? error.message : String(error)}`,
					),
				};
			}
		};
	}

	return facade;
}
