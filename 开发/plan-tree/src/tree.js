/**
 * plan-tree · 执行节点：`nodes` 投影与树简报。
 *
 * 只有派发过的计划才在树上（A-2）。节点状态用九态（A2A 那套，码值见 plan-state）：
 * 派发 → working，结算 → completed / failed / input-required，父交付 → 子任务 canceled。
 * 节点与计划是多对一：一份计划最多派发一次，所以现在是一对一，但结构上留着多对一。
 *
 * 计数在这里改，不另设服务：**按模板**累计失败（不是按层、不是全局）。
 * 模板失败是"该复盘了"的判据；具体建不建 F 由 events.js 的宿主动作决定。
 *
 * **读路径：树库优先、投影兜底。** 投影来自本会话日志的前缀，子会话看不到派发之后
 * 父日志里发生的事（比如"父交付把我取消了"）；树库是整棵树的最新事实。所以 `plan_tree`
 * / `plan_show` 先把 treeSessions 里的 nodes 覆盖到投影上，再渲染。
 *
 * 简报里**计划与节点都报**，而且结算要带出"为什么进行不下去"——
 * 状态只是标签，坑才是下次不踩的东西。
 *
 * @module @local/plan-tree/tree
 */
import { z } from 'zod';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { REVIEW_TYPE, STATUS } from './state.js';

export const name = 'plan-tree';

export const inject = ['tools', 'sessionProjections', 'planEvents', 'planStates'];

const stateSchema = z.object({
	nodes: z.record(z.string(), z.any()),
	// 模板键 → 累计失败数。单位是模板，不是层。
	failures: z.record(z.string(), z.number()),
	nextId: z.number(),
});

function planNumber(id) {
	const match = /^p(\d+)$/u.exec(String(id ?? ''));
	return match === null ? Number.MAX_SAFE_INTEGER : Number(match[1]);
}

/** 节点 id 也是 n<数字>，排序要按数值而不是字典序（否则 n10 排在 n2 前面）。 */
function nodeNumber(id) {
	const match = /^n(\d+)$/u.exec(String(id ?? ''));
	return match === null ? Number.MAX_SAFE_INTEGER : Number(match[1]);
}

/** 拿这个会话所属那棵树的库；没装 tree-store 或打不开就返回 undefined（退回纯投影）。 */
function storeOf(ctx, session) {
	try {
		return ctx.get('treeSessions')?.atSession(session);
	} catch {
		return undefined;
	}
}

/**
 * 把树库里的节点状态覆盖到投影上（树库优先、投影兜底）。
 *
 * 只覆盖状态与该有的关系字段；结算六项这类"内容"仍以投影为准（库只存状态与关系）。
 * @param state - `nodes` 投影。
 * @param rows - tree-store 的 nodes 行（不存在就跳过）。
 */
export function mergeStoredNodes(state, rows) {
	if (!Array.isArray(rows) || rows.length === 0) return state;
	const nodes = { ...state.nodes };
	for (const row of rows) {
		const existing = nodes[row.id];
		const base = existing ?? {
			id: row.id,
			parentSession: row.parent_session,
			planId: row.plan_id,
			dir: null,
			type: row.type,
			layer: row.layer,
			layerIndex: null,
			topic: row.topic,
			reason: null,
			childId: row.child_id,
			verdict: null,
			summary: null,
			conclusion: null,
			evidence: null,
			artifacts: null,
			pitfalls: null,
			where: null,
		};
		nodes[row.id] = {
			...base,
			childId: row.child_id ?? base.childId,
			planId: row.plan_id ?? base.planId,
			status: row.status ?? base.status,
		};
	}
	return { ...state, nodes };
}

/**
 * 把树库里的计划状态覆盖到 `plans` 投影上（计划段也树库优先）。
 *
 * 为什么计划也要覆盖：`plan_status(p1 → completed)` 这类显式状态写在库里，
 * 而离线子会话 / 未重放投影的视图看不到；不覆盖就会出现"库里已完成、树上还进行中"。
 * 只覆盖状态（其余标题、正文仍以投影为准），库里没有的计划补一条最小行让它可见。
 *
 * @param plansState - `plans` 投影（可能 undefined）。
 * @param rows - tree-store 的 plans 行。
 */
