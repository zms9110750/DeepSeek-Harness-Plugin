/**
 * 任务库 · 宿主侧。
 *
 * 任务既是文件（`任务\<id>.md`），也是对话面板里的任务。
 * 这里只做三件事：读写任务文件、给模型四个任务工具、给面板三条命令。
 *
 * 硬规则：
 *   · 模型提交的一律是「未指定」，只有用户能把状态改成「提交」（/task-approve）；
 *   · `task_claim` 只接受「提交」的任务，未指定 / 拒绝 / 完成 都拒绝；
 *   · 任务的附属权限（子工作空间 + 权限档位）只在会话处于「按计划」档位时才生效，
 *     这一段由权限侧实现，这里只负责把值交出去。
 *
 * @module @local/taskboard
 */
import { readdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
/*
 * 这里**不该**有 `import { defineTool } from '@deepseek-ai/dsh-tools'`。
 *
 * 工具（14 个）在 `packages/tools` 里注册，core 一个都没定义过。
 * 那行 import 是拆包时留下的死引用 —— 它让 core 在模块解析层面
 * 依赖 dsh-tools，而用户的要求是「tools 依赖 core，不是反过来」。
 */
/*
 * 这个包拆成四个插件（用户要求「一个包里面可以有多个插件」）：
 *
 *   core         本文件 —— 存储、任务模型、状态机、AI 工具、命令
 *   templates    附加模板（内置 4 个在 core/templates/，其余 23 个在这里）
 *   plan-preset  「按计划」权限档 + 守卫
 *   workspace    子工作空间 / 额外工作区 + 路径判定
 *   ui-drawer    输入栏旁边的箭头抽屉
 *   ui-sidebar   右侧栏的「任务」标签页
 *
 * 为什么要拆：权限是**限制**，面板是**显示**。以前混在一个插件里，
 * 导致"只想看面板"的人被迫接受权限注入，反之亦然。
 *
 * 依赖方向（单向，不成环）：
 *   core → shared ← plan-preset
 *   core → shared ← workspace
 *   core → plan-preset（要 CLAIMS / resolveClaim / refreshClaims）
 *   plan-preset → workspace（路径判定）
 */
import {
	text,
	CURRENT_ACTOR,
	CURRENT_SESSION,
	sessionIdOf,
	actorLabel,
	splitWorkspaces,
} from './shared.js';
import {
	PLAN_PRESET,
	CLAIMS,
	claimKey,
	resolveClaim,
	installPlanPreset,
	installGuard,
	provideTaskLoader,
	refreshClaims,
	parseDeny,
} from '../plan-preset/index.js';
import { within } from '../workspace/index.js';

/*
 * ── 绑到存储服务 ──────────────────────────────────────────────────────
 *
 * 持久化已经拆到独立的 `@local/taskboard-store` 包（用户要求的第 ① 块）。
 * 这个模块不再直接碰文件，而是把 store service 的方法接成同名局部函数，
 * 这样下面几百处调用一行都不用改。
 *
 * 为什么用这层薄壳而不是全改成 `ctx.taskboardStore.xxx`：
 * 那些调用点分散在两三千行里，逐个改既危险又没收益。
 * 薄壳还能在 store 缺失时给出清楚的报错，而不是 `undefined is not a function`。
 */
let STORE = null;

/** store 的方法名 → 局部同名函数。 */
function bindStore(service) {
	STORE = service;
}

/** 拿一个 store 方法，缺失时给出可读的报错。 */
function storeFn(name) {
	return function (...args) {
		if (STORE === null || typeof STORE[name] !== 'function') {
			throw new Error(`任务板存储服务不可用（缺 ${name}）。检查 @local/taskboard-store 是否启用。`);
		}
		return STORE[name](...args);
	};
}

/* 这些原来都是本模块的函数，现在转给 store。 */
const listAll = storeFn('listAll');
const readTask = storeFn('readTask');
const saveTask = storeFn('saveTask');
const appendEvent = storeFn('appendEvent');
const withWrite = storeFn('withWrite');
const listGroups = storeFn('listGroups');
const saveGroup = storeFn('saveGroup');
const readCurrentGroup = storeFn('readCurrentGroup');
const writeCurrentGroup = storeFn('writeCurrentGroup');
const readStore = storeFn('readStore');
const migrateLegacy = storeFn('migrateLegacy');
const parseTask = storeFn('parseTask');
const renderTask = storeFn('renderTask');
const readHistory = storeFn('readHistory');

/** 存储文件路径（提示文案里要显示"存储在哪"）。 */
function storeFilePath() {
	return STORE && typeof STORE.storeFile === 'string' ? STORE.storeFile : '（未知）';
}

/** 老的 resolveDshHome —— 现在只有提示文案用得到。 */
function resolveDshHome(configured) {
	const fromEnv = process.env.DSH_HOME;
	return configured !== undefined && configured !== null && String(configured).trim() !== ''
		? String(configured)
		: fromEnv !== undefined && fromEnv.trim().length > 0
			? fromEnv
			: join(homedir(), '.dsh');
}
export const name = 'taskboard';

/*
 * 依赖清单。
 *
 * ⚠️ **不要在这里加 `tools` 或 `commands`。**
 *
 * 用户定的依赖方向是单向的：
 *
 *   > tools 直接依赖 core 啊。这个语义是你不喜欢我的 tools，你就自己造你的 tools。
 *   > 也就是说 core 是要暴露东西的。但依赖确实是 tools 依赖 core。
 *   > core 是 core 就是假设他不能关的。
 *
 * 之前这两个写在 inject 里，但 core 从来没有用过 `ctx.tools` 或
 * `ctx.commands`（工具和命令都在 tools 包里注册）。那是**反向依赖**：
 * 它会让 core 等着 tools 就绪，而 tools 又依赖 core —— 顺序上绕了一圈，
 * 而且违背了「core 不能关、tools 可换」的设定。
 *
 * 现在只留 core 真正用到的：
 *   permissionPresets / sessionProjections —— 权限预设与会话投影
 *   taskboardStore                        —— 持久化（store 包提供）
 */
export const inject = ['permissionPresets', 'sessionProjections', 'taskboardStore'];

/** 老格式目录（一个任务一个 md），只在首次启动时迁移用。 */
const LEGACY_DIR = process.env.TASKBOARD_ROOT || 'X:\\temp\\dsh\\任务';

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
/*
 * 模板类型：A–F 是「这是什么活」，H1–H8 是「为什么停下来等人」。
 * 代码只认 type 字符串，H* 不参与别的逻辑（status / 分类都不看 type）；
 * 模板本身只是正文骨架，用来把搁置理由写具体。
 */
/**
 * 模板编号（双字母）：**大类英文首字母 + 模板英文首字母**。
 *
 *   目标 Goal   → G      设计 Design → D
 *   记录 Record → R      工作 Work   → W
 *
 * 冲突时退到**第二个单词的首字母**。例：记录类的「汇报」Report 首字母是 R，
 * 与大类前缀撞了，取第二字母 → `RR`。
 *
 * 为什么改用英文：模板字母本来就是英文缩写（Decision / Proposal / Fix…），
 * 旧方案混用拼音（M/S/J/G）和英文，`GD` 这种编号说不清是"工作+实现"还是别的。
 */
/*
 * 全部模板编号（27 个）—— 这是**词表**，描述"可能存在哪些模板"，
 * 不是"现在装了哪些"。
 *
 * 内置实际只有 4 个（见 BUILTIN_TYPES）。其余 23 个由 `templates` 插件提供。
 * 分开的理由：`TYPE_NAMES` / `TYPE_TO_KIND` / 编号前缀这些映射表要对
 * **所有可能的模板**都有答案，否则关掉 templates 插件后，读老数据时
 * 连 `RB 阻碍` 都认不出来了。
 */
const TYPES = [
	// 目标 Goal
	'GU',
	// 设计 Design
	'DC', 'DQ',
	// 记录 Record
	'RB', 'RW', 'RF', 'RL', 'RR',
	// 工作 Work
	'WR', 'WV', 'WI',
	// code 域（templates 扩展包提供）
	'MM', 'FN', 'OP', 'TS',
	'DI', 'IM', 'WT',
];
/** 旧类型：只用于读老数据（第一代单字母 + 第二代拼音前缀）。 */
const LEGACY_TYPES = [
	'A', 'B', 'C', 'D', 'F', 'G', 'I', 'K', 'N', 'O', 'P', 'Q', 'R', 'W', 'X',
	'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'H7', 'H8',
	/* 第二代（拼音前缀），已废，只读 */
	'MG', 'MO', 'ML', 'MT',
	'SQ', 'SP', 'SK', 'SC', 'SA', 'SV',
	'JB', 'JW', 'JF', 'JT',
	'GR', 'GD', 'GI', 'GX', 'GN', 'GJ', 'GZ', 'GE', 'GY',
];
const ALL_TYPES = TYPES.concat(LEGACY_TYPES);

/** 旧编号 → 新编号。读老数据时自动升级。 */
const RENAME = {
	/* 第一代单字母 */
	A: 'DB',
	B: 'RB',
	C: 'DI',
	D: 'WI',
	F: 'RF',
	G: 'GU',
	I: 'WT',
	K: 'DQ',
	N: 'WV',
	O: 'GO',
	P: 'DP',
	Q: 'DC',
	R: 'WR',
	W: 'RR',
	X: 'WF',
	/* 第二代拼音前缀 */
	MG: 'GU',
	MO: 'GO',
	ML: 'GA',
	MT: 'GV',
	SQ: 'DC',
	SP: 'DP',
	SK: 'DQ',
	SC: 'DI',
	SA: 'DB',
	SV: 'DT',
	JB: 'RB',
	JW: 'RR',
	JF: 'RF',
	JT: 'RS',
	GR: 'WR',
	GD: 'WI',
	GI: 'WT',
	GX: 'WF',
	GN: 'WV',
	GJ: 'WL',
	GZ: 'WC',
	GE: 'WD',
	GY: 'WE',
	/* H1–H8 无对应模板：已降级为阻碍模板里的理由词表 */
};

/** 把任意写法的 type 归一成当前的编号（旧单字母自动升级）。 */
function normalizeType(raw) {
	const value = String(raw ?? '').trim().toUpperCase();
	if (value === '') return '';
	if (TYPES.includes(value)) return value;
	if (Object.hasOwn(RENAME, value)) return RENAME[value];
	return value;
}

const TYPE_NAMES = {
	/* 目标 Goal */
	GU: '用户需求',
	MM: '预期不符',
	FN: '新增功能',
	OP: '项目优化',
	TS: '项目测试',
	GO: '优化',
	GA: '画作',
	GV: '小说',
	/* 设计 Design */
	DC: '决策',
	DP: '方案',
	DQ: '提问',
	DI: '接口界面',
	IM: '底层实现',
	DB: '问题',
	DT: '定调',
	/* 记录 Record */
	RB: '阻碍',
	RW: '交付',
	RL: '留档',
	RR: '汇报',
	RF: '复盘',
	RS: '设定集',
	RD: '缺陷报告',
	RE: '功能请求',
	WX: '文档',
	/* 工作 Work */
	WR: '调研',
	WI: '实现',
	WT: '实现项',
	WF: '缺陷',
	WV: '校验',
	WL: '线稿',
	WC: '上色',
	WD: '起草',
	WE: '修改',
	WP: '性能',
	/* 老数据里的 H* 只用于显示 */
	H1: '需要授权 · 代价过大',
	H2: '需要授权 · 用户转移话题',
	H3: '需要授权 · 方案缺陷过大',
	H4: '需要信息 · 缺用户信息',
	H5: '需要信息 · 需要先调研',
	H6: '需要授权 · 资源被占用',
	H7: '需要授权 · 缺权限 / 环境不对',
	H8: '需要信息 · 子任务未回收',
};

/*
 * ---------------------------------------------------------------------------
 * 四个大类（kind）
 * ---------------------------------------------------------------------------
 *
 * 分类轴是「**什么时候算做完**」——四个定义互斥且穷尽，所以是真正的大类，
 * 而不是按行业角色乱切（那样必然互相重叠）。
 *
 *   goal   目标   派生任务全部终结才算完         无自有状态，纯推导   不占位
 *   design 设计   用户采纳/驳回了才算完        有状态              不占位
 *   record 记录   写出来就算完（没人动手）      有状态              不占位
 *   work   工作   真做出来了才算完             有状态              **占位**
 *
 * 只有 work 可领取、参与「一次一个」的竞争。其余三类根本不存在「领取」这个动作。
 *
 * 其余一切（形态、章节、提示语、能派发什么）都下沉到**模板**：
 * 「行为取决于具体的模板配置」。
 */
const KINDS = {
	goal: { name: '目标', who: '无（由派生任务决定）', occupying: false, claimable: false },
	design: { name: '设计', who: '用户', occupying: false, claimable: false },
	record: { name: '记录', who: '无（写出来即完）', occupying: false, claimable: false },
	work: { name: '工作', who: 'AI', occupying: true, claimable: true },
};
const KIND_ORDER = ['goal', 'design', 'record', 'work'];

/**
 * 老 type → 新 kind 的推断（零行为变更，只是把概念落进数据）。
 *
 * A（问题）      → design  它是在问方向，等用户答
 * B（设计）      → design
 * C（接口）      → design  接口约定也是"定方向"，不是动手
 * D（实现）      → work    真正动手
 * R（研究）      → work    调研也要动手查
 * F（复盘）      → record  复盘是写出来就完
 * H1..H8         → record  它们是"为什么停"，属于叙述，不是活
 * 空             → work    最安全：老数据里空 type 的多半是待办任务
 */
/**
 * type → kind 的映射（新模板 + 老数据兼容）。
 *
 * 目标类：G
 * 设计类：Q 决策  P 方案  K 提问  C 接口  A 问题
 * 记录类：B 阻碍  W 汇报  F 复盘
 * 工作类：R 调研  D 实现  I 实现项
 *
 * 老类型（已废弃，只为读旧数据）：
 *   A→design  B→design  C→design  D→work  R→work  F→record  H*→record
 * 注意老 B 是"设计"，新 B 是"阻碍"——同一个字母含义变了。
 * 兼容靠 kind 字段：老数据没存 kind 才按 type 推，且老数据不会有新 B。
 */
const TYPE_TO_KIND = {
	/* 目标 Goal */
	GU: 'goal',
	MM: 'goal',
	FN: 'goal',
	OP: 'goal',
	TS: 'goal',
	GO: 'goal',
	GA: 'goal',
	GV: 'goal',
	/* 设计 Design */
	DC: 'design',
	DP: 'design',
	DQ: 'design',
	DI: 'design',
	IM: 'design',
	DB: 'design',
	DT: 'design',
	/* 记录 Record */
	RB: 'record',
	RW: 'record',
	RL: 'record',
	RR: 'record',
	RF: 'record',
	RS: 'record',
	RD: 'record',
	RE: 'record',
	WX: 'record',
	/* 工作 Work */
	WR: 'work',
	WI: 'work',
	WT: 'work',
	WF: 'work',
	WV: 'work',
	WL: 'work',
	WC: 'work',
	WD: 'work',
	WE: 'work',
	WP: 'work',
	/* 第二代拼音前缀（老数据） */
	MG: 'goal',
	MO: 'goal',
	ML: 'goal',
	MT: 'goal',
	SQ: 'design',
	SP: 'design',
	SK: 'design',
	SC: 'design',
	SA: 'design',
	SV: 'design',
	JB: 'record',
	JW: 'record',
	JF: 'record',
	JT: 'record',
	GR: 'work',
	GD: 'work',
	GI: 'work',
	GX: 'work',
	GN: 'work',
	GJ: 'work',
	GZ: 'work',
	GE: 'work',
	GY: 'work',
	/* 老数据（旧单字母 + H1–H8） */
	A: 'design',
	B: 'design',
	C: 'design',
	D: 'work',
	F: 'record',
	G: 'goal',
	I: 'work',
	K: 'design',
	N: 'work',
	O: 'goal',
	P: 'design',
	Q: 'design',
	R: 'work',
	W: 'record',
	X: 'work',
	H1: 'record',
	H2: 'record',
	H3: 'record',
	H4: 'record',
	H5: 'record',
	H6: 'record',
	H7: 'record',
	H8: 'record',
};

/**
 * 推断 kind：存的优先，没存就按 type 推。
 *
 * ⚠️ 有个陷阱：**老 type 和新 kind 可能矛盾**。
 *
 * 例：老数据里 `type: H1`（旧的搁置模板）如果被写进了 `kind: design`
 * （因为当时还是"设计"类），那读的时候到底听谁的？
 *
 * 口径：**存的 kind 优先**——它是明确的、后来写下的决定；
 * type 只是模板骨架，模板可以换，kind 不会因为换模板而变。
 * 但这种情况要能被查出来，所以 renderTask 会标出"类型与种类不一致"。
 */
function kindOf(task) {
	const stored = String(task?.kind ?? '').trim();
	if (stored !== '' && Object.hasOwn(KINDS, stored)) return stored;
	/* 老数据是单字母 type：normalizeType 会升级成双字母，再查表。 */
	const type = normalizeType(task?.type);
	if (type !== '' && Object.hasOwn(TYPE_TO_KIND, type)) return TYPE_TO_KIND[type];
	return 'work';
}

/** 一个任务的状态，缺省按草稿算。 */
function statusOf(task) {
	return String(task?.status || '未指定');
}

/** 一个任务的模板编号（双字母，老数据自动升级）。 */
function typeOf(task) {
	return normalizeType(task?.type);
}

/** 是否已经结束（成功/失败/拒绝/取消）—— 结束的东西不再参与计算。 */
function isEnded(task) {
	return PARENT_CLOSED.has(statusOf(task));
}

/** 这个 kind 是否参与领取竞争。 */
function isClaimable(task) {
	return KINDS[kindOf(task)]?.claimable === true;
}

/** 父节点处于这些状态时，不允许再往下派生/领取。 */
const PARENT_CLOSED = new Set(['成功', '失败', '取消', '拒绝']);

/** 模板目录说明，给工具描述用：`G 用户提出 / Q 决策 / …`，从常量生成避免漏改。 */
function typeCatalog() {
	return TYPES.map((type) => `${type} ${TYPE_NAMES[type] || ''}`).join(' / ');
}

/**
 * 解析传入的 kind：空 → 按 type 推；给了就必须是四个之一。
 *
 * 这是 step 1「零行为变更」的关键：老调用方（面板、旧代码）不传 kind，
 * 行为与以前完全一致；新调用方可以显式指定，落进数据里。
 */
function resolveKindArg(raw, type) {
	const wanted = String(raw ?? '').trim();
	if (wanted === '') {
		const upper = String(type ?? '').trim().toUpperCase();
		return TYPE_TO_KIND[upper] ?? 'work';
	}
	if (!Object.hasOwn(KINDS, wanted)) {
		throw new Error(`kind 必须是 ${KIND_ORDER.join(' / ')} 之一，收到「${wanted}」`);
	}
	return wanted;
}

/* 任务状态复用 A2A 的九态（见 任务\19-A2A调研\README.md）。 */
const STATUS = ['未指定', '提交', '处理中', '需要信息', '需要授权', '成功', '失败', '取消', '拒绝'];

/* 领取决定的常量在 task_claim 里（CLAIMABLE_FROM），
   原来这里还有一个 `CLAIMABLE = ['提交']`，改完就没用了。 */

/*
 * 九态 → 分组。一个状态**可以属于多个组**：
 *
 *   进行：还活着（已采纳待领、正在做、或者停下来等人但没放弃）
 *   搁置：停下来等人（需要信息 / 需要授权）
 *   完成：终结了（成功 / 失败 / 取消 / 拒绝）
 *
 * 「需要信息」「需要授权」同时属于「进行」和「搁置」——它们是**进行中的暂停**，
 * 不是终结。所以 GROUP_OF 的值是数组，判定用 hasGroup()，不要用 ===。
 *
 * 三分类（ACTIVE / DRAFT / FINAL，级联用的口径）由分组派生，不再各处手写：
 *   · 进行态 = 属于「进行」且不属于「结束」 → 活着，会被级联取消/搁置
 *   · 成功态 = 属于「结束」               → 已交付，不销毁
 *   · 草稿   = 两组都不属于（只有「未指定」）→ 没采纳，不作数
 */
const GROUP_OF = {
	未指定: [],
	提交: ['进行'],
	处理中: ['进行'],
	需要信息: ['进行', '搁置'],
	需要授权: ['进行', '搁置'],
	成功: ['结束'],
	失败: ['结束'],
	取消: ['结束'],
	拒绝: ['结束'],
};

/** 三组的定义（顺序即面板展示顺序）。 */
const GROUPS = [
	{ id: '进行', label: '进行', hint: '还活着：在做，或者停下来等人但没放弃' },
	{ id: '搁置', label: '搁置', hint: '停下来等人：需要信息 / 需要授权' },
	{ id: '结束', label: '结束', hint: '终结：成功 / 失败 / 拒绝 / 取消' },
];

/** 某个状态属于哪些组（拷贝，调用方改了不影响定义）。 */
function groupsOf(status) {
	return (GROUP_OF[status] || []).slice();
}

/** 状态是否属于某个组。多组状态用这个判，不要用 ===。 */
function hasGroup(status, group) {
	return (GROUP_OF[status] || []).includes(group);
}

/** 进行态：属于「进行」且不属于「结束」。 */
const ACTIVE = STATUS.filter((status) => hasGroup(status, '进行') && !hasGroup(status, '结束'));
/** 成功态：属于「结束」。 */
const FINAL = STATUS.filter((status) => hasGroup(status, '结束'));
/** 草稿：两组都不属于（目前只有「未指定」）。 */
const DRAFT = STATUS.filter((status) => !hasGroup(status, '进行') && !hasGroup(status, '结束'));

/*
 * ---------------------------------------------------------------------------
 * 目标的状态由派生任务推导（DP-02）
 * ---------------------------------------------------------------------------
 *
 * 用户原话（五条规则，按优先级从上往下）：
 *
 *   > 没有采纳的子任务：未开始。
 *   > 子任务都被需要授权：需要授权。
 *   > 子任务有采纳的且未完成未中断：进行中。
 *   > 子任务全部失败：失败。
 *   > 子任务都在成功态且不是全部失败：完成。
 *
 * **不落盘**——只在读取时算。理由（用户原话）：
 *   「不存推导值。手动不能点完成。因为目标的语义就是无限的。完成了还能重开。没意义。」
 *
 * 也就是说目标是纯投影：它没有自己的生命周期，只有"下面那堆事到哪一步了"。
 *
 * 注意推导出的状态名不直接复用九态：九态是 A2A 对齐层，不能加新值。
 * 所以这里返回的是**展示用的派生状态**，它不进 `status` 字段，
 * 也不参与 `TRANSITIONS` 判定。真实的 `status` 仍然只由用户/工具显式设置。
 */
/*
 * ---------------------------------------------------------------------------
 * 目标的状态由派生任务推导（GU-08 1.1–1.10）
 * ---------------------------------------------------------------------------
 *
 * 用户原话（1.1–1.10，后者成立需前者不成立）：
 *
 *   > 1.1 初始为未指定。需要手动进行状态转移进行"采纳"。采纳后才能进入
 *   >     下方序列进行计算状态
 *   > 1.2 如果没有任何子任务或他们的状态为"未指定"，为"提交"
 *   > 1.3 如果有任何子任务为"处理中"或"提交"，则为"处理中"
 *   > 1.4 如果有任何子任务为"需要信息"，则为"需要信息"
 *   > 1.5 如果有任何子任务为"需要授权"，则为"需要授权"
 *   > 1.6 如果有任何子任务为"失败"，且没有任何子任务为"成功"，则为"失败"
 *   > 1.7 如果有任何子任务为"成功"，则为"成功"
 *   > 1.8 任何时候可以手动控制状态转移为"取消"
 *   > 1.9 目标不会成为"拒绝"
 *
 * ## 1.3 压在 1.4 上面，是刻意的
 *
 * 用户原话：
 *
 *   > 处理中，那么意味着 ai 要继续。你变成需要信息，那做一个停一个？
 *   > 用户需要无人值守。
 *
 * 所以只要有一条子任务在跑，目标就显示"处理中" —— 哪怕另一条在等你补信息。
 * "等你"这件事在子任务那一层看得见，不需要冒到目标上把整块板变成红色。
 *
 * ## 不落盘
 *
 * 目标是纯投影：它没有自己的生命周期，只有"下面那堆事到哪一步了"。
 * 推导值不进 `status` 字段。真实的 `status` 只由用户/工具显式设置。
 */
/*
 * ---------------------------------------------------------------------------
 * 四类的状态推导（GU-08）
 * ---------------------------------------------------------------------------
 *
 * 用户原话：
 *
 *   > 给模板改变状态变更，状态分组，专有名词，状态转移。
 *   >
 *   > 草稿：未指定
 *   > 进行：提交，处理中
 *   > 搁置：需要信息，需要授权
 *   > 结束：成功，失败，拒绝，取消
 *   >
 *   > 目标：用户需求
 *   > 设计：提问，决策
 *   > 工作：调研，校验
 *   > 记录：阻碍，交付，复盘，留档
 *
 * ## 两类状态
 *
 * **存储态** —— 由人/AI 的动作写进 `status` 字段：
 *
 *     未指定 --采纳(人)--> 提交 --领取--> 处理中
 *     处理中 --交付成功(人批准)--> 成功
 *     处理中 --满足守卫--> 失败
 *     任意 --取消--> 取消
 *     任意 --拒绝(人)--> 拒绝
 *
 * **计算态** —— 不存，每次由派生任务算出来：
 *
 *     需要信息 / 需要授权
 *
 * 计算态是**覆盖层**，不是存下来的状态。梗阻消失后不是"回到"某个状态，
 * 而是重新算一遍，发现没有梗阻，露出底下的存储态。
 *
 * ## 规则的第 3 节开头那句话
 *
 *   > 只有说了用户或ai进行操作的，才是手动转换。否则为计算状态，
 *   > 状态在更前面的更具有优先级
 *
 * 所以每类的规则分成三栏：
 *
 *     manual   人/AI 的动作（写 status）
 *     computed 从派生任务算出来的梗阻（不写 status）
 *     guard    手动动作的前置条件（不参与优先级）
 */

/**
 * 四类各自的计算态规则。
 *
 * 每一项是一个 `(task, children) => string` —— 返回空串表示不触发。
 * 数组顺序就是优先级，前面的赢。
 */
const COMPUTED_RULES = {
	/*
	 * 1. 目标：1.1–1.10
	 *
	 * 1.1 没采纳 → 未开始（不计算）
	 * 1.2 没子任务或全未指定 → 提交
	 * 1.3 有处理中或提交 → 处理中
	 * 1.4 有需要信息 → 需要信息
	 * 1.5 有需要授权 → 需要授权
	 * 1.6 有失败且无成功 → 失败
	 * 1.7 有成功 → 成功
	 *
	 * 1.8 取消、1.9 拒绝是手动动作，不在这里。
	 */
	goal: [
		{
			why: '1.2 没有任何子任务，或子任务全是未指定',
			test: (task, kids) => {
				const live = kids.filter((k) => statusOf(k) !== '未指定');
				return live.length === 0 ? '提交' : '';
			},
		},
		{
			why: '1.3 有子任务在处理中或提交（AI 要继续，所以压在等你之上）',
			test: (task, kids) => (kids.some((k) => ['处理中', '提交'].includes(statusOf(k))) ? '处理中' : ''),
		},
		{
			why: '1.4 有子任务需要信息',
			test: (task, kids) => (kids.some((k) => statusOf(k) === '需要信息') ? '需要信息' : ''),
		},
		{
			why: '1.5 有子任务需要授权',
			test: (task, kids) => (kids.some((k) => statusOf(k) === '需要授权') ? '需要授权' : ''),
		},
		{
			why: '1.6 有失败且没有任何成功',
			test: (task, kids) => {
				const hasFail = kids.some((k) => statusOf(k) === '失败');
				const hasDone = kids.some((k) => statusOf(k) === '成功');
				return hasFail && !hasDone ? '失败' : '';
			},
		},
		{
			why: '1.7 有任何成功',
			test: (task, kids) => (kids.some((k) => statusOf(k) === '成功') ? '成功' : ''),
		},
		{
			why: '兜底：子任务全都不做了（全取消/拒绝）',
			test: (task, kids) => {
				const live = kids.filter((k) => statusOf(k) !== '未指定');
				if (live.length === 0) return '';
				return live.every((k) => ['取消', '拒绝'].includes(statusOf(k))) ? '取消' : '';
			},
		},
	],

	/*
	 * 2. 设计：2.1–2.4
	 *
	 * 2.1 初始 需要授权（人工设置，不是推导）
	 * 2.2 有任何未结束的调研子任务 → 需要信息
	 * 2.3 用户手动转 成功/拒绝/取消
	 * 2.4 设计不会失败
	 */
	design: [
		{
			why: '2.2 有未结束的调研子任务',
			test: (task, kids) => {
				const draft = kids.some((k) => kindOf(k) === 'work' && typeOf(k) === 'WR' && !isEnded(k));
				return draft ? '需要信息' : '';
			},
		},
	],

	/*
	 * 3. 工作：3.1–3.8
	 *
	 * 3.1 初始 未指定，需要用户采纳
	 * 3.2 需要用户或 AI 领取 → 处理中
	 * 3.3 有不为结束的调研或设计子任务 → 需要信息
	 * 3.4 有需要授权的阻碍子任务 → 需要授权
	 * 3.5/3.6/3.7/3.8 是手动动作的守卫，不在这里
	 */
	work: [
		{
			why: '3.3 有未结束的调研或设计子任务',
			test: (task, kids) => {
				const blocked = kids.some((k) => {
					if (isEnded(k)) return false;
					const kind = kindOf(k);
					if (kind === 'design') return true;
					if (kind === 'work' && typeOf(k) === 'WR') return true;
					return false;
				});
				return blocked ? '需要信息' : '';
			},
		},
		{
			why: '3.4 有需要授权的阻碍子任务',
			test: (task, kids) => {
				const blocked = kids.some((k) => kindOf(k) === 'record' && typeOf(k) === 'RB' && statusOf(k) === '需要授权');
				return blocked ? '需要授权' : '';
			},
		},
	],

	/*
	 * 4. 记录：4.1–4.2
	 *
	 * 4.1 初始 需要授权，只能由用户转 成功/失败
	 * 4.2 阻碍成功=解决，失败=解决不了
	 *
	 * 记录**没有计算态** —— 它不靠子任务，写出来就等人看。
	 */
	record: [],
};

/**
 * 一个任务现在应该显示什么状态。
 *
 * 计算态优先于存储态：有梗阻时显示梗阻，没梗阻才显示 status 字段。
 *
 * @param {object} task
 * @param {object[]} all
 * @returns {string}
 */
function derivedStatus(task, all) {
	const kids = all.filter((item) => item.parent === task.id);
	const kind = kindOf(task);

	/* 草稿不计算 —— 没采纳的东西不投影。
	   目标用「未开始」（它没有草稿这个概念，只有"还没采纳"）。 */
	if (statusOf(task) === '未指定') return kindOf(task) === 'goal' ? '未开始' : '未指定';

	/* 结束态不被计算覆盖：已经结束的东西不再"等什么"。 */
	if (isEnded(task)) return statusOf(task);

	for (const rule of COMPUTED_RULES[kind] || []) {
		const got = rule.test(task, kids);
		if (got !== '') return got;
	}

	return statusOf(task);
}

/**
 * 当前生效的是哪一条规则（给详情页显示"为什么是这个状态"）。
 *
 * @param {object} task
 * @param {object[]} all
 * @returns {{why: string, status: string}|undefined}
 */
function derivedReason(task, all) {
	const kids = all.filter((item) => item.parent === task.id);
	const kind = kindOf(task);
	if (statusOf(task) === '未指定' || isEnded(task)) return undefined;
	for (const rule of COMPUTED_RULES[kind] || []) {
		const got = rule.test(task, kids);
		if (got !== '') return { why: rule.why, status: got };
	}
	return undefined;
}

/**
 * 目标状态的推导（旧名，保留给已有调用点）。
 *
 * 新代码请用 `derivedStatus(task, all)` —— 它对四类都适用。
 *
 * @param {object} task
 * @param {object[]} all
 * @returns {string}
 */
function deriveGoalStatus(task, all) {
	return derivedStatus(task, all);
}

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
 * 真正收窄由下面的 guard 按"领取的任务"来做，否则任务里写「完全权限」也放不开。
 */

/** 备注长度上限（字符）：够写清一段理由，又不至于让任务头变得无法展示。 */
const NOTE_LIMIT = 4000;

/**
 * 改一个任务的备注（搁置理由等附加信息）。
 *
 * 与 task_update 的区别：备注不是「任务内容」，**不受「只有未指定可改」的限制**——
 * 进行中的任务正需要补一句「我在等什么」。
 */
async function setNote(id, note) {
	return withWrite(async () => {
		const task = await readTask(id);
		if (task === undefined) throw new Error(`没有这个任务：${id}`);
		const value = String(note ?? '').trim();
		if (value.length > NOTE_LIMIT) {
			throw new Error(`备注太长（${value.length} 字），上限 ${NOTE_LIMIT} 字`);
		}
		const next = Object.assign({}, task, { note: value });
		await saveTask(next);
		return next;
	});
}

/**
 * 写一个「进展」章节。
 *
 * ## 它和 updateTask 的区别
 *
 * updateTask 有一道锁：只有「未指定」的任务能改。
 * 这条**没有锁** —— 任务采纳之后能写，终结之后也能写。
 *
 * 因为它的用途本来就是"随时间变化"：AI 自己定的阶段目标、
 * 阶段性进展、卡住时的临时说明。写完就锁死的话它就没用了。
 *
 * ## 什么时候允许
 *
 * 只有模板里给那一章标了 `aiWritable: true`（或者 `progress: true`）
 * 才允许。没标的章节，AI 照样写不进去 —— 否则整份正文就全开放了。
 *
 * @param {string} id
 * @param {string} sectionId  章节 id
 * @param {string} value
 * @returns {Promise<object>} 更新后的任务
 */
async function setProgress(id, sectionId, value) {
	return withWrite(async () => {
		const task = await readTask(id);
		if (task === undefined) throw new Error(`没有这个任务：${id}`);

		const wanted = String(sectionId ?? '').trim();
		if (wanted === '') throw new Error('要写哪一章？（section 不能为空）');

		/* 正文必须是对象形态才分得清章节。旧字符串正文没有章节概念。 */
		if (task.body === null || typeof task.body !== 'object' || Array.isArray(task.body)) {
			throw new Error(
				`${task.id} 的正文是老格式（一整段 Markdown），没有章节可以写。` +
					'进展只能写进对象形态的正文。',
			);
		}

		const section = task.body[wanted];
		if (section === undefined) {
			throw new Error(`${task.id} 没有「${wanted}」这一章`);
		}

		/* 标了 aiWritable / progress 才放行。 */
		const allowed = section.aiWritable === true || section.progress === true;
		if (!allowed) {
			throw new Error(
				`${task.id} 的「${wanted}」这一章不允许 AI 写。\n` +
					'只有模板里标了 aiWritable: true 的章节才能写进展 —— ' +
					'否则任务一被采纳，整份正文就全开放了。',
			);
		}

		const text = String(value ?? '');
		if (text.length > NOTE_LIMIT) {
			throw new Error(`进展太长（${text.length} 字），上限 ${NOTE_LIMIT} 字`);
		}

		const body = Object.assign({}, task.body, {
			[wanted]: Object.assign({}, section, { value: text }),
		});
		const next = Object.assign({}, task, { body });
		await saveTask(next);
		return next;
	});
}

/*
 * ---------------------------------------------------------------------------
 * 开放问题（answers）
 * ---------------------------------------------------------------------------
 *
 * 设计类任务正文里常有「## 两个要定的点」这种**开放问题**。
 * 以前只能整段堆在备注里，用户没法一条一条回答——他会说"完全在备注里面打字，
 * 没法一一直接回答"。
 *
 * 所以给任务加一个 `answers` 字段：`{ 问题键: 回答 }`。
 *   · 问题键取自正文的编号（`1` / `2` / `3`…），稳定、不依赖标题文字
 *   · 面板按编号渲染成一问一答的任务，每条一个输入框
 *   · 与 note 正交：note 是自由结论，answers 是逐条应答
 *
 * 为什么不塞进 body：body 是 Markdown 交付物，回答是可被反复改写的状态。
 * 混在一起以后既没法单独改某一条，也没法知道"哪几条还没答"。
 */
const ANSWERS_LIMIT = 20000;

/** 从正文里抠出「开放问题」的编号列表（供面板/工具知道该问几条）。 */
function extractQuestions(body) {
	const text = String(body ?? '');
	const questions = [];
	/* 只看「要定的点」/「待定」/「开放问题」这几个小标题下的内容。 */
	const headingPattern = /^#{2,4}\s*.*(要定的点|待定|开放问题|需要你定|需要决定).*$/gmu;
	let match;
	while ((match = headingPattern.exec(text)) !== null) {
		const start = match.index + match[0].length;
		/* 到下一个同级或更高级标题为止 */
		const rest = text.slice(start);
		const nextHeading = /^#{1,4}\s+/mu.exec(rest);
		const section = nextHeading === null ? rest : rest.slice(0, nextHeading.index);
		/* 取 `1. **xxx**：yyy` 或 `1. xxx` 形式的条目 */
		const itemPattern = /^\s*(\d+)\.\s+(.+)$/gmu;
		let item;
		while ((item = itemPattern.exec(section)) !== null) {
			questions.push({
				index: Number(item[1]),
				text: item[2].trim().replace(/\*\*/gu, ''),
			});
		}
	}
	return questions;
}

async function setAnswer(id, question, answer) {
	return withWrite(async () => {
		const task = await readTask(id);
		if (task === undefined) throw new Error(`没有这个任务：${id}`);
		const key = String(question ?? '').trim();
		if (key === '') throw new Error('要说明回答的是第几问（question）');
		const value = String(answer ?? '').trim();
		const current = task.answers && typeof task.answers === 'object' ? Object.assign({}, task.answers) : {};
		if (value === '') delete current[key];
		else current[key] = value;
		const total = Object.values(current).join('').length;
		if (total > ANSWERS_LIMIT) {
			throw new Error(`回答总长超限（${total} 字），上限 ${ANSWERS_LIMIT} 字`);
		}
		const next = Object.assign({}, task, { answers: current });
		await saveTask(next);
		return next;
	});
}


/*
 * ---------------------------------------------------------------------------
 * 归档（archived）
 * ---------------------------------------------------------------------------
 *
 * 用户原话：
 *   > 归档。分组。这个需要设计。否则之前没有用用户任务提出来的任务，
 *   > 占据了太多的竖向高度。
 *   > 归档以后界面不显示。但索引还在。可以显示已归档。
 *   > 已经归档的，ai 仍然可以用工具查看。
 *
 * 所以 `archived` 是一个**独立的布尔**，不塞进九态：
 *   · 九态是 A2A 对齐层，不能加新值
 *   · 归档和生命周期正交——已归档的可以是完成、取消、甚至还在进行
 *
 * 归档**不影响 AI 用工具读取**：`task_list` / `task_get` 照样能看到。
 * 只是面板默认不显示。这是用户明确要的："ai 仍然可以用工具查看"。
 */
async function setArchived(id, archived) {
	return withWrite(async () => {
		const task = await readTask(id);
		if (task === undefined) throw new Error(`没有这个任务：${id}`);
		const next = Object.assign({}, task, { archived: archived === true });
		await saveTask(next);
		return next;
	});
}

/**
 * 批量归档一棵子树：给一个父 id，它和所有后代一起归档。
 *
 * 用户要"归档直接对分组归档"，所以必须有批量。不做递归删除，
 * 只是把 `archived` 打成 true —— 随时能取消，索引都还在。
 */
async function archiveSubtree(id, archived) {
	return withWrite(async () => {
		const all = await listAll();
		const byParent = new Map();
		for (const item of all) {
			const parent = String(item.parent || '').trim();
			if (parent === '') continue;
			if (!byParent.has(parent)) byParent.set(parent, []);
			byParent.get(parent).push(item);
		}
		const root = all.find((item) => item.id === String(id || '').trim());
		if (root === undefined) throw new Error(`没有这个任务：${id}`);
		const seen = new Set();
		const queue = [root];
		const touched = [];
		while (queue.length > 0) {
			const current = queue.shift();
			if (seen.has(current.id)) continue;
			seen.add(current.id);
			const next = Object.assign({}, current, { archived: archived === true });
			await saveTask(next);
			touched.push(current.id);
			for (const child of byParent.get(current.id) || []) queue.push(child);
		}
		return touched;
	});
}


/*
 * ---------------------------------------------------------------------------
 * 标签（tags）
 * ---------------------------------------------------------------------------
 *
 * 用户原话：
 *   > 他可以被标记为什么 tag，例如用户风格。
 *   > 让 ai 看不是当前任务组的时候知道看什么。
 *   > 也可以看里面有没有描述了现在用的库的使用方法。
 *
 * 所以 tag 和分组是**两个维度**：
 *   · 分组 = 这件事属于哪次工作（**一个，不能改**）
 *   · tag  = 这条记录讲的是什么（**多个，随便加**）
 *
 * 典型用法：某个分组里有一条记录写了"这个库怎么用"，
 * 给它打 `库用法`；以后在别的分组里，AI 可以按 tag 找到它——
 * 这正是用户说的"看不是当前任务组的时候知道看什么"。
 *
 * 与「不做 tag」不冲突：用户当时拒绝的是**用 tag 代替枚举语义**
 * （分类、状态、可见性）。这种"跨组检索的标记"是另一回事。
 */
async function setTags(id, tags) {
	return withWrite(async () => {
		const task = await readTask(id);
		if (task === undefined) throw new Error(`没有这个任务：${id}`);
		const list = Array.isArray(tags)
			? [...new Set(tags.map((tag) => String(tag).trim()).filter((tag) => tag !== ''))]
			: [];
		const next = Object.assign({}, task, { tags: list });
		await saveTask(next);
		return next;
	});
}


/*
 * ---------------------------------------------------------------------------
 * 标记（flags）—— 与状态正交的那一套
 * ---------------------------------------------------------------------------
 *
 * 用户原话：
 *   > 需要有醒目，分组，之类的功能。例如 ai 改写了备注，要求需要回答。之类的。沟通。
 *   > 需要像围棋落子一样，高亮。或者说，「需要处理」，「需要审核」，「已读」，「设置为未读」。
 *   > 就像受邮箱那样。
 *
 * 四个**固定枚举**（不是自由 tag——用户明确：「目前只需要具体枚举的语义」）：
 *
 *   unread        系统置：新建 / 被改动 → 我没看过
 *   read          我置：打开详情即置 → 看过了
 *   needs-me      任务自己声明 → 卡在我这里，等我动手
 *   needs-review  派发方置 → 我做的，等你审
 *
 * 为什么必须与状态分开：
 *   · 「已读」不是生命周期的一部分——一件「处理中」的任务可以已读也可以未读
 *   · 「需要处理」可能对应多个状态（需要授权 / 待选 / 需要信息），
 *     但语义是同一个：**等我**
 *   · 塞进状态会数量爆炸（3 组 × 2 读 × 2 待 = 12 种，还要按 kind 再乘）
 */
const FLAGS = ['unread', 'read', 'needs-me', 'needs-review'];

/** 解析存储里的 flags 字符串（逗号分隔）→ 数组，只留合法值。 */
function parseFlags(raw) {
	return String(raw ?? '')
		.split(/[,，\s]+/u)
		.map((flag) => flag.trim())
		.filter((flag) => FLAGS.includes(flag));
}

/** 把 flags 数组归一：read 和 unread 互斥，后者覆盖前者。 */
function normalizeFlags(list) {
	const out = [];
	for (const flag of list) {
		if (!FLAGS.includes(flag)) continue;
		/* 设 read 就清 unread；设 unread 就清 read。 */
		if (flag === 'read') {
			const at = out.indexOf('unread');
			if (at !== -1) out.splice(at, 1);
		}
		if (flag === 'unread') {
			const at = out.indexOf('read');
			if (at !== -1) out.splice(at, 1);
		}
		if (!out.includes(flag)) out.push(flag);
	}
	return out;
}

async function setFlags(id, flags) {
	return withWrite(async () => {
		const task = await readTask(id);
		if (task === undefined) throw new Error(`没有这个任务：${id}`);
		const list = normalizeFlags(Array.isArray(flags) ? flags.map(String) : []);
		const next = Object.assign({}, task, { flags: list.join(',') });
		await saveTask(next);
		return next;
	});
}


/** 新建：取下一个空号再追加；撞号就重试。 */
async function createNew(task) {
	return withWrite(() => createNewInner(task));
}

/**
 * 新建：编号 = **模板编号 + 流水号**，例如 `MG-01`、`GD-03`、`SQ-02`。
 *
 * 为什么不再用 `T-001`：用户要求编号自带语义（"用双字母…大分类首字母，
 * 然后模板类型一个字母"）。`T-` 前缀看不出它是什么，而且所有类型挤在一条
 * 流水线上——新增一张调研会和实现抢号，读起来毫无信息。
 *
 * 现在的规则：
 *   · 前缀 = 模板编号（MG / SQ / JB / GR …），一眼知道类别和形态
 *   · 流水号**按前缀各自编号**，MG-01、MG-02、GD-01……互不干扰
 *
 * 老数据保持 `T-001` 不动（只读不改）。新老 id 混存没问题，
 * 因为 id 只是主键，语义在 type/kind 里。
 */
/**
 * 1.10 的复盘约束：失败数除 3 向下取整，不能大于成功复盘数。
 *
 * 用户原话：
 *
 *   > 失败的"工作"子任务，数量除3向下取整，不能大于成功"复盘"。
 *   > 在这个情况下不能继续创建"工作"子任务。（ai不能创建，用户不受影响）
 *
 * 也就是说：每 3 个失败要配 1 个复盘。
 *
 *   失败 0–2 个 → floor(0)=0 → 不限
 *   失败 3–5 个 → floor(1)=1 → 至少 1 个复盘
 *   失败 6–8 个 → floor(2)=2 → 至少 2 个复盘
 *
 * ## 只拦 AI
 *
 * 用户不受影响 —— 人想拆多少工作就拆多少。
 * 这条约束是给 AI 的：防止它无限试错而不总结。
 *
 * @param {string} goalId
 * @returns {Promise<string>} 空串表示可以创建
 */
async function retroBlocker(goalId) {
	if (goalId === '') return '';
	const all = await listAll();
	const kids = all.filter((item) => item.parent === goalId);
	const failed = kids.filter((item) => kindOf(item) === 'work' && statusOf(item) === '失败').length;
	const retros = kids.filter((item) => kindOf(item) === 'record' && typeOf(item) === 'RF' && statusOf(item) === '成功').length;
	const need = Math.floor(failed / 3);
	if (need <= retros) return '';
	return (
		`${goalId} 下面已经有 ${failed} 条失败的工作，需要 ${need} 份复盘，但现在只有 ${retros} 份。` +
		'先派一条复盘（记录类 RF）写清根因和下次怎么避，再来创建工作。'
	);
}

async function createNewInner(task) {
	/* 1.10：AI 创建工作子任务前，先查复盘够不够。
	 *
	 * 注意：这里 task 还没编号，kindOf 靠 kind / type 字段判断，
	 * 不能用 isClaimable(task) —— 那个判的是"领取资格"，语义不对。
	 */
	if (String(task?.parent ?? '') !== '' && kindOf(task) === 'work') {
		const blocker = await retroBlocker(String(task.parent));
		if (blocker !== '') throw new Error(blocker);
	}

	/* 前缀：有模板就用模板编号（MG / SQ / GR…）；
	   空模板（没选 type）用**大类首字母**：goal→M、design→S、record→J、work→G。
	   这样空模板也有可读编号，不会冒出一个 ITEM-01 这种怪东西。 */
	const KIND_PREFIX = { goal: 'G', design: 'D', record: 'R', work: 'W' };
	/* 旧类型（单字母 / H1–H8）不再产生新编号：它们已被 TYPES 淘汰，
	   如果还照着旧 type 编出 "H1-01" 这种，正则和面板都会含糊。
	   统一回落到大类首字母。 */
	const declared = normalizeType(task?.type);
	const prefix = TYPES.includes(declared) ? declared : KIND_PREFIX[kindOf(task)] || 'X';
	const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
	const pattern = new RegExp(`^${escaped}-(\\d+)$`, 'u');
	for (let attempt = 0; attempt < 50; attempt += 1) {
		const map = await readStore();
		let max = 0;
		for (const key of map.keys()) {
			const match = pattern.exec(key);
			if (match) max = Math.max(max, Number(match[1]));
		}
		const id = `${prefix}-${String(max + 1 + attempt).padStart(2, '0')}`;
		if (map.has(id)) continue;
		await saveTask(Object.assign({}, task, { id }));
		return id;
	}
	throw new Error('新建任务失败：连续 50 次编号冲突');
}
/* 任务模板目录（GitHub issue forms 的 YAML）。
 *
 * ── 内置最小集 vs 附加模板 ──────────────────────────────────────────
 *
 * 用户原话：
 *   > templates 是存在的。core 可以依赖他。内置有通用的最小需要的模板。
 *   > 然后，附加的模板才是额外包。
 *
 * 所以这里是**内置那一份**：四个 kind 各一个通用模板，
 *
 *   GU 用户任务（goal）  WI 实现（work）  DP 方案（design）  RR 汇报（record）
 *
 * 装不装 `templates` 插件，core 都能完整工作——只是可选模板少一些。
 * `templates` 插件提供的模板**叠加**在这四个之上（同编号时它覆盖内置，
 * 这样想换掉内置模板的实现也能做到）。
 */
const TEMPLATE_DIR = join(fileURLToPath(new URL('.', import.meta.url)), 'templates');

/**
 * 模板的三个来源目录（GU-08 之后模板分两处）。
 *
 *   core/templates/                 4 个内置（core 自带，不依赖任何插件）
 *   ../templates/templates/         9 个核心地基（templates 插件提供）
 *   ../extra-templates/templates/   领域模板（扩展包提供）
 *
 * core 挨个找，找到就用。装不装插件都能工作 —— 只是可选模板少一些。
 */
const TEMPLATE_DIRS = [
	TEMPLATE_DIR,
	join(fileURLToPath(new URL('.', import.meta.url)), '..', 'templates', 'templates'),
	join(fileURLToPath(new URL('.', import.meta.url)), '..', 'extra-templates', 'templates'),
];

/** 内置模板编号。 */
const BUILTIN_TYPES = ['GU', 'WI', 'DP', 'RR'];

/**
 * 读模板的附加来源，由 `templates` 插件注册。
 *
 * 拿不到就只用内置的——这是**可选依赖**该有的样子：
 * 关掉 templates，core 不崩，只是模板少了。
 *
 * 为什么用模块级变量而不是层层传 ctx：模板读取是在 `templateMeta` /
 * `dispatchOptions` / `loadTemplate` 之间反复互相调用的，一路传 ctx
 * 要改十几个签名，而且这些函数本来就不该知道 ctx 长什么样。
 * 一个进程只有一份模板服务，存在模块级就够。
 */
let TEMPLATES_SERVICE = undefined;

/** core 的 apply 里调用，把服务绑上。 */
function bindTemplates(ctx) {
	try {
		TEMPLATES_SERVICE = typeof ctx?.get === 'function' ? ctx.get('taskboardTemplates') : undefined;
	} catch (failure) {
		TEMPLATES_SERVICE = undefined;
	}
}

/** 当前可用的全部模板编号（内置 + 附加）。
 *
 * 顺序按 `TYPES` 的声明顺序（目标 → 设计 → 记录 → 工作），
 * 附加模板里不在 `TYPES` 中的追加在后面。
 * **不排序**——界面和文档都按"大类"分组读，字母序会把四个大类搅在一起。
 */
async function availableTypes() {
	const added = TEMPLATES_SERVICE && typeof TEMPLATES_SERVICE.types === 'function' ? TEMPLATES_SERVICE.types() : [];

	/*
	 * 没有 templates 插件时，自己扫目录。
	 *
	 * 之前这里只认 BUILTIN_TYPES（4 个），于是测试环境里
	 * 「工作不能派 WT」这类规则根本没机会触发 —— WT 不在可用列表里，
	 * 就没被检查。
	 *
	 * 现在按「文件在不在」判断：三个目录里任何一处有 `XX.yml`，就算可用。
	 * 这样 core 单独跑也能看到全部模板，装上插件则用插件的扫描结果
	 * （插件能感知配置开关）。
	 */
	const fromDisk = added.length > 0 ? [] : await TEMPLATE_TYPES_ON_DISK();
	const pool = added.length > 0 ? added : fromDisk;

	const known = TYPES.filter((type) => BUILTIN_TYPES.includes(type) || pool.includes(type));
	const unknown = pool.filter((type) => !TYPES.includes(type));
	return [...known, ...unknown];
}

/**
 * 在目录（含子目录）里找 `XX.yml`，返回完整路径。
 *
 * 领域模板按领域分了子目录，所以要递归。
 *
 * @param {string} dir
 * @param {string} wanted 大写编号
 * @returns {Promise<string|undefined>}
 */
async function findTemplateFile(dir, wanted) {
	let entries;
	try {
		entries = await readdir(dir, { withFileTypes: true });
	} catch {
		return undefined;
	}
	for (const entry of entries) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			const hit = await findTemplateFile(full, wanted);
			if (hit !== undefined) return hit;
		} else if (entry.name.toUpperCase() === wanted + '.YML') {
			return full;
		}
	}
	return undefined;
}

