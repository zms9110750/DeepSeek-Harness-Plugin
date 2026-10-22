/**
 * plan-events · 树/计划共用的那一类日志事件。
 *
 * 一个插件一种事件类型，一条事件带 `op`。这里除了类型和写入口之外什么都没有，
 * 但它是整套东西唯一允许写日志的地方，所以单独成一个插件：换掉它，就换掉了
 * "记录长什么样"，其余插件只认 `opOf()` 的返回值。
 *
 * 两条硬约束（两次事故换来的，别动）：
 *   1. 必须 appendPluginRecord：它强制 `plugin:` 命名空间并标 `ignorable:true`。
 *      裸 `session.append('自定义类型')` 写出的是"未知且不可忽略"的类型，加载器
 *      会拒绝解释整份日志。
 *   2. `user/message` 是唯一不受 turn/step 约束的面事件；`system/message` 之类
 *      只能在打开的步骤里写，异步写必炸。
 *
 * 写入口顺带做三件**宿主动作**（都不改变 records 是唯一真相这一点）：
 *   · 物化九态：记录进 records 后立刻镜像进 plans/nodes（tree-store.record）；
 *   · 同模板累计三败 → 自动建一份复盘任务（F 系列，草案，不自动派发）；
 *   · 父交付 → 把它挂起中的直接子任务自动置 canceled（只写父日志，子靠通知与树库读）。
 *
 * @module @local/plan-tree/events
 */
import { appendPluginRecord } from '@deepseek-ai/dsh-session';
import { createUserMessage } from '@deepseek-ai/dsh-llm';

export const name = 'plan-events';

export const inject = [];

/** 唯一的自有类型。op 在数据里，不一个动作一个类型。 */
export const RECORD = 'plugin:plan-tree/node';

/** 更早版本的形状；读端认得，写端不再用。 */
const LEGACY = {
	'plan-tree/dispatch': 'dispatch',
	'plugin:plan-tree/dispatch': 'dispatch',
	'plan-tree/file': 'file',
	'plugin:plan-tree/file': 'file',
};

/** 只有这几种记录进树库：它们是树本身，不是旁注。 */
const MIRRORED = new Set(['plan', 'adopt', 'reject-draft', 'shelve-draft', 'status', 'dispatch', 'link', 'file', 'cancel-dependents']);

/** 只有这几件事算"状态变了"，要告诉父与同层兄弟；派发与链接是父自己做的，不用通知自己。 */
const NOTIFIED = new Set(['adopt', 'reject-draft', 'shelve-draft', 'status', 'file', 'cancel-dependents']);

/** 复盘任务（F）交付之后才算这一轮复盘结束；没交付就没完。 */
function isPendingReview(status) {
	return status !== 'completed' && status !== 'canceled';
}

/** op → 状态码。file 看判定，其余看动作。 */
function statusAfter(op, data) {
	if (op === 'adopt') return 'submitted';
	if (op === 'reject-draft') return 'rejected';
	if (op === 'shelve-draft') return data?.shelved === false ? null : 'input-required';
	if (op === 'status') return data?.to ?? null;
	if (op === 'cancel-dependents') return 'canceled';
	if (op === 'file') return { success: 'completed', reject: 'failed', shelved: 'input-required' }[data?.verdict] ?? 'working';
	return null;
}

/**
 * 状态一变，告诉父与同层兄弟。
 *
 * B-03 定的做法：往它们各 **append** 一条 `user/message`，正文一句话；细节让它们
 * 自己 `plan_tree` / `plan_show`。
 *
 * 投递必须是纯日志拼接，绝不能 `followup`：目标是**别人的会话**，followup 会把它
 * 唤醒成一轮（空闲的还会冷启动），用户把"严禁唤醒"定成了硬约束。`append` 不进
 * inbox、不触发 wakeDriver：正在跑的在本轮步骤边界组请求时看到，停着的等它下次
 * 被唤醒时一并带上。已实测（append-probe）：5 秒内无 turn/start、立刻进 surface、
 * 当刻起 <500ms 落盘。
 *
 * `source.kind` 按关系分开，否则子会把自己的状态通知、兄弟的失败当成用户的话。
 */
