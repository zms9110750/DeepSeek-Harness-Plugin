/**
 * plan-mode-probe · 一次性探针：把会话切到 `plan-write` 预设，用来在无头里验计划模式。
 * 只注册一个工具，不改任何配置、不碰 plan-tree。
 *
 * @module @local/plan-mode-probe
 */
import { defineTool } from '@deepseek-ai/dsh-tools';

export const name = 'plan-mode-probe';

export const inject = ['tools', 'permissionPresets', 'sessionProjections'];

export function apply(ctx) {
	ctx.tools.register(
		defineTool({
			name: 'set_plan_mode',
			description: 'Probe only: switch this session to the plan-write permission preset.',
			parameters: {},
			output: {
				schema: { type: 'object', additionalProperties: false, properties: { text: { type: 'string', required: true } } },
				render: (_args, value) => [{ type: 'text', text: value.text }],
			},
			execute(_args, exec) {
				const agent = exec.agent;
				if (!agent) throw new Error('set_plan_mode requires an owning agent session');
				ctx.permissionPresets.set(agent.session, 'plan-write');
				const state = ctx.sessionProjections.stateOf(agent.session, 'permissions');
				return { text: `preset switched; permissions=${JSON.stringify(state)}` };
			},
		}),
	);
}
