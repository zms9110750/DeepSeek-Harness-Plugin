/**
 * 任务板 · 持久化提供者（store）。
 *
 * 用户要求拆成八个插件，这是第 ① 块：
 *   > 1.持久化和提供者（处理从软件到磁盘）
 *
 * ## 职责边界
 *
 * 这一层**只管把内存里的对象变成磁盘上的字节，再变回来**：
 *
 *   · 文件路径与目录
 *   · JSONL 追加 + fold（事件溯源）
 *   · 序列化 / 反序列化（parseTask / renderTask）
 *   · 写队列（withWrite，串行化并发写）
 *   · 分组文件、当前组文件
 *   · 老格式迁移
 *
 * **不在这里做的事**：
 *   · 业务规则（谁能改状态、失败要不要理由）→ core
 *   · 编号规则（WI-01 怎么来的）→ core（它要知道模板）
 *   · 面向模型的工具 → tools 插件
 *
 * 这样想换 SQLite 的人只需要写一个实现同样接口的新包，
 * 上层的 core / tools / ui 一行都不用改。
 *
 * ## 对外接口：ctx.taskboardStore
 *
 *   listAll()                 → 全部任务（已 fold）
 *   readTask(id)              → 一条，或 undefined
 *   saveTask(task, meta)      → 追加一条 upsert 事件
 *   appendEvent(event)        → 底层追加（core 的 createNew 用）
 *   withWrite(fn)             → 写队列（串行化）
 *   listGroups()              → 分组列表
 *   saveGroup(group)          → 保存分组
 *   readCurrentGroup(sid)     → 当前组
 *   writeCurrentGroup(id,sid) → 设当前组
 *   migrateLegacy()           → 老格式一次性导入
 *   storeFile / groupsFile / currentFile  → 路径（面板要读）
 */
import { appendFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
/*
 * 任务头的字段清单与顺序 —— **这是磁盘格式的一部分**，属于 store。
 *
 * 顺序就是 JSONL / 旧 md 文件里 `key: value` 行的顺序。
 * 改动它等于改动文件格式，所有读老数据的路径都要跟着改。
 */
const HEAD_FIELDS = [
	'id',
	'title',
	'type',
	'kind',
	'status',
	'parent',
	'links',
	'workspace',
	'workspaces',
	'permission',
	'deny',
	'claimed_by',
	'note',
	'flags',
];
/** 只认 string，其它一律当空串。store 内部用。 */
function text(value) {
	return typeof value === 'string' ? value : '';
}

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
		/* 存归一化后的编号：老数据的单字母在这里自动升级成双字母。 */
		type: hooks.normalizeType(head.type),
		/* kind 存了就用存的；没存是因为老数据，读的时候按 type 推（见 kindOf）。 */
		kind: text(head.kind),
		status: text(head.status) || '未指定',
		parent: text(head.parent),
		links: text(head.links),
		workspace: text(head.workspace),
		workspaces: text(head.workspaces),
		permission: text(head.permission),
		deny: text(head.deny),
		claimed_by: text(head.claimed_by),
		body: lines.slice(index).join('\n').trim(),
		note: text(head.note),
		flags: text(head.flags),
		file,
	};
}

function renderTask(task) {
	const lines = ['---'];
	for (const field of HEAD_FIELDS) {
		if (field === 'kind') {
			/* 老数据没存 kind：这里输出**推断后**的值，并标出它是推出来的。 */
			const resolved = hooks.kindOf(task);
			const stored = text(task.kind);
			lines.push(`kind: ${resolved}${stored === '' ? ' (推断)' : ''}`);
			continue;
		}
		lines.push(`${field}: ${text(task[field])}`);
	}
	lines.push('---', '', text(task.body));
	if (text(task.note) !== '') lines.push('', '<!-- note -->', text(task.note));
	return `${lines.join('\n')}\n`;
}

/* ---- 存储：一个 JSONL 文件，放在用户目录 ----
 * 路径：%USERPROFILE%\.dsh\taskboard\plans.jsonl
 * 每行一个事件：{"op":"upsert","task":{…}}；读取时顺序折叠成当前状态。
 * 追加写、无原生依赖；单文件，备份/搬迁只搬这一个。
 */
/**
 * 数据根目录：与宿主同一套规则（读自 `app.asar` 的 `@deepseek-ai/dsh-home-paths`）。
 *
 * 优先级（高 → 低）：
 *   1. 显式配置的路径
 *   2. `$DSH_HOME`（空串/纯空白视为没设，避免把 home 解析成当前目录）
 *   3. `~/.dsh`
 *
 * 任务库是**运行时数据**，跟会话消息一个地位，所以必须住在同一个根下（T-032）。
 * 支持 `~` / `~/` / `~\` 前缀展开。
 */
