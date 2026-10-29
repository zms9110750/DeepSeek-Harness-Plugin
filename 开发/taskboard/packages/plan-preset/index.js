/**
 * 「按计划」权限档 —— 独立插件。
 *
 * 为什么独立（用户要求）：
 *   > 一个包里面可以有多个插件。以下内容放在一个包里，分插件：
 *   > 箭头面板，任务面板，"按计划"的权限状态，"子工作空间"，额外工作空间。
 *
 * 权限是**限制**，面板是**显示**。两者混在一个插件里，导致
 * "只想看面板"的人被迫接受权限注入，反之亦然。拆开之后各自可独立启停。
 *
 * 依赖：`core`（要读 planClaims / 任务数据）。
 * 不依赖：面板。
 */

import { text, CURRENT_SESSION, sessionIdOf, splitWorkspaces } from '../core/shared.js';
import { judgeCommand, within } from '../workspace/index.js';
const PLAN_PRESET = 'plan';
const PLAN_SPEC = {
	sandbox: 'danger-full-access',
	approval: 'never',
	name: '按计划',
	description: '按领取的任务决定子工作空间与权限档位；没有领取任务时一切工具都被拒。',
};

/** 会话 id → 领取的任务（进程内快取）。 */
const CLAIMS = new Map();

/** 任务库里所有「处理中」的任务：进程重启后用它重建 claim。 */
let CLAIM_CACHE = [];

/*
 * 读任务列表的入口，由 `core` 插件注入。
 *
 * 为什么不直接 import：`listAll` 属于 core（它管存储）。如果这里 import 它，
 * 依赖方向就变成 plan-preset → core，而 core 又要用本模块的 CLAIMS / resolveClaim，
 * 两边互相依赖。改成"core 启动时把函数塞进来"，依赖就只剩单向的。
 *
 * 没注入时 refreshClaims 静默失败——权限档位仍能工作，只是进程重启后
 * 需要重新 task_claim 才能恢复 claim。
 */
let loadAll = null;

/** core 启动时调用。 */
export function provideTaskLoader(fn) {
	loadAll = typeof fn === 'function' ? fn : null;
}

async function refreshClaims() {
	if (loadAll === null) {
		CLAIM_CACHE = [];
		return;
	}
	try {
		const tasks = await loadAll();
		CLAIM_CACHE = tasks.filter((task) => task.status === '处理中');
	} catch (failure) {
		CLAIM_CACHE = [];
	}
}

/**
 * 解析这个会话当前该用哪份 claim。
 *
 * 只认**明确属于本会话**的：进程内快取，或 `claimed_by === 本会话 id`。
 *
 * 早期版本还有一条回落——「`claimed_by` 为空的处理中任务给任何会话用」。
 * 那是最危险的一处：两个会话会同时把同一个任务解析成自己的，于是
 * A 的 workspace + B 的 permission 在同一个进程里同时生效，等于**权限并集**。
 * 现在直接不回落：认不出来就是没有 claim，按「失败即关」拒绝，
 * 让模型先 `task_claim` 认领（领取会写 `claimed_by`）。
 */
function resolveClaim(agent) {
	const direct = CLAIMS.get(claimKey(agent));
	if (direct !== undefined) return direct;
	const id = claimKey(agent);
	if (id === '') return undefined;
	return CLAIM_CACHE.find((task) => (task.claimed_by || '') === id);
}

/*
 * ---------------------------------------------------------------------------
 * 工具描述符（T-023）
 * ---------------------------------------------------------------------------
 *
 * MCP 给工具四个描述：**写 / 破坏 / 外部 / 幂等**。本地工具也应该有，才能做细粒度开关。
 *
 * 为什么不挂在 `defineTool` 上：`defineTool()` 只挑它认识的字段（name / description /
 * parameters / output / deferTimeout…），自定义字段会被**静默丢弃**（读过 lib/index.js
 * 的 defineTool 实现确认）。所以描述符单独维护一张表，按工具名查。
 *
 * 四个描述符的语义：
 *
 *   write      改工作区的内容（写文件、改配置、跑命令）。
 *              只读档下必须拒。
 *   destructive 可能删/覆盖已有东西，且不可逆（delete、rm、清库）。
 *              就算给了写权限，也应该单独再要一次确认。
 *   external   会离开这台机器/这个进程（联网、调外部 API、起子进程、装包）。
 *              沙箱能挡文件，挡不了这个。
 *   idempotent 同样参数重复执行结果一样。false 表示重放有副作用。
 *              决定重试安不安全。
 *
 * 未知工具按最保守处理：write + destructive + external 全 true、idempotent false。
 */