/** 三个模板目录里实际有哪些编号（每次现扫，不缓存 —— 开发时改文件要生效）。 */
async function TEMPLATE_TYPES_ON_DISK() {
	const found = new Set();
	const walk = async (dir) => {
		let entries;
		try {
			entries = await readdir(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			const full = join(dir, entry.name);
			if (entry.isDirectory()) await walk(full);
			else if (entry.name.endsWith('.yml')) found.add(entry.name.replace(/\.yml$/u, '').toUpperCase());
		}
	};
	for (const dir of TEMPLATE_DIRS) await walk(dir);
	return [...found];
}

async function loadTemplate(type) {
	const wanted = String(type ?? '').trim().toUpperCase();
	const types = await availableTypes();
	/* 只接受当前模板（内置 + 附加）。H1–H8 已废除：它们是停止理由，不是模板，
	   文件也删了。给老 type 一个清楚的报错，而不是"文件不存在"。 */
	if (!types.includes(wanted)) {
		if (LEGACY_TYPES.includes(wanted)) {
			throw new Error(
				`模板 ${wanted} 已废除：H1–H8 是"为什么停"的理由，不是模板。` +
					'现在用记录类的「B · 阻碍」，它的 reason 小节就是这张词表。',
			);
		}
		throw new Error(
			`模板类型必须是 ${types.join('/')}，收到「${type}」` +
				(BUILTIN_TYPES.includes(wanted) ? '' : '\n（装 `templates` 插件可以多出 23 个模板）'),
		);
	}
	/* 附加来源优先：想用自定义模板覆盖内置同名模板也能做到。 */
	const extra = TEMPLATES_SERVICE;
	if (extra && typeof extra.read === 'function' && !BUILTIN_TYPES.includes(wanted)) {
		return extra.read(wanted);
	}
	if (extra && typeof extra.read === 'function') {
		try {
			return await extra.read(wanted);
		} catch (failure) {
			/* 附加来源没有这个编号 → 回落到内置。 */
		}
	}
	/* 附加来源没给 → 自己按三个目录挨个找。 */
	for (const dir of TEMPLATE_DIRS) {
		const found = await findTemplateFile(dir, wanted);
		if (found !== undefined) return await readFile(found, 'utf8');
	}
	throw new Error(`模板 ${wanted} 的文件找不到（找过 ${TEMPLATE_DIRS.length} 个目录）`);
}

/*
 * ---------------------------------------------------------------------------
 * 模板元数据（dispatch / default_kind / behavior / framed / domain）
 * ---------------------------------------------------------------------------
 *
 * 这些字段以前**只写在模板文件里，代码一个都不读**——等于装饰。
 * 现在读出来，让 `dispatch` 真的能收窄可派发范围。
 *
 * 不做完整 YAML 解析：模板是我们自己写的，字段都在顶层。
 * 只认 `^key: value` 这一种形态，够用且不会因为缩进变化而炸。
 */
const TEMPLATE_META_CACHE = new Map();

function parseTemplateMeta(source) {
	const meta = {
		name: '',
		defaultKind: '',
		behavior: '',
		framed: null,
		domain: '',
		/** dispatch 里允许的大类；空数组表示"没写，按大类默认"。 */
		dispatch: [],
	};
	for (const line of String(source ?? '').split(/\r?\n/u)) {
		if (/^\s/u.test(line)) continue;
		const match = /^([a-z_]+):\s*(.*)$/u.exec(line);
		if (match === null) continue;
		const key = match[1];
		const value = match[2].trim();
		if (key === 'name') meta.name = value;
		else if (key === 'default_kind') meta.defaultKind = value;
		else if (key === 'behavior') meta.behavior = value;
		else if (key === 'domain') meta.domain = value;
		else if (key === 'framed') meta.framed = value !== 'false';
		else if (key === 'dispatch') {
			/* 形如 `[goal, design, record, work]` */
			const inner = /^\[(.*)\]$/u.exec(value);
			meta.dispatch = inner
				? inner[1]
						.split(',')
						.map((part) => part.trim())
						.filter((part) => part !== '' && Object.hasOwn(KINDS, part))
				: [];
		}
	}
	return meta;
}

/** 读某模板的元数据（带缓存）。读不到返回 null。 */
async function templateMeta(type) {
	const wanted = normalizeType(type);
	if (wanted === '' || !TYPES.includes(wanted)) return null;
	if (TEMPLATE_META_CACHE.has(wanted)) return TEMPLATE_META_CACHE.get(wanted);
	let source = '';
	try {
		/* 必须走 loadTemplate：它会先查 `templates` 插件的服务，
		 * 只有内置那 4 个才从本地目录读。直接 readFile(TEMPLATE_DIR)
		 * 会让附加的 23 个模板永远读不到——它们不在 core 目录里。 */
		source = await loadTemplate(wanted);
	} catch (failure) {
		return null;
	}
	const meta = parseTemplateMeta(source);
	TEMPLATE_META_CACHE.set(wanted, meta);
	return meta;
}

/** 清缓存：模板文件可能在运行期被改（开发时常见）。 */
export function clearTemplateMetaCache() {
	TEMPLATE_META_CACHE.clear();
}

/**
 * 从 `fromId` 出发，能派发哪些模板。
 *
 * 判定三层，缺一不可：
 *   1. **大类规则**：工作不能派「要做的事」（`ENTITY_TYPES`）
 *   2. **父模板的 dispatch**：写了就收窄；没写按大类默认（什么都行）
 *   3. **子模板的 default_kind** 必须落在允许的大类里
 *
 * 返回 `{ allowed: [{type, name, kind}], blocked: [{type, reason}] }`。
 * `blocked` 是给人看的——"为什么那个模板不在这"，比静默隐藏有用。
 */
async function dispatchOptions(fromId) {
	const from = String(fromId ?? '').trim();
	const fromTask = from === '' ? undefined : await readTask(from);
	const parentKind = fromTask === undefined ? '' : kindOf(fromTask);
	const parentType = fromTask === undefined ? '' : normalizeType(fromTask.type);
	const parentMeta = parentType === '' ? null : await templateMeta(parentType);

	/* 父模板写了 dispatch 就用它；没写就是四类全开。 */
	const declared = parentMeta !== null && parentMeta.dispatch.length > 0 ? parentMeta.dispatch : KIND_ORDER;

	const allowed = [];
	const blocked = [];
	for (const type of await availableTypes()) {
		const meta = await templateMeta(type);
		if (meta === null) continue;
		const childKind = meta.defaultKind !== '' && Object.hasOwn(KINDS, meta.defaultKind)
			? meta.defaultKind
			: TYPE_TO_KIND[type] ?? 'work';

		/* 第一层：大类规则 */
		if (parentKind === 'work' && childKind === 'work' && ENTITY_TYPES.has(type)) {
			blocked.push({
				type,
				name: (meta.name || type).replace(/^[A-Z]{1,2}\s*[·・.]\s*/u, '').trim() || type,
				reason: '工作是原子任务，不能再派另一件要做的事（该升级为目标）',
			});
			continue;
		}

		/* 第二层 + 第三层：父模板的 dispatch 收窄 */
		if (!declared.includes(childKind)) {
			blocked.push({
				type,
				name: (meta.name || type).replace(/^[A-Z]{1,2}\s*[·・.]\s*/u, '').trim() || type,
				reason:
					parentMeta === null
						? `派生来源没有模板，只允许 ${declared.join('/')}`
						: `${parentType} 的 dispatch 只允许 ${declared.join('/')}`,
			});
			continue;
		}

		/* 模板的 `name` 字段本身就是 `WI · 实现` 这种带编号的形式，
		   剥掉前缀只留中文名，否则会显示成「WI · WI · 实现」。 */
		const label = (meta.name || type).replace(/^[A-Z]{1,2}\s*[·・.]\s*/u, '').trim() || type;
		allowed.push({ type, name: label, kind: childKind });
	}
	return { from: fromTask, parentKind, allowed, blocked };
}


/**
 * 一个任务进入终止态后，把整片下游一起收掉（递归、防环）。
 *
 * 下游有两种，都是「进行态 → 取消」，草稿与成功态一律不动：
 *   · 派生派生任务：`parent` 指向我；
 *   · 依赖方：`links` 里写着 `依赖:<我>`。
 *
 * 区别在根节点：我做成了（完成）→ 依赖我的人照常可领，只有派生任务要收；
 * 我没做成（失败 / 取消 / 拒绝）→ 依赖我的人也全是死路，一起取消。
 *
 * 被取消的下游自己也是「终止」，所以它的派生任务和依赖方继续往下收——
 * 用队列 + seen 集合，既保证递归完整，又不会在环上打转。
 */
async function cascadeClose(rootId, rootStatus) {
	const seen = new Set();
	const queue = [{ id: rootId, closeDependents: rootStatus !== '成功' }];
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
 * 为什么只禁这一条（T-016）：任务只有在「处理中」时才会把 `workspace` / `permission`
 * 交给守卫。草稿是模型自己能写的，如果草稿能直接进「处理中」，模型就能绕过
 * 「采纳只能由用户做」，给自己发一张写着「完全权限」的任务 —— 已经实测复现。
 *
 * 其它边按工作流放开（第一版写得太严，把正常用法也挡了）：
 *
 *   · 草稿可以转 需要信息 / 需要授权：H1..H8 搁置模板就是这么用的，
 *     建完草稿直接标明「我在等什么」。这两个状态**不授予任何权限**，安全。
 *   · 提交（已采纳、还没人领）可以转 需要信息 / 需要授权 / 完成 / 失败 / 取消 / 拒绝：
 *     用户采纳了但决定先不做、或者发现根本不用做。
 *   · 进行态之间随便转：处理中 ↔ 需要信息 / 需要授权，处理中 → 拒绝 也算放弃。
 *   · 终态（完成 / 失败 / 取消 / 拒绝）只能被**用户**重开回「提交」（T-030 决议）。
 */
const ACTIVE_ALL = ['提交', '处理中', '需要信息', '需要授权'];
const TERMINAL = ['成功', '失败', '取消', '拒绝'];
const DRAFT_STATUS = '未指定';

/** 终态：重开这类任务属于「用户专属」动作，模型不能自己干。 */
const REOPEN_FROM = TERMINAL;

/**
 * 判定一条转移是否允许；返回空串表示允许，否则返回给模型看的原因。
 * `byUser` 为 true 时是用户路径（面板按钮、斜杠命令）。
 */
function transitionBlocker(from, to, byUser, task) {
	if (from === to) return '';

	/*
	 * ---------------------------------------------------------------------
	 * GU-08：权限按**类别**不同，不再是全局一套
	 * ---------------------------------------------------------------------
	 *
	 * 用户原话：
	 *
	 *   2.3 用户可以手动转换为"成功""拒绝""取消"。ai无权进行状态转移操作
	 *   3.5 必须有一个失败的"阻碍"子任务或一个失败的"交付"子任务，
	 *       ai才可以转化为"失败"。用户转化为失败不受限制。
	 *   3.6 必须有一个成功的"交付"子任务，ai才可以转化为"成功"。
	 *       用户转化不受限制。
	 *   4.1 初始状态为"需要授权"。只能由用户转移为"成功""失败"。
	 *
	 * 归成一张表：
	 *
	 *   类别   采纳   领取   转成功     转失败     拒绝   取消
	 *   目标   人     —     推导        推导       ✗     人
	 *   设计   —      —     人          不会失败   人     人
	 *   工作   人     人+AI  人/AI(守卫) 人/AI(守卫) 人     人+AI
	 *   记录   —      —     人          人         —      —
	 *
	 * 没给 task 时（老调用点）退化成之前的全局规则。
	 */
	if (task !== undefined) {
		const kind = kindOf(task);

		/* 设计：AI 完全无权改状态（2.3）。 */
		if (kind === 'design' && byUser !== true) {
			return '「设计」的状态只能由用户改：模型请把要问的写成正文，等用户在面板上处理。';
		}

		/* 设计不会失败（2.4）。 */
		if (kind === 'design' && to === '失败') {
			return '「设计」不会失败。做不下去就换成「拒绝」，或者派一条调研。';
		}

		/* 记录：只能由用户转 成功/失败（4.1）。 */
		if (kind === 'record') {
			if (byUser !== true && (to === '成功' || to === '失败')) {
				return '「记录」只能由用户验收：模型写完等用户在面板上点「成功」或「失败」。';
			}
		}

		/* 目标不会成为拒绝（1.9）。 */
		if (kind === 'goal' && to === '拒绝') {
			return '「目标」不会变成「拒绝」。要放弃整个目标，用「取消」。';
		}

		/* 工作：AI 转成功/失败要满足守卫（3.5/3.6），具体在 setStateInner 里查子任务。 */
		if (kind === 'work' && byUser !== true && (to === '成功' || to === '失败')) {
			return '';  /* 守卫需要读子任务，交给 setStateInner */
		}
	}

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
			return `「${from}」是终态，只有用户能重开：模型请新建一个任务（或用面板「分支」）。`;
		}
		if (to !== '提交') {
			return `重开只能从「${from}」回到「提交」，不能直接到「${to}」。`;
		}
		return '';
	}

	/* 其余都是进行态之间的转移：交给各自的前置校验（领取检查、派生来源检查等）。 */
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
	if (task === undefined) throw new Error(`没有这个任务：${id}`);

	const from = String(task.status || '未指定');

	/* 状态转移规则：安全边界（草稿不能进处理中）+ 终态重开限定。 */
	const blocker = transitionBlocker(from, wanted, byUser, task);
	if (blocker !== '') throw new Error(blocker);

	/* 目标的状态是**推导**的，不能手动设（DP-02）。
	 *
	 * 用户原话：「不存推导值。手动不能点完成。因为目标的语义就是无限的。
	 * 完成了还能重开。没意义。除了取消以外，不给手动按钮。」
	 *
	 * 所以这里只放行两个动作：
	 *   · 「拒绝」—— 放弃整个目标（除了取消以外唯一该有的手动动作）
	 *   · 「未指定」—— 草稿阶段的状态变更（采纳前）
	 *
	 * 「取消」也允许：用户说的是"除了取消以外"，拒绝和取消都算终止整个目标。
	 */
	if (kindOf(task) === 'goal' && !DRAFT.includes(from)) {
		const allowed = new Set(['拒绝', '取消', '提交']);
		if (!allowed.has(wanted)) {
			const derived = deriveGoalStatus(task, await listAll());
			throw new Error(
				`${task.id} 是「目标」，它的状态由派生任务推导，不能手动设成「${wanted}」。\n` +
					`现在推导出来是「${derived}」。\n` +
					'要让目标往前走，去推进它的派生任务；要放弃整个目标，用「拒绝」或「取消」。',
			);
		}
	}

	/* 转「失败」必须有理由载体（WI-01）。
	 *
	 * 用户原话：「必须要有一个记录类型的子任务。并且可以点击失败按钮以后，
	 * 效果就是新建->记录->阻碍。不区分具体是什么记录。」
	 *
	 * 判定顺序（宽进）：
	 *   1. 有记录类派生任务（最好是 RB 阻碍）→ 通过
	 *   2. 或 note 写了东西 → 通过（AI 用工具时不一定走面板的弹窗）
	 *   3. 都没有 → 拒绝，并说明该怎么做
	 *
	 * 为什么允许 note 兜底：面板能把用户引向"建阻碍"，但 AI 调
	 * `task_state` 时不会弹窗。对它来说，note 就是那句话的载体。
	 */
	if (wanted === '失败') {
		const children = (await listAll()).filter((item) => item.parent === task.id);

		/*
		 * 3.5：工作转失败，AI 必须有「失败的阻碍」或「失败的交付」子任务。
		 *
		 * 用户原话：
		 *   > 必须有一个失败的"阻碍"子任务或一个失败的"交付"子任务，
		 *   > ai才可以转化为"失败"。用户转化为失败不受限制。
		 */
		if (kindOf(task) === 'work' && byUser !== true) {
			const evidenced = children.some(
				(child) =>
					kindOf(child) === 'record' &&
					(typeOf(child) === 'RB' || typeOf(child) === 'RW' || typeOf(child) === '交付') &&
					statusOf(child) === '失败',
			);
			if (!evidenced) {
				throw new Error(
					`${task.id} 要转「失败」，得先有一条**失败的记录**作为依据。` +
						'派一条阻碍（RB）写清卡在哪，或一条交付写清做不出来什么；' +
						'等用户在那条记录上点「失败」，再回来把这条工作标失败。\n' +
						'（用户本人不受这条限制：面板上直接点「失败」，或让用户敲 /task-state，都可以跳过。）',
				);
			}
		}

		/*
		 * 记录本身就是**理由的载体**，不该再要求它自己带一个理由载体。
		 *
		 * 之前这条守卫对所有类别生效，于是「阻碍」想标失败时
		 * 反被要求"先派一条阻碍" —— 递归了。
		 */
		const hasRecord = children.some((item) => kindOf(item) === 'record');
		const wroteNote = text(note) !== '' || text(task.note) !== '';
		const selfIsReason = kindOf(task) === 'record';
		/* 3.5：用户转化为失败不受限制 —— 理由守卫只拦 AI。 */
		if (byUser !== true && !selfIsReason && !hasRecord && !wroteNote) {
			throw new Error(
				`${task.id} 要转「失败」，得先说明失败的原因。两个办法：\n` +
					'  1. 派一条记录（推荐 RB 阻碍）把它写清楚：task_submit 时 parent 填这个 id、type 填 RB\n' +
					'  2. 或者在这个任务的 note 里写清：卡在哪、为什么过不去、下一件该试什么\n' +
					'理由：失败的原因常常很长、还会牵涉别的任务。塞进一句话里，后来的人看不出所以然。',
			);
		}
	}

	if (wanted === '处理中') {
		/* 只有「工作」这一类才能被领取（四类别模型）。
		 *
		 * 目标、设计、记录都不存在「领取」这个动作：
		 *   · 目标的状态由派生任务推导，它自己不占位；
		 *   · 设计是等用户回答/选择/过目，AI 领它没有意义；
		 *   · 记录没人动手，写出来就完。
		 *
		 * 所以「一次只能做一个」只对工作生效，别的类别根本不参与竞争。 */
		if (!isClaimable(task)) {
			const kind = kindOf(task);
			throw new Error(
				`${task.id} 是「${KINDS[kind]?.name ?? kind}」，不能领取。` +
					'只有「工作」需要领取（一次只能做一个）；目标是推导的、设计等你回答、记录写出来就完。',
			);
		}
		/*
		 * 领取前置：从「提交」或**搁置态**都能领。
		 *
		 * 原来只认「提交」，于是这条链会永久卡死：
		 *
		 *   领取 → 处理中
		 *   AI 卡住 → 置为「需要信息」（setStateInner 会清掉 CLAIMS）
		 *   用户补完信息 → 状态还是「需要信息」
		 *   AI 想接着做 → task_claim 要求 from === '提交' → 拒绝
		 *
		 * 「需要信息」「需要授权」的语义是**进行中的暂停**，不是终结
		 * （见 GROUP_OF：它们同时属于「进行」和「搁置」）。暂停之后
		 * 当然要能恢复，否则这张任务只能被取消重开。
		 *
		 * 并发双领仍由下面两道挡住：
		 *   · 草稿进不来（transitionBlocker 拦了「未指定」→「处理中」）
		 *   · 已被别人领走的会读成「处理中」，而「处理中」不在这里的白名单
		 */
		const CLAIMABLE_FROM = ['提交', '需要信息', '需要授权'];
		if (!CLAIMABLE_FROM.includes(from)) {
			throw new Error(
				`${task.id} 当前状态是「${from}」，不能领取。` +
					`只有「${CLAIMABLE_FROM.join('」/「')}」的任务能被领取` +
					(from === '处理中' ? '（已被其他会话领走）' : ''),
			);
		}
		const running = await activeClaimOf(agent);
		if (running !== undefined && running.id !== task.id) {
			throw new Error(
				`当前已有进行中的任务 ${running.id}（${running.title}）：一次只能做一个，先把它完成/失败/取消再领取新的`,
			);
		}
		const blocker2 = await claimBlocker(task);
		if (blocker2 !== '') throw new Error(`不能领取 ${task.id}：${blocker2}`);
	}
	if (wanted === '成功') {
		const all = await listAll();

		/*
		 * 3.6：工作转成功，AI 必须有一个成功的「交付」子任务。
		 *
		 * 用户原话：
		 *   > 必须有一个成功的"交付"子任务，ai才可以转化为"成功"。
		 *   > 用户转化不受限制。
		 *
		 * 用户不受限 —— 因为用户点「成功」这件事本身就是验收，
		 * 不再需要一份书面交付来证明。
		 */
		if (kindOf(task) === 'work' && byUser !== true) {
			const delivered = all.some(
				(child) => child.parent === task.id && kindOf(child) === 'record' && (typeOf(child) === 'RW' || typeOf(child) === '交付') && statusOf(child) === '成功',
			);
			if (!delivered) {
				throw new Error(
					`${task.id} 要转「成功」，得先有一份**成功的交付记录**。` +
						'派一条交付（记录类）写清：产物在哪、别人拿它做什么、过时了怎么知道；' +
						'等用户在上面点「成功」，再回来把这条工作标成功。\n' +
						'（用户本人不受这条限制：面板上直接点「成功」，或让用户敲 /task-state，都可以跳过。）',
				);
			}
		}

		/* 上行：派生任务里只要还有「进行态」，派生来源就不能成功。
		   草稿（未指定）不作数，结束态（成功/失败/取消/拒绝）不阻挡。 */
		const open = all.filter((child) => child.parent === task.id && isActive(child.status));
		if (open.length > 0) {
			throw new Error(
				`派生任务还在进行中：${open.map((child) => `${child.id}（${child.status}）`).join('、')}；` +
					'先把它们收掉（成功 / 失败 / 取消 / 拒绝）再完成派生来源',
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
	/* 事件溯源（T-019）：记下 from→to 和是谁改的。 */
	CURRENT_ACTOR.value = actorLabel(agent, byUser);
	await saveTask(task, { from, to: wanted });
	CURRENT_ACTOR.value = '';
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
				deny: task.deny,
			});
		} else {
			CLAIMS.delete(key);
		}
	}
	if (wanted === '需要信息' || wanted === '需要授权') await shelveChildren(task.id);
	if (isFinal(wanted)) await cascadeClose(task.id, wanted);
	return task;
}