function broadcast(ctx, session, op, data) {
	if (!NOTIFIED.has(op)) return;
	const agents = ctx.get('agents');
	if (agents === undefined) return;

	const status = statusAfter(op, data);
	const label = ctx.get('planStates')?.labelOf?.(status) ?? String(status ?? '草案');
	const text = `[计划状态] ${String(data?.id ?? '?')} → ${label}`;

	/** id → source.kind：父看到的是本节点状态，同层看到的是兄弟状态。 */
	const targets = new Map();
	if (op !== 'cancel-dependents') {
		const parent = session.header?.parentSession;
		if (typeof parent === 'string' && parent.length > 0) targets.set(parent, 'plan-state');
		// 同层兄弟：本会话的 nodes 投影里，子会话不是自己的节点。
		const nodes = ctx.get('sessionProjections')?.stateOf?.(session, 'nodes')?.nodes ?? {};
		for (const node of Object.values(nodes)) {
			if (typeof node.childId !== 'string' || node.childId === session.id) continue;
			targets.set(node.childId, 'plan-sibling');
		}
	}

	for (const [id, kind] of targets) {
		// 目标会话不在本进程里（没打开）就安静跳过：通知不是主流程，缺一条不影响状态本身。
		const targetSession = agents.get?.(id)?.session;
		if (targetSession === undefined) continue;
		try {
			targetSession.append(
				'user/message',
				createUserMessage({
					content: [{ type: 'text', text }],
					source: { kind, form: 'notice', senderSessionId: session.id },
				}),
				{ surfaceOp: 'append' },
			);
		} catch (error) {
			// 一条通知写失败只告警：状态已经记进日志，通知丢了可以再查。
			ctx.logger?.warn?.(`plan-events: 状态通知写入失败（${id}）：${String(error?.message ?? error)}`);
		}
	}
}

/**
 * 同模板累计三败 → 建一份复盘任务（F 系列）。
 *
 * 规则（用户已定）：
 *   · 计数单位是模板（不是层、不是全局），累计、不要求连续；
 *   · 触发动作是**真的创建**一份草案，不是建议、不是禁模板；
 *   · 上一份复盘还没交付（completed）时不再新建，免得一次堆好几份；
 *   · 复盘任务不会自动派发，采纳后才派。
 *
 * @returns `{ created }` 新建的 F id；`{ suppressed }` 已有未交付复盘所以没建；undefined 没到阈值。
 */
