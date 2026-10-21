/**
 * sub-workspace · 子工作区：这个会话（或它派出去的那一支）凭什么能写某个目录。
 *
 * 写宽由父指定、后代不可改（A-1）：一条 claim 就是"某个计划把某个目录划给了某个子会话"。
 * 它是只读锁的宿主数据——锁不看"有没有计划"，看"有没有一块写到哪儿都说得清的地方"。
 *
 * 读范围（A-5：以用户选的工作区为基准、可读别的项目、范围外逐个授权）**还没做**。
 *
 * @module @local/plan-tree/sub-workspace
 */
import { z } from 'zod';
import { defineTool } from '@deepseek-ai/dsh-tools';

export const name = 'sub-workspace';

export const inject = ['commands', 'sessionProjections', 'planEvents', 'tools'];

const stateSchema = z.object({
	claims: z.record(z.string(), z.any()),
});

/** 路径比较用：统一斜杠、去尾斜杠、Windows 上不分大小写。 */
export function normPath(path) {
	return String(path ?? '')
		.trim()
		.replace(/\//g, '\\')
		.replace(/\\+$/g, '')
		.toLowerCase();
}

/** `child` 是不是在 `parent` 里面（按目录分隔符对齐，不认 `/a/bc` 属于 `/a/b`）。 */
export function within(parent, child) {
	const base = normPath(parent);
	const target = normPath(child);
	if (base === '') return false;
	if (target === base) return true;
	return target.startsWith(base.endsWith('\\') ? base : `${base}\\`);
}

export function apply(ctx) {
	const { append, opOf } = ctx.planEvents;

	const init = () => ({ claims: {} });

	const fold = (state, event) => {
		const op = opOf(event);
		if (op !== 'claim' && op !== 'release') return state;
		const data = event.data;
		const key = normPath(data.path);
		if (key === '') return state;
		const claims = { ...state.claims };
		if (op === 'release') {
			delete claims[key];
			return { ...state, claims };
		}
		claims[key] = { path: data.path, planId: data.planId ?? null, by: data.by ?? null, at: data.at ?? null };
		return { ...state, claims };
	};

	ctx.sessionProjections.register({
		key: 'subWorkspaces',
		stateVersion: 1,
		stateSchema,
		init,
		apply: fold,
		wire: { viewSchema: stateSchema, view: (state) => state },
	});

	const stateOf = (agent) => ctx.sessionProjections.stateOf(agent.session, 'subWorkspaces');

	ctx.provide('subWorkspaces', {
		stateOf,

		/** 这个会话的根目录（会话自己的 cwd）。 */
		rootOf(agent) {
			return agent.session.header.cwd ?? undefined;
		},

		claimsOf(state) {
			return Object.values(state?.claims ?? {});
		},

		/** 这个路径落在哪一块被认领的目录里（含自身）。 */
		claimFor(state, path) {
			const found = Object.values(state?.claims ?? {}).find((claim) => within(claim.path, path));
			return found;
		},

		owns(state, path) {
			return this.claimFor(state, path) !== undefined;
		},

		claim(agent, path, planId) {
			const target = String(path ?? '').trim();
			if (target === '') throw new Error('sub-workspace: 空的路径');
			append(agent.session, 'claim', { path: target, planId: planId ?? null, by: agent.session.id, at: Date.now() });
			return target;
		},

		release(agent, path) {
			append(agent.session, 'release', { path: String(path ?? '').trim() });
		},
	});

	ctx.commands.register({
		name: 'sub-workspace',
		description: '看/加/删子工作区（可写范围）',
		input: { hint: 'list | add <路径> | remove <路径>' },
		recordInput: false,
		handler({ agent, rawInput }) {
			const raw = String(rawInput ?? '').trim();
			const space = raw.indexOf(' ');
			const action = (space < 0 ? raw : raw.slice(0, space)).toLowerCase();
			const rest = space < 0 ? '' : raw.slice(space + 1).trim();
			const state = stateOf(agent);
			const claims = Object.values(state?.claims ?? {});

			if (action === '' || action === 'list') {
				if (claims.length === 0) {
					return { kind: 'success', text: `还没有子工作区。会话根：${agent.session.header.cwd ?? '(未知)'}` };
				}
				return { kind: 'success', text: claims.map((claim) => `${claim.path}${claim.planId ? `  ← ${claim.planId}` : ''}`).join('\n') };
			}
			if (action === 'add') {
				if (rest === '') return { kind: 'error', text: '用法：/sub-workspace add <绝对路径>' };
				append(agent.session, 'claim', { path: rest, planId: null, by: agent.session.id, at: Date.now() });
				return { kind: 'success', text: `已认领 ${rest}` };
			}
			if (action === 'remove') {
				if (rest === '') return { kind: 'error', text: '用法：/sub-workspace remove <路径>' };
				append(agent.session, 'release', { path: rest });
				return { kind: 'success', text: `已释放 ${rest}` };
			}
			return { kind: 'error', text: '用法：/sub-workspace list | add <路径> | remove <路径>' };
		},
	});

	ctx.tools.register(
		defineTool({
			name: 'sub_workspace',
			description:
				'Claim, release, or list the sub-workspaces this session may write. A sub-workspace is two things at once: ' +
				'a concurrency lock (two branches must not write one directory) and the scope the user reviews before work starts. ' +
				'Call this only for a directory the user has already allowed — for example they said to build something in a folder. ' +
				'When the user has NOT yet allowed it, do not claim anything: write a proposal with plan_write so the user can review it, ' +
				'and claim the directory at dispatch time through plan_dispatch(workspace).',
			parameters: {
				action: { type: 'string', required: true, enum: ['list', 'add'], description: 'What to do. Releasing a claim is the user\'s call, not the model\'s.' },
				path: { type: 'string', description: 'Absolute directory to claim. Required for add.' },
				plan: { type: 'string', description: 'Optional plan id this claim belongs to.' },
			},
			output: {
				schema: {
					type: 'object',
					additionalProperties: false,
					properties: { text: { type: 'string', required: true } },
				},
				render: (_args, value) => [{ type: 'text', text: value.text }],
			},
			execute(args, exec) {
				const agent = exec.agent;
				if (!agent) throw new Error('sub_workspace requires an owning agent session');
				const state = stateOf(agent);
				const claims = Object.values(state?.claims ?? {});

				if (args.action === 'list') {
					if (claims.length === 0) return { text: `还没有子工作区。会话根：${agent.session.header.cwd ?? '(未知)'}` };
					return { text: claims.map((claim) => `${claim.path}${claim.planId ? `  ← ${claim.planId}` : ''}`).join('\n') };
				}
				if (args.action === 'add') {
					const path = String(args.path ?? '').trim();
					if (path === '') throw new Error('sub_workspace add: path is required (an absolute directory)');
					ctx.get('subWorkspaces').claim(agent, path, args.plan);
					return { text: `已认领 ${path}——这一支现在只能写这里面的东西。` };
				}
				// 释放只能由用户来：模型自己撤掉认领，等于把锁自己打开（实测发生过）。
				throw new Error(`sub_workspace: unknown action "${args.action}"；释放认领请让用户用 /sub-workspace remove`);
			},
		}),
	);
}