/**
 * 读某份任务的事件历史（T-019）。
 *
 * **只读**：不改文件、不补字段、不迁移。老事件没有 ts/actor/from/to 就显示为「—」。
 * 这是「append-only JSONL 本来就存了全部历史，只是没人读」的兑现。
 */
/** 任务驱动的执行约定：写进系统提示，模型每一步都能看到。 */

/** 覆盖式更新一个任务的内容字段（不动 status / claimed_by）；只有「未指定」的任务可改。 */
async function updateTask(id, patch) {
	return withWrite(() => updateTaskInner(id, patch));
}

async function updateTaskInner(id, patch) {
	const task = await readTask(id);
	if (task === undefined) throw new Error(`没有这个任务：${id}`);
	if (task.status !== '未指定') {
		throw new Error(`${task.id} 现在的状态是「${task.status}」，已采纳的任务不能直接改；请用「分支」复制一份再改`);
	}
	const next = Object.assign({}, task, patch, { id: task.id, status: task.status, claimed_by: task.claimed_by });
	/* kind 变了要校验：它是四类别模型的核心字段，不能写进非法值。
	   这也是「升级为目标」的落地路径（工作 ⇄ 目标 可互转）。 */
	if (patch.kind !== undefined) {
		const wanted = String(patch.kind ?? '').trim();
		if (wanted === '') {
			next.kind = task.kind;
		} else {
			if (!Object.hasOwn(KINDS, wanted)) {
				throw new Error(`kind 必须是 ${KIND_ORDER.join(' / ')} 之一，收到「${wanted}」`);
			}
			next.kind = wanted;
		}
	}
	/* 额外工作区进来时同样校验绝对路径并归一。 */
	if (patch.workspaces !== undefined) next.workspaces = splitWorkspaces(patch.workspaces).join(', ');
	for (const field of ['title', 'type', 'kind', 'body', 'parent', 'links', 'workspace', 'workspaces', 'permission', 'deny']) {
		if (patch[field] === undefined) next[field] = task[field];
	}
	await saveTask(next);
	return next;
}