function expandHomePath(raw) {
	const value = String(raw ?? '');
	if (value === '~') return homedir();
	if (value.startsWith('~/') || value.startsWith('~\\')) return join(homedir(), value.slice(2));
	return value;
}

function resolveDshHome(configured) {
	const fromEnv = process.env.DSH_HOME;
	const picked =
		configured !== undefined && configured !== null && String(configured).trim() !== ''
			? configured
			: fromEnv !== undefined && fromEnv.trim().length > 0
				? fromEnv
				: join(homedir(), '.dsh');
	return resolve(expandHomePath(picked));
}

/*
 * 业务知识的注入点。
 *
 * 
ormalizeType / kindOf 依赖模板表（哪些编号合法、某模板属于哪个大类），
 * 那是 core 的知识，不是存储层的。currentActor 也一样——谁在写是会话的概念。
 *
 * 所以这里留一个可注入的 hooks 对象：core 启动时调 provideStoreHooks(...)。
 * 这样 store 保持纯 I/O，换实现时不用复制这些业务规则。
 */
const hooks = {
	normalizeType: (value) => String(value ?? '').toUpperCase(),
	kindOf: () => 'work',
	currentActor: () => '',
};

/** core 启动时调用，把自己的业务函数交给存储层。 */
export function provideStoreHooks(overrides) {
	Object.assign(hooks, overrides ?? {});
}

/*
 * 老格式目录（一个任务一个 md 文件）。
 *
 * 只在首次启动时扫一次，把老数据导进 JSONL，然后写 `.migrated` 标记。
 * 保留它是为了**不丢用户已有的数据** —— 迁移完就再也不碰了。
 */
const LEGACY_DIR = process.env.TASKBOARD_ROOT || 'X:\\temp\\dsh\\任务';
const STORE_DIR = join(resolveDshHome(), 'taskboard');
const STORE_FILE = process.env.TASKBOARD_STORE || join(STORE_DIR, 'plans.jsonl');
/*
 * ---------------------------------------------------------------------------
 * 分组（groups）
 * ---------------------------------------------------------------------------
 *
 * 用户原话：
 *   > 肯定要分组啊。我这里打插件要这些任务。等下我写程序还要这些任务干什么？
 *   > 我的工作空间是在仓库的根目录的。为了做工作的时候可以读别的程序。
 *
 * 关键澄清：**`workspace` 不是分组**。那是"能读哪个目录"的权限字段，
 * 用户为了能读别的项目，把它设成了仓库根目录——所以按 workspace 分组
 * 会把所有任务挤进同一堆。分组必须是**独立的概念**。
 *
 * 设计：一个分组就是一个**命名的集合**，任务可以属于任意多个分组。
 *   · 与父子树正交（一个任务既可属于某分组，又在某棵树下）
 *   · 与九态正交（分组不是状态）
 *   · 存独立文件 `groups.jsonl`，不污染 `plans.jsonl` 的行格式
 *     （用户明确要求过"不要随便改日志"；新建文件比改旧行安全）
 *
 * 记录格式（一行一个事件，追加式，同样按 id fold）：
 *   {"op":"upsert","ts":"…","group":{"id":"g-1","name":"插件开发","members":["T-001",…]}}
 */
const GROUPS_FILE = process.env.TASKBOARD_GROUPS || join(STORE_DIR, 'groups.jsonl');
/*
 * ---------------------------------------------------------------------------
 * 当前分组（current group）
 * ---------------------------------------------------------------------------
 *
 * 用户原话：
 *   > 需要有一个当前组。工具的查找是默认对当前组里面找的。
 *   > 去翻别的组需要额外的参数。就比如用户风格，
 *   > 你不可能在程序里面去查绘画的风格。
 *
 * 所以工具的默认范围 = 当前组。这也顺带解决了"分组要一个人记着"的问题：
 * 切一次，后面所有工具调用都默认在那一组里。
 *
 * 存一个单独的文件（`current.json`），因为它是**会话级偏好**，
 * 不是任务数据，混进 plans.jsonl 会把事件流搞脏。
 */
const CURRENT_FILE = process.env.TASKBOARD_CURRENT || join(STORE_DIR, 'current.json');

/*
 * ⚠️ 当前组**跟随会话**，不是全局。
 *
 * 用户原话：「"当前组"这个状态是有必要的。而且跟随会话。
 * 这个不能跨会话了还同步。」
 *
 * 所以键是 sessionId：A 会话在看"开发任务板"时，B 会话可能在看别的，
 * 默认查询范围互不影响。没有 sessionId 的调用回落到 `_default`。
 */
