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
import { dirname, join, resolve } from 'node:path';
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
const TYPES = [
	// 目标 Goal
	'GU', 'GO', 'GA', 'GV',
	// 设计 Design
	'DC', 'DP', 'DQ', 'DI', 'DB', 'DT',
	// 记录 Record
	'RB', 'RR', 'RF', 'RS', 'RD', 'RE', 'WX',
	// 工作 Work
	'WR', 'WI', 'WT', 'WF', 'WV', 'WL', 'WC', 'WD', 'WE', 'WP',
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
	GU: '用户任务',
	GO: '优化',
	GA: '画作',
	GV: '小说',
	/* 设计 Design */
	DC: '决策',
	DP: '方案',
	DQ: '提问',
	DI: '接口',
	DB: '问题',
	DT: '定调',
	/* 记录 Record */
	RB: '阻碍',
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
	H4: '需要补充 · 缺用户信息',
	H5: '需要补充 · 需要先调研',
	H6: '需要授权 · 资源被占用',
	H7: '需要授权 · 缺权限 / 环境不对',
	H8: '需要补充 · 子任务未回收',
};

/*
 * ---------------------------------------------------------------------------
 * 四个大类（kind）
 * ---------------------------------------------------------------------------
 *
 * 分类轴是「**什么时候算做完**」——四个定义互斥且穷尽，所以是真正的大类，
 * 而不是按行业角色乱切（那样必然互相重叠）。
 *
 *   goal   目标   子事项全部终结才算完         无自有状态，纯推导   不占位
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
	goal: { name: '目标', who: '无（由子事项决定）', occupying: false, claimable: false },
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
 * 空             → work    最安全：老数据里空 type 的多半是待办事项
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
	GO: 'goal',
	GA: 'goal',
	GV: 'goal',
	/* 设计 Design */
	DC: 'design',
	DP: 'design',
	DQ: 'design',
	DI: 'design',
	DB: 'design',
	DT: 'design',
	/* 记录 Record */
	RB: 'record',
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

/** 这个 kind 是否参与领取竞争。 */
function isClaimable(task) {
	return KINDS[kindOf(task)]?.claimable === true;
}

/** 父节点处于这些状态时，不允许再往下派生/领取。 */
const PARENT_CLOSED = new Set(['完成', '失败', '取消', '拒绝']);

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

/*
 * ---------------------------------------------------------------------------
 * 目标的状态由子事项推导（DP-02）
 * ---------------------------------------------------------------------------
 *
 * 用户原话（五条规则，按优先级从上往下）：
 *
 *   > 没有采纳的子任务：未开始。
 *   > 子任务都被需要授权：需要授权。
 *   > 子任务有采纳的且未完成未中断：进行中。
 *   > 子任务全部失败：失败。
 *   > 子任务都在完成态且不是全部失败：完成。
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
const GOAL_DERIVED = {
	未开始: '未开始',
	需要授权: '需要授权',
	需要补充: '需要补充',
	进行中: '进行中',
	失败: '失败',
	完成: '完成',
	取消: '已取消',
};

/**
 * 按子事项推导一个目标当前的样子。没有子事项时返回 `未开始`。
 *
 * 优先级（先命中先返回）：
 *   1. 没有非草稿子事项            → 未开始
 *   2. 有子事项在「需要补充」      → 需要补充（用户没提，但它也是"中断"，归这里）
 *   3. 活跃的都在「需要授权」      → 需要授权
 *   4. 有子事项在「提交/处理中」  → 进行中
 *   5. 全是「失败」                → 失败
 *   6. 全终结且不全失败            → 完成
 *   7. 其它（混合了草稿和终结）    → 进行中（还有草稿没采纳，等于没完）
 */