/** 一份新任务被采纳（提交）时，它 links 里「取代:X」的那些旧任务直接转「拒绝」。 */
/*
 * ---------------------------------------------------------------------------
 * 关系类型（links）
 * ---------------------------------------------------------------------------
 *
 * 用户原话：
 *   > 考虑给关联新增更多内容。例如一期，二期。意味着他们是一件事情。
 *   > 那么是否除了用兄弟节点的联系以外，是否需要给一个"相关"的关系？
 *   > 然后还要有"约束"，"参考"之类的关系。
 *   > 例如一个目标，一个工作，用约束/参考，联系到记录/阻碍/研究里面去。
 *
 * 三个维度决定一种关系：
 *   ① 有没有方向      ② 有没有行为      ③ 影不影响状态
 *
 * | 类型 | 方向 | 行为 | 典型用法 |
 * |------|------|------|----------|
 * | 依赖 | 有向 | 阻断领取 + 上游失败则下游取消 | A 完成才能做 B |
 * | 相关 | 无向 | 无 | 一期 / 二期、同类问题 |
 * | 约束 | 有向 | 阻断领取（宽松：只警告不硬拒） | 查资料被"没有梯子"约束 |
 * | 参考 | 有向 | 无 | 做这事时该看那条记录 |
 * | 取代 | 有向 | 旧转拒绝 + 依赖转移 | 新方案替代旧方案 |
 * | 派生 | 有向 | 无（遗留字段，父子结构才是主路径） | 我从哪来 |
 * | 来源 | 有向 | 无 | 追溯出处 |
 *
 * **约束 vs 阻碍**（用户明确区分过）：
 *   「约束，是一个关系。阻碍，是一个性质，他可没说阻碍谁啊。
 *    不同的事情也可以被一个无关的东西阻碍。例如搜什么东西，然后约束于没有梯子。」
 *
 *   阻碍 = 任务的性质（"我被卡住了"），自身不指向谁
 *   约束 = 两个任务之间的关系，**可以跨树**指向一件完全无关的事
 *
 * 所以约束存在 links 里，不是父子结构。
 */
