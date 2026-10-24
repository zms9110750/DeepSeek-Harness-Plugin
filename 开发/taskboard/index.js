/**
 * 任务库 · 宿主侧。
 *
 * 计划既是文件（`任务\<id>.md`），也是对话面板里的卡片。
 * 这里只做三件事：读写计划文件、给模型四个任务工具、给面板三条命令。
 *
 * 硬规则：
 *   · 模型提交的一律是「未指定」，只有用户能把状态改成「提交」（/task-approve）；
 *   · `task_claim` 只接受「提交」的计划，未指定 / 拒绝 / 完成 都拒绝；
 *   · 计划的附属权限（子工作空间 + 权限档位）只在会话处于「按计划」档位时才生效，
 *     这一段由权限侧实现，这里只负责把值交出去。
 *
 * @module @local/taskboard
 */
import { appendFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineTool } from '@deepseek-ai/dsh-tools';

export const name = 'taskboard';

export const inject = ['tools', 'commands', 'permissionPresets', 'sessionProjections'];

/** 老格式目录（一份计划一个 md），只在首次启动时迁移用。 */
const LEGACY_DIR = process.env.TASKBOARD_ROOT || 'X:\\temp\\dsh\\任务';

const HEAD_FIELDS = [
	'id',
	'title',
	'type',
	'status',
	'parent',
	'links',
	'workspace',
	'workspaces',
	'permission',
	'claimed_by',
	'note',
];

/*
 * 模板类型：A–F 是「这是什么活」，H1–H8 是「为什么停下来等人」。
 * 代码只认 type 字符串，H* 不参与别的逻辑（status / 分类都不看 type）；
 * 模板本身只是正文骨架，用来把搁置理由写具体。
 */