function currentKey(sessionId) {
	const id = String(sessionId ?? '').trim();
	return id === '' ? '_default' : id;
}

async function readCurrentMap() {
	try {
		const raw = await readFile(CURRENT_FILE, 'utf8');
		const parsed = JSON.parse(raw);
		/* 兼容旧格式（{group:"g-1"}）→ 当成 _default。 */
		if (parsed !== null && typeof parsed === 'object' && typeof parsed.group === 'string' && parsed.sessions === undefined) {
			return { _default: parsed.group };
		}
		return parsed !== null && typeof parsed === 'object' && parsed.sessions !== null && typeof parsed.sessions === 'object'
			? parsed.sessions
			: {};
	} catch (failure) {
		return {};
	}
}

async function readCurrentGroup(sessionId) {
	const map = await readCurrentMap();
	const key = currentKey(sessionId);
	/* 先按会话找；找不到再退回 `_default`（旧格式或没会话上下文的调用）。
	 *
	 * 这个回落是必要的：AI 在工具里调时，sessionId 可能拿不到；
	 * 面板通过命令设当前组时也可能没有会话 id。不给回落的话，
	 * 就会出现"设了当前组但新建仍然没归组"这种诡异现象。 */
	const id = String(map[key] ?? map._default ?? '').trim();
	if (id === '') return '';
	const groups = (await listGroups()).filter((entry) => entry.name !== '');
	return groups.some((entry) => entry.id === id) ? id : '';
}

async function writeCurrentGroup(id, sessionId) {
	const map = await readCurrentMap();
	const key = currentKey(sessionId);
	const value = String(id ?? '').trim();
	if (value === '') delete map[key];
	else map[key] = value;
	await mkdir(dirname(CURRENT_FILE), { recursive: true });
	await writeFile(CURRENT_FILE, JSON.stringify({ sessions: map }), 'utf8');
}

/** 读全部分组（追加式 JSONL，按 id fold 最后一次）。 */
async function listGroups() {
	await mkdir(dirname(GROUPS_FILE), { recursive: true });
	let raw = '';
	try {
		raw = await readFile(GROUPS_FILE, 'utf8');
	} catch (failure) {
		return [];
	}
	const byId = new Map();
	for (const line of String(raw).split(/\r?\n/u)) {
		const trimmed = line.trim();
		if (trimmed === '') continue;
		let event = null;
		try {
			event = JSON.parse(trimmed);
		} catch (failure) {
			continue;
		}
		if (event === null || event.op !== 'upsert') continue;
		const group = event.group;
		if (group === null || typeof group !== 'object') continue;
		const id = String(group.id || '').trim();
		if (id === '') continue;
		byId.set(id, {
			id,
			name: String(group.name || id),
			members: Array.isArray(group.members) ? group.members.map(String) : [],
			createdAt: String(group.createdAt || ''),
			/* 归档是对分组归档的。 */
			archived: group.archived === true,
		});
	}
	return [...byId.values()];
}

/** 写一个分组（追加一行）。 */
async function saveGroup(group) {
	await mkdir(dirname(GROUPS_FILE), { recursive: true });
	/* 没显式传 archived 时沿用现有值。
	 *
	 * 为什么要这样：改名、加成员这些操作不该意外把分组从归档里拉出来。
	 * 之前每个调用点都要自己传 archived，漏一个就是隐形 bug。 */
	let archived = group.archived;
	if (archived === undefined) {
		const existing = (await listGroups()).find((entry) => entry.id === group.id);
		archived = existing?.archived === true;
	}
	const event = {
		op: 'upsert',
		ts: new Date().toISOString(),
		actor: 'user',
		group: {
			id: group.id,
			name: group.name,
			members: group.members,
			createdAt: group.createdAt || new Date().toISOString(),
			/* 归档是对**分组**归档的（用户要求）：
			 * 「归档是对分组归档的。」所以在组上放一个布尔，
			 * 而不是给每条任务都打 archived。 */
			archived: archived === true,
		},
	};
	await appendFile(GROUPS_FILE, JSON.stringify(event) + '\n', 'utf8');
}

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
/**
 * 追加一条事件（T-019 事件溯源）。
 *
 * 只**增加**字段，不动原有结构：
 *   {op, task}  →  {op, ts, actor, from, to, task}
 *
 * 为什么这么保守：用户明确说过「不要随便改日志，如果读不了，可能整个 agent
 * 都要别的 agent 修」。所以：
 *   · 仍然是 `{"op":"upsert","task":{…}}` 这一行一个事件的老形状；
 *   · `ts`/`actor`/`from`/`to` 是**同级新增**，老读代码（只认 op/task）完全不受影响；
 *   · 老事件没有这些字段 → 读的时候缺就缺，不报错、不补写、不迁移。
 *
 * `from`/`to` 只在状态真的变化时才有；`actor` 是会话 id 或 `user`。
 */