const RELATIONS = {
	/* 有行为 */
	依赖: { direction: 'forward', blocks: 'hard', cascades: true },
	取代: { direction: 'forward', blocks: 'none', cascades: true },
	约束: { direction: 'forward', blocks: 'soft', cascades: false },

	/* 只给人看的 */
	相关: { direction: 'both', blocks: 'none', cascades: false },
	参考: { direction: 'forward', blocks: 'none', cascades: false },

	/*
	 * 派生 = 父子结构。
	 *
	 * 它不是 links 里的标签（是 parent 字段），
	 * 留在表里是为了让"七种关系"这个词表完整 —— 用户查关系类型时能看到它。
	 */
	派生: { direction: 'forward', blocks: 'none', cascades: false, viaParent: true },
};
/** 用户在 links 里能用的（派生/来源是系统写的，不拦手写）。 */
const RELATION_LABELS = Object.keys(RELATIONS);

/** 校验 links 字符串里的关系名，返回归一后的字符串。 */
function normalizeLinks(raw) {
	const parts = String(raw ?? '')
		.split(/[,，]/u)
		.map((part) => part.trim())
		.filter((part) => part !== '');
	const out = [];
	for (const part of parts) {
		const cut = part.split(/[:：]/u);
		const label = (cut[0] || '').trim();
		const to = (cut[1] || '').trim();
		if (to === '') continue;
		if (!RELATION_LABELS.includes(label)) {
			throw new Error(
				`不认识的关系「${label}」。可用的：${RELATION_LABELS.join(' / ')}。\n` +
					'依赖=前者完成才能做 / 相关=同一件事的两个阶段 / 约束=被某件外部的事限制 / ' +
					'参考=做这事时该看那条 / 取代=新方案替旧方案',
			);
		}
		out.push(`${label}:${to}`);
	}
	return out.join(', ');
}

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
 * 领取前的规则检查。
 *
 * 现在只查一件事：**依赖的东西完成了没有**。
 *
 * 以前这里还有两条：
 *   · 「派生来源必须是处理中」
 *   · 「派生源必须是处理中」
 * 四类别模型下**全删了**，因为它们正是死锁的来源：
 *
 *   派生来源（目标/设计）根本不该处于「处理中」——目标没有自有状态，
 *   设计是等用户回答。要求它们「处理中」等于要求一个不该存在的状态，
 *   于是凡是有父节点的任务都领不了。
 *
 * 派生关系不再额外限制：能不能派生由模板的 dispatch 表和 kind 决定，
 * 不由「父节点正在跑」决定。父节点是容器，容器不需要"在跑"。
 */
