/**
 * plan-lock · 读写锁：没有子工作区就只能读。
 *
 * 锁的判据不是"有没有计划"，是"有没有一块写到哪儿都说得清的地方"（A-6 的本意：
 * 只读是为了逼出第一个子工作区、把可写范围定下来）。
 *
 * 三种权限档的处理：
 *   - `danger-full-access`（用户明确放开）：整套跳过；
 *   - 读不到的权限：不拦（不知道就不设限，避免把正常会话锁死）；
 *   - 其余（read-only / workspace-write）：只许写进已认领的子工作区。
 *
 * 这是**加限制**的守卫，不是开权限的通道：底下的文件沙箱照旧生效，
 * 这里只会让能写的更少，不会让本该被拒的写通过。
 *
 * @module @local/plan-tree/lock
 */
export const name = 'plan-lock';

export const inject = ['tools', 'sessionProjections', 'subWorkspaces', 'commands'];

/** 会改工作区的工具。其余一律当作只读，不拦。 */
const WRITE_TOOLS = new Set(['write', 'edit', 'pwsh', 'bash', 'delete']);

export function apply(ctx) {
	/**
	 * 用户用 `/plan off` 手动放开的会话。
	 * 放在 apply 里而不是模块顶层：这是会话级的活状态，插件一卸载就该跟着消失，
	 * 否则关掉再开回来，上一份的"已放开"会悄悄继承过来。
	 */
	const unlocked = new Set();

	const sandboxOf = (agent) => {
		try {
			const permissions = ctx.sessionProjections.stateOf(agent.session, 'permissions');
			return permissions?.sandbox ?? permissions?.mode ?? permissions?.preset;
		} catch {
			return undefined;
		}
	};

	ctx.tools.guard((exec) => {
		const agent = exec?.agent;
		if (!agent) return undefined;

		const toolName = exec?.tool?.name ?? exec?.name;
		if (!WRITE_TOOLS.has(toolName)) return undefined;

		if (unlocked.has(agent.session.id ?? agent.id)) return undefined;

		const sandbox = sandboxOf(agent);
		if (sandbox === undefined || sandbox === 'danger-full-access') return undefined;

		const scopes = ctx.subWorkspaces;
		const state = scopes.stateOf(agent);
		const claims = scopes.claimsOf(state);

		if (claims.length === 0) {
			return (
				`本会话还没有子工作区，只能读。记计划（plan_write）不受影响——它不落盘。\n` +
				`要开工：采纳一份计划并 plan_dispatch（带 workspace 就会认领那一块），` +
				`或 /sub-workspace add <绝对路径>，或用 /plan off 放开。`
			);
		}

		const args = exec?.args ?? exec?.input ?? {};
		const target = String(args.file_path ?? args.path ?? args.cwd ?? '');
		if (target === '') {
			return (
				`${toolName} 看不出要写哪个目录，而写只允许落在子工作区里：\n` +
				claims.map((claim) => `  ${claim.path}`).join('\n') +
				'\n要放开用 /plan off。'
			);
		}
		if (scopes.owns(state, target)) return undefined;

		return (
			`${target} 不在任何子工作区里：\n` +
			claims.map((claim) => `  ${claim.path}`).join('\n') +
			'\n要放开用 /plan off，或 /sub-workspace add <路径>。'
		);
	});

	ctx.commands.register({
		name: 'plan',
		description: '放开 / 收回"没有子工作区就只能读"的锁',
		input: { hint: 'on | off | status' },
		recordInput: false,
		handler({ agent, rawInput }) {
			const action = String(rawInput ?? '').trim().toLowerCase();
			const id = agent.session.id ?? agent.id;
			if (action === '' || action === 'status') {
				const claims = ctx.subWorkspaces.claimsOf(ctx.subWorkspaces.stateOf(agent));
				return {
					kind: 'success',
					text: unlocked.has(id)
						? '锁已放开：可以写工作区。用 /plan on 收回。'
						: claims.length === 0
							? '锁生效：没有子工作区，只能读。用 /plan off 放开。'
							: `锁生效：只能写进 ${claims.map((claim) => claim.path).join(' / ')}。`,
				};
			}
			if (action === 'off') {
				unlocked.add(id);
				return { kind: 'success', text: '锁已放开：可以写工作区。' };
			}
			if (action === 'on') {
				unlocked.delete(id);
				return { kind: 'success', text: '锁已收回。' };
			}
			return { kind: 'error', text: '用法：/plan on | off | status' };
		},
	});
}
