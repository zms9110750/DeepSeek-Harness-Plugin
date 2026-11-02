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
	/** 搜索（走 ⑤；⑤ 缺省 ⇒ 报 `SEARCH_UNAVAILABLE`，不自己实现一套筛法）。 */
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
		readonly kind?: string;
		readonly origin: CreateOrigin;
	}): WriteResult;
	/** UI 单章编辑（只校验 L1）。 */
	updateBody(cardId: string, sectionId: string, payload: unknown): WriteResult;
	/** 整卡编辑（标题 / 备注 / 章节 / 关系）。 */
	updateCard(cardId: string, editable: Readonly<Record<string, unknown>>): WriteResult;
	fork(cardId: string, options?: { readonly templateRef?: string; readonly kind?: string }): ReturnType<typeof forkCard>;
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

	return {
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
			const workspace = ensureWorkspace();
			if (!workspace.ok) return workspace;
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

		fork(cardId: string, options?: { readonly templateRef?: string; readonly kind?: string }) {
			/* 降级模式：fork 要选新模板 ⇒ 过闸（用户 14:50）。 */
			const allowed = requireTemplates();
			if (allowed !== undefined) return allowed;
			const workspace = ensureWorkspace();
			if (!workspace.ok) return workspace;
			const result = forkCard(ports, workspace.workspace, cardId, {
				...(options?.templateRef === undefined ? {} : { templateRef: options.templateRef }),
				...(options?.kind === undefined ? {} : { kind: options.kind }),
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
}