async function claimBlocker(task, tasks) {
	const all = tasks || (await listAll());
	const byId = new Map(all.map((item) => [item.id, item]));
	for (const link of linkPairs(task)) {
		if (link.label !== '依赖') continue;
		const dep = byId.get(link.to);
		if (dep === undefined) return `依赖 ${link.to} 不存在`;
		/* 依赖：必须先完成才能领。这是"还没开始、要等前面"的语义，
		   和"阻碍"（在做、中途卡住）不是一回事。 */
		if (dep.status !== '成功') return `依赖 ${link.to} 还没完成（当前「${dep.status}」），不能领取`;
	}
	/* 约束（RELATIONS.约束 = soft）：**不硬拒，只往 text 里加提示**。
	 *
	 * 为什么软：约束常常是"外部条件不理想"（没梯子、没权限、数据量太大），
	 * 硬拒会让任务永远领不了。用户能判断"这个约束现在绕得过去"。
	 * 所以领是可以领的，但要把约束明确说出来。
	 *
	 * 实现上不在这里返回——调用方拿不到"提示"这个返回值形态。
	 * 约束的提示由 claim 工具自己拼（见 claimConstraints）。 */
	if (task.parent) {
		const parent = byId.get(task.parent);
		if (parent === undefined) return `派生来源 ${task.parent} 不存在`;
		/* 已终结的父节点下面不能再开新活（父都收尾了，孩子不该冒出来）。 */
		if (PARENT_CLOSED.has(parent.status)) {
			return `派生来源 ${parent.id} 已「${parent.status}」，不能再往下领取`;
		}
	}
	return '';
}

