/**
 * plan-lock · 读写锁：没有子工作区就只能读；外加一个「计划模式」权限档。
 *
 * 锁的判据不是"有没有计划"，是"有没有一块写到哪儿都说得清的地方"（A-6 的本意：
 * 只读是为了逼出第一个子工作区、把可写范围定下来）。
 *
 * 权限档的处理：
 *   - `plan-write`（计划模式，本插件注入的权限预设）：没有子工作区就**一律不给写**
 *     （跟真的计划模式一样）；有子工作区时只许写范围内。计划模式优先于 sandbox：
 *     用户显式选了这个档，即使 sandbox 被改成 danger-full-access 也照样按计划模式拦。
 *   - `danger-full-access`（用户明确放开）：普通档整套跳过；
 *   - 读不到的权限：不拦（不知道就不设限，避免把正常会话锁死）；
 *   - 其余（read-only / workspace-write）：只许写进已认领的子工作区。
 *
 * `/plan-tree off` 是永远排在最前面的逃生口：计划模式也先走它。
 *
 * 这是**加限制**的守卫，不是开权限的通道：底下的文件沙箱照旧生效，
 * 这里只会让能写的更少，不会让本该被拒的写通过。
 *
 * @module @local/plan-tree/lock
 */
import { isAbsolute, join } from 'node:path';

import { within } from './sub-workspace.js';

export const name = 'plan-lock';

export const inject = ['tools', 'sessionProjections', 'subWorkspaces', 'commands', 'permissionPresets'];

/** 计划模式的权限预设名：也是 permission-presets 目录里的 id。 */
export const PLAN_PRESET = 'plan-write';

/**
 * 注入到权限目录里的档位。
 *
 * sandbox 用 workspace-write 是双保险：宿主文件沙箱再把工作区边界兜一层，
 * 我们的 guard 只在里面收窄到已声明的子工作区。approval 用 never：计划模式
 * 不该自己发起提权审批——要放宽是用户切档的事。
 */
const PLAN_SPEC = {
	sandbox: 'workspace-write',
	approval: 'never',
	name: '计划模式（只写子工作区）',
	description: '写只允许落在已声明的子工作区内；没有子工作区时写入一律被拒。',
};

/** 会改工作区的工具。其余一律当作只读，不拦。 */
const WRITE_TOOLS = new Set(['write', 'edit', 'pwsh', 'bash', 'delete', 'plan_export']);

/**
 * 取这次调用的参数：真实 exec 把模型给的参数放在 `arguments`（宿主在
 * createExecution 里冻结的 JSON），不是 `args`/`input`——照老字段读会永远读空，
 * 守卫就会把"有认领时的所有写工具"都判成"看不出要写哪个目录"。
 * `args`/`input` 只作老桩与旧版形状的兜底。
 */
function argsOf(exec) {
	const raw = exec?.arguments ?? exec?.args ?? exec?.input;
	return typeof raw === 'object' && raw !== null ? raw : {};
}