const TYPES = ['A', 'B', 'C', 'D', 'R', 'F'];
const HOLD_TYPES = ['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'H7', 'H8'];
const ALL_TYPES = TYPES.concat(HOLD_TYPES);
const TYPE_NAMES = {
	A: '问题',
	B: '设计',
	C: '接口',
	D: '实现',
	R: '研究',
	F: '复盘',
	H1: '需要授权 · 代价过大',
	H2: '需要授权 · 用户转移话题',
	H3: '需要授权 · 方案缺陷过大',
	H4: '需要补充 · 缺用户信息',
	H5: '需要补充 · 需要先调研',
	H6: '需要授权 · 资源被占用',
	H7: '需要授权 · 缺权限 / 环境不对',
	H8: '需要补充 · 子任务未回收',
};

/* 计划状态复用 A2A 的九态（见 计划\19-A2A调研\README.md）。 */
const STATUS = ['未指定', '提交', '处理中', '需要补充', '需要授权', '完成', '失败', '取消', '拒绝'];

/** 只有「提交」（已采纳）的计划能被领取。 */
const CLAIMABLE = ['提交'];

/*
 * 九态 → 分组。一个状态**可以属于多个组**：
 *
 *   进行：还活着（已采纳待领、正在做、或者停下来等人但没放弃）
 *   搁置：停下来等人（需要补充 / 需要授权）
 *   完成：终结了（成功 / 失败 / 取消 / 拒绝）
 *
 * 「需要补充」「需要授权」同时属于「进行」和「搁置」——它们是**进行中的暂停**，
 * 不是终结。所以 GROUP_OF 的值是数组，判定用 hasGroup()，不要用 ===。
 *
 * 三分类（ACTIVE / DRAFT / FINAL，级联用的口径）由分组派生，不再各处手写：
 *   · 进行态 = 属于「进行」且不属于「完成」 → 活着，会被级联取消/搁置
 *   · 完成态 = 属于「完成」               → 已交付，不销毁
 *   · 草稿   = 两组都不属于（只有「未指定」）→ 没采纳，不作数
 */
const GROUP_OF = {
	未指定: [],
	提交: ['进行'],
	处理中: ['进行'],
	需要补充: ['进行', '搁置'],
	需要授权: ['进行', '搁置'],
	完成: ['完成'],
	失败: ['完成'],
	取消: ['完成'],
	拒绝: ['完成'],
};

/** 三组的定义（顺序即面板展示顺序）。 */
const GROUPS = [
	{ id: '进行', label: '进行', hint: '还活着：在做，或者停下来等人但没放弃' },
	{ id: '搁置', label: '搁置', hint: '停下来等人：需要补充 / 需要授权' },
	{ id: '完成', label: '完成', hint: '终结：成功 / 失败 / 取消 / 拒绝' },
];

/** 某个状态属于哪些组（拷贝，调用方改了不影响定义）。 */
function groupsOf(status) {
	return (GROUP_OF[status] || []).slice();
}

/** 状态是否属于某个组。多组状态用这个判，不要用 ===。 */
function hasGroup(status, group) {
	return (GROUP_OF[status] || []).includes(group);
}

/** 进行态：属于「进行」且不属于「完成」。 */
const ACTIVE = STATUS.filter((status) => hasGroup(status, '进行') && !hasGroup(status, '完成'));
/** 完成态：属于「完成」。 */
const FINAL = STATUS.filter((status) => hasGroup(status, '完成'));
/** 草稿：两组都不属于（目前只有「未指定」）。 */
const DRAFT = STATUS.filter((status) => !hasGroup(status, '进行') && !hasGroup(status, '完成'));

function isActive(status) {
	return ACTIVE.includes(status);
}
function isFinal(status) {
	return FINAL.includes(status);
}

/**
 * 「按计划」权限档：注入 permission-presets 的目录，客户端菜单自动多一项。
 *
 * 只能就地改那张表（官方没有注册 API），所以注入挂在 ctx.effect 上、卸载时
 * 删键再 emit 一次——同 gate-switch12 / plan-lock 的做法。
 *
 * sandbox 取上限（danger-full-access）+ approval=never：这一档本身不做限制，
 * 真正收窄由下面的 guard 按"领取的任务"来做，否则计划里写「完全权限」也放不开。
 */
const PLAN_PRESET = 'plan';
const PLAN_SPEC = {
	sandbox: 'danger-full-access',
	approval: 'never',
	name: '按计划',
	description: '按领取的任务决定子工作空间与权限档位；没有领取任务时一切工具都被拒。',
};

/** 会话 id → 领取的任务（进程内快取）。 */
const CLAIMS = new Map();

/** 计划库里所有「处理中」的计划：进程重启后用它重建 claim。 */
let CLAIM_CACHE = [];

async function refreshClaims() {
	try {
		const tasks = await listAll();
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
 * 早期版本还有一条回落——「`claimed_by` 为空的处理中计划给任何会话用」。
 * 那是最危险的一处：两个会话会同时把同一份计划解析成自己的，于是
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

/** 会改工作区的工具；其余当只读。 */
const WRITE_TOOLS = new Set(['write', 'edit', 'delete', 'pwsh', 'bash', 'terminal_open']);

/**
 * 计划管理类工具：只读写计划库、不碰工作区。
 *
 * **在「按计划」档下永远放行**，与领取的计划写了什么权限无关、与有没有领取无关。
 * 这是防死锁的关键：AI 能自己完成任务、搁置、再领下一张，否则「工具全关」的计划
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

/** Windows 路径归一：统一分隔符、消掉 . 与 ..（不访问磁盘）。 */
function normalizePath(raw) {
	const text = String(raw ?? '').replace(/\//gu, '\\');
	const parts = text.split('\\');
	const out = [];
	for (const part of parts) {
		if (part === '' || part === '.') continue;
		if (part === '..') {
			out.pop();
			continue;
		}
		out.push(part);
	}
	return out.join('\\').toLowerCase();
}

function within(root, target) {
	const base = normalizePath(root);
	const path = normalizePath(target);
	if (base === '' || path === '') return false;
	return path === base || path.startsWith(`${base}\\`);
}

function installPlanPreset(ctx) {
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
 * 由宿主自己的档位说话——计划的附属权限不参与。
 */
function installGuard(ctx) {
	ctx.tools.guard((exec) => {
		try {
			const agent = exec?.agent;
			if (!agent) return undefined;
			const session = agent.session ?? agent;
			const state = ctx.sessionProjections?.stateOf?.(session, 'permissions');
			if (state?.preset !== PLAN_PRESET) return undefined;

			const toolName = toolNameOf(exec);
			/* 计划管理类工具只读写计划库、不碰工作区：任何档位都放行，
			   否则「按计划」档下连 task_list / task_claim 都被拒，永远领不到任务。 */
			if (PLAN_TOOLS.has(toolName)) return undefined;

			const claim = resolveClaim(agent);
			if (claim === undefined) {
				return (
					'按计划：当前会话没有可用的领取（没有领取任务，或者任务不属于本会话）。\n' +
					'先 task_list 找一份「提交」的计划，task_claim 领取，再动手。'
				);
			}

			const permission = claim.permission || '工作区内修改';
			if (permission === '工具全关') {
				return (
					`按计划：任务 ${claim.id} 要求「工具全关」，本会话不能调用工作区类工具。\n` +
					'但切任务不受限：用 task_state 把它改成「完成 / 失败 / 需要补充 / 需要授权」，' +
					'再用 task_list + task_claim 领下一张。'
				);
			}
			if (permission === '完全权限') return undefined;

			const args = argsOf(exec);

			if (permission === '仅可查看') {
				if (WRITE_TOOLS.has(toolName)) {
					return (
						`按计划：任务 ${claim.id} 只给「仅可查看」，${toolName} 是写操作，不能调用。\n` +
						'切任务不受限：先 task_state 结束或搁置这张计划，再领下一张。'
					);
				}
				return undefined;
			}

			// 工作区内修改（也是没写权限时的默认）：计划没写子工作空间时，按会话 cwd 兜底
			const root = claim.workspace || String(session?.header?.cwd || '');
			/* 额外工作区：允许多个，与主工作区一起构成「可写范围」。 */
			const extras = Array.isArray(claim.workspaces)
				? claim.workspaces.filter((entry) => text(entry) !== '')
				: splitWorkspaces(claim.workspaces);
			const roots = (root === '' ? [] : [root]).concat(extras);
			if (!WRITE_TOOLS.has(toolName)) return undefined;

			const allowed = () => roots.join('、') || '（计划没写工作区）';

			const rawPath = String(args.file_path ?? args.path ?? '');
			const command = String(args.command ?? args.cmd ?? args.script ?? '');
			if (rawPath === '') {
				if (roots.length === 0) {
					return `按计划：任务 ${claim.id} 没有子工作空间，命令类工具一律拒绝。`;
				}
				if (command !== '') {
					const lowered = command.toLowerCase();
					if (roots.some((entry) => lowered.includes(entry.toLowerCase()))) return undefined;
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

/** 「额外工作区」解析：逗号分隔的绝对路径 → 数组（去空、去重、校验绝对路径）。 */
function splitWorkspaces(raw) {
	const parts = Array.isArray(raw)
		? raw.map((entry) => String(entry ?? ''))
		: String(raw ?? '').split(/[,，;；]/u);
	const seen = new Set();
	const out = [];
	for (const part of parts) {
		const value = part.trim();
		if (value === '') continue;
		if (!isAbsolutePath(value)) {
			throw new Error(`额外工作区必须是绝对路径（含盘符或 UNC），收到「${value}」`);
		}
		const key = value.replace(/\//gu, '\\').toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(value.replace(/\//gu, '\\'));
	}
	return out;
}

/** 绝对路径判定：`C:\…` / `\\server\share` / `/…`（不访问磁盘）。 */
function isAbsolutePath(value) {
	const text = String(value ?? '').trim();
	if (text === '') return false;
	if (/^[A-Za-z]:[\\/]/u.test(text)) return true;
	if (/^\\\\/u.test(text)) return true;
	if (text.startsWith('/')) return true;
	return false;
}

/**
 * 计划管理工具在「按计划」档下永不拦截的测试用钩子：
 * 判断某个工具名是否属于永不拦截的计划管理类。
 */
function isPlanTool(name) {
	return PLAN_TOOLS.has(String(name ?? ''));
}

function text(value) {
	return typeof value === 'string' ? value : '';
}

/** 备注长度上限（字符）：够写清一段理由，又不至于让计划头变得无法展示。 */
const NOTE_LIMIT = 4000;

/**
 * 改一份计划的备注（搁置理由等附加信息）。
 *
 * 与 task_update 的区别：备注不是「计划内容」，**不受「只有未指定可改」的限制**——
 * 进行中的计划正需要补一句「我在等什么」。
 */
async function setNote(id, note) {
	return withWrite(async () => {
		const task = await readTask(id);
		if (task === undefined) throw new Error(`没有这份计划：${id}`);
		const value = String(note ?? '').trim();
		if (value.length > NOTE_LIMIT) {
			throw new Error(`备注太长（${value.length} 字），上限 ${NOTE_LIMIT} 字`);
		}
		const next = Object.assign({}, task, { note: value });
		await saveTask(next);
		return next;
	});
}

/** 只认识 `key: value` 行的极简头解析，够用且不怕正文里的冒号。 */
function parseTask(raw, file) {
	const lines = String(raw ?? '').split(/\r?\n/u);
	const head = {};
	let index = 0;
	if (lines[0] === '---') {
		for (index = 1; index < lines.length; index += 1) {
			if (lines[index] === '---') {
				index += 1;
				break;
			}
			const match = /^([A-Za-z_]+):[ \t]?(.*)$/u.exec(lines[index]);
			if (match) head[match[1]] = match[2].trim();
		}
	}
	const id = text(head.id) || String(file).replace(/\.md$/u, '');
	return {
		id,
		title: text(head.title) || id,
		type: text(head.type).toUpperCase(),
		status: text(head.status) || '未指定',
		parent: text(head.parent),
		links: text(head.links),
		workspace: text(head.workspace),
		workspaces: text(head.workspaces),
		permission: text(head.permission),
		claimed_by: text(head.claimed_by),
		body: lines.slice(index).join('\n').trim(),
		note: text(head.note),
		file,
	};
}

function renderTask(task) {
	const lines = ['---'];
	for (const field of HEAD_FIELDS) lines.push(`${field}: ${text(task[field])}`);
	lines.push('---', '', text(task.body));
	if (text(task.note) !== '') lines.push('', '<!-- note -->', text(task.note));
	return `${lines.join('\n')}\n`;
}

/* ---- 存储：一个 JSONL 文件，放在用户目录 ----
 * 路径：%USERPROFILE%\.dsh\taskboard\plans.jsonl
 * 每行一个事件：{"op":"upsert","task":{…}}；读取时顺序折叠成当前状态。
 * 追加写、无原生依赖；单文件，备份/搬迁只搬这一个。
 */
const STORE_DIR = join(homedir(), '.dsh', 'taskboard');
const STORE_FILE = process.env.TASKBOARD_STORE || join(STORE_DIR, 'plans.jsonl');

async function readStore() {
	await mkdir(dirname(STORE_FILE), { recursive: true });
	let raw = '';
	try {
		raw = await readFile(STORE_FILE, 'utf8');
	} catch (error) {
		if (!error || error.code !== 'ENOENT') throw error;
		await migrateLegacy();
		try {
			raw = await readFile(STORE_FILE, 'utf8');
		} catch (again) {
			raw = '';
		}
	}
	const map = new Map();
	for (const line of raw.split(/\r?\n/u)) {
		if (line.trim() === '') continue;
		let event;
		try {
			event = JSON.parse(line);
		} catch (failure) {
			continue;
		}
		if (!event) continue;
		if (event.op === 'upsert' && event.task && event.task.id) {
			map.set(String(event.task.id), event.task);
		} else if (event.op === 'patch' && event.id && map.has(String(event.id))) {
			map.set(String(event.id), Object.assign({}, map.get(String(event.id)), event.patch));
		}
	}
	return map;
}

/** 极简写锁：同一进程内的读改写串行，避免并发丢更新。 */
let WRITE_CHAIN = Promise.resolve();
function withWrite(operation) {
	const run = WRITE_CHAIN.then(operation, operation);
	WRITE_CHAIN = run.then(
		() => undefined,
		() => undefined,
	);
	return run;
}
async function appendEvent(event) {
	await mkdir(dirname(STORE_FILE), { recursive: true });
	await appendFile(STORE_FILE, `${JSON.stringify(event)}\n`, 'utf8');
}

/** 老目录（任务\*.md）→ 一次性导入 JSONL。 */
async function migrateLegacy() {
	const marker = `${STORE_FILE}.migrated`;
	try {
		await readFile(marker, 'utf8');
		return;
	} catch (failure) {
		/* 没迁移过 */
	}
	let files = [];
	try {
		files = (await readdir(LEGACY_DIR)).filter((name) => name.endsWith('.md')).sort();
	} catch (failure) {
		return;
	}
	for (const file of files) {
		try {
			const raw = await readFile(join(LEGACY_DIR, file), 'utf8');
			await appendEvent({ op: 'upsert', task: parseTask(raw, file) });
		} catch (failure) {
			/* 跳过坏文件 */
		}
	}
	try {
		await writeFile(marker, '1', 'utf8');
	} catch (failure) {
		/* 标记写失败不影响迁移 */
	}
}

async function listAll() {
	const map = await readStore();
	return [...map.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

async function readTask(id) {
	const wanted = text(id).trim();
	if (wanted === '') throw new Error('task_get: 需要一个计划 id，例如 T-001');
	return (await readStore()).get(wanted);
}

/** 关联去重：同一条「类型:目标」只留一份（大小写/空格归一）。 */
function dedupeLinks(raw) {
	const seen = new Set();
	const out = [];
	String(raw || '')
		.split(/[,，]/u)
		.map((part) => part.trim())
		.filter((part) => part !== '')
		.forEach((part) => {
			const key = part.replace(/\s+/gu, '').toLowerCase();
			if (seen.has(key)) return;
			seen.add(key);
			out.push(part);
		});
	return out.join(', ');
}
async function saveTask(task) {
	if (task && typeof task.links === 'string') task = Object.assign({}, task, { links: dedupeLinks(task.links) });
	await appendEvent({ op: 'upsert', task });
}

/** 新建：取下一个空号再追加；撞号就重试。 */
async function createNew(task) {
	return withWrite(() => createNewInner(task));
}

async function createNewInner(task) {
	for (let attempt = 0; attempt < 50; attempt += 1) {
		const map = await readStore();
		let max = 0;
		for (const key of map.keys()) {
			const match = /^T-(\d+)$/u.exec(key);
			if (match) max = Math.max(max, Number(match[1]));
		}
		const id = `T-${String(max + 1).padStart(3, '0')}`;
		if (map.has(id)) continue;
		await saveTask(Object.assign({}, task, { id }));
		return id;
	}
	throw new Error('新建计划失败：连续 50 次编号冲突');
}

function summarize(task) {
	const groups = groupsOf(task.status);
	const bits = [
		`${task.id} [${task.type || '?'} ${TYPE_NAMES[task.type] || ''}] ${task.title}`,
		`状态=${task.status}` + (groups.length > 0 ? `（${groups.join('/')}）` : '（草稿）'),
	];
	if (task.parent) bits.push(`父=${task.parent}`);
	if (task.links) bits.push(`链接=${task.links}`);
	if (task.workspace) bits.push(`子工作空间=${task.workspace}`);
	if (text(task.workspaces) !== '') bits.push(`额外工作区=${task.workspaces}`);
	if (task.permission) bits.push(`权限=${task.permission}`);
	if (text(task.note) !== '') bits.push('备注=' + task.note.replace(/\s+/gu, ' ').slice(0, 40));
	return bits.join(' · ');
}

function renderList(tasks) {
	if (tasks.length === 0) return '任务库是空的（存储：' + STORE_FILE + '）';
	const lines = [`共 ${tasks.length} 份计划（存储：${STORE_FILE}）`];
	for (const task of tasks) lines.push(`- ${summarize(task)}`);
	lines.push(
		'',
		'九态分组：进行=提交/处理中/需要补充/需要授权；搁置=需要补充/需要授权；完成=完成/失败/取消/拒绝。',
		'需要补充与需要授权同时属于「进行」和「搁置」——是进行中的暂停，不是终结。',
		'未指定=AI 提交但用户还没采纳，不能领取；提交=可以 task_claim。',
	);
	return lines.join('\n');
}

function renderFull(task) {
	const lines = [summarize(task), ''];
	if (task.body) lines.push(task.body);
	return lines.join('\n');
}

function registerTools(ctx) {
	ctx.tools.register(
		defineTool({
			name: 'task_list',
			description:
				'列出任务库里的所有计划（只给头部：id、类型、状态、父、链接、子工作空间、权限档位）。' +
				'状态「未指定」是 AI 提交但用户还没采纳的，不能领取；「提交」才能 task_claim。',
			parameters: {},
			output: {
				schema: { type: 'object', additionalProperties: false, properties: { text: { type: 'string' } } },
				render: (_args, value) => [{ type: 'text', text: value.text }],
			},
			async execute() {
				return { text: renderList(await listAll()) };
			},
		}),
	);

	ctx.tools.register(
		defineTool({
			name: 'task_get',
			description: '读一份计划的全文（头部 + 正文）。先用 task_list 找 id。',
			parameters: { id: { type: 'string', required: true, description: '计划 id，例如 T-001' } },
			output: {
				schema: { type: 'object', additionalProperties: false, properties: { text: { type: 'string' } } },
				render: (_args, value) => [{ type: 'text', text: value.text }],
			},
			async execute(args) {
				const task = await readTask(args.id);
				if (task === undefined) throw new Error(`task_get: 没有这份计划：${args.id}`);
				return { text: renderFull(task) };
			},
		}),
	);

	ctx.tools.register(
		defineTool({
			name: 'task_submit',
			description:
				'提交一份计划草稿。状态固定为「未指定」，用户在面板里采纳之后变成「提交」才能被领取。' +
				'type 取 A(问题)/B(设计)/C(接口)/D(实现)/R(研究)/F(复盘)，或留空 = 空模板（正文自由写，适合记录待定事项），' +
				'或 H1..H8（搁置模板：用 task_template 取骨架，用来写清为什么停下来等人）。' +
				'workspace 填子工作空间（主战场，单个绝对路径，可空 = 会话目录）；' +
				'workspaces 填额外工作区（要读写的其它目录，逗号分隔的绝对路径，可空）；' +
				'permission 填 仅可查看/工作区内修改/完全权限/工具全关，可空。',
			parameters: {
				title: { type: 'string', required: true, description: '一句话标题' },
				type: { type: 'string', description: 'A/B/C/D/R/F，或留空 = 空模板' },
				body: { type: 'string', required: true, description: '正文 Markdown，按该类型模板的小节填' },
				parent: { type: 'string', description: '父计划 id，空 = 顶层' },
				links: { type: 'string', description: '链接，例如「依赖:T-003, 派生:T-004」' },
				workspace: { type: 'string', description: '子工作空间绝对路径（单个）' },
				workspaces: { type: 'string', description: '额外工作区，逗号分隔的绝对路径（可多个）' },
				permission: { type: 'string', description: '仅可查看 / 工作区内修改 / 完全权限 / 工具全关' },
			},
			output: {
				schema: { type: 'object', additionalProperties: false, properties: { text: { type: 'string' } } },
				render: (_args, value) => [{ type: 'text', text: value.text }],
			},
			async execute(args) {
				const type = text(args.type).toUpperCase();
				/* 空字符串 = 空模板（面板的 /task-create 一直允许，工具这边也放开）。 */
				if (type !== '' && !ALL_TYPES.includes(type)) {
					throw new Error(`task_submit: type 必须留空或取 ${ALL_TYPES.join('/')}，收到「${args.type}」`);
				}
				const title = text(args.title).trim();
				if (title === '') throw new Error('task_submit: 标题不能为空');
				await assertParent(text(args.parent));
				/* 额外工作区：校验绝对路径并归一（逗号分隔）；非法直接拒，不落盘。 */
				const workspaces = splitWorkspaces(args.workspaces).join(', ');
				const id = await createNew({
					title,
					type,
					status: '未指定',
					parent: text(args.parent),
					links: text(args.links),
					workspace: text(args.workspace),
					workspaces,
					permission: text(args.permission),
					claimed_by: '',
					body: text(args.body),
				});
				return {
					text:
						`已提交 ${id}（状态=未指定，等用户采纳后变成「提交」才能领取）。\n` +
						`存储：${STORE_FILE}`,
				};
			},
		}),
	);

	ctx.tools.register(
		defineTool({
			name: 'task_claim',
			description:
				'领取一份「提交」状态的计划，返回它的子工作空间与权限档位。' +
				'未指定、拒绝、完成、需要补充、需要授权的计划都不能领取。领取后状态变成「处理中」，并在计划头上记下领取的会话。',
			parameters: { id: { type: 'string', required: true, description: '计划 id，例如 T-001' } },
			output: {
				schema: { type: 'object', additionalProperties: false, properties: { text: { type: 'string' } } },
				render: (_args, value) => [{ type: 'text', text: value.text }],
			},
			async execute(args, exec) {
				const agent = exec?.agent;
				/* 走唯一的改状态入口：这里拿到写锁（并发双领会被串行化），
				   并且 CLAIMS / 级联 / 转移校验全部由 setStateInner 一处维护。 */
				const task = await setState(args.id, '处理中', agent, false);
				const lines = [`已领取 ${task.id}：${task.title}`, `类型：${task.type} ${TYPE_NAMES[task.type] || ''}`];
				lines.push(`子工作空间：${task.workspace || '（计划没写，按会话当前工作目录）'}`);
				lines.push(`额外工作区：${task.workspaces || '（无）'}`);
				lines.push(`权限档位：${task.permission || '（计划没写，按会话当前档位）'}`);
				lines.push('', '提醒：计划的附属权限只在会话权限档位为「按计划」时生效；其它档位按会话当前权限执行。');
				return { text: lines.join('\n') };
			},
		}),
	);
}

function registerCommands(ctx) {
	ctx.commands.register({
		name: 'tasks',
		description: '输出任务库全部计划头的 JSON（面板读取）',
		recordInput: false,
		async handler() {
			const tasks = await listAll();
			return {
				kind: 'success',
				text: JSON.stringify(
					tasks.map(({ body, file, ...head }) => {
						const firstLine = String(body || '')
							.split(/\r?\n/u)
							.map((line) => line.replace(/^[#>\-\s]+/u, '').trim())
							.filter((line) => line !== '')[0];
						return Object.assign(head, {
							summary: firstLine ? firstLine.slice(0, 80) : '',
							/* 九态分组：数组，一个状态可以属于多个组。面板按这个着色/分区。 */
							groups: groupsOf(head.status),
						});
					}),
				),
			};
		},
	});

	ctx.commands.register({
		name: 'task-groups',
		description: '输出九态分组定义（面板读取；状态 → 组的映射，多组状态返回数组）',
		recordInput: false,
		async handler() {
			return {
				kind: 'success',
				text: JSON.stringify({
					groups: GROUPS,
					status: STATUS.map((status) => ({ status, groups: groupsOf(status) })),
				}),
			};
		},
	});

	ctx.commands.register({
		name: 'task-approve',
		description: '用户采纳一份计划（未指定 → 提交，面板按钮调用）',
		input: { hint: '<计划 id>' },
		recordInput: false,
		async handler({ rawInput }) {
			const id = text(rawInput).trim();
			const task = await readTask(id);
			if (task === undefined) return { kind: 'error', text: `没有这份计划：${id}` };
			if (task.status === '提交') return { kind: 'success', text: `${task.id} 已经是「提交」` };
			if (task.status !== '未指定') {
				return { kind: 'error', text: `${task.id} 现在是「${task.status}」，只有「未指定」的计划能被采纳` };
			}
			task.status = '提交';
			task.claimed_by = '';
			await saveTask(task);
			await applySupersede(task);
			await refreshClaims();
			return { kind: 'success', text: `已采纳 ${task.id}（现在可以被领取）` };
		},
	});

	ctx.commands.register({
		name: 'task-reject',
		description: '用户打回一份计划（面板按钮调用）',
		input: { hint: '<计划 id>' },
		recordInput: false,
		async handler({ rawInput }) {
			const id = text(rawInput).trim();
			/* 走唯一的改状态入口：拒绝是终止态，要触发派生/依赖的取消级联。 */
			try {
				const task = await setState(id, '拒绝', undefined, true);
				return { kind: 'success', text: `已拒绝 ${task.id}` };
			} catch (error) {
				return { kind: 'error', text: String(error?.message ?? error) };
			}
		},
	});
}

/** 计划模板目录（GitHub issue forms 的 YAML）。 */
const TEMPLATE_DIR = join(fileURLToPath(new URL('.', import.meta.url)), 'templates');

async function loadTemplate(type) {
	const wanted = String(type ?? '').trim().toUpperCase();
	if (!ALL_TYPES.includes(wanted)) throw new Error(`模板类型必须是 ${ALL_TYPES.join('/')}，收到「${type}」`);
	return readFile(join(TEMPLATE_DIR, `${wanted}.yml`), 'utf8');
}

/**
 * 一个计划进入终止态后，把整片下游一起收掉（递归、防环）。
 *
 * 下游有两种，都是「进行态 → 取消」，草稿与完成态一律不动：
 *   · 派生子计划：`parent` 指向我；
 *   · 依赖方：`links` 里写着 `依赖:<我>`。
 *
 * 区别在根节点：我做成了（完成）→ 依赖我的人照常可领，只有子计划要收；
 * 我没做成（失败 / 取消 / 拒绝）→ 依赖我的人也全是死路，一起取消。
 *
 * 被取消的下游自己也是「终止」，所以它的子计划和依赖方继续往下收——
 * 用队列 + seen 集合，既保证递归完整，又不会在环上打转。
 */
async function cascadeClose(rootId, rootStatus) {
	const seen = new Set();
	const queue = [{ id: rootId, closeDependents: rootStatus !== '完成' }];
	while (queue.length > 0) {
		const item = queue.shift();
		if (seen.has(item.id)) continue;
		seen.add(item.id);
		const tasks = await listAll();
		for (const other of tasks) {
			if (other.id === item.id) continue;
			if (!isActive(other.status)) continue;
			const isChild = other.parent === item.id;
			const isDependent =
				item.closeDependents &&
				linkPairs(other).some((link) => link.label === '依赖' && link.to === item.id);
			if (!isChild && !isDependent) continue;
			other.status = '取消';
			other.claimed_by = '';
			await saveTask(other);
			/* 它已经终结了（取消），它自己的下游也一起收。 */
			queue.push({ id: other.id, closeDependents: true });
		}
	}
}

/**
 * 状态转移规则。
 *
 * **只有一条是安全边界**，其余都是工作流口味：
 *
 *   未指定（草稿） → 处理中   ❌ 禁止
 *
 * 为什么只禁这一条（T-016）：计划只有在「处理中」时才会把 `workspace` / `permission`
 * 交给守卫。草稿是模型自己能写的，如果草稿能直接进「处理中」，模型就能绕过
 * 「采纳只能由用户做」，给自己发一张写着「完全权限」的计划 —— 已经实测复现。
 *
 * 其它边按工作流放开（第一版写得太严，把正常用法也挡了）：
 *
 *   · 草稿可以转 需要补充 / 需要授权：H1..H8 搁置模板就是这么用的，
 *     建完草稿直接标明「我在等什么」。这两个状态**不授予任何权限**，安全。
 *   · 提交（已采纳、还没人领）可以转 需要补充 / 需要授权 / 完成 / 失败 / 取消 / 拒绝：
 *     用户采纳了但决定先不做、或者发现根本不用做。
 *   · 进行态之间随便转：处理中 ↔ 需要补充 / 需要授权，处理中 → 拒绝 也算放弃。
 *   · 终态（完成 / 失败 / 取消 / 拒绝）只能被**用户**重开回「提交」（T-030 决议）。
 */
const ACTIVE_ALL = ['提交', '处理中', '需要补充', '需要授权'];
const TERMINAL = ['完成', '失败', '取消', '拒绝'];
const DRAFT_STATUS = '未指定';

/** 终态：重开这类计划属于「用户专属」动作，模型不能自己干。 */
const REOPEN_FROM = TERMINAL;

/**
 * 判定一条转移是否允许；返回空串表示允许，否则返回给模型看的原因。
 * `byUser` 为 true 时是用户路径（面板按钮、斜杠命令）。
 */
function transitionBlocker(from, to, byUser) {
	if (from === to) return '';

	/* 安全边界：草稿不能直接进处理中。 */
	if (from === DRAFT_STATUS && to === '处理中') {
		return (
			'草稿（未指定）必须先由用户在面板点「采纳」变成「提交」，才能领取。' +
			'模型不能把草稿直接推进到「处理中」——那等于自己给自己发权限。'
		);
	}

	/* 草稿只能「被采纳」（用户）或原地结束；草稿 → 处理中上面已拦。 */
	if (from === DRAFT_STATUS) {
		if (to === '提交' && byUser !== true) {
			return '采纳（→提交）只能由用户执行：模型请用 task_claim 领取，或让用户在面板点「采纳」。';
		}
		return '';
	}

	/* 终态锁死，只能由用户重开回「提交」。 */
	if (REOPEN_FROM.includes(from)) {
		if (byUser !== true) {
			return `「${from}」是终态，只有用户能重开：模型请新建一张计划（或用面板「分支」）。`;
		}
		if (to !== '提交') {
			return `重开只能从「${from}」回到「提交」，不能直接到「${to}」。`;
		}
		return '';
	}

	/* 其余都是进行态之间的转移：交给各自的前置校验（领取检查、父计划检查等）。 */
	if (to === '提交' && byUser !== true) {
		return '采纳（→提交）只能由用户执行：模型请用 task_claim 领取，或让用户在面板点「采纳」。';
	}
	return '';
}

function canTransition(from, to, byUser) {
	return transitionBlocker(from, to, byUser) === '';
}

/** 唯一的改状态入口：校验状态名、写文件、必要时级联。 */
async function setState(id, next, agent, byUser, note) {
	return withWrite(() => setStateInner(id, next, agent, byUser, note));
}

async function setStateInner(id, next, agent, byUser, note) {
	const wanted = String(next ?? '').trim();
	if (!STATUS.includes(wanted)) {
		throw new Error(`状态必须是九态之一：${STATUS.join(' / ')}，收到「${next}」`);
	}
	/* 注意：这里拿到的 task 是在 withWrite 锁内重新读出来的（readTask → readStore），
	   所以串行的第二个调用能看到第一个的写入。下面所有校验都基于这份新快照。 */
	const task = await readTask(id);
	if (task === undefined) throw new Error(`没有这份计划：${id}`);

	const from = String(task.status || '未指定');

	/* 状态转移规则：安全边界（草稿不能进处理中）+ 终态重开限定。 */
	const blocker = transitionBlocker(from, wanted, byUser);
	if (blocker !== '') throw new Error(blocker);

	if (wanted === '处理中') {
		/* 领取前置：必须是「提交」。转移规则已经保证草稿进不来，
		   但这里再挡一次——两个会话同时领同一张时，后到的那个读到的是
		   「处理中」而不是「提交」，必须被拒（T-018 并发双领）。 */
		if (from !== '提交') {
			throw new Error(
				`${task.id} 当前状态是「${from}」，只有「提交」的计划能被领取` +
					(from === '处理中' ? `（已被其他会话领走）` : ''),
			);
		}
		const running = await activeClaimOf(agent);
		if (running !== undefined && running.id !== task.id) {
			throw new Error(`当前已有进行中的任务 ${running.id}（${running.title}）：一次只能做一个，先把它完成/失败/取消再领取新的`);
		}
		const blocker2 = await claimBlocker(task);
		if (blocker2 !== '') throw new Error(`不能领取 ${task.id}：${blocker2}`);
	}
	if (wanted === '完成') {
		/* 上行：子计划里只要还有「进行态」（提交 / 处理中 / 需要补充 / 需要授权），父计划就不能完成。
		   草稿（未指定）不作数，完成态（完成/失败/取消/拒绝）不阻挡。 */
		const all = await listAll();
		const open = all.filter((child) => child.parent === task.id && isActive(child.status));
		if (open.length > 0) {
			throw new Error(
				`子计划还在进行中：${open.map((child) => `${child.id}（${child.status}）`).join('、')}；` +
					'先把它们收掉（完成 / 失败 / 取消 / 拒绝）再完成父计划',
			);
		}
	}
	const wasSubmitted = task.status === '提交';
	task.status = wanted;
	if (wanted === '处理中') {
		task.claimed_by = String(agent?.id ?? agent?.session?.id ?? '');
	} else {
		task.claimed_by = '';
	}
	/* 状态与备注可以一次写完：搁置时最该说清「为什么」。 */
	if (typeof note === 'string') task.note = note.trim().slice(0, NOTE_LIMIT);
	await saveTask(task);
	if (!wasSubmitted) await applySupersede(task);
	await refreshClaims();
	/* CLAIMS 统一在这里维护：所有进出「处理中」的路径（工具、命令、planClaims、
	   级联）都走 setState，所以只要在这里同步一次就够，不需要各处手工补写。
	   之前只有 /task-state 命令路径更新过它，用工具切任务就会残留旧 claim，
	   权限只增不减（T-018 已实测复现）。 */
	const key = claimKey(agent);
	if (key !== '') {
		if (wanted === '处理中') {
			CLAIMS.set(key, {
				id: task.id,
				workspace: task.workspace,
				workspaces: task.workspaces,
				permission: task.permission,
			});
		} else {
			CLAIMS.delete(key);
		}
	}
	if (wanted === '需要补充' || wanted === '需要授权') await shelveChildren(task.id);
	if (isFinal(wanted)) await cascadeClose(task.id, wanted);
	return task;
}

function registerExtraTools(ctx) {
	ctx.tools.register(
		defineTool({
			name: 'task_template',
			description:
				'取一种计划模板（GitHub issue forms 的 YAML）。写计划前先取模板，按 body 里的字段填。' +
				'type 取 A(问题)/B(设计)/C(接口)/D(实现)/R(研究)/F(复盘)，' +
				'或 H1..H8（搁置模板：按「为什么停下来等人」分——代价过大 / 用户转移话题 / 方案缺陷 / 缺用户信息 / 需先调研 / 资源被占用 / 缺权限 / 子任务未回收）。',
			parameters: { type: { type: 'string', required: true, description: 'A/B/C/D/R/F 或 H1..H8' } },
			output: {
				schema: { type: 'object', additionalProperties: false, properties: { text: { type: 'string' } } },
				render: (_args, value) => [{ type: 'text', text: value.text }],
			},
			async execute(args) {
				return { text: await loadTemplate(args.type) };
			},
		}),
	);

	ctx.tools.register(
		defineTool({
			name: 'task_state',
			description:
				'改一份计划的状态（九态）：未指定 / 提交 / 处理中 / 需要补充 / 需要授权 / 完成 / 失败 / 取消 / 拒绝。' +
				'改「完成」时，进行态的子计划会被自动取消；改「需要补充 / 需要授权」时，进行态的子计划转「需要授权」。' +
				'可选 note 一起写下理由（搁置时最该填：为什么需要授权 / 为什么缺信息）。',
			parameters: {
				id: { type: 'string', required: true, description: '计划 id，例如 T-001' },
				status: { type: 'string', required: true, description: '九态之一' },
				note: { type: 'string', description: '备注 / 搁置理由（可选，写清为什么停在这里）' },
			},
			output: {
				schema: { type: 'object', additionalProperties: false, properties: { text: { type: 'string' } } },
				render: (_args, value) => [{ type: 'text', text: value.text }],
			},
			async execute(args, exec) {
				const task = await setState(args.id, args.status, exec?.agent, false, args.note);
				return { text: `${task.id} 状态改为「${task.status}」` };
			},
		}),
	);

	ctx.tools.register(
		defineTool({
			name: 'task_note',
			description:
				'改一份计划的备注（附加信息 / 搁置理由）。**不受「只有未指定可改」的限制**——' +
				'进行中的计划也能补一句「我在等什么」。空字符串表示清空备注。',
			parameters: {
				id: { type: 'string', required: true, description: '计划 id，例如 T-001' },
				note: { type: 'string', required: true, description: '备注正文；空串 = 清空' },
			},
			output: {
				schema: { type: 'object', additionalProperties: false, properties: { text: { type: 'string' } } },
				render: (_args, value) => [{ type: 'text', text: value.text }],
			},
			async execute(args) {
				const task = await setNote(args.id, args.note);
				return {
					text:
						text(task.note) === ''
							? `已清空 ${task.id} 的备注`
							: `已更新 ${task.id} 的备注（${task.note.length} 字）`,
				};
			},
		}),
	);
}

function registerExtraCommands(ctx) {
	ctx.commands.register({
		name: 'task-templates',
		description: '输出全部计划模板（YAML）的 JSON（面板读取）',
		recordInput: false,
		async handler() {
			const out = [];
			for (const type of ALL_TYPES) {
				try {
					out.push({ type: type, yaml: await loadTemplate(type) });
				} catch (error) {
					out.push({ type: type, yaml: '' });
				}
			}
			return { kind: 'success', text: JSON.stringify(out) };
		},
	});

	ctx.commands.register({
		name: 'task-create',
		description: '新建一份计划（面板调用；JSON：{title,type,body,parent,workspace,workspaces,permission,status}）',
		input: { hint: '{"title":"…","type":"C","body":"…"}' },
		recordInput: false,
		async handler({ rawInput }) {
			try {
				const input = JSON.parse(String(rawInput ?? '{}'));
				const type = String(input.type ?? '').toUpperCase();
				if (type !== '' && !ALL_TYPES.includes(type)) return { kind: 'error', text: `type 必须是 ${ALL_TYPES.join('/')}，或留空（空模板）` };
				const title = String(input.title ?? '').trim();
				if (title === '') return { kind: 'error', text: '标题不能为空' };
				const rawStatus = input.status === undefined ? '' : String(input.status);
				if (rawStatus !== '' && !STATUS.includes(rawStatus)) {
					return { kind: 'error', text: `status 必须是九态之一：${STATUS.join(' / ')}` };
				}
				const wantedStatus = rawStatus === '' ? '未指定' : rawStatus;
				if (wantedStatus !== '未指定' && wantedStatus !== '提交') {
					return { kind: 'error', text: '新建只能用「未指定」或「提交」；其它状态要走 /task-state' };
				}
				const status = wantedStatus;
				await assertParent(text(input.parent));
				const id = await createNew({
					title,
					type,
					status,
					parent: text(input.parent),
					links: text(input.links),
					workspace: text(input.workspace),
					workspaces: splitWorkspaces(input.workspaces).join(', '),
					permission: text(input.permission),
					claimed_by: '',
					body: text(input.body),
				});
				if (status === '提交') {
					const created = await readTask(id);
					if (created !== undefined) await applySupersede(created);
				}
				return { kind: 'success', text: JSON.stringify({ id, status }) };
			} catch (error) {
				return { kind: 'error', text: String(error?.message ?? error) };
			}
		},
	});

	ctx.commands.register({
		name: 'task-get',
		description: '取一份计划的全文 JSON（面板读取正文）',
		input: { hint: '<计划 id>' },
		recordInput: false,
		async handler({ rawInput }) {
			const task = await readTask(String(rawInput ?? '').trim());
			if (task === undefined) return { kind: 'error', text: `没有这份计划：${rawInput}` };
			return { kind: 'success', text: JSON.stringify(task) };
		},
	});
	ctx.commands.register({
		name: 'task-note',
		description: '改一份计划的备注 / 搁置理由（面板调用；不受「只有未指定可改」限制）',
		input: { hint: '<计划 id> <备注文本>' },
		recordInput: false,
		async handler({ rawInput }) {
			const raw = String(rawInput ?? '').trim();
			/* 备注本身含空格，所以只把第一段当 id，其余整段是正文。 */
			const cut = raw.indexOf(' ');
			if (cut <= 0) return { kind: 'error', text: '用法：/task-note <计划 id> <备注文本>' };
			const id = raw.slice(0, cut).trim();
			const note = raw.slice(cut + 1).trim();
			try {
				const task = await setNote(id, note);
				return {
					kind: 'success',
					text: JSON.stringify({ id: task.id, note: text(task.note) }),
				};
			} catch (error) {
				return { kind: 'error', text: String(error?.message ?? error) };
			}
		},
	});
	ctx.commands.register({
		name: 'task-state',
		description: '改一份计划的状态（面板调用；九态之一）',
		input: { hint: '<计划 id> <状态> [备注]' },
		recordInput: false,
		async handler({ agent, rawInput }) {
			const raw = String(rawInput ?? '').trim();
			const parts = raw.split(/\s+/u);
			if (parts.length < 2) return { kind: 'error', text: '用法：/task-state <计划 id> <状态> [备注]' };
			/* 第三个参数起是备注（可能含空格），把它整段还给 note。 */
			const rest = raw.slice(raw.indexOf(parts[1]) + parts[1].length).trim();
			try {
				/* CLAIMS 与 refreshClaims 已由 setStateInner 一处维护，这里不再手工补写。 */
				const task = await setState(parts[0], parts[1], agent, true, rest === '' ? undefined : rest);
				return { kind: 'success', text: `${task.id} 状态改为「${task.status}」` };
			} catch (error) {
				return { kind: 'error', text: String(error?.message ?? error) };
			}
		},
	});
}
/** 计划驱动的执行约定：写进系统提示，模型每一步都能看到。 */
const PROMPT_TEXT = [
	'本会话可能被切到「按计划」权限档。这一档下"能干什么"由你领取的计划决定：',
	'- 先 `task_list` 看计划库；只有状态是「提交」的计划能被领取。',
	'- 用 `task_claim` 领取（用户也可以在面板点「领取」）。领取后按该计划写的子工作空间与权限档位干活；计划没写就按会话当前目录与档位。',
	'- 一次只做一张计划的事；同一会话同一时刻只能有一个「处理中」的计划，手上还有时领不了新的，先把它完成/失败/取消。',
	'- 发现了不属于当前计划的活，用 `task_submit` 新建一张计划（parent 指向当前计划，links 写 依赖/派生/来源）挂上去，不要顺手做掉。',
	'- 做完 → `task_state` 改成「完成」；确认做不下去 → 「失败」；缺信息或要先调研 → 「需要补充」；代价大、要用户拍板 → 「需要授权」；用户明确否决 → 「拒绝」。',
	'- 搁置（需要补充 / 需要授权）时用 `task_state` 的 `note` 参数写清为什么停在这里（在等谁、等什么）；事后补写用 `task_note`。',
	'- 一张计划交付后会级联取消它下面停在「需要补充 / 需要授权」的子计划，所以子计划要赶在父计划完成前处理掉。',
	'- 做完一张回到 `task_list` 继续领下一张，直到没有「提交」的计划；都没有就停下等用户，不要自己找事做。',
	'- 计划太大或含糊：先用 `task_template` 取模板，再用 `task_submit` 拆成子计划（A问题/B设计/C接口/D实现/R研究/F复盘 选合适层），再执行。',
	'- 领取前的硬规则：自己 `依赖:X` 的，X 必须「完成」；有父计划或派生源的，父计划/派生源必须「处理中」。不满足就领不到。',
	'- 状态三分类：**进行态**＝提交 / 处理中 / 需要补充 / 需要授权；**草稿**＝未指定（没采纳，不作数）；**完成态**＝完成 / 失败 / 取消 / 拒绝（已交付，不销毁）。',
	'- 派生就是父子结构：子计划还有进行态时不能完成父计划；父计划搁置（需要补充 / 需要授权）时，进行态的子计划一起转「需要授权」；父计划终止（完成 / 失败 / 取消 / 拒绝）时，进行态的子计划全部「取消」。草稿与完成态都不动。',
	'- 依赖链单向终结：前者「完成」→ 后者照常可领；前者失败 / 取消 / 拒绝 → 进行态的下游全部「取消」（递归）。已采纳的计划不能改，要重来只能 fork 出新计划。',
	'- 取代关系（新计划 links 写 `取代:X`）：新计划被采纳时，X 转「拒绝」，指向 X 的依赖自动转移到新计划，从 X 派生出去的下游全部「取消」。',
	'- 计划上的子工作空间与权限只在「按计划」档生效；其它档位（仅可查看/工作区内修改/完全权限/工具全关）一律按会话档位走，与计划无关。',
	'- 计划可以写两个工作区字段：`workspace`（子工作区，单个，主战场）与 `workspaces`（额外工作区，逗号分隔的绝对路径，可多个）。「工作区内修改」档下写在任一目录内都放行。',
	'- 按计划档不会死锁：计划管理类工具（task_list / task_get / task_submit / task_claim / task_state / task_update / task_template / task_note）永远放行。',
	'- 切任务不受计划权限限制：计划写「工具全关」或「仅可查看」时，工作区类工具被挡，但 task_state 永远能用——先结束或搁置当前计划，再 task_list + task_claim 领下一张。',
	'- 宿主暴露了 `planClaims` 服务（按会话 id 领取/查询/释放计划），给"一个计划 fork 一个会话"的调度器用；子智能体/团队走自己的权限档，不受计划权限约束。',
	'- 一个会话同一时刻只能做一个计划；不同会话可以并发各领一张，权限与工作空间各自独立、绝不并集。子 AI 可以用 `planClaims.claim(自己的id, 计划id)` 接入。',
].join('\n');

/** 覆盖式更新一份计划的内容字段（不动 status / claimed_by）；只有「未指定」的计划可改。 */
async function updateTask(id, patch) {
	return withWrite(() => updateTaskInner(id, patch));
}

async function updateTaskInner(id, patch) {
	const task = await readTask(id);
	if (task === undefined) throw new Error(`没有这份计划：${id}`);
	if (task.status !== '未指定') {
		throw new Error(`${task.id} 现在的状态是「${task.status}」，已采纳的计划不能直接改；请用「分支」复制一份再改`);
	}
	const next = Object.assign({}, task, patch, { id: task.id, status: task.status, claimed_by: task.claimed_by });
	/* 额外工作区进来时同样校验绝对路径并归一。 */
	if (patch.workspaces !== undefined) next.workspaces = splitWorkspaces(patch.workspaces).join(', ');
	for (const field of ['title', 'type', 'body', 'parent', 'links', 'workspace', 'workspaces', 'permission']) {
		if (patch[field] === undefined) next[field] = task[field];
	}
	await saveTask(next);
	return next;
}

/** 一份新计划被采纳（提交）时，它 links 里「取代:X」的那些旧计划直接转「拒绝」。 */
/** links 解析成 [{label,to}]。 */
function linkPairs(task) {
	return String(task.links || '')
		.split(/[,，]/u)
		.map((part) => part.trim())
		.filter((part) => part !== '')
		.map((part) => {
			const cut = part.split(/[:：]/u);
			return { label: (cut[0] || '').trim(), to: (cut[1] || '').trim() };
		})
		.filter((link) => link.to !== '');
}

/**
 * 领取前的规则检查：
 *   · 自己 links 里的「依赖:X」→ X 必须是「完成」
 *   · 有父计划的 → 父计划必须是「处理中」
 *   · 别人 links 里有「派生:我」→ 那个派生源必须是「处理中」
 * 返回错误文案；空串表示可以领取。
 */
async function claimBlocker(task, tasks) {
	const all = tasks || (await listAll());
	const byId = new Map(all.map((item) => [item.id, item]));
	for (const link of linkPairs(task)) {
		if (link.label !== '依赖') continue;
		const dep = byId.get(link.to);
		if (dep === undefined) return `依赖 ${link.to} 不存在`;
		if (dep.status !== '完成') return `依赖 ${link.to} 还没完成（当前「${dep.status}」），不能领取`;
	}
	if (task.parent) {
		const parent = byId.get(task.parent);
		if (parent === undefined) return `父计划 ${task.parent} 不存在`;
		if (parent.status !== '处理中') {
			return `父计划 ${parent.id} 不在「处理中」（当前「${parent.status}」），不能领取`;
		}
	}
	/* 派生：谁 links 里写了「派生:我」，谁就是我的派生源，必须正在「处理中」。 */
	for (const other of all) {
		if (other.id === task.id) continue;
		const derives = linkPairs(other).some((link) => link.label === '派生' && link.to === task.id);
		if (!derives) continue;
		if (other.status !== '处理中') {
			return `派生源 ${other.id} 不在「处理中」（当前「${other.status}」），不能领取`;
		}
	}
	return '';
}

/** 当前会话正在进行的任务（处理中）；没有就 undefined。 */
async function activeClaimOf(agent) {
	const id = String(agent?.id ?? agent?.session?.id ?? '');
	const direct = CLAIMS.get(id);
	if (direct !== undefined) {
		const task = await readTask(direct.id);
		if (task !== undefined && task.status === '处理中') return task;
	}
	const all = await listAll();
	return all.find((task) => task.status === '处理中' && (task.claimed_by || '') === id);
}
/** 父子校验：父计划必须存在，且已完成的计划不能再派生。 */
async function assertParent(parentId) {
	const id = String(parentId ?? '').trim();
	if (id === '') return;
	const parent = await readTask(id);
	if (parent === undefined) throw new Error(`父计划 ${id} 不存在`);
	if (parent.status === '完成') throw new Error(`父计划 ${id} 已完成，不能再往下派生`);
}
/**
 * 父计划被搁置（需要补充/需要授权）时，进行态的子计划一起转「需要授权」（递归，防环）。
 * 草稿（未指定）不作数、完成态是已交付的记录——两者都不动。
 */
async function shelveChildren(parentId, visited) {
	const seen = visited || new Set();
	if (seen.has(parentId)) return;
	seen.add(parentId);
	const tasks = await listAll();
	for (const child of tasks) {
		if (child.parent !== parentId) continue;
		if (isActive(child.status) && child.status !== '需要授权') {
			child.status = '需要授权';
			child.claimed_by = '';
			await saveTask(child);
		}
		await shelveChildren(child.id, seen);
	}
}
/** 派生链下游全部取消（递归，防环）：只认 `links` 里的 `派生:X` 这种写法，父子结构由 cascadeClose 管。 */
async function cancelDerived(sourceId, all, visited) {
	const seen = visited || new Set();
	if (seen.has(sourceId)) return;
	seen.add(sourceId);
	for (const other of all) {
		if (other.id === sourceId) continue;
		const derived = linkPairs(other).some((link) => link.label === '派生' && link.to === sourceId);
		if (!derived) continue;
		/* 只动进行态：草稿不作数，完成态是已交付的记录。 */
		if (isActive(other.status)) {
			other.status = '取消';
			other.claimed_by = '';
			await saveTask(other);
		}
		await cancelDerived(other.id, all, seen);
	}
}
async function applySupersede(task) {
	if (task.status !== '提交') return;
	const all = await listAll();
	for (const link of linkPairs(task)) {
		if (link.label !== '取代') continue;
		const oldId = link.to;
		if (oldId === '') continue;
		const old = all.find((item) => item.id === oldId);
		if (old === undefined) continue;

		/* 顺序有讲究：必须先把「指向旧计划」的依赖转移到新计划，再判旧计划死刑。
		   反过来的话，旧计划一转「拒绝」就会把那些依赖方当成死路一起取消掉，
		   而它们本来应该在替代关系里活下来、改指向新计划。 */

		/* 1) 依赖转移：凡是指向旧计划的「依赖」，改成指向新计划 */
		for (const other of all) {
			if (other.id === task.id) continue;
			const pairs = linkPairs(other);
			if (!pairs.some((pair) => pair.label === '依赖' && pair.to === oldId)) continue;
			other.links = pairs
				.map((pair) => (pair.label === '依赖' && pair.to === oldId ? `依赖:${task.id}` : `${pair.label}:${pair.to}`))
				.join(', ');
			await saveTask(other);
		}

		/* 2) 旧计划转「拒绝」，并把它自己的下游一起收掉（子计划 + 剩下的依赖方）。
		   这里不能调 setState：applySupersede 本身就在 withWrite 里，再进一次会自锁。 */
		if (old.status !== '拒绝') {
			old.status = '拒绝';
			old.claimed_by = '';
			await saveTask(old);
			await cascadeClose(oldId, '拒绝');
		}

		/* 3) 旧计划 `links` 里「派生:X」写法的下游，也一并取消（递归） */
		await cancelDerived(oldId, await listAll());
	}
	await refreshClaims();
}

function registerUpdate(ctx) {
	ctx.tools.register(
		defineTool({
			name: 'task_update',
			description:
				'改一份已有计划的内容（标题 / 类型 / 父计划 / 关联 / 子工作空间 / 权限 / 正文）。只改内容，不改状态——状态用 task_state。',
			parameters: {
				id: { type: 'string', required: true, description: '计划 id，例如 T-004' },
				title: { type: 'string', description: '新标题' },
				type: { type: 'string', description: 'A/B/C/D/R/F，或空串表示空模板' },
				body: { type: 'string', description: '新正文（Markdown）' },
				parent: { type: 'string', description: '父计划 id，空 = 顶层' },
				links: { type: 'string', description: '关联，例如「依赖:T-001, 派生:T-002」' },
				workspace: { type: 'string', description: '子工作空间绝对路径' },
				permission: { type: 'string', description: '仅可查看 / 工作区内修改 / 完全权限 / 工具全关' },
			},
			output: {
				schema: { type: 'object', additionalProperties: false, properties: { text: { type: 'string' } } },
				render: (_args, value) => [{ type: 'text', text: value.text }],
			},
			async execute(args) {
				const patch = {};
				for (const field of ['title', 'type', 'body', 'parent', 'links', 'workspace', 'workspaces', 'permission']) {
					if (args[field] !== undefined) patch[field] = String(args[field]);
				}
				if (patch.type !== undefined) {
					patch.type = patch.type.toUpperCase();
					if (patch.type !== '' && !ALL_TYPES.includes(patch.type)) throw new Error(`type 必须是 ${ALL_TYPES.join('/')} 或留空`);
				}
				const task = await updateTask(args.id, patch);
				return { text: `已更新 ${task.id}：${task.title}` };
			},
		}),
	);

	ctx.commands.register({
		name: 'task-update',
		description: '改一份已有计划的内容（面板调用；JSON：{id,title?,type?,body?,parent?,links?,workspace?,permission?}）',
		input: { hint: '{"id":"T-004","title":"…"}' },
		recordInput: false,
		async handler({ rawInput }) {
			try {
				const input = JSON.parse(String(rawInput ?? '{}'));
				if (!input.id) return { kind: 'error', text: '缺少 id' };
				const patch = {};
				for (const field of ['title', 'type', 'body', 'parent', 'links', 'workspace', 'workspaces', 'permission']) {
					if (input[field] !== undefined) patch[field] = String(input[field]);
				}
				if (patch.type !== undefined) patch.type = patch.type.toUpperCase();
				const task = await updateTask(input.id, patch);
				return { kind: 'success', text: JSON.stringify({ id: task.id }) };
			} catch (error) {
				return { kind: 'error', text: String(error?.message ?? error) };
			}
		},
	});
}
/**
 * 给「一个会话干一个计划」的调度器用的宿主服务。
 *
 * 口径是**会话 id**，不要求是真实的 DSH 会话对象：外部调度器（含自管子 AI）
 * 给一个稳定的字符串 id 就行。一个 id 同一时刻只允许一个「处理中」的计划，
 * 不同 id 可以并发领取、各按自己那份计划的权限干活——**互不影响、不并集**。
 *
 * 子智能体 / 团队 AI 走自己的权限档（不是「按计划」），守卫本来就不管它们；
 * 它们可以不接这个口子，也可以主动用 `claim(sessionId, planId)` 各领各的。
 */
function planClaimsFor(ctx) {
	/** 统一形状：外部调度器拿到就能自己实现守卫。 */
	const shape = (task) => ({
		id: task.id,
		title: task.title,
		status: task.status,
		claimedBy: String(task.claimed_by || ''),
		workspace: task.workspace || '',
		workspaces: splitWorkspaces(task.workspaces),
		permission: task.permission || '',
	});

	const service = {
		/** 该会话当前正在做的计划（处理中 + claimed_by 严格匹配）；没有就 undefined。 */
		async current(sessionId) {
			const id = String(sessionId ?? '');
			if (id === '') return undefined;
			const map = await readStore();
			for (const task of map.values()) {
				if (task.status === '处理中' && String(task.claimed_by || '') === id) return shape(task);
			}
			return undefined;
		},

		/**
		 * 为某个会话领取一份「提交」的计划；一次只能一个。
		 * sessionId 是任意稳定字符串，不要求是真实 DSH 会话。
		 */
		async claim(sessionId, planId) {
			const session = String(sessionId ?? '');
			if (session === '') throw new Error('planClaims.claim: 需要会话 id');
			/* 走唯一的改状态入口：拿到写锁（并发双领被串行化）、
			   CLAIMS 与 refreshClaims 由 setStateInner 一处维护、
			   转移校验（草稿不能进处理中）也自动生效。 */
			const task = await setState(planId, '处理中', { id: session }, false);
			return shape(task);
		},

		/** 释放该会话的领取（默认退回「提交」）。 */
		async release(sessionId, nextStatus) {
			const running = await service.current(sessionId);
			if (running === undefined) return undefined;
			const wanted = String(nextStatus ?? '');
			/* 释放不能落到「处理中」：那会造出 claimed_by 为空的无主处理中计划 */
			if (wanted === '处理中') throw new Error('release 不能把计划释放成「处理中」；要换手请先 release 再 claim');
			/* 走唯一的改状态入口：释放到终止态时同样要触发派生/依赖级联。 */
			const task = await setState(running.id, STATUS.includes(wanted) ? wanted : '提交', undefined, true);
			/* 同步清快取：不清的话，这个会话下一次工具调用还会以为自己在做旧任务。 */
			CLAIMS.delete(String(sessionId ?? ''));
			await refreshClaims();
			return { id: task.id, status: task.status };
		},

		/** 只读：当前全部领取（给面板/调度器看）。 */
		async list() {
			const map = await readStore();
			return [...map.values()].filter((task) => task.status === '处理中').map(shape);
		},

		/**
		 * 外部调度器自检用：某个会话如果现在动手，会拿到哪份权限。
		 * 返回 undefined 表示「没有可用领取」（守卫会拒掉除计划管理工具以外的一切）。
		 */
		async effective(sessionId) {
			const running = await service.current(sessionId);
			if (running === undefined) return undefined;
			return {
				id: running.id,
				workspace: running.workspace || '',
				workspaces: running.workspaces || [],
				permission: running.permission || '工作区内修改',
			};
		},
	};
	return service;
}

export function apply(ctx) {
	registerTools(ctx);
	registerCommands(ctx);
	registerExtraTools(ctx);
	registerExtraCommands(ctx);
	registerUpdate(ctx);
	try {
		ctx.provide('planClaims', planClaimsFor(ctx));
	} catch (failure) {
		/* 没有 provide 能力时只是少一个口子 */
	}
	installPlanPreset(ctx);
	installGuard(ctx);
	refreshClaims().catch(() => {});
	try {
		const prompts = ctx.get('systemPrompt');
		if (prompts && typeof prompts.section === 'function') {
			ctx.effect(() => prompts.section({ name: 'taskboard', order: 60, text: PROMPT_TEXT }));
		}
	} catch (failure) {
		/* 没有 systemPrompt 服务时只是少一段约定，不影响工具 */
	}
}