export function mergeStoredPlans(plansState, rows) {
	if (plansState === undefined || !Array.isArray(rows) || rows.length === 0) return plansState;
	const plans = { ...(plansState.plans ?? {}) };
	for (const row of rows) {
		const existing = plans[row.id];
		if (existing === undefined) {
			plans[row.id] = {
				id: row.id,
				title: row.title ?? '',
				type: row.type ?? 'plan',
				layer: row.layer ?? null,
				layerIndex: null,
				dir: null,
				templatePath: row.template ?? null,
				adopted: row.adopted === 1,
				rejected: row.rejected === 1,
				shelved: row.shelved === 1,
				status: row.status ?? null,
				body: '',
			};
			continue;
		}
		plans[row.id] = { ...existing, status: row.status ?? existing.status ?? null };
	}
	return { ...plansState, plans };
}

/**
 * 一次读齐 plan_tree / plan_show 要的东西：**树库优先、投影兜底**。
 * 库打不开（没装 tree-store、文件坏了）时退回纯投影，两个工具照常用。
 */
function readView(ctx, session) {
	const store = storeOf(ctx, session);
	const nodeState = ctx.sessionProjections.stateOf(session, 'nodes') ?? { nodes: {}, failures: {}, nextId: 1 };
	const planState = ctx.sessionProjections.stateOf(session, 'plans');
	return {
		nodes: mergeStoredNodes(nodeState, store?.allNodes?.() ?? []),
		plans: mergeStoredPlans(planState, store?.allPlans?.() ?? []),
	};
}

/**
 * 简报：计划（状态）→ 节点树 → 每模板失败计数。
 *
 * **只报标题和状态**：树是索引，不是内容。正文、派发理由、结算六项都归 `plan_show`。
 * 一眼要能看出"哪一支卡住了"，靠的是状态；"为什么卡住"要展开那一条才需要。
 * @param state - `nodes` 投影（可已被树库覆盖）。
 * @param plansState - `plans` 投影；缺了只是不报计划段（比如 record 被单独关掉）。
 * @param planStates - 状态机服务；缺了退化成一句话判断。
 */
export function renderTree(state, plansState, planStates) {
	const lines = [];
	const nodes = Object.values(state.nodes ?? {});
	const label = (status) => planStates?.labelOf?.(status) ?? String(status ?? '');

	// ---- 计划：树的主干。 ----
	const plans = plansState === undefined ? [] : Object.values(plansState.plans ?? {});
	if (plans.length > 0) {
		lines.push('计划：');
		for (const plan of [...plans].sort((a, b) => planNumber(a.id) - planNumber(b.id))) {
			const own = nodes.filter((node) => node.planId === plan.id);
			const raw = planStates === undefined
				? (plan.adopted === true ? 'submitted' : null)
				: planStates.statusOf(plan, own);
			const status = label(raw);
			const layer = plan.type === REVIEW_TYPE ? '复盘' : plan.type === 'research' ? '研究' : plan.layer ?? '未分层';
			// 提案文件夹显示在标题前：一眼看出这条出自哪份提案。
			const home = plan.dir ? `【${plan.dir}】` : '';
			lines.push(`  ${plan.id} [${layer}] ${status}  ${home}${plan.title}`);
		}
		lines.push('');
	}

	// ---- 节点：父子关系从 parentSession → childId 的映射里推。 ----
	const bySession = new Map();
	for (const node of nodes) {
		if (node.childId) bySession.set(node.childId, node);
	}
	const children = new Map();
	for (const node of nodes) {
		const parent = bySession.get(node.parentSession);
		const key = parent ? parent.id : '';
		if (!children.has(key)) children.set(key, []);
		children.get(key).push(node);
	}

	const walk = (key, depth) => {
		for (const node of children.get(key) ?? []) {
			const layer = node.type === REVIEW_TYPE ? '复盘' : node.layer === null || node.layer === undefined ? '研究' : node.layer;
			const pad = '  '.repeat(depth);
			lines.push(`${pad}${node.id} [${layer}] ${label(node.status)}  ${node.topic}`);
			walk(node.id, depth + 1);
		}
	};
	walk('', 0);

	if (nodes.length === 0) lines.push('(树是空的：还没有派发过任何节点)');

	const failures = Object.entries(state.failures ?? {})
		.map(([template, used]) => `${template.replace(/^.*\//u, '')}:${used}`)
		.join(' ');
	const every = planStates?.REVIEW_EVERY ?? 3;

	return {
		tree: lines.join('\n').trimEnd(),
		failures: failures === '' ? '（还没有模板失败计数）' : `模板失败（每 ${every} 次建一份复盘）：${failures}`,
	};
}

