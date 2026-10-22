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
import { join } from 'node:path';

import { within } from './sub-workspace.js';

export const name = 'plan-lock';

export const inject = ['tools', 'sessionProjections', 'subWorkspaces', 'commands'];

/** 会改工作区的工具。其余一律当作只读，不拦。 */
const WRITE_TOOLS = new Set(['write', 'edit', 'pwsh', 'bash', 'delete']);

/**
 * 从官方任务板取可写范围（依赖劫持）。
 *
 * 他们的 `writeScopes` 明确是 **advisory、不是锁**（源码注释："without treating it as a lock"），
 * 而且路径是 **workspace 相对**、不许绝对路径与 `..`。我们把它当作唯一的声明处，
 * 自己来执行：相对路径按会话 cwd 换算成绝对路径，交给下面的守卫。
 *
 * 读不到就返回空 = 放行：任务板是实验包的私有结构，字段一变我们就读不到，
 * 那时候宁可退回"不设限"，也不能把会话锁死。
 */
function scopesFromTasks(ctx, agent) {
	try {
		const teams = ctx.get?.('agentTeams');
		if (teams === undefined || typeof teams.tryMembership !== 'function' || typeof teams.listTasks !== 'function') return [];
		const membership = teams.tryMembership(agent);
		if (membership === undefined) return [];
		const root = agent.session?.header?.cwd;
		if (typeof root !== 'string' || root === '') return [];
		const tasks = teams.listTasks(membership) ?? [];
		const mine = membership.target ?? membership.id;
		const out = [];
		for (const task of tasks) {
			// 没有 owner 的任务是"谁都能认"，也算进来；有 owner 的只看自己那份。
			if (task.owner !== undefined && task.owner !== null && task.owner !== mine) continue;
			for (const scope of task.writeScopes ?? []) {
				const relative = String(scope).replace(/^[\\/]+/, '').replace(/\//g, '\\');
				out.push({ path: join(root, relative), planId: null, task: task.id });
			}
		}
		return out;
	} catch {
		return [];
	}
}

export function apply(ctx) {
	/**
	 * 用户用 `/plan-tree off` 手动放开的会话。
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
		// 两处声明合并：我们自己的 claim 记录 + 官方任务板的 writeScopes。
		// 任务板是将来唯一该用的地方；claim 留着是为了没装团队时还能用。
		// 再按"必须在工作区里"过滤一遍：库里已存在的越界记录一律不算数（老记录不复活）。
		const root = scopes.rootOf(agent);
		const claims = [...scopes.claimsOf(state), ...scopesFromTasks(ctx, agent)]
			.filter((claim) => root === undefined || within(root, claim.path));

		// 一块都没认领 = 这一支还没有划定范围 = 谈不上并发，因此**不拦**。
		// 锁的职责是别让两支写同一块地方，不是给每个新会话上枷锁。
		// （早期版本在这里直接拒绝，结果新开的会话一进来就写不了任何东西。）
		if (claims.length === 0) return undefined;

		const HOW = [
			'',
			'子工作区既是**并发锁**（两条分支不能写同一个目录），也是**用户过目过的写入范围**。所以别绕，按情况选一条：',
			'  · 用户已许可这个目录 → 调 `sub_workspace(action:"add", path:"<绝对路径>")` 自己划出范围，然后继续写。',
			'  · 用户还没许可 → 先 `plan_write` 写一份提案给用户过目；派发时在 `plan_dispatch` 里带 `workspace`，那一刻会自动认领。',
			'  · 只想放开当前会话 → `/plan-tree off`。',
		].join('\n');

		const args = exec?.args ?? exec?.input ?? {};
		const target = String(args.file_path ?? args.path ?? args.cwd ?? '');
		if (target === '') {
			// 没有路径字段的工具（`pwsh` / `bash`）看命令文本：里面出现了认领目录就放行。
			// 模型很爱用 `pwsh -Command "Set-Content ..."` 写文件，而命令文本里没有路径字段，
			// 早先一律按"看不出要写哪儿"拒掉，等于把整条写路堵死（实测：两个子都写不进去）。
			const command = String(args.command ?? args.cmd ?? args.script ?? '');
			if (command !== '' && claims.some((claim) => command.toLowerCase().includes(String(claim.path).toLowerCase()))) {
				return undefined;
			}
			return (
				`${toolName} 看不出要写哪个目录，而写只允许落在子工作区里：\n` +
				claims.map((claim) => `  ${claim.path}`).join('\n') +
				HOW
			);
		}
		if (scopes.owns(state, target)) return undefined;

		return `\`${target}\` 不在任何子工作区里：\n` + claims.map((claim) => `  ${claim.path}`).join('\n') + HOW;
	});

	ctx.commands.register({
		name: 'plan-tree',
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
						? '锁已放开：可以写工作区。用 /plan-tree on 收回。'
						: claims.length === 0
							? '锁生效：没有子工作区，只能读。用 /plan-tree off 放开。'
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
			return { kind: 'error', text: '用法：/plan-tree on | off | status' };
		},
	});
}