/**
 * 列出这个任务的「约束」和「参考」，给领取时做提示（不阻断）。
 *
 * 用户原话：「例如一个目标，一个工作，用约束/参考，联系到记录/阻碍/研究里面去。」
 * 约束跨树指向——它指向的东西可能完全不在同一棵树下，所以不能靠父子结构找。
 */
async function claimHints(task, tasks) {
	const all = tasks || (await listAll());
	const byId = new Map(all.map((item) => [item.id, item]));
	const hints = [];
	for (const link of linkPairs(task)) {
		if (link.label !== '约束' && link.label !== '参考') continue;
		const target = byId.get(link.to);
		const label = link.label === '约束' ? '约束' : '参考';
		if (target === undefined) {
			hints.push(`⚠️ ${label} ${link.to} 不存在`);
			continue;
		}
		hints.push(`${label}：${target.id}（${target.status}）${target.title} —— 先看一眼`);
	}
	return hints;
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

/*
 * 这里曾经有 isAncestorOf / isDescendantOf 两个函数，用来做「祖先链内部交接」，
 * 目的是解开当时的死锁（领了派生来源 → 派生任务全领不了）。
 *
 * 四类别模型落地后它们是**多余的**，已经删除：
 *   · 能派工作的容器是「目标」，而目标不可领取（状态由派生任务推导）；
 *   · 所以「父节点占着会话位、子节点进不来」这个前提根本不会出现；
 *   · 死锁不是靠"允许换手"绕过去的，是在类别层面就不存在。
 *
 * 删掉它们比留着更安全：留着会让人以为父子争位是个需要特殊处理的情况。
 */

/**
 * 父子校验（创建/派生时调用）。
 *
 * 查三件事：
 *   1. 父存在
 *   2. 父不是终结态（PARENT_CLOSED —— 与 claimBlocker 共用同一个集合）
 *   3. **工作不能派「工作类项目」**（四类别模型的核心约束）
 *
 * 关于第 3 条的口径（用户明确纠正过一次）：
 *
 *   工作**可以**派任何"项目"——调研、记录、复盘、设计，都行。
 *   比如线稿画到一半查参考（派 WR 调研），这是创作里最高频的动作。
 *
 *   工作**不能**派"另一件要做的事"（派 WT 实现项 / WF 缺陷 这类）。
 *   因为那说明它本来就不是原子任务——它是容器，该升级为目标。
 *
 * 所以判定不能只看 kind，要看**具体模板**：
 *   · ENTITY_TYPES（实现类模板）才是"要动手做的东西"
 *   · WR 调研 / WV 校验 / WL 线稿 这些是"项目"，工作可以派
 *
 * 为什么"派另一件工作"必须禁止：两个都要占会话位，必然互相抢。
 * 而调研/记录不占位（或只在被领取时短暂占位），不会与父工作争。
 */
const ENTITY_TYPES = new Set(['WT', 'WF', 'WI', 'WD', 'WE', 'WC', 'WP']);

async function assertParent(parentId, childKind, childType) {
	const id = String(parentId ?? '').trim();
	if (id === '') return;
	const parent = await readTask(id);
	if (parent === undefined) throw new Error(`派生来源 ${id} 不存在`);
	if (PARENT_CLOSED.has(parent.status)) {
		throw new Error(`父节点 ${id} 已「${parent.status}」，不能再往下派生`);
	}
	/* 用与 task_dispatch / 面板按钮**同一套判定**，避免"按钮里没有、
	   task_submit 却能建"这种两处规则不一致。 */
	const child = normalizeType(childType);
	if (child !== '' && TYPES.includes(child)) {
		const options = await dispatchOptions(id);
		const blocked = options.blocked.find((item) => item.type === child);
		if (blocked !== undefined) {
			throw new Error(`${id} 下面不能派 ${child}：${blocked.reason}`);
		}
		return;
	}
	/* 空模板（没写 type）：只挡"工作派工作"这条大类规则。 */
	if (kindOf(parent) === 'work' && childKind === 'work') {
		throw new Error(
			`${id} 是「工作」，不能再派另一件要做的事。\n` +
				'理由：「能一次做完」和「能再拆」互斥 —— 还要拆的东西本身是容器，那是「目标」。\n' +
				`要么把 ${id} 升级为目标，要么派调研（WR）/ 记录（RB、RR、RF）/ 设计（DC、DP）。`,
		);
	}
}
/**
 * 派生来源被搁置（需要信息/需要授权）时，进行态的派生任务一起转「需要授权」（递归，防环）。
 * 草稿（未指定）不作数、成功态是已交付的记录——两者都不动。
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
		/* 只动进行态：草稿不作数，成功态是已交付的记录。 */
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

		/* 顺序有讲究：必须先把「指向旧任务」的依赖转移到新任务，再判旧任务死刑。
		   反过来的话，旧任务一转「拒绝」就会把那些依赖方当成死路一起取消掉，
		   而它们本来应该在替代关系里活下来、改指向新任务。 */

		/* 1) 依赖转移：凡是指向旧任务的「依赖」，改成指向新任务 */
		for (const other of all) {
			if (other.id === task.id) continue;
			const pairs = linkPairs(other);
			if (!pairs.some((pair) => pair.label === '依赖' && pair.to === oldId)) continue;
			other.links = pairs
				.map((pair) => (pair.label === '依赖' && pair.to === oldId ? `依赖:${task.id}` : `${pair.label}:${pair.to}`))
				.join(', ');
			await saveTask(other);
		}

		/* 2) 旧任务转「拒绝」，并把它自己的下游一起收掉（派生任务 + 剩下的依赖方）。
		   这里不能调 setState：applySupersede 本身就在 withWrite 里，再进一次会自锁。 */
		if (old.status !== '拒绝') {
			old.status = '拒绝';
			old.claimed_by = '';
			await saveTask(old);
			await cascadeClose(oldId, '拒绝');
		}

		/* 3) 旧任务 `links` 里「派生:X」写法的下游，也一并取消（递归） */
		await cancelDerived(oldId, await listAll());
	}
	await refreshClaims();
}