/**
 * 一份提案的全文：正文 + 它派过的每个节点的结算。
 *
 * 这是树的展开层。树只给"哪一份、什么状态"，具体内容在这里按需拉取，
 * 一次只拉一份——所以树的简报再长也不会被正文撑爆。
 * @param plan - `plans` 投影里的一条。
 * @param nodes - 属于这份计划的节点。
 * @param planStates - 状态机服务。
 */
export function renderPlan(plan, nodes, planStates) {
	const raw = planStates === undefined
		? (plan.adopted === true ? 'submitted' : null)
		: planStates.statusOf(plan, nodes);
	const status = planStates?.labelOf?.(raw) ?? (raw ?? '草案');
	const kind = plan.type === REVIEW_TYPE ? '复盘' : plan.type === 'research' ? '研究' : plan.layer ?? '未分层';
	const lines = [];
	lines.push(`${plan.id} [${kind}] ${status}  ${plan.title}`);
	if (plan.dir) lines.push(`提案：${plan.dir}`);
	if (plan.templatePath) lines.push(`模板：${plan.templatePath}`);
	lines.push('');
	lines.push(String(plan.body ?? '(没有正文)').trimEnd());

	for (const node of nodes) {
		const nodeStatus = planStates?.labelOf?.(node.status) ?? node.status;
		lines.push('');
		lines.push(`—— 节点 ${node.id} · ${nodeStatus} ——`);
		if (node.reason) lines.push(`派发理由：${node.reason}`);
		if (node.verdict === null || node.verdict === undefined) {
			lines.push('（还没有结算）');
			continue;
		}
		lines.push(`判定：${node.verdict}`);
		if (node.conclusion) lines.push(`结论：${node.conclusion}`);
		if (node.evidence) lines.push(`证据：${node.evidence}`);
		if (node.artifacts) lines.push(`产物：${node.artifacts}`);
		if (node.pitfalls) lines.push(`坑：${node.pitfalls}`);
		if (node.where) lines.push(`去哪查：${node.where}`);
	}

	return lines.join('\n');
}