function maybeReview(ctx, session, failure) {
	const states = ctx.get('planStates');
	const stores = ctx.get('treeSessions');
	const statesApi = states ?? {};
	if (typeof statesApi.shouldReview !== 'function') return undefined;
	if (!statesApi.shouldReview(failure.failed, failure.lastReviewedAt)) return undefined;

	const store = (() => {
		try {
			return stores?.atSession(session);
		} catch {
			return undefined;
		}
	})();

	// 上一份复盘还没交付：先不建。
	const reviews = store === undefined
		? Object.values(ctx.get('sessionProjections')?.stateOf?.(session, 'plans')?.plans ?? {}).filter(
				(plan) => plan.type === 'review' && statesApi.templateKey(plan) === failure.template,
			)
		: store.reviewsOf(failure.template);
	const pending = reviews.find((plan) => {
		const nodes = store === undefined ? [] : store.plan(plan.id)?.nodes ?? [];
		return isPendingReview(statesApi.statusOf(plan, nodes));
	});
	if (pending !== undefined) {
		// 不建，但要把"为什么没建"带回给 plan_file：否则看起来像触发器坏了。
		ctx.logger?.info?.(`plan-events: ${failure.template} 已有未交付的复盘 ${pending.id}，本次不新建`);
		return { suppressed: pending.id };
	}

	// 失败节点的坑：直接铺进复盘正文，派出去的子不必再翻日志。
	const failedNodes = (() => {
		if (store !== undefined && typeof store.failedNodesOfTemplate === 'function') {
			return store.failedNodesOfTemplate(failure.template);
		}
		const plans = ctx.get('sessionProjections')?.stateOf?.(session, 'plans')?.plans ?? {};
		const nodes = ctx.get('sessionProjections')?.stateOf?.(session, 'nodes')?.nodes ?? {};
		const nodeIds = new Set(
			Object.values(plans)
				.filter((plan) => statesApi.templateKey(plan) === failure.template)
				.map((plan) => plan.id),
		);
		return Object.values(nodes).filter((node) => nodeIds.has(node.planId) && node.verdict === 'reject');
	})();

	const label = failure.label ?? String(failure.template).replace(/^.*\//u, '');
	const id = store === undefined ? nextReviewIdFromProjection(ctx, session) : store.nextReviewId();
	const title = `复盘：${label} 累计失败 ${failure.failed} 次`;
	const body = statesApi.renderReviewPlan({ id, template: failure.template, label, failed: failure.failed, nodes: failedNodes });

	// 真正创建：一条 plan 记录（草案，未采纳）。不经过 plan_write，因为它是宿主动作，
	// 不是模型写的提案；采纳仍然是用户的决定。
	append(ctx, session, 'plan', {
		id,
		title,
		type: statesApi.REVIEW_TYPE ?? 'review',
		layer: null,
		layerIndex: null,
		dir: null,
		// 复盘任务的模板位仍指向那份一直失败的模板：再失败也不会被算进它的计数。
		templatePath: failure.template,
		topic: `为什么「${label}」反复失败`,
		goal: `查清「${label}」累计 ${failure.failed} 次失败的原因，给出下一份计划该改什么`,
		done_when: '能说清坑在哪，并给出下一份计划具体改哪一条',
		where_to_learn: '同模板失败节点的结论、证据与坑（已列在正文里）',
		author: 'host',
		body,
		// 建它的刻度：此后该模板再累计 3 次才会建下一份。
		reviewAt: failure.failed,
		createdAt: Date.now(),
		parentSession: session.id,
	});
	return { created: id };
}

/** 没有树库时的兜底：从投影里数 F 号。 */
function nextReviewIdFromProjection(ctx, session) {
	const plans = ctx.get('sessionProjections')?.stateOf?.(session, 'plans')?.plans ?? {};
	let max = 0;
	for (const id of Object.keys(plans)) {
		const match = /^F(\d+)$/u.exec(String(id));
		if (match !== null) max = Math.max(max, Number(match[1]));
	}
	return `F${max + 1}`;
}

/**
 * 父交付 → 把它挂起中的直接子任务置为 canceled。
 *
 * 只写**父日志**一条 `cancel-dependents`，物化表跟着更新；被取消的子会话各收一条
 * 通知——同样用 append 拼接、不唤醒（跨会话追加 user/message + surfaceOp:'append'
 * 已实测可行）。它下次 `plan_tree` 时以树库为准，看到的就是 canceled——即使它
 * 当时离线、根本没读到这条通知。
 */
function cancelDependents(ctx, session, data) {
	const stores = ctx.get('treeSessions');
	const statesApi = ctx.get('planStates') ?? {};
	let childSession;
	let suspended = [];
	try {
		const store = stores?.atSession(session);
		if (store === undefined) return;
		const node = store.node(data.id);
		childSession = node?.child_id;
		if (typeof childSession !== 'string' || childSession.length === 0) return;
		suspended = store.suspendedChildren(childSession);
	} catch (error) {
		ctx.logger?.warn?.(`plan-events: 取消扫描失败：${String(error?.message ?? error)}`);
		return;
	}
	if (suspended.length === 0) return;

	const canceled = suspended.map((node) => node.id);
	append(ctx, session, 'cancel-dependents', {
		id: data.id,
		session: childSession,
		canceled,
		reason: '父任务已交付，挂起的子任务自动取消',
	});

	// 通知被取消的子会话（它们可能离线；离线时靠下次读树库看到）。
	const agents = ctx.get('agents');
	for (const node of suspended) {
		if (typeof node.child_id !== 'string' || node.child_id.length === 0) continue;
		const targetSession = agents?.get?.(node.child_id)?.session;
		if (targetSession === undefined) continue;
		try {
			targetSession.append(
				'user/message',
				createUserMessage({
					content: [
						{
							type: 'text',
							text: `[计划状态] ${node.id} → ${statesApi.labelOf?.('canceled') ?? '已取消'}（父任务已交付，挂起的子任务自动取消）`,
						},
					],
					source: { kind: 'plan-state', form: 'notice', senderSessionId: session.id },
				}),
				{ surfaceOp: 'append' },
			);
		} catch (error) {
			ctx.logger?.warn?.(`plan-events: 取消通知写入失败（${node.child_id}）：${String(error?.message ?? error)}`);
		}
	}
}

/**
 * 唯一的写入口。
 * @returns 落盘与宿主动作的结果（`{ failure, reviewId, canceled }` 等），调用方按需取用。
 */
function append(ctx, session, op, data) {
	const record = { op, ...data };
	appendPluginRecord(session, RECORD, record);

	let info;
	// 树管的是提案本身，所以提案也进树库：日志丢了库还在，界面也不必非等会话打开。
	// 单会话视图：写入方就是这条记录的主人，读方只读自己那一串（见 15/README 第 10 条）。
	const stores = ctx.get('treeSessions');
	if (stores !== undefined && MIRRORED.has(op)) {
		try {
			const seq = session.snapshotEvents().length - 1;
			info = stores.atSession(session).record(session.id, seq, JSON.stringify(record));
		} catch (error) {
			// 物化失败绝不影响日志本身：日志才是会话能继续跑的前提。
			ctx.logger?.warn?.(`plan-events: 树库落盘失败（日志已写）：${String(error?.message ?? error)}`);
		}
	}

	// ---- 宿主动作 1：同模板累计三败 → 复盘任务（F 系列） ----
	let reviewed;
	if (op === 'file' && data?.verdict === 'reject' && info?.failure !== undefined) {
		try {
			reviewed = maybeReview(ctx, session, info.failure);
		} catch (error) {
			ctx.logger?.warn?.(`plan-events: 建复盘任务失败（不影响结算）：${String(error?.message ?? error)}`);
		}
	}

	// ---- 宿主动作 2：父交付 → 挂起的子任务自动取消 ----
	let canceled;
	if (op === 'file' && data?.verdict === 'success') {
		try {
			canceled = cancelDependents(ctx, session, data);
		} catch (error) {
			ctx.logger?.warn?.(`plan-events: 取消挂起子任务失败：${String(error?.message ?? error)}`);
		}
	}

	// 状态变了就通知父与同层兄弟（B-03）。通知失败同样不影响记录。
	try {
		broadcast(ctx, session, op, record);
	} catch (error) {
		ctx.logger?.warn?.(`plan-events: 状态通知失败：${String(error?.message ?? error)}`);
	}

	return {
		...info,
		...(reviewed?.created === undefined ? {} : { reviewId: reviewed.created }),
		...(reviewed?.suppressed === undefined ? {} : { reviewSuppressed: reviewed.suppressed }),
		...(canceled === undefined ? {} : { canceled }),
	};
}

export function apply(ctx) {
	ctx.provide('planEvents', {
		type: RECORD,

		/** 唯一的写入口。 */
		append(session, op, data) {
			return append(ctx, session, op, data);
		},

		/** 一条事件属于哪个 op；不是本插件的事件返回 undefined。 */
		opOf(event) {
			if (event?.type === RECORD) return event.data?.op;
			return LEGACY[event?.type];
		},
	});
}