async function appendEvent(event) {
	await mkdir(dirname(STORE_FILE), { recursive: true });
	const enriched = Object.assign({ ts: new Date().toISOString() }, event);
	/* actor：调用方没给就落到当前写入上下文（见 withActor），最后兜底 'unknown'。 */
	if (enriched.actor === undefined) enriched.actor = hooks.currentActor() || 'unknown';
	await appendFile(STORE_FILE, `${JSON.stringify(enriched)}\n`, 'utf8');
}


/**
 * 读一个任务的事件历史。
 *
 * 这属于存储层：它要直接读 JSONL 原文，**只读**、不补字段、不迁移。
 * core 的 task_history 通过服务调它。
 */async function readHistory(id, limit) {
	const wanted = String(id ?? '').trim();
	if (wanted === '') throw new Error('task_history: 需要一个任务 id，例如 MG-01');
	let raw = '';
	try {
		raw = await readFile(STORE_FILE, 'utf8');
	} catch (error) {
		if (!error || error.code !== 'ENOENT') throw error;
		raw = '';
	}
	const entries = [];
	for (const line of raw.split(/\r?\n/u)) {
		if (line.trim() === '') continue;
		let event;
		try {
			event = JSON.parse(line);
		} catch (failure) {
			/* 坏行跳过：历史读不出来不该让整个调用失败。 */
			continue;
		}
		if (!event || event.op !== 'upsert' || !event.task || String(event.task.id) !== wanted) continue;
		entries.push({
			ts: text(event.ts),
			actor: text(event.actor),
			from: text(event.from),
			to: text(event.to),
			status: text(event.task.status),
			note: text(event.task.note),
		});
	}
	if (entries.length === 0) {
		const any = await readTask(wanted);
		if (any === undefined) throw new Error(`没有这个任务：${wanted}`);
		return [];
	}
	const cap = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 50;
	return entries.slice(-cap);
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
	if (wanted === '') throw new Error('task_get: 需要一个任务 id，例如 MG-01');
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
/**
 * 写一个任务的当前状态。
 *
 * `meta` 可选：`{from, to}` 表示这次写是一次状态转移（只有 setState 会传）。
 * `from`/`to` 只在真的变化时才写，别的写入（改备注、改正文）不带这两个字段。
 */
async function saveTask(task, meta) {
	if (task && typeof task.links === 'string') task = Object.assign({}, task, { links: dedupeLinks(task.links) });
	const event = { op: 'upsert', task };
	if (meta && typeof meta.from === 'string' && typeof meta.to === 'string' && meta.from !== meta.to) {
		event.from = meta.from;
		event.to = meta.to;
	}
	await appendEvent(event);
}

/*
 * ── 插件入口 ───────────────────────────────────────────────────────────
 *
 * 只做一件事：把上面这些函数挂成 `ctx.taskboardStore` 服务。
 * 上层（core / tools / ui）通过 inject 拿，不直接 import ——
 * 那样才能换实现。
 */
export const name = 'taskboard-store';

/* 纯 I/O 包：不依赖任何前置服务。 */
export const inject = [];

const service = {
	/** 上层把自己的业务函数（编号归一化 / kind 推断 / 当前写入者）交进来。 */
	provideHooks: provideStoreHooks,
	readStore,
	readHistory,
	listAll,
	readTask,
	saveTask,
	appendEvent,
	withWrite,
	listGroups,
	saveGroup,
	readCurrentGroup,
	writeCurrentGroup,
	migrateLegacy,
	dedupeLinks,
	parseTask,
	renderTask,
	/* 路径：面板需要知道读哪儿 */
	storeFile: STORE_FILE,
	groupsFile: GROUPS_FILE,
	currentFile: CURRENT_FILE,
};

export function apply(ctx) {
	ctx.provide('taskboardStore', service);
}

/* 也导出，方便测试和同包内联用。 */
export {
	readStore,
	readHistory,
	listAll,
	readTask,
	saveTask,
	appendEvent,
	withWrite,
	listGroups,
	saveGroup,
	readCurrentGroup,
	writeCurrentGroup,
	migrateLegacy,
	dedupeLinks,
	parseTask,
	renderTask,
	STORE_FILE,
	GROUPS_FILE,
	CURRENT_FILE,
};