/** 描述符表：只列已知道具；没列的走 CONSERVATIVE。 */
const DESCRIPTORS = {
	// —— 只读 ——
	read: { write: false, destructive: false, external: false, idempotent: true },
	glob: { write: false, destructive: false, external: false, idempotent: true },
	grep: { write: false, destructive: false, external: false, idempotent: true },
	'screenshot': { write: false, destructive: false, external: false, idempotent: true },
	'job_list': { write: false, destructive: false, external: false, idempotent: true },
	'job_output': { write: false, destructive: false, external: false, idempotent: true },
	'task_list': { write: false, destructive: false, external: false, idempotent: true },
	'task_get': { write: false, destructive: false, external: false, idempotent: true },
	'task_template': { write: false, destructive: false, external: false, idempotent: true },
	'task_groups': { write: false, destructive: false, external: false, idempotent: true },
	'task_history': { write: false, destructive: false, external: false, idempotent: true },

	// —— 任务管理（只改任务库自己的文件）——
	'task_submit': { write: true, destructive: false, external: false, idempotent: false },
	'task_claim': { write: true, destructive: false, external: false, idempotent: false },
	'task_state': { write: true, destructive: false, external: false, idempotent: false },
	'task_update': { write: true, destructive: false, external: false, idempotent: false },
	'task_note': { write: true, destructive: false, external: false, idempotent: true },

	// —— 写工作区 ——
	write: { write: true, destructive: false, external: false, idempotent: true },
	edit: { write: true, destructive: false, external: false, idempotent: true },
	'apply_patch': { write: true, destructive: false, external: false, idempotent: true },
	delete: { write: true, destructive: true, external: false, idempotent: true },

	// —— 命令执行：写 + 破坏 + 外部，且不幂等 ——
	pwsh: { write: true, destructive: true, external: true, idempotent: false },
	bash: { write: true, destructive: true, external: true, idempotent: false },
	'terminal_open': { write: true, destructive: true, external: true, idempotent: false },
	'terminal_write': { write: true, destructive: true, external: true, idempotent: false },
	'job_kill': { write: true, destructive: true, external: false, idempotent: true },

	// —— 能绕过权限模型的东西：全保守 ——
	'plugin_manager': { write: true, destructive: true, external: true, idempotent: false },
	'subagent': { write: false, destructive: false, external: true, idempotent: false },
	'subagent_fork': { write: false, destructive: false, external: true, idempotent: false },
	'subai': { write: false, destructive: false, external: true, idempotent: false },
	'subai_fork': { write: false, destructive: false, external: true, idempotent: false },
	'workflow': { write: false, destructive: false, external: true, idempotent: false },

	// —— 外部 / 网络 ——
	web_search: { write: false, destructive: false, external: true, idempotent: true },
	web_fetch: { write: false, destructive: false, external: true, idempotent: true },
};

/** 未知工具的默认描述：按最危险算。 */
const CONSERVATIVE_DESCRIPTOR = {
	write: true,
	destructive: true,
	external: true,
	idempotent: false,
};

/** 取某个工具的描述符。没登记过 → 保守默认。 */
function descriptorOf(toolName) {
	const name = String(toolName ?? '');
	if (Object.prototype.hasOwnProperty.call(DESCRIPTORS, name)) return DESCRIPTORS[name];
	/* MCP 工具命名不统一（mcp__server__tool），一律按外部 + 破坏处理。 */
	if (name.startsWith('mcp__') || name.startsWith('mcp_')) {
		return { write: true, destructive: true, external: true, idempotent: false };
	}
	return CONSERVATIVE_DESCRIPTOR;
}

/**
 * 任务的「描述符开关」：任务里可以显式关掉某一类能力，
 * 比整个「权限档位」细一档。
 *
 * 写法（任务字段 `deny`，逗号分隔）：`destructive, external`
 * 语义是「在权限档位之上再收窄」——只能收窄，不能放宽。
 */
const DESCRIPTOR_KEYS = ['write', 'destructive', 'external', 'idempotent'];

function parseDeny(raw) {
	const out = new Set();
	for (const part of String(raw ?? '').split(/[,，;；\s]+/u)) {
		const key = part.trim().toLowerCase();
		if (key !== '' && DESCRIPTOR_KEYS.includes(key)) out.add(key);
	}
	return out;
}

/** 按描述符判定是否要拦；返回原因或空串。 */
function descriptorBlocker(toolName, denySet) {
	const desc = descriptorOf(toolName);
	if (desc.write && denySet.has('write')) return '任务关闭了「写」类能力（write）';
	if (desc.destructive && denySet.has('destructive')) return '任务关闭了「破坏」类能力（destructive）';
	if (desc.external && denySet.has('external')) return '任务关闭了「外部」类能力（external）';
	if (desc.idempotent === false && denySet.has('idempotent')) return '任务关闭了「不幂等」类能力（idempotent）';
	return '';
}

