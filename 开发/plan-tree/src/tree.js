/**
 * plan-tree · 执行节点：`nodes` 投影与树简报。
 *
 * 只有派发过的计划才在树上（A-2）。节点状态是 open / success / reject / shelved，
 * 与计划状态是多对一：一份计划最多派发一次，所以现在是一对一，但结构上留着多对一。
 *
 * 计数在这里改，不另设服务：否决 +1、成功归零、搁置不动。计数按层分开、层是并存的。
 *
 * 简报里**计划与节点都报**，而且结算要带出"为什么进行不下去"——
 * 状态只是标签，坑才是下次不踩的东西。
 *
 * @module @local/plan-tree/tree
 */
import { z } from 'zod';
import { defineTool } from '@deepseek-ai/dsh-tools';

export const name = 'plan-tree';

export const inject = ['tools', 'sessionProjections', 'planEvents', 'planStates'];

const stateSchema = z.object({
	nodes: z.record(z.string(), z.any()),
	counts: z.record(z.string(), z.number()),
	nextId: z.number(),
});

function planNumber(id) {
	const match = /^p(\d+)$/.exec(String(id ?? ''));
	return match === null ? Number.MAX_SAFE_INTEGER : Number(match[1]);
}

/** 节点 id 也是 n<数字>，排序要按数值而不是字典序（否则 n10 排在 n2 前面）。 */
function nodeNumber(id) {
	const match = /^n(\d+)$/.exec(String(id ?? ''));
	return match === null ? Number.MAX_SAFE_INTEGER : Number(match[1]);
}

/**
 * 简报：计划（状态）→ 节点树 → 每层计数。
 *
 * **只报标题和状态**：树是索引，不是内容。正文、派发理由、结算六项都归 `plan_show`。
 * 一眼要能看出"哪一支卡住了"，靠的是状态；"为什么卡住"要展开那一条才需要。
 * @param state - `nodes` 投影。
 * @param plansState - `plans` 投影；缺了只是不报计划段（比如 record 被单独关掉）。
 * @param planStates - 状态机服务；缺了退化成一句话判断。
 */
export function renderTree(state, plansState, planStates) {
	const lines = [];
	const nodes = Object.values(state.nodes ?? {});

	// ---- 计划：树的主干。 ----
	const plans = plansState === undefined ? [] : Object.values(plansState.plans ?? {});
	if (plans.length > 0) {
		lines.push('计划：');
		for (const plan of [...plans].sort((a, b) => planNumber(a.id) - planNumber(b.id))) {
			const own = nodes.filter((node) => node.planId === plan.id);
			const raw = planStates === undefined
				? (plan.adopted === true ? 'submitted' : null)
				: planStates.statusOf(plan, own);
			// 存储与协议用码值，树给人看，所以打文案。
			const status = planStates?.labelOf?.(raw) ?? (raw ?? '草案');
			const layer = plan.type === 'research' ? '研究' : plan.layer ?? '未分层';
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
			const layer = node.layer === null ? '研究' : node.layer;
			const pad = '  '.repeat(depth);
			lines.push(`${pad}${node.id} [${layer}] ${node.status}  ${node.topic}`);
			walk(node.id, depth + 1);
		}
	};
	walk('', 0);

	if (nodes.length === 0) lines.push('(树是空的：还没有派发过任何节点)');

	const counts = Object.entries(state.counts ?? {})
		.map(([layer, used]) => `${layer}:${used}`)
		.join(' ');

	return { tree: lines.join('\n').trimEnd(), counts: counts === '' ? '（还没有计数）' : counts };
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
	const lines = [];
	lines.push(`${plan.id} [${plan.type === 'research' ? '研究' : plan.layer ?? '未分层'}] ${status}  ${plan.title}`);
	if (plan.dir) lines.push(`提案：${plan.dir}`);
	lines.push('');
	lines.push(String(plan.body ?? '(没有正文)').trimEnd());

	for (const node of nodes) {
		lines.push('');
		lines.push(`—— 节点 ${node.id} · ${node.status} ——`);
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

	const init = () => ({ nodes: {}, counts: {}, nextId: 1 });

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
						status: 'open',
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

		if (op === 'file') {
			const node = state.nodes[data.id];
			if (!node) return state;
			const counts = { ...state.counts };
			if (data.verdict === 'success' && node.layer) counts[node.layer] = 0;
			if (data.verdict === 'reject' && node.layer) counts[node.layer] = (counts[node.layer] ?? 0) + 1;
			return {
				...state,
				counts,
				nodes: {
					...state.nodes,
					[node.id]: {
						...node,
						status: data.verdict,
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

		return state;
	};

	ctx.sessionProjections.register({
		key: 'nodes',
		stateVersion: 1,
		stateSchema,
		init,
		apply: fold,
		wire: { viewSchema: stateSchema, view: (state) => state },
	});

	ctx.tools.register(
		defineTool({
			name: 'plan_tree',
			description:
				'Report the plan tree: every plan and every dispatched node, each as one line of title and status ' +
				'(草案 / 计划 / 进行中 / 完成 / 失败 / 搁置), plus the per-layer rejection counts. ' +
				'This is the index, not the content: bodies, dispatch reasons, and settlements are behind plan_show. ' +
				'A discouraged or failed node shows its status here; read that line with plan_show to learn why it stalled.',
			parameters: {},
			output: {
				schema: {
					type: 'object',
					additionalProperties: false,
					properties: { tree: { type: 'string', required: true }, counts: { type: 'string', required: true } },
				},
				render: (_args, value) => [{ type: 'text', text: `${value.tree}\n\n${value.counts}` }],
			},
			execute(_args, exec) {
				if (!exec.agent) throw new Error('plan_tree requires an owning agent session');
				const state = ctx.sessionProjections.stateOf(exec.agent.session, 'nodes');
				if (!state) throw new Error('plan_tree: the nodes projection is not available in this session');
				const plans = ctx.sessionProjections.stateOf(exec.agent.session, 'plans');
				return renderTree(state, plans, ctx.planStates);
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
				plan: { type: 'string', required: true, description: 'Plan id from plan_tree (for example p3).' },
			},
			output: {
				schema: { type: 'object', additionalProperties: false, properties: { text: { type: 'string', required: true } } },
				render: (_args, value) => [{ type: 'text', text: value.text }],
			},
			execute(args, exec) {
				if (!exec.agent) throw new Error('plan_show requires an owning agent session');
				const plans = ctx.sessionProjections.stateOf(exec.agent.session, 'plans');
				if (!plans) throw new Error('plan_show: the plans projection is not available in this session');
				const plan = plans.plans?.[args.plan];
				if (plan === undefined) {
					const known = Object.keys(plans.plans ?? {});
					throw new Error(
						`plan_show: no plan "${args.plan}" in this session (have ${known.length === 0 ? 'none' : known.join(', ')})`,
					);
				}
				const state = ctx.sessionProjections.stateOf(exec.agent.session, 'nodes');
				const own = Object.values(state?.nodes ?? {})
					.filter((node) => node.planId === plan.id)
					.sort((a, b) => nodeNumber(a.id) - nodeNumber(b.id));
				return { text: renderPlan(plan, own, ctx.planStates) };
			},
		}),
	);
}