export function apply(ctx) {
	const { opOf } = ctx.planEvents;
	const status = ctx.planStates?.STATUS ?? STATUS;

	const init = () => ({ nodes: {}, failures: {}, nextId: 1 });

	/** 结算判定 → 节点状态。研究/复盘节点也一样落三态。 */
	const verdictStatus = (verdict) =>
		ctx.planStates?.VERDICT_STATUS?.[verdict] ??
		({ success: 'completed', reject: 'failed', shelved: 'input-required' }[verdict] ?? 'working');

	const fold = (state, event) => {
		const op = opOf(event);
		const data = event.data;

		if (op === 'dispatch') {
			return {
				...state,
				nextId: state.nextId + 1,
				nodes: {
					...state.nodes,
					[data.id]: {
						id: data.id,
						parentSession: data.parentSession,
						planId: data.planId ?? null,
						dir: data.dir ?? null,
						type: data.type,
						layer: data.layer,
						layerIndex: data.layerIndex,
						topic: data.topic,
						reason: data.reason,
						// 模板身份随派发一起记下来：失败计数要按模板，不按层。
						template: ctx.planStates?.templateKey?.({ templatePath: data.templatePath }) ?? null,
						status: status.WORKING,
						childId: data.childId,
						verdict: null,
						summary: null,
						// 结算的五项都留着：树要能回答"为什么进行不下去"。
						conclusion: null,
						evidence: null,
						artifacts: null,
						pitfalls: null,
						where: null,
					},
				},
			};
		}

		if (op === 'link') {
			// 派发记录先写、子会话 id 后到（团队插件自己生成 id），这里把两者绑起来。
			const node = state.nodes[data.id];
			if (!node || typeof data.childId !== 'string') return state;
			return { ...state, nodes: { ...state.nodes, [node.id]: { ...node, childId: data.childId } } };
		}

		if (op === 'file') {
			const node = state.nodes[data.id];
			if (!node) return state;
			const failures = { ...state.failures };
			// 只有模板造出来的计划节点才进计数；研究与复盘没有模板位。
			if (data.verdict === 'reject' && node.type === 'plan' && node.template) {
				failures[node.template] = (failures[node.template] ?? 0) + 1;
			}
			return {
				...state,
				failures,
				nodes: {
					...state.nodes,
					[node.id]: {
						...node,
						status: verdictStatus(data.verdict),
						verdict: data.verdict,
						summary: data.conclusion ?? null,
						conclusion: data.conclusion ?? null,
						evidence: data.evidence ?? null,
						artifacts: data.artifacts ?? null,
						pitfalls: data.pitfalls ?? null,
						where: data.where ?? null,
					},
				},
			};
		}

		if (op === 'status') {
			// 用户命令写的状态（授权 / 判死 / 恢复 / 否决）。不认识的码值原样不认。
			const node = state.nodes[data.id];
			if (!node) return state;
			const to = ctx.planStates?.isStatus?.(data.to) === true ? data.to : node.status;
			return { ...state, nodes: { ...state.nodes, [node.id]: { ...node, status: to } } };
		}

		if (op === 'cancel-dependents') {
			// 父交付时宿主自动把挂起的子任务置 canceled。已终结的节点不再改（单向门）。
			const canceled = new Set((Array.isArray(data.canceled) ? data.canceled : []).map(String));
			if (canceled.size === 0) return state;
			const nodes = { ...state.nodes };
			for (const id of canceled) {
				const node = nodes[id];
				if (!node) continue;
				if (ctx.planStates?.isTerminal?.(node.status) === true) continue;
				nodes[id] = { ...node, status: status.CANCELED };
			}
			return { ...state, nodes };
		}

		return state;
	};

	ctx.sessionProjections.register({
		key: 'nodes',
		stateVersion: 2,
		stateSchema,
		init,
		apply: fold,
		wire: { viewSchema: stateSchema, view: (state) => state },
	});

	ctx.tools.register(
		defineTool({
			name: 'plan_tree',
			description:
				'Report the plan tree: every plan and every dispatched node, each as one line of title and nine-state status ' +
				'(草案 / 计划 / 进行中 / 搁置 / 待授权 / 完成计划 / 失败计划 / 已取消 / 否决), plus per-template failure counts ' +
				'(three failures on one template create a review task F1, F2…). ' +
				'This is the index, not the content: bodies, dispatch reasons, and settlements are behind plan_show. ' +
				'Node statuses are read from the tree database first and fall back to this session projection, ' +
				'so a node canceled by its parent after this session was dispatched still shows as canceled.',
			parameters: {},
			output: {
				schema: {
					type: 'object',
					additionalProperties: false,
					properties: { tree: { type: 'string', required: true }, failures: { type: 'string', required: true } },
				},
				render: (_args, value) => [{ type: 'text', text: `${value.tree}\n\n${value.failures}` }],
			},
			execute(_args, exec) {
				if (!exec.agent) throw new Error('plan_tree requires an owning agent session');
				const raw = ctx.sessionProjections.stateOf(exec.agent.session, 'nodes');
				if (!raw) throw new Error('plan_tree: the nodes projection is not available in this session');
				const view = readView(ctx, exec.agent.session);
				return renderTree(view.nodes, view.plans, ctx.planStates);
			},
		}),
	);

	ctx.tools.register(
		defineTool({
			name: 'plan_show',
			description:
				'Show one proposal in full: its body, and every node it dispatched with the reason for dispatching and ' +
				'the six-line settlement that came back (verdict, conclusion, evidence, artifacts, pitfalls, where). ' +
				'Use plan_tree first to pick the id; this reads one proposal at a time so the tree stays an index.',
			parameters: {
				plan: { type: 'string', required: true, description: 'Plan id from plan_tree (for example p3 or F1).' },
			},
			output: {
				schema: { type: 'object', additionalProperties: false, properties: { text: { type: 'string', required: true } } },
				render: (_args, value) => [{ type: 'text', text: value.text }],
			},
			execute(args, exec) {
				if (!exec.agent) throw new Error('plan_show requires an owning agent session');
				const view = readView(ctx, exec.agent.session);
				const plans = view.plans;
				if (!plans) throw new Error('plan_show: the plans projection is not available in this session');
				const plan = plans.plans?.[args.plan];
				if (plan === undefined) {
					const known = Object.keys(plans.plans ?? {});
					throw new Error(
						`plan_show: no plan "${args.plan}" in this session (have ${known.length === 0 ? 'none' : known.join(', ')})`,
					);
				}
				const own = Object.values(view.nodes.nodes ?? {})
					.filter((node) => node.planId === plan.id)
					.sort((a, b) => nodeNumber(a.id) - nodeNumber(b.id));
				return { text: renderPlan(plan, own, ctx.planStates) };
			},
		}),
	);
}
