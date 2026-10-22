/**
 * plan-settle · 归档一个节点的结算（出口锚五项）。
 *
 * 五项必填：结论、证据、产物、坑、去哪查。少一项就不算结算完成——这是 B-02 的
 * 硬约定，因为父的上下文里只留这几句，缺了就等于这段活没留下任何可查的东西。
 *
 * 裁决只在两种情况下动计数：reject 让该层 +1，success 归零；shelved 不动。
 *
 * @module @local/plan-tree/settle
 */
import { defineTool } from '@deepseek-ai/dsh-tools';

export const name = 'plan-settle';

export const inject = ['tools', 'sessionProjections', 'planEvents'];

const VERDICTS = ['success', 'reject', 'shelved'];

export function apply(ctx) {
	const { append } = ctx.planEvents;

	ctx.tools.register(
		defineTool({
			name: 'plan_file',
			description:
				'File the settlement of one dispatched node into the plan tree. Call it once, after the child returned its six lines. ' +
				'verdict is what the node amounts to: success (it holds), reject (it does not — it counts toward the template\'s ' +
				'failure total, and three failures on one template create a review task), ' +
				'shelved (set aside; it counts toward nothing). The five fields are what later readers get.',
			parameters: {
				node: { type: 'string', required: true, description: 'Node id, for example n3.' },
				verdict: { type: 'string', required: true, enum: [...VERDICTS], description: 'success | reject | shelved' },
				conclusion: { type: 'string', required: true, description: 'What was done, or what could not be done.' },
				evidence: { type: 'string', required: true, description: 'How it was confirmed.' },
				artifacts: { type: 'string', required: true, description: 'Paths created or changed.' },
				pitfalls: { type: 'string', required: true, description: 'The route that does not work.' },
				where: { type: 'string', required: true, description: 'Where to read the detail.' },
			},
			output: {
				schema: {
					type: 'object',
					additionalProperties: false,
					properties: {
						filed: { type: 'string', required: true },
						verdict: { type: 'string', required: true },
						status: { type: 'string' },
						templateFailures: { type: 'integer' },
						review: { type: 'string' },
						reviewHeld: { type: 'string' },
						canceled: { type: 'array', items: { type: 'string' } },
					},
				},
				render: (_args, value) => {
					const extra = [
						value.status === undefined ? '' : `→ ${value.status}`,
						value.templateFailures === undefined ? '' : `模板失败 ${value.templateFailures} 次`,
						value.review === undefined ? '' : `已建复盘 ${value.review}`,
						value.reviewHeld === undefined ? '' : `已有未交付复盘 ${value.reviewHeld}，本次不再新建`,
						(value.canceled ?? []).length === 0 ? '' : `已取消挂起子任务 ${value.canceled.join(', ')}`,
					].filter((part) => part !== '');
					return [{ type: 'text', text: `filed ${value.filed} as ${value.verdict}${extra.length === 0 ? '' : `（${extra.join('；')}）`}` }];
				},
			},
			execute(args, exec) {
				const agent = exec.agent;
				if (!agent) throw new Error('plan_file requires an owning agent session');

				const state = ctx.sessionProjections.stateOf(agent.session, 'nodes');
				if (!state) throw new Error('plan_file: the nodes projection is not available in this session');
				const node = state.nodes[args.node];
				if (!node) throw new Error(`plan_file: no node "${args.node}" in this tree`);
				// 九态：只有终结态不能再结算；挂起中的节点可以被结算（判死/完成/再搁置）。
				if (ctx.planStates?.isTerminal?.(node.status) === true) {
					throw new Error(`plan_file: node "${args.node}" is already ${ctx.planStates?.labelOf?.(node.status) ?? node.status}`);
				}

				// 写入口顺带做宿主动作：失败累计到阈值会建复盘任务，成功会取消挂起的子任务。
				const info = append(agent.session, 'file', {
					id: args.node,
					verdict: args.verdict,
					conclusion: args.conclusion,
					evidence: args.evidence,
					artifacts: args.artifacts,
					pitfalls: args.pitfalls,
					where: args.where,
				});

				return {
					filed: args.node,
					verdict: args.verdict,
					status: ctx.planStates?.VERDICT_STATUS?.[args.verdict] ?? undefined,
					...(info?.failure === undefined ? {} : { templateFailures: info.failure.failed }),
					...(info?.reviewId === undefined ? {} : { review: info.reviewId }),
					...(info?.reviewSuppressed === undefined ? {} : { reviewHeld: info.reviewSuppressed }),
					...(Array.isArray(info?.canceled) && info.canceled.length > 0 ? { canceled: info.canceled } : {}),
				};
			},
		}),
	);
}
