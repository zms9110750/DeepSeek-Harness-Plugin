/**
 * plan-debug · 开发期专用，**发布时不要装**。
 *
 * 正式形态里「采纳」是用户的决定：面板上的按钮，或 `/plan-adopt` 命令。
 * 模型没有这个工具——这样它就不能自己批准自己的计划。
 *
 * 这个包把那条授权临时交出去：装它，agent 能自己走完
 * write → adopt → dispatch 的闭环，方便反复验证派发链路；拆掉，采纳又只剩用户。
 * 它写的是**同一条** `op:'adopt'` 事件，所以和按钮没有区别。
 *
 * @module @local/plan-debug
 */
import { defineTool } from '@deepseek-ai/dsh-tools';

export const name = 'plan-debug';

export const inject = ['tools', 'sessionProjections', 'planEvents'];

export function apply(ctx) {
	const { append } = ctx.planEvents;

	ctx.tools.register(
		defineTool({
			name: 'plan_adopt',
			description:
				'DEV ONLY (from @local/plan-debug) — adopt a recorded plan on the user\'s behalf. ' +
				'In a normal install adoption is the user\'s decision in the plan panel and no such tool exists. ' +
				'Adoption is the fork point and cannot be undone.',
			parameters: { plan: { type: 'string', required: true, description: 'Plan id, for example p13.' } },
			output: {
				schema: {
					type: 'object',
					additionalProperties: false,
					properties: {
						id: { type: 'string', required: true },
						adopted: { type: 'boolean', required: true },
					},
				},
				render: (_args, value) => [{ type: 'text', text: `adopted ${value.id}` }],
			},
			execute(args, exec) {
				const agent = exec.agent;
				if (!agent) throw new Error('plan_adopt requires an owning agent session');
				const state = ctx.sessionProjections.stateOf(agent.session, 'plans');
				if (!state) throw new Error('plan_adopt: plans 投影不可用（plan-record 没装？）');
				const plan = state.plans[args.plan];
				if (plan === undefined) throw new Error(`plan_adopt: 没有这份计划：${args.plan}`);
				if (plan.rejected === true) throw new Error(`plan_adopt: ${plan.id} 已被否决，另写一份`);
				if (plan.adopted !== true) append(agent.session, 'adopt', { id: plan.id });
				return { id: plan.id, adopted: true };
			},
		}),
	);
}
