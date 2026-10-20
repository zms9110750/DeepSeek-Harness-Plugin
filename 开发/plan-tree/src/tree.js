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

/** 把多行结算压成一句，方便放进树行里。 */
function oneLine(text, limit = 160) {
	const flat = String(text ?? '').replace(/\s+/g, ' ').trim();
	return flat.length > limit ? `${flat.slice(0, limit)}…` : flat;
}

function planNumber(id) {
	const match = /^p(\d+)$/.exec(String(id ?? ''));
	return match === null ? Number.MAX_SAFE_INTEGER : Number(match[1]);
}

/**
 * 简报：计划（状态 + 为什么卡住）→ 节点树 → 每层计数。
 * @param state - `nodes` 投影。
 * @param plansState - `plans` 投影；缺了只是不报计划段（比如 record 被单独关掉）。
 * @param planStates - 状态机服务；缺了退化成一句话判断。
 */
export function renderTree(state, plansState, planStates) {
	const lines = [];
	const nodes = Object.values(state.nodes ?? {});

	// ---- 计划：树的主干。状态之外，失败/搁置的把坑带出来。 ----
	const plans = plansState === undefined ? [] : Object.values(plansState.plans ?? {});
	if (plans.length > 0) {
		lines.push('计划：');
		for (const plan of [...plans].sort((a, b) => planNumber(a.id) - planNumber(b.id))) {
			const own = nodes.filter((node) => node.planId === plan.id);
			const status = planStates === undefined
				? (plan.adopted === true ? '计划' : '草案')
				: planStates.statusOf(plan, own);
			const layer = plan.type === 'research' ? '研究' : plan.layer ?? '未分层';
			lines.push(`  ${plan.id} [${layer}] ${status}  ${plan.title}`);
			const settled = own.find((node) => node.verdict !== null && node.verdict !== undefined);
			if (settled !== undefined) {
				if (settled.pitfalls) lines.push(`      坑：${oneLine(settled.pitfalls)}`);
				else if (settled.summary) lines.push(`      结算：${oneLine(settled.summary)}`);
			}
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
			lines.push(`${pad}    派发：${node.reason}`);
			if (node.summary) lines.push(`${pad}    结算：${node.summary}`);
			if (node.pitfalls) lines.push(`${pad}    坑：${node.pitfalls}`);
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
				'Report the plan tree: every plan with its status (草案 / 计划 / 进行中 / 完成 / 失败 / 搁置), ' +
				'every dispatched node with its dispatch reason and settlement, and the per-layer rejection counts. ' +
				'For a plan that stalled or failed it carries the pitfall line — that is the point of reading it. ' +
				'Detail stays in each child session; this is the shape.',
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
}
