/**
 * plan-tree · 执行节点：`nodes` 投影与树简报。
 *
 * 只有派发过的计划才在树上（A-2）。节点状态是 open / success / reject / shelved，
 * 与计划状态是多对一：一份计划最多派发一次，所以现在是一对一，但结构上留着多对一。
 *
 * 计数在这里改，不另设服务：否决 +1、成功归零、搁置不动。计数按层分开、层是并存的。
 *
 * @module @local/plan-tree/tree
 */
import { z } from 'zod';
import { defineTool } from '@deepseek-ai/dsh-tools';

export const name = 'plan-tree';

export const inject = ['tools', 'sessionProjections', 'planEvents'];

const stateSchema = z.object({
	nodes: z.record(z.string(), z.any()),
	counts: z.record(z.string(), z.number()),
	nextId: z.number(),
});

export function renderTree(state) {
	const bySession = new Map();
	for (const node of Object.values(state.nodes)) {
		if (node.childId) bySession.set(node.childId, node);
	}
	const children = new Map();
	for (const node of Object.values(state.nodes)) {
		const parent = bySession.get(node.parentSession);
		const key = parent ? parent.id : '';
		if (!children.has(key)) children.set(key, []);
		children.get(key).push(node);
	}

	const lines = [];
	const walk = (key, depth) => {
		for (const node of children.get(key) ?? []) {
			const layer = node.layer === null ? '研究' : node.layer;
			const pad = '  '.repeat(depth);
			lines.push(`${pad}${node.id} [${layer}] ${node.status}  ${node.topic}`);
			lines.push(`${pad}    派发：${node.reason}`);
			if (node.summary) lines.push(`${pad}    结算：${node.summary}`);
			walk(node.id, depth + 1);
		}
	};
	walk('', 0);

	if (lines.length === 0) lines.push('(树是空的：还没有派发过任何节点)');
	const counts = Object.entries(state.counts ?? {})
		.map(([layer, used]) => `${layer}:${used}`)
		.join(' ');
	return { tree: lines.join('\n'), counts: counts === '' ? '（还没有计数）' : counts };
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
						summary: data.conclusion,
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
				'Report the plan tree: shape, each node\'s layer and status, one line of dispatch reason, one line of settlement. ' +
				'It carries no detail by design — the detail lives in each child session and in the settlement fields.',
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
				return renderTree(state);
			},
		}),
	);
}