function deriveGoalStatus(task, all) {
	const children = all.filter((item) => item.parent === task.id);
	/* 草稿（未指定）不算数：用户还没采纳，等于"还没开始"。 */
	const live = children.filter((item) => !DRAFT.includes(String(item.status || '未指定')));
	if (live.length === 0) {
		return children.length === 0 ? GOAL_DERIVED.未开始 : GOAL_DERIVED.未开始;
	}

	const statuses = live.map((item) => String(item.status || ''));
	if (statuses.some((status) => status === '需要补充')) return GOAL_DERIVED.需要补充;
	if (statuses.every((status) => status === '需要授权')) return GOAL_DERIVED.需要授权;
	if (statuses.some((status) => status === '提交' || status === '处理中')) return GOAL_DERIVED.进行中;
	if (statuses.every((status) => status === '失败')) return GOAL_DERIVED.失败;
	/* 全终结且不全是失败 */
	if (statuses.every((status) => FINAL.includes(status))) return GOAL_DERIVED.完成;
	/* 混合：有还没开始的、也有终结的 */
	return GOAL_DERIVED.进行中;
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

	// —— 计划管理（只改计划库自己的文件）——
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
 * 计划的「描述符开关」：计划里可以显式关掉某一类能力，
 * 比整个「权限档位」细一档。
 *
 * 写法（计划字段 `deny`，逗号分隔）：`destructive, external`
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
	if (desc.write && denySet.has('write')) return '计划关闭了「写」类能力（write）';
	if (desc.destructive && denySet.has('destructive')) return '计划关闭了「破坏」类能力（destructive）';
	if (desc.external && denySet.has('external')) return '计划关闭了「外部」类能力（external）';
	if (desc.idempotent === false && denySet.has('idempotent')) return '计划关闭了「不幂等」类能力（idempotent）';
	return '';
}

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
			/* 计划级描述符开关：比权限档位细一档，只能收窄。 */
			const deny = parseDeny(claim.deny);

			if (permission === '工具全关') {
				return (
					`按计划：任务 ${claim.id} 要求「工具全关」，本会话不能调用工作区类工具。\n` +
					'但切任务不受限：用 task_state 把它改成「完成 / 失败 / 需要补充 / 需要授权」，' +
					'再用 task_list + task_claim 领下一张。'
				);
			}
			if (permission === '完全权限') {
				/* 完全权限之上仍尊重计划自己写的 deny。 */
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
						'切任务不受限：先 task_state 结束或搁置这张计划，再领下一张。'
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

			// 工作区内修改（也是没写权限时的默认）：计划没写子工作空间时，按会话 cwd 兜底
			const root = claim.workspace || String(session?.header?.cwd || '');
			/* 额外工作区：允许多个，与主工作区一起构成「可写范围」。 */
			const extras = Array.isArray(claim.workspaces)
				? claim.workspaces.filter((entry) => text(entry) !== '')
				: splitWorkspaces(claim.workspaces);
			const roots = (root === '' ? [] : [root]).concat(extras);

			const allowed = () => roots.join('、') || '（计划没写工作区）';

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

/** 从一段命令里抽出绝对路径（Windows 盘符路径 / UNC），用于目录归属判定。 */
function extractPaths(segment) {
	const found = [];
	for (const match of String(segment ?? '').matchAll(/[A-Za-z]:[\\/][^\s"'|;&]*/gu)) {
		found.push(match[0]);
	}
	for (const match of String(segment ?? '').matchAll(/\\\\[^\s"'|;&]+/gu)) {
		found.push(match[0]);
	}
	return found;
}

/**
 * 命令是不是只动允许目录（T-018 第 2 项）。
 *
 * 返回空串 = 放行；否则返回给模型看的原因。
 *
 * 判定口径（偏保守）：
 *   1. 按 `;` `&&` `||` `|` 与换行切成独立分句；
 *   2. 每个分句里抽出的每个绝对路径，都必须落在某个允许目录内；
 *   3. 一个路径都没抽到的分句 → 拒（看不出它写哪，宁可让模型拆成 write/edit）。
 *
 * 已知不完备：`cd` 后接相对路径、重定向 `>`、`node -e "..."` 里的字符串。
 * 真正完备需要按命令解析（T-029 在研究），这里先把已证实的绕过堵掉。
 */
function judgeCommand(command, roots) {
	const segments = String(command ?? '')
		.split(/[;&|\r\n]+/u)
		.map((part) => part.trim())
		.filter((part) => part !== '');
	if (segments.length === 0) return '命令是空的';

	for (const segment of segments) {
		const paths = extractPaths(segment);
		if (paths.length === 0) {
			/* 没写绝对路径：可能是纯粹的计算（echo hi / node --version），
			   也可能是相对路径写入。分不清，只放行明显只读的形态。 */
			if (isPlainReadOnlyCommand(segment)) continue;
			return `分句「${segment.slice(0, 40)}」看不出要动哪个目录`;
		}
		for (const path of paths) {
			if (!roots.some((root) => within(root, path))) {
				return `路径 ${path} 不在允许目录内`;
			}
		}
	}
	return '';
}

/** 明显只读的命令形态（白名单）：只认真正无副作用的。 */
const READONLY_COMMAND_PREFIXES = [
	'echo ',
	'echo"',
	'Write-Output ',
	'Get-ChildItem',
	'Get-Content',
	'Get-Item',
	'Get-Location',
	'Test-Path',
	'Select-String',
	'Measure-Object',
	'node --version',
	'node -v',
	'pnpm --version',
	'git status',
	'git log',
	'git diff',
	'git branch',
	'where ',
	'which ',
];

function isPlainReadOnlyCommand(segment) {
	const text = String(segment ?? '').trim().toLowerCase();
	return READONLY_COMMAND_PREFIXES.some((prefix) => text.startsWith(prefix.toLowerCase()));
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

/*
 * ---------------------------------------------------------------------------
 * 开放问题（answers）
 * ---------------------------------------------------------------------------
 *
 * 设计类事项正文里常有「## 两个要定的点」这种**开放问题**。
 * 以前只能整段堆在备注里，用户没法一条一条回答——他会说"完全在备注里面打字，
 * 没法一一直接回答"。
 *
 * 所以给事项加一个 `answers` 字段：`{ 问题键: 回答 }`。
 *   · 问题键取自正文的编号（`1` / `2` / `3`…），稳定、不依赖标题文字
 *   · 面板按编号渲染成一问一答的卡片，每条一个输入框
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
		if (task === undefined) throw new Error(`没有这份计划：${id}`);
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
		/* 存归一化后的编号：老数据的单字母在这里自动升级成双字母。 */
		type: normalizeType(head.type),
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
			const resolved = kindOf(task);
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
 * 计划库是**运行时数据**，跟会话消息一个地位，所以必须住在同一个根下（T-032）。
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

const STORE_DIR = join(resolveDshHome(), 'taskboard');
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
	if (enriched.actor === undefined) enriched.actor = CURRENT_ACTOR.value || 'unknown';
	await appendFile(STORE_FILE, `${JSON.stringify(enriched)}\n`, 'utf8');
}

/**
 * 当前写入者（会话 id / 'user' / 'unknown'）。
 *
 * 用「最近一次 setState/saveTask 的上下文」而不是异步上下文传递：
 * 这个插件所有写入都在 withWrite 串行链里，同一时刻只有一个写入上下文，
 * 所以一个简单的「当前值」就够，不需要 AsyncLocalStorage。
 */
const CURRENT_ACTOR = { value: '' };

function actorLabel(agent, byUser) {
	if (byUser === true) return 'user';
	const id = String(agent?.id ?? agent?.session?.id ?? '').trim();
	return id === '' ? 'unknown' : id;
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
	if (wanted === '') throw new Error('task_get: 需要一个计划 id，例如 MG-01');
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
 * 写一份计划的当前状态。
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
async function createNewInner(task) {
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
	throw new Error('新建事项失败：连续 50 次编号冲突');
}

function summarize(task) {
	const groups = groupsOf(task.status);
	const kind = kindOf(task);
	const bits = [
		`${task.id} [${KINDS[kind]?.name ?? kind}/${task.type || '?'} ${TYPE_NAMES[task.type] || ''}] ${task.title}`,
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
			parameters: { id: { type: 'string', required: true, description: '计划 id，例如 MG-01' } },
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
				'提交一份事项草稿。状态固定为「未指定」，用户在面板里采纳之后变成「提交」才能被领取。' +
				`type 取其一：${typeCatalog()}；留空 = 空模板（正文自由写）。` +
				'kind 取 goal(目标) / design(设计) / record(记录) / work(工作)，留空按 type 推断。' +
				'四个大类的区别是**谁能标完成**：目标由子事项决定、设计等用户点头、记录写完即完、工作由 AI 做出来。' +
				'只有「工作」能被领取，且一次只能做一个。' +
				'工作不能再派工作（能一次做完和能再拆互斥，要拆就先升级为目标）。' +
				'workspace 填子工作空间（主战场，单个绝对路径，可空 = 会话目录）；' +
				'workspaces 填额外工作区（要读写的其它目录，逗号分隔的绝对路径，可空）；' +
				'permission 填 仅可查看/工作区内修改/完全权限/工具全关，可空。',
			parameters: {
				title: { type: 'string', required: true, description: '一句话标题' },
				type: { type: 'string', description: `${TYPES.join('/')}，或留空 = 空模板` },
				kind: { type: 'string', description: 'goal/design/record/work；留空则按 type 推断' },
				body: { type: 'string', required: true, description: '正文 Markdown，按该类型模板的小节填' },
				parent: { type: 'string', description: '父计划 id，空 = 顶层' },
				links: { type: 'string', description: '链接，例如「依赖:GD-01, 派生:GR-01」' },
				workspace: { type: 'string', description: '子工作空间绝对路径（单个）' },
				workspaces: { type: 'string', description: '额外工作区，逗号分隔的绝对路径（可多个）' },
				permission: { type: 'string', description: '仅可查看 / 工作区内修改 / 完全权限 / 工具全关' },
				deny: { type: 'string', description: '按描述符再收窄，逗号分隔：write / destructive / external / idempotent' },
			},
			output: {
				schema: { type: 'object', additionalProperties: false, properties: { text: { type: 'string' } } },
				render: (_args, value) => [{ type: 'text', text: value.text }],
			},
			async execute(args) {
				const type = normalizeType(args.type);
				/* 空字符串 = 空模板（面板的 /task-create 一直允许，工具这边也放开）。 */
				if (type !== '' && !ALL_TYPES.includes(type)) {
					throw new Error(`task_submit: type 必须留空或取 ${ALL_TYPES.join('/')}，收到「${args.type}」`);
				}
				const title = text(args.title).trim();
				if (title === '') throw new Error('task_submit: 标题不能为空');
				/* kind 先算：assertParent 要拿它判断"工作不能派工作"。 */
				const kind = resolveKindArg(args.kind, type);
				await assertParent(text(args.parent), kind, type);
				/* 额外工作区：校验绝对路径并归一（逗号分隔）；非法直接拒，不落盘。 */
				const workspaces = splitWorkspaces(args.workspaces).join(', ');
				const id = await createNew({
					title,
					type,
					kind,
					status: '未指定',
					parent: text(args.parent),
					links: text(args.links),
					workspace: text(args.workspace),
					workspaces,
					permission: text(args.permission),
					deny: text(args.deny),
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
			parameters: { id: { type: 'string', required: true, description: '计划 id，例如 MG-01' } },
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
							/* kind 用**推断后**的值：老数据没存 kind，直接给 head.kind 会是空的，
							   面板就没法按四类别显示。这里统一填好，面板不用自己推。 */
							kind: kindOf(head),
							type: normalizeType(head.type),
							/* 开放问题进度：正文里有几问、已答几问。
							   面板据此在树/列表上标「还差 2 条没答」。 */
							questionCount: extractQuestions(body).length,
							answeredCount: Object.keys(head.answers ?? {}).length,
							/* 目标：推导出来的样子（不落盘，只给面板显示）。 */
							derived:
								kindOf(head) === 'goal' ? deriveGoalStatus({ ...head, body }, tasks) : '',
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
			/* 走唯一入口：转移校验、from→to 事件、取代级联都在里面。 */
			try {
				const approved = await setState(id, '提交', undefined, true);
				return { kind: 'success', text: `已采纳 ${approved.id}（现在可以被领取）` };
			} catch (error) {
				return { kind: 'error', text: String(error?.message ?? error) };
			}
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
	/* 只接受当前模板（TYPES）。H1–H8 已废除：它们是停止理由，不是模板，
	   文件也删了。给老 type 一个清楚的报错，而不是"文件不存在"。 */
	if (!TYPES.includes(wanted)) {
		if (LEGACY_TYPES.includes(wanted)) {
			throw new Error(
				`模板 ${wanted} 已废除：H1–H8 是"为什么停"的理由，不是模板。` +
					'现在用记录类的「B · 阻碍」，它的 reason 小节就是这张词表。',
			);
		}
		throw new Error(`模板类型必须是 ${TYPES.join('/')}，收到「${type}」`);
	}
	return readFile(join(TEMPLATE_DIR, `${wanted}.yml`), 'utf8');
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
		source = await readFile(join(TEMPLATE_DIR, `${wanted}.yml`), 'utf8');
	} catch (failure) {
		return null;
	}
	const meta = parseTemplateMeta(source);
	TEMPLATE_META_CACHE.set(wanted, meta);
	return meta;
}

/** 清缓存：模板文件可能在运行期被改（开发时常见）。 */
function clearTemplateMetaCache() {
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
	for (const type of TYPES) {
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
						? `父事项没有模板，只允许 ${declared.join('/')}`
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
				`${task.id} 是「目标」，它的状态由子事项推导，不能手动设成「${wanted}」。\n` +
					`现在推导出来是「${derived}」。\n` +
					'要让目标往前走，去推进它的子事项；要放弃整个目标，用「拒绝」或「取消」。',
			);
		}
	}

	/* 转「失败」必须有理由载体（WI-01）。
	 *
	 * 用户原话：「必须要有一个记录类型的子任务。并且可以点击失败按钮以后，
	 * 效果就是新建->记录->阻碍。不区分具体是什么记录。」
	 *
	 * 判定顺序（宽进）：
	 *   1. 有记录类子事项（最好是 RB 阻碍）→ 通过
	 *   2. 或 note 写了东西 → 通过（AI 用工具时不一定走面板的弹窗）
	 *   3. 都没有 → 拒绝，并说明该怎么做
	 *
	 * 为什么允许 note 兜底：面板能把用户引向"建阻碍"，但 AI 调
	 * `task_state` 时不会弹窗。对它来说，note 就是那句话的载体。
	 */
	if (wanted === '失败') {
		const children = (await listAll()).filter((item) => item.parent === task.id);
		const hasRecord = children.some((item) => kindOf(item) === 'record');
		const wroteNote = text(note) !== '' || text(task.note) !== '';
		if (!hasRecord && !wroteNote) {
			throw new Error(
				`${task.id} 要转「失败」，得先说明失败的原因。两个办法：\n` +
					'  1. 派一条记录（推荐 RB 阻碍）把它写清楚：task_submit 时 parent 填这个 id、type 填 RB\n' +
					'  2. 或者在这条事项的 note 里写清：卡在哪、为什么过不去、下一件该试什么\n' +
					'理由：失败的原因常常很长、还会牵涉别的事项。塞进一句话里，后来的人看不出所以然。',
			);
		}
	}

	if (wanted === '处理中') {
		/* 只有「工作」这一类才能被领取（四类别模型）。
		 *
		 * 目标、设计、记录都不存在「领取」这个动作：
		 *   · 目标的状态由子事项推导，它自己不占位；
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
			throw new Error(
				`当前已有进行中的任务 ${running.id}（${running.title}）：一次只能做一个，先把它完成/失败/取消再领取新的`,
			);
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
	if (wanted === '需要补充' || wanted === '需要授权') await shelveChildren(task.id);
	if (isFinal(wanted)) await cascadeClose(task.id, wanted);
	return task;
}

/**
 * 读某份计划的事件历史（T-019）。
 *
 * **只读**：不改文件、不补字段、不迁移。老事件没有 ts/actor/from/to 就显示为「—」。
 * 这是「append-only JSONL 本来就存了全部历史，只是没人读」的兑现。
 */
async function readHistory(id, limit) {
	const wanted = String(id ?? '').trim();
	if (wanted === '') throw new Error('task_history: 需要一个计划 id，例如 MG-01');
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
		if (any === undefined) throw new Error(`没有这份计划：${wanted}`);
		return [];
	}
	const cap = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 50;
	return entries.slice(-cap);
}

function renderHistory(id, entries) {
	if (entries.length === 0) return `${id} 没有可读的历史事件（可能是老数据，或还没被改过）。`;
	const lines = [`${id} 的历史（最近 ${entries.length} 条，时间顺序）：`];
	for (const entry of entries) {
		const when = entry.ts === '' ? '（无时间戳）' : entry.ts.replace('T', ' ').replace(/\..*$/u, '');
		const who = entry.actor === '' ? '—' : entry.actor;
		const move = entry.from !== '' && entry.to !== '' ? `${entry.from} → ${entry.to}` : `状态=${entry.status}`;
		lines.push(`- ${when}  ${who}  ${move}` + (entry.note ? `  备注：${entry.note.slice(0, 40)}` : ''));
	}
	return lines.join('\n');
}

function registerExtraTools(ctx) {
	ctx.tools.register(
		defineTool({
			name: 'task_template',
			description:
				'取一种事项模板（GitHub issue forms 的 YAML）。写事项前先取模板，按 body 里的字段填。' +
				`可选模板：${typeCatalog()}。` +
				'每个模板声明了 default_kind（默认大类）与 behavior（界面形态）。' +
				'给了 `from`（父事项 id）时，会同时列出该父事项允许派发的模板——' +
				'不允许的会说明原因（例如工作不能再派另一件要做的事）。',
			parameters: {
				type: { type: 'string', required: true, description: `${TYPES.join('/')}` },
				from: { type: 'string', description: '父事项 id；给了就一并校验能否派发' },
			},
			output: {
				schema: { type: 'object', additionalProperties: false, properties: { text: { type: 'string' } } },
				render: (_args, value) => [{ type: 'text', text: value.text }],
			},
			async execute(args) {
				const yaml = await loadTemplate(args.type);
				const fromId = String(args.from ?? '').trim();
				if (fromId === '') return { text: yaml };
				/* 顺带把"这个模板能不能挂在那个父事项下"一起回答，
				   省得模型取了模板、写完、提交时才被拒。 */
				const options = await dispatchOptions(fromId);
				const wanted = normalizeType(args.type);
				const blocked = options.blocked.find((item) => item.type === wanted);
				if (blocked !== undefined) {
					throw new Error(`不能把 ${wanted} 挂在 ${fromId} 下面：${blocked.reason}`);
				}
				return { text: yaml };
			},
		}),
	);

	ctx.tools.register(
		defineTool({
			name: 'task_dispatch',
			description:
				'列出某个事项下面**允许派发**哪些模板（以及为什么另一些不行）。' +
				'判定三层：大类规则（工作不能派另一件要做的事）、父模板的 dispatch 收窄、子模板的 default_kind。' +
				'不给 id 时返回全部模板（等于没限制）。',
			parameters: { id: { type: 'string', description: '父事项 id，例如 WI-01；空 = 全部模板' } },
			output: {
				schema: { type: 'object', additionalProperties: false, properties: { text: { type: 'string' } } },
				render: (_args, value) => [{ type: 'text', text: value.text }],
			},
			async execute(args) {
				const options = await dispatchOptions(args.id);
				const lines = [];
				if (options.from !== undefined) {
					lines.push(
						`${options.from.id}（${KINDS[options.parentKind]?.name ?? options.parentKind}）下面可以派发：`,
					);
				} else {
					lines.push('全部可用模板（没指定父事项，等于没限制）：');
				}
				for (const item of options.allowed) {
					lines.push(`  ✅ ${item.type} · ${item.name}（${KINDS[item.kind]?.name ?? item.kind}）`);
				}
				if (options.blocked.length > 0) {
					lines.push('', '不能派发的：');
					for (const item of options.blocked) {
						lines.push(`  ❌ ${item.type} · ${item.name} —— ${item.reason}`);
					}
				}
				return { text: lines.join('\n') };
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
				id: { type: 'string', required: true, description: '计划 id，例如 MG-01' },
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
			name: 'task_history',
			description:
				'读一份计划的事件历史（时间、谁改的、状态从什么变成什么、备注）。**只读**，不改任何东西。' +
				'老事件没有时间戳/actor 时显示为「—」。',
			parameters: {
				id: { type: 'string', required: true, description: '计划 id，例如 MG-01' },
				limit: { type: 'integer', description: '返回最近多少条，默认 50' },
			},
			output: {
				schema: { type: 'object', additionalProperties: false, properties: { text: { type: 'string' } } },
				render: (_args, value) => [{ type: 'text', text: value.text }],
			},
			async execute(args) {
				const entries = await readHistory(args.id, args.limit);
				return { text: renderHistory(String(args.id).trim(), entries) };
			},
		}),
	);

	ctx.tools.register(
		defineTool({
			name: 'task_answer',
			description:
				'回答设计类计划里的**某一个开放问题**（正文「要定的点 / 待定」小标题下编号的那些）。' +
				'与 task_note 的区别：note 是一整段自由结论，answer 是**逐条应答**，' +
				'面板会把它们渲染成一问一答，能看出哪几条还没答。' +
				'question 用编号（"1" / "2"），空字符串表示删掉这条回答。',
			parameters: {
				id: { type: 'string', required: true, description: '计划 id，例如 DP-05' },
				question: { type: 'string', required: true, description: '第几问（正文里的编号，例如 "1"）' },
				answer: { type: 'string', required: true, description: '回答内容；空串 = 删掉这条回答' },
			},
			output: {
				schema: { type: 'object', additionalProperties: false, properties: { text: { type: 'string' } } },
				render: (_args, value) => [{ type: 'text', text: value.text }],
			},
			async execute(args) {
				const task = await setAnswer(args.id, args.question, args.answer);
				const answered = Object.keys(task.answers ?? {}).length;
				const total = extractQuestions(task.body).length;
				return { text: `已记录 ${task.id} 第 ${args.question} 问的回答（已答 ${answered}/${total} 条）` };
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
				id: { type: 'string', required: true, description: '计划 id，例如 MG-01' },
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
		name: 'task-history',
		description: '输出一份计划的事件历史 JSON（面板读取时间线）',
		input: { hint: '<计划 id> [limit]' },
		recordInput: false,
		async handler({ rawInput }) {
			const parts = String(rawInput ?? '').trim().split(/\s+/u);
			if (parts.length < 1 || parts[0] === '') return { kind: 'error', text: '用法：/task-history <计划 id> [limit]' };
			try {
				const limit = parts[1] === undefined ? undefined : Number(parts[1]);
				const entries = await readHistory(parts[0], limit);
				return { kind: 'success', text: JSON.stringify({ id: parts[0], entries }) };
			} catch (error) {
				return { kind: 'error', text: String(error?.message ?? error) };
			}
		},
	});

	/* 保留但**当前没有调用方**。
	   面板现在已经不靠它了：沙箱只管工具调用、不管工具内部实现，Windows 也没有
	   沙箱机制，所以面板直接读文件就行，不需要问宿主路径（发命令会写会话日志）。

	   留着它是因为它对**人**有用：想看计划库落在哪、或者宿主按 $DSH_HOME
	   解析到了什么位置，敲一下就知道。 */
	ctx.commands.register({
		name: 'task-paths',
		description: '输出计划库与模板的绝对路径（人工排查用；面板不依赖它）',
		recordInput: false,
		async handler() {
			return {
				kind: 'success',
				text: JSON.stringify({
					store: STORE_FILE,
					templates: TEMPLATE_DIR,
					home: resolveDshHome(),
				}),
			};
		},
	});

	ctx.commands.register({
		name: 'task-dispatch',
		description: '列出某个事项下面允许派发的模板（面板读；JSON：{id} → {allowed,blocked}）',
		input: { hint: '{"id":"WI-01"}' },
		recordInput: false,
		async handler(payload) {
			let id = '';
			try {
				const parsed = JSON.parse(String(payload ?? '').trim() || '{}');
				id = String(parsed?.id ?? '').trim();
			} catch (error) {
				return { kind: 'error', text: '参数不是合法 JSON' };
			}
			const options = await dispatchOptions(id);
			return {
				kind: 'success',
				text: JSON.stringify({ allowed: options.allowed, blocked: options.blocked }),
			};
		},
	});

	ctx.commands.register({
		name: 'task-templates',
		description: '输出全部模板（YAML）的 JSON（面板读取；只给当前可用模板，不含已废弃的 H*）',
		recordInput: false,
		async handler() {
			const out = [];
			/* 只列 TYPES（当前模板）。H1–H8 已降级为停止原因，文件都删了，
			   列出来只会让面板显示 8 个空模板。老数据靠 LEGACY_TYPES 兜住读取。 */
			for (const type of TYPES) {
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
				const type = normalizeType(input.type);
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
				const kind = resolveKindArg(input.kind, type);
				await assertParent(text(input.parent), kind, type);
				const id = await createNew({
					title,
					type,
					kind,
					status,
					parent: text(input.parent),
					links: text(input.links),
					workspace: text(input.workspace),
					workspaces: splitWorkspaces(input.workspaces).join(', '),
					permission: text(input.permission),
					deny: text(input.deny),
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
		name: 'task-answer',
		description: '回答某一条开放问题（面板调用；JSON：{id,question,answer}）',
		input: { hint: '{"id":"DP-05","question":"1","answer":"…"}' },
		recordInput: false,
		async handler(payload) {
			let parsed = null;
			try {
				parsed = JSON.parse(String(payload ?? '').trim() || '{}');
			} catch (error) {
				return { kind: 'error', text: '参数不是合法 JSON' };
			}
			try {
				const task = await setAnswer(parsed?.id, parsed?.question, parsed?.answer);
				return {
					kind: 'success',
					text: JSON.stringify({ id: task.id, answers: task.answers ?? {} }),
				};
			} catch (error) {
				return { kind: 'error', text: String((error && error.message) || error) };
			}
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
	'- 计划太大或含糊：先用 `task_template` 取模板，再用 `task_submit` 拆成子事项，再执行。' +
		`可用模板：${typeCatalog()}。`,
	'- 领取前的硬规则：自己 `依赖:X` 的，X 必须「完成」。父节点是终结态时不能再派生。',
	'- **四个大类（凭"谁能标完成"区分）**：目标（子事项全终结才算完，不占位）/ 设计（等用户点头，不占位）/ 记录（写完即完，不占位）/ 工作（AI 做出来，**占位**）。',
	'- **只有「工作」能被领取**，且一次只能做一个。目标/设计/记录根本不存在"领取"这个动作。',
	'- **工作不能派工作**：「能一次做完」和「能再拆」互斥 —— 还要拆说明它是容器，那就升级为目标。',
	'- 阻碍 = 记录类模板 `B`。它一出现，父工作从「处理中」转「需要补充」。阻碍解除后**不自动改状态**，靠查询判断能否继续（没有未终结的阻碍子节点就能继续）。',
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
 * 领取前的规则检查。
 *
 * 现在只查一件事：**依赖的东西完成了没有**。
 *
 * 以前这里还有两条：
 *   · 「父计划必须是处理中」
 *   · 「派生源必须是处理中」
 * 四类别模型下**全删了**，因为它们正是死锁的来源：
 *
 *   父计划（目标/设计）根本不该处于「处理中」——目标没有自有状态，
 *   设计是等用户回答。要求它们「处理中」等于要求一个不该存在的状态，
 *   于是凡是有父节点的计划都领不了。
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
		if (dep.status !== '完成') return `依赖 ${link.to} 还没完成（当前「${dep.status}」），不能领取`;
	}
	if (task.parent) {
		const parent = byId.get(task.parent);
		if (parent === undefined) return `父计划 ${task.parent} 不存在`;
		/* 已终结的父节点下面不能再开新活（父都收尾了，孩子不该冒出来）。 */
		if (PARENT_CLOSED.has(parent.status)) {
			return `父计划 ${parent.id} 已「${parent.status}」，不能再往下领取`;
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

/*
 * 这里曾经有 isAncestorOf / isDescendantOf 两个函数，用来做「祖先链内部交接」，
 * 目的是解开当时的死锁（领了父计划 → 子计划全领不了）。
 *
 * 四类别模型落地后它们是**多余的**，已经删除：
 *   · 能派工作的容器是「目标」，而目标不可领取（状态由子事项推导）；
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
	if (parent === undefined) throw new Error(`父计划 ${id} 不存在`);
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
				id: { type: 'string', required: true, description: '计划 id，例如 SQ-01' },
				title: { type: 'string', description: '新标题' },
				type: { type: 'string', description: 'A/B/C/D/R/F，或空串表示空模板' },
				kind: { type: 'string', description: 'goal/design/record/work；空则按 type 推断' },
				body: { type: 'string', description: '新正文（Markdown）' },
				parent: { type: 'string', description: '父计划 id，空 = 顶层' },
				links: { type: 'string', description: '关联，例如「依赖:GD-01, 派生:GR-01」' },
				workspace: { type: 'string', description: '子工作空间绝对路径' },
				permission: { type: 'string', description: '仅可查看 / 工作区内修改 / 完全权限 / 工具全关' },
				deny: { type: 'string', description: '按描述符再收窄，逗号分隔：write / destructive / external / idempotent' },
			},
			output: {
				schema: { type: 'object', additionalProperties: false, properties: { text: { type: 'string' } } },
				render: (_args, value) => [{ type: 'text', text: value.text }],
			},
			async execute(args) {
				const patch = {};
				for (const field of ['title', 'type', 'kind', 'body', 'parent', 'links', 'workspace', 'workspaces', 'permission', 'deny']) {
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
		input: { hint: '{"id":"SQ-01","title":"…"}' },
		recordInput: false,
		async handler({ rawInput }) {
			try {
				const input = JSON.parse(String(rawInput ?? '{}'));
				if (!input.id) return { kind: 'error', text: '缺少 id' };
				const patch = {};
				for (const field of ['title', 'type', 'kind', 'body', 'parent', 'links', 'workspace', 'workspaces', 'permission', 'deny']) {
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