/** 工具名：真实 exec 是 `name`，老桩是 `tool.name`。 */
function toolNameOf(exec) {
	return exec?.tool?.name ?? exec?.name;
}

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

	const permissionStateOf = (agent) => {
		try {
			return ctx.sessionProjections.stateOf(agent.session, 'permissions');
		} catch {
			return undefined;
		}
	};

	const sandboxOf = (agent) => {
		const state = permissionStateOf(agent);
		return state?.sandbox ?? state?.mode ?? state?.preset;
	};

	/** 当前会话是不是计划模式（权限档是 plan-write）。 */
	const isPlanMode = (agent) => permissionStateOf(agent)?.preset === PLAN_PRESET;

	// ---- 计划模式这个权限档：往 permission-presets 目录里注入一条 ----
	// 官方没有注册 API，只能就地改它实例上的表（同 gate-switch12 的做法）。
	// 所以两件事必须同时成立，否则禁用之后会留下撤不掉的状态：
	//   1. 注入挂在 ctx.effect 上——disposer 随 fiber 走；
	//   2. 卸载时删掉这个键（原来有就还原），并**再发一次 catalog-changed**，
	//      否则客户端菜单里还挂着「计划模式」，而守卫已经没了。
	// 只动自己这个键，不清空重排。
	ctx.effect(() => {
		const table = ctx.permissionPresets?.presets;
		if (table === undefined || table === null) {
			ctx.logger?.warn?.('plan-lock: permissionPresets.presets 不可用，plan-write 预设未注入');
			return undefined;
		}
		const had = Object.prototype.hasOwnProperty.call(table, PLAN_PRESET);
		const previous = had ? table[PLAN_PRESET] : undefined;

		table[PLAN_PRESET] = PLAN_SPEC;
		ctx.emit('permission-presets/catalog-changed');

		return () => {
			if (had) table[PLAN_PRESET] = previous;
			else delete table[PLAN_PRESET];
			ctx.emit('permission-presets/catalog-changed');
		};
	}, 'plan-lock: 注入 plan-write 预设');

	/** 拒绝文案里"怎么加范围"三步：两个模式共用。 */
	const HOW_ADD = [
		'  · 用户已许可这个目录 → 调 `sub_workspace(action:"add", path:"<工作区里的绝对路径>")` 自己划出范围，然后继续写。',
		'  · 用户还没许可 → 先 `plan_write` 写一份提案给用户过目；派发时在 `plan_dispatch` 里带 `workspace`，那一刻会自动认领。',
		'  · 只想放开当前会话 → `/plan-tree off`（计划模式也认这个逃生口）。',
	].join('\n');

	/** 计划模式的拒绝文案必须自带：当前工作区、已声明范围、怎么加范围、已知代价。 */
	const planText = (claims, root) =>
		[
			`当前工作区：${root ?? '(未知)'}`,
			claims.length === 0 ? '已声明范围：（无）' : ['已声明范围：', ...claims.map((claim) => `  ${claim.path}`)].join('\n'),
			'怎么加范围：',
			HOW_ADD,
			'已知代价：计划模式下 pwsh 也算写工具——没有子工作区时连只读命令也会被拒；有子工作区时命令文本里必须出现认领目录才放行。',
		].join('\n');

	ctx.tools.guard((exec) => {
		const agent = exec?.agent;
		if (!agent) return undefined;

		const toolName = toolNameOf(exec);
		if (!WRITE_TOOLS.has(toolName)) return undefined;

		// 逃生口排第一：计划模式也先走它。
		if (unlocked.has(agent.session.id ?? agent.id)) return undefined;

		const planMode = isPlanMode(agent);

		const scopes = ctx.subWorkspaces;
		const state = scopes.stateOf(agent);
		const root = scopes.rootOf(agent);
		// 两处声明合并：我们自己的 claim 记录 + 官方任务板的 writeScopes。
		// 任务板是将来唯一该用的地方；claim 留着是为了没装团队时还能用。
		// 再按"必须在工作区里"过滤一遍：库里已存在的越界记录一律不算数（老记录不复活）。
		const claims = [...scopes.claimsOf(state), ...scopesFromTasks(ctx, agent)]
			.filter((claim) => root === undefined || within(root, claim.path));

		const args = argsOf(exec);
		// 路径工具：真 exec 的形状是 file_path（write/edit/read），delete/plan_export 还有 path。
		// 相对路径按会话工作区解析——write 一般给绝对路径，plan_export 允许相对路径。
		const rawPath = String(args.file_path ?? args.path ?? '');
		const target = rawPath === '' ? '' : isAbsolute(rawPath) ? rawPath : join(root ?? process.cwd(), rawPath);
		// 没有路径字段的工具（pwsh / bash）看命令文本：里面出现了认领目录就放行。
		const command = String(args.command ?? args.cmd ?? args.script ?? '');

		// 计划模式：没有子工作区 = 一律不给写（跟真的计划模式一样）。
		if (planMode && claims.length === 0) {
			return `计划模式：写入被拒绝——没有声明任何子工作区。\n${planText(claims, root)}`;
		}

		// 普通模式：读不到权限 / danger-full-access 整套跳过；没有认领 = 不拦。
		// （"全拒"只属于 plan-write 档，普通档一条都不改，避免把新会话锁死。）
		if (!planMode) {
			const sandbox = sandboxOf(agent);
			if (sandbox === undefined || sandbox === 'danger-full-access') return undefined;
			if (claims.length === 0) return undefined;
		}

		const HOW = planMode
			? `计划模式：写只允许落在已声明的子工作区里。\n${planText(claims, root)}`
			: [
					'',
					'子工作区既是**并发锁**（两条分支不能写同一个目录），也是**用户过目过的写入范围**。所以别绕，按情况选一条：',
					HOW_ADD,
				].join('\n');

		if (target === '') {
			// 命令文本里出现了认领目录就放行——模型写文件几乎都用 pwsh。
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
		description: '放开 / 收回写锁；查看当前权限档（含计划模式 plan-write）',
		input: { hint: 'on | off | status' },
		recordInput: false,
		handler({ agent, rawInput }) {
			const action = String(rawInput ?? '').trim().toLowerCase();
			const id = agent.session.id ?? agent.id;
			const permission = permissionStateOf(agent);
			const planMode = permission?.preset === PLAN_PRESET;
			const mode = planMode
				? `计划模式（${PLAN_PRESET}）`
				: `普通模式（${permission?.preset ?? permission?.sandbox ?? '权限未知'}）`;
			if (action === '' || action === 'status') {
				const claims = ctx.subWorkspaces.claimsOf(ctx.subWorkspaces.stateOf(agent));
				const scope = claims.length === 0 ? '没有子工作区' : `只能写进 ${claims.map((claim) => claim.path).join(' / ')}`;
				return {
					kind: 'success',
					text: unlocked.has(id)
						? `锁已放开（逃生口）：可以写工作区。当前权限：${mode}。用 /plan-tree on 收回。`
						: planMode && claims.length === 0
							? `当前权限：${mode}；${scope} = 写入一律拒绝。加范围用 /sub-workspace add <绝对路径>，或把权限档切回 workspace-write。`
							: `当前权限：${mode}；锁生效：${scope}。`,
				};
			}
			if (action === 'off') {
				unlocked.add(id);
				return { kind: 'success', text: `锁已放开（逃生口）：可以写工作区。当前权限：${mode}。` };
			}
			if (action === 'on') {
				unlocked.delete(id);
				return { kind: 'success', text: `锁已收回。当前权限：${mode}。` };
			}
			return { kind: 'error', text: '用法：/plan-tree on | off | status' };
		},
	});
}