/**
 * 任务管理类工具：只读写任务库、不碰工作区。
 *
 * **在「按计划」档下永远放行**，与领取的任务写了什么权限无关、与有没有领取无关。
 * 这是防死锁的关键：AI 能自己完成任务、搁置、再领下一张，否则「工具全关」的任务
 * 会把它锁死在里面，连 `task_state` 都调不了。
 */
const PLAN_TOOLS = new Set([
	'task_list',
	'task_get',
	'task_claim',
	'task_state',
	'task_submit',
	'task_update',
	'task_template',
	'task_note',
	'task_groups',
	'task_history',
]);

function claimKey(agent) {
	return String(agent?.id ?? agent?.session?.id ?? '');
}

function argsOf(exec) {
	const raw = exec?.arguments ?? exec?.args ?? exec?.input;
	return typeof raw === 'object' && raw !== null ? raw : {};
}

function toolNameOf(exec) {
	return exec?.tool?.name ?? exec?.name ?? '';
}


export function installPlanPreset(ctx) {
	ctx.effect(() => {
		const table = ctx.permissionPresets?.presets;
		if (table === undefined || table === null) return undefined;
		const had = Object.prototype.hasOwnProperty.call(table, PLAN_PRESET);
		const previous = had ? table[PLAN_PRESET] : undefined;
		table[PLAN_PRESET] = PLAN_SPEC;
		ctx.emit('permission-presets/catalog-changed');
		return () => {
			if (had) table[PLAN_PRESET] = previous;
			else delete table[PLAN_PRESET];
			ctx.emit('permission-presets/catalog-changed');
		};
	}, 'taskboard: 注入按计划预设');
}

/**
 * 按计划的守卫：**只在会话档位是「按计划」时生效**。
 * 其它任何档位（仅可查看 / 工作区内修改 / 完全权限 / 工具全关）一律 return undefined，
 * 由宿主自己的档位说话——任务的附属权限不参与。
 */