/**
 * 给「一个会话干一个任务」的调度器用的宿主服务。
 *
 * 口径是**会话 id**，不要求是真实的 DSH 会话对象：外部调度器（含自管子 AI）
 * 给一个稳定的字符串 id 就行。一个 id 同一时刻只允许一个「处理中」的任务，
 * 不同 id 可以并发领取、各按自己那份任务的权限干活——**互不影响、不并集**。
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
		/** 该会话当前正在做的任务（处理中 + claimed_by 严格匹配）；没有就 undefined。 */
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
		 * 为某个会话领取一份「提交」的任务；一次只能一个。
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
			/* 释放不能落到「处理中」：那会造出 claimed_by 为空的无主处理中任务 */
			if (wanted === '处理中') throw new Error('release 不能把任务释放成「处理中」；要换手请先 release 再 claim');
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
		 * 返回 undefined 表示「没有可用领取」（守卫会拒掉除任务管理工具以外的一切）。
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

/*
 * ---------------------------------------------------------------------------
 * 四个插件（一个包里，各自可独立启停）
 * ---------------------------------------------------------------------------
 *
 * 用户要求：「一个包里面可以有多个插件。以下内容放在一个包里，分插件：
 *   箭头面板，任务面板，"按计划"的权限状态，"子工作空间"，额外工作空间。」
 *
 * `apply` 仍是默认入口，但它现在只做**组合**：按顺序启动四个子插件。
 * 每个子插件也有自己的 apply，可以单独在 cordis.patch.yml 里挂：
 *
 *   - insert: { id: taskboard,        name: '@local/taskboard' }          ← core + 全部
 *   - insert: { id: taskboard-core,   name: '@local/taskboard/core' }     ← 只有数据层
 *   - insert: { id: taskboard-plan,   name: '@local/taskboard/plan-preset' }
 *   - insert: { id: taskboard-ws,     name: '@local/taskboard/workspace' }
 */

/*
 * ── 插件入口 ───────────────────────────────────────────────────────────
 *
 * 用户要求：「任务板：有命令，ai 工具，后端实现。」
 *
 * 这个包只做**后端**：存储、任务模型、状态机、AI 工具、命令。
 * UI 是另外两个包（ui-drawer / ui-sidebar），权限与工作空间也是。
 *
 * 模板：内置四个（GU 用户任务 / WI 实现 / DP 方案 / RR 汇报）在
 * `./templates/`，够用。装 `templates` 插件会多出 23 个可选模板——
 * 那是**可选**依赖，拿不到就只用内置的。
 */
/*
 * ── 对外暴露核心 API（给 tools 插件用）───────────────────────────────
 *
 * 用户原话：
 *   > tools直接依赖core啊。这个语义是你不喜欢我的tools，你就自己造你的tools。
 *   > 也就是说core是要暴露东西的。但依赖确实是tools依赖core。
 *   > core是core就是假设他不能关的。
 *
 * 所以：**core 是必需的底层，tools 是可替换的上层**。
 * 别人不满意这套工具，可以关掉 `@local/taskboard-tools`、自己写一个，
 * 只要能接上下面这些方法就能跑。
 *
 * 依赖方向是单向的：tools → core。core 不认识 tools。
 */
function coreService(ctx) {
	return {
		/* ── 读 ── */
		listAll: () => listAll(),
		readTask: (id) => readTask(id),
		listGroups: () => listGroups(),
		readCurrentGroup: (sessionId) => readCurrentGroup(sessionId),
		writeCurrentGroup: (id, sessionId) => writeCurrentGroup(id, sessionId),
		saveGroup: (group) => saveGroup(group),
		readHistory: (id, limit) => readHistory(id, limit),

		/* ── 写（业务规则都在这些里面）── */
		createNew: (task) => createNew(task),
		updateTask: (id, patch) => updateTask(id, patch),
		setState: (id, next, agent, byUser, note) => setState(id, next, agent, byUser, note),
		setNote: (id, note) => setNote(id, note),
		setAnswer: (id, question, answer) => setAnswer(id, question, answer),
		setTags: (id, tags) => setTags(id, tags),
		setFlags: (id, flags) => setFlags(id, flags),
		archiveSubtree: (id, archived) => archiveSubtree(id, archived),
		applySupersede: (task) => applySupersede(task),

		/* ── 规则查询（工具要用来校验 / 展示）── */
		transitionBlocker: (from, to, byUser, task) => transitionBlocker(from, to, byUser, task),
		claimBlocker: (task, tasks) => claimBlocker(task, tasks),
		claimHints: (task, tasks) => claimHints(task, tasks),
		assertParent: (parentId, childKind, childType) => assertParent(parentId, childKind, childType),
		typeCatalog: () => typeCatalog(),
		resolveKindArg: (raw, type) => resolveKindArg(raw, type),
		normalizeType: (raw) => normalizeType(raw),
		normalizeLinks: (raw) => normalizeLinks(raw),
		linkPairs: (task) => linkPairs(task),
	setProgress: (id, section, value) => setProgress(id, section, value),
		kindOf: (task) => kindOf(task),
		groupsOf: (status) => groupsOf(status),
		deriveGoalStatus: (task, all) => deriveGoalStatus(task, all),
		isClaimable: (task) => isClaimable(task),
		isActive: (status) => isActive(status),
		isFinal: (status) => isFinal(status),
		extractQuestions: (body) => extractQuestions(body),
		parseFlags: (raw) => parseFlags(raw),

		/* ── 模板（可选依赖 templates 插件）── */
		availableTypes: () => availableTypes(),
		loadTemplate: (type) => loadTemplate(type),
		templateMeta: (type) => templateMeta(type),
		dispatchOptions: (fromId) => dispatchOptions(fromId),

		/* ── 杂项 ── */
		/** 当前会话 id（由权限守卫在每次工具调用前写入）。 */
		currentSession: () => CURRENT_SESSION.value,
		storeFilePath: () => storeFilePath(),
		/** 内置模板目录（core/templates）。面板要在这里写 INDEX.json 之外的清单，先拿路径。 */
		templateDir: () => TEMPLATE_DIR,
	TYPE_NAMES: () => TYPE_NAMES,
	LEGACY_TYPES: () => LEGACY_TYPES,
		resolveDshHome: (c) => resolveDshHome(c),
		splitWorkspaces: (raw) => splitWorkspaces(raw),

		/* ── 注册面（tools 插件要往 ctx 上挂东西）── */
		ctx,
	};
}
export function apply(ctx) {
	/* 存储服务：持久化在独立包里，这里接上。 */
	bindStore(ctx.taskboardStore);
	/* 把业务知识交给存储层（编号归一化、kind 推断、当前写入者）。 */
	if (typeof ctx.taskboardStore?.provideHooks === 'function') {
		ctx.taskboardStore.provideHooks({
			normalizeType,
			kindOf,
			currentActor: () => CURRENT_ACTOR.value,
		});
	}
	/* 先把模板服务找出来（可能还没注册 —— 插件加载顺序不保证）。 */
	bindTemplates(ctx);
	try {
		ctx.provide('taskboardCore', coreService(ctx));
	} catch (failure) {
		/* 没有 provide 能力时 tools 插件会拿不到，但 core 的存储/规则照样工作 */
	}
	try {
		ctx.provide('planClaims', planClaimsFor(ctx));
	} catch (failure) {
		/* 没有 provide 能力时只是少一个口子 */
	}
	/*
	 * 系统提示不在这里：它讲的是"怎么用这套工具"，跟工具面是一体的，
	 * 所以搬到了 @local/taskboard-tools。
	 *
	 * 之前这里还留着一句 `text: PROMPT_TEXT`，但 PROMPT_TEXT 已经迁走，
	 * core 里没有这个符号 —— effect 回调执行时直接 ReferenceError。
	 */
}