export function installGuard(ctx) {
	ctx.tools.guard((exec) => {
		try {
			const agent = exec?.agent;
			/* 记下本次调用的会话 id：让「当前组」能跟随会话。
			   注意这行必须在下面那些 `return undefined` 之前——
			   低权限档位下也要能记住会话，否则切了档当前组就丢了。 */
			CURRENT_SESSION.value = sessionIdOf(exec);
			if (!agent) return undefined;
			const session = agent.session ?? agent;
			const state = ctx.sessionProjections?.stateOf?.(session, 'permissions');
			if (state?.preset !== PLAN_PRESET) return undefined;

			const toolName = toolNameOf(exec);
			/* 任务管理类工具只读写任务库、不碰工作区：任何档位都放行，
			   否则「按计划」档下连 task_list / task_claim 都被拒，永远领不到任务。 */
			if (PLAN_TOOLS.has(toolName)) return undefined;

			const claim = resolveClaim(agent);
			if (claim === undefined) {
				return (
					'按计划：当前会话没有可用的领取（没有领取任务，或者任务不属于本会话）。\n' +
					'先 task_list 找一份「提交」的任务，task_claim 领取，再动手。'
				);
			}

			const permission = claim.permission || '工作区内修改';
			/* 任务级描述符开关：比权限档位细一档，只能收窄。 */
			const deny = parseDeny(claim.deny);

			if (permission === '工具全关') {
				return (
					`按计划：任务 ${claim.id} 要求「工具全关」，本会话不能调用工作区类工具。\n` +
					'但切任务不受限：用 task_state 把它改成「成功 / 失败 / 需要信息 / 需要授权」，' +
					'再用 task_list + task_claim 领下一张。'
				);
			}
			if (permission === '完全权限') {
				/* 完全权限之上仍尊重任务自己写的 deny。 */
				const blocked = descriptorBlocker(toolName, deny);
				return blocked === '' ? undefined : `按计划：任务 ${claim.id} 的 ${toolName} 被拒——${blocked}。`;
			}

			const args = argsOf(exec);
			const desc = descriptorOf(toolName);

			if (permission === '仅可查看') {
				/* 白名单口径（T-017）：按**描述符**判，不按名字清单判。
				   以前是 WRITE_TOOLS 黑名单，只认 5 个名字，plugin_manager /
				   subagent / mcp__* 全漏放行。现在只要带了 write 描述就拒，
				   未知工具默认带 write，所以新装的插件也自动被挡。 */
				if (desc.write) {
					return (
						`按计划：任务 ${claim.id} 只给「仅可查看」，${toolName} 会写东西（write=${desc.write}），不能调用。\n` +
						'切任务不受限：先 task_state 结束或搁置这张任务，再领下一张。'
					);
				}
				/* external 也挡：只读档不该联网、不该起子智能体。 */
				if (desc.external) {
					return `按计划：任务 ${claim.id} 只给「仅可查看」，${toolName} 是外部调用（external），不能调用。`;
				}
				const blocked = descriptorBlocker(toolName, deny);
				return blocked === '' ? undefined : `按计划：任务 ${claim.id} 的 ${toolName} 被拒——${blocked}。`;
			}

			/* 「工作区内修改」：先过描述符，再过路径。 */
			{
				const blocked = descriptorBlocker(toolName, deny);
				if (blocked !== '') return `按计划：任务 ${claim.id} 的 ${toolName} 被拒——${blocked}。`;
				/* 读类工具不需要路径校验。 */
				if (!desc.write) return undefined;
			}

			// 工作区内修改（也是没写权限时的默认）：任务没写子工作空间时，按会话 cwd 兜底
			const root = claim.workspace || String(session?.header?.cwd || '');
			/* 额外工作区：允许多个，与主工作区一起构成「可写范围」。 */
			const extras = Array.isArray(claim.workspaces)
				? claim.workspaces.filter((entry) => text(entry) !== '')
				: splitWorkspaces(claim.workspaces);
			const roots = (root === '' ? [] : [root]).concat(extras);

			const allowed = () => roots.join('、') || '（任务没写工作区）';

			const rawPath = String(args.file_path ?? args.path ?? '');
			const command = String(args.command ?? args.cmd ?? args.script ?? '');
			if (rawPath === '') {
				if (roots.length === 0) {
					return `按计划：任务 ${claim.id} 没有子工作空间，命令类工具一律拒绝。`;
				}
				if (command !== '') {
					/* 命令判定（T-018 第 2 项）：
					   以前是「命令里出现过允许目录的字符串就放行」，实测可以
					   `Remove-Item C:\Windows\...; echo X:\temp\dsh` 绕过。
					   现在按「每个分句里出现的路径都必须在允许目录内」判：
					     · 按 ; && || | 换行切段
					     · 每段里抽出形如 X:\... 的路径，逐个要求落在允许目录内
					     · 一段都没抽到路径的（比如 `npm test`）→ 拒，因为看不出写哪
					   仍然不是完备的（管道、重定向、cd + 相对路径都还能绕），
					   T-029 正在研究更硬的方案；这里先把已知绕过堵掉。 */
					const verdict = judgeCommand(command, roots);
					if (verdict !== '') {
						return `按计划：任务 ${claim.id} 只给「工作区内修改」，命令被拒——${verdict}。\n允许的目录：${allowed()}`;
					}
					return undefined;
				}
				return (
					`按计划：任务 ${claim.id} 只给「工作区内修改」，但看不出要写哪个目录。\n` +
					`写必须落在这些目录里：${allowed()}`
				);
			}
			if (roots.length === 0) {
				return `按计划：任务 ${claim.id} 没有子工作空间，也不知道会话目录，写操作一律拒绝。`;
			}
			if (roots.some((entry) => within(entry, rawPath))) return undefined;
			return `按计划：任务 ${claim.id} 只给「工作区内修改」，${rawPath} 不在允许的目录内。\n允许：${allowed()}`;
		} catch (failure) {
			return `按计划：守卫内部出错（${String(failure?.message ?? failure)}），按失败即关处理：本次工具调用被拒。`;
		}
	});
}

/*
 * 导出给同包其它插件用（index.js 的 core 要读 CLAIMS / resolveClaim）。
 * 这些是**模块内共享状态**：一个进程只有一份，四个插件共享同一份。
 */
export {
	refreshClaims,
	PLAN_PRESET,
	PLAN_SPEC,
	CLAIMS,
	resolveClaim,
	descriptorOf,
	parseDeny,
	descriptorBlocker,
	PLAN_TOOLS,
	claimKey,
	argsOf,
	toolNameOf,
};

/*
 * ── 插件入口 ───────────────────────────────────────────────────────────
 *
 * 这个包是**独立的插件**（用户要求「按计划的权限：一个新的权限，按任务给出的权限工作」）。
 * 关掉它，「按计划」这个权限档就不存在了，其它插件照常工作——
 * 只是任务里写的 workspace / permission 不再参与任何判定（它们仍然存着，面板照样显示）。
 */
export const name = 'taskboard-plan-preset';

/* 它要用这些服务；不声明的话加载器可能在服务就绪前就挂载它，
 * 于是 apply 里拿到的 ctx.tools / ctx.permissionPresets 是空的。 */
export const inject = ['tools', 'permissionPresets', 'sessionProjections'];

export function apply(ctx) {
	installPlanPreset(ctx);
	installGuard(ctx);
}
