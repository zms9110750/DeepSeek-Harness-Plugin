/**
 * 任务板 · 给 agent 的工具面。
 *
 * 用户要求拆八块，这是第 ③ 块：
 *   > 3.给agent的工具面
 *
 * ## 依赖方向（用户明确指定）
 *
 *   > tools直接依赖core啊。这个语义是你不喜欢我的tools，你就自己造你的tools。
 *   > 也就是说core是要暴露东西的。但依赖确实是tools依赖core。
 *   > core是core就是假设他不能关的。
 *
 * 所以：
 *   · core 提供 `ctx.taskboardCore`，包含全部业务规则
 *   · 这个包只做「把 core 的能力翻译成模型能调的十四个工具」
 *   · **不喜欢这套工具？关掉本插件，自己写一个接上 taskboardCore 就行**
 *
 * 这个包里没有任何业务判断——状态能不能改、失败要不要理由、编号怎么生成，
 * 全在 core。这里只有：参数校验、调用 core、把结果渲染成文字。
 *
 * ## 包含什么
 *
 *   14 个模型工具：task_list / task_get / task_submit / task_claim /
 *                  task_state / task_template / task_dispatch / task_history /
 *                  task_workgroup / task_flag / task_tag / task_note /
 *                  task_answer / task_update
 *   + 展示层（renderList / summarize / renderHistory）
 *   + 一批面板命令（/tasks、/task-get、/task-state …）
 *
 * 命令也在这里：它们和工具是同一件事的两个入口（模型用工具、人用命令）。
 */
/*
 * node:path / node:fs —— 写模板索引文件要用。
 *
 * 这两个是从 core 搬代码时漏掉的：搬过来用了 `join()` 和 `writeFile()`，
 * 却没搬 import。运行期直接 ReferenceError，被 catch 吞掉，
 * 于是 INDEX.json 永远写不出来，面板报「读不到模板」。
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineTool } from '@deepseek-ai/dsh-tools';
/*
 * 正文校验（行动库 + 模板章节）。
 *
 * 用相对路径直接引 `packages/actions` —— 两个包都在同一个仓库里，
 * 走相对路径比配 `@local/taskboard-actions` 更省事，也不会因为 profile
 * 的 node_modules 没 link 上而炸。这个包是零依赖的，直接 import 就行。
 */
import { checkBody } from '../actions/check-body.js';

export const name = 'taskboard-tools';

/* 依赖 core：没有它这个包什么也做不了。 */
export const inject = ['tools', 'commands', 'taskboardCore'];

/*
 * 把 core 的能力接成局部同名符号。
 *
 * 为什么用薄壳：这一千多行注册代码里到处是 `listAll()` / `setState()`
 * 这样的裸调用，逐个改成 `CORE.listAll()` 既危险又没收益。
 * 薄壳还能在 core 缺失时给出可读报错。
 */
let CORE = null;

function coreFn(name) {
	return function (...args) {
		if (CORE === null || typeof CORE[name] !== 'function') {
			throw new Error(`任务板核心不可用（缺 ${name}）。core 是必需依赖，不能关。`);
		}
		return CORE[name](...args);
	};
}

/**
 * 取 core 里的**值**（不是函数）的薄壳。
 *
 * core 导出的映射表是 getter（`TYPE_NAMES: () => TYPE_NAMES`），
 * 所以这里调用一次拿结果。用 coreFn 会包成函数壳，
 * 后续 `TYPE_NAMES[x]` 就变成读函数属性了。
 */
function coreVal(name) {
	if (CORE === null || CORE[name] === undefined) {
		throw new Error(`任务板核心不可用（缺 ${name}）。core 是必需依赖，不能关。`);
	}
	return CORE[name]();
}

/**
 * 惰性取 core 里的值表。
 *
 * 模块加载时 CORE 还是 null（apply 才绑定），所以不能直接 coreVal()。
 * 这个函数每次现取 —— 映射表很小，开销可忽略。
 */
const lazyTable = (name) => () => coreVal(name);

/* 读 */
const listAll = coreFn('listAll');
const readTask = coreFn('readTask');
const listWorkgroups = coreFn('listWorkgroups');
const readCurrentWorkgroup = coreFn('readCurrentWorkgroup');
const writeCurrentWorkgroup = coreFn('writeCurrentWorkgroup');
const saveWorkgroup = coreFn('saveWorkgroup');
const readHistory = coreFn('readHistory');

/* 写 */
const createNew = coreFn('createNew');
const updateTask = coreFn('updateTask');
const setState = coreFn('setState');
const setNote = coreFn('setNote');
const setProgress = coreFn('setProgress');
const setAnswer = coreFn('setAnswer');
const setTags = coreFn('setTags');
const setFlags = coreFn('setFlags');
const archiveSubtree = coreFn('archiveSubtree');
const applySupersede = coreFn('applySupersede');

/* 规则 */
const transitionBlocker = coreFn('transitionBlocker');
const claimBlocker = coreFn('claimBlocker');
const claimHints = coreFn('claimHints');
const assertParent = coreFn('assertParent');
const typeCatalog = coreFn('typeCatalog');
const resolveKindArg = coreFn('resolveKindArg');
const normalizeType = coreFn('normalizeType');
const normalizeLinks = coreFn('normalizeLinks');
const linkPairs = coreFn('linkPairs');
const kindOf = coreFn('kindOf');
const stategroupsOf = coreFn('stategroupsOf');
const deriveGoalStatus = coreFn('deriveGoalStatus');
const isClaimable = coreFn('isClaimable');
const isActive = coreFn('isActive');
const isFinal = coreFn('isFinal');
const extractQuestions = coreFn('extractQuestions');
const parseFlags = coreFn('parseFlags');

/* 模板 */
const availableTypes = coreFn('availableTypes');
const loadTemplate = coreFn('loadTemplate');
const templateMeta = coreFn('templateMeta');
const dispatchOptions = coreFn('dispatchOptions');

/* 杂项 */
const storeFilePath = coreFn('storeFilePath');
/*
 * 模板目录（core/templates）。
 *
 * 这个常量原来在 core 里，拆 tools 时被搬过来用却没定义 ——
 * `writeFile(join(TEMPLATE_DIR, 'INDEX.json'))` 直接 ReferenceError，
 * 被 catch 吞掉，于是 INDEX.json 永远不更新，面板就报「读不到模板」。
 */
const templateDir = coreFn('templateDir');
const currentSessionId = coreFn('currentSession');
const resolveDshHome = coreFn('resolveDshHome');
const splitWorkspaces = coreFn('splitWorkspaces');

/*
 * 模板与分组的**词表**。
 *
 * 这些是"可能存在哪些模板/分组"的静态表，不是业务规则。
 * 业务判断（能不能改状态、怎么编号）在 core。
 * 放在这里是因为工具描述要列出来给模型看。
 */
const TYPES = [
	'GU', 'GO', 'GA', 'GV',
	'DC', 'DP', 'DQ', 'DI', 'DB', 'DT',
	'RB', 'RR', 'RF', 'RS', 'RD', 'RE', 'WX', 'RW', 'RL',
	'WR', 'WI', 'WT', 'WF', 'WV', 'WL', 'WC', 'WD', 'WE', 'WP',
];
/** 全部编号（含老类型）。函数而非常量：LEGACY_TYPES 在后面才定义。 */
function allTypes() {
	return TYPES.concat(legacyTypes());
}
/* 三组的定义（顺序即面板展示顺序）。与 core 的 GROUPS 保持一致。 */
const GROUPS = [
	{ id: '进行', label: '进行', hint: '还活着：在做，或者停下来等人但没放弃' },
	{ id: '搁置', label: '搁置', hint: '停下来等人：需要信息 / 需要授权' },
	{ id: '结束', label: '结束', hint: '终结：成功 / 失败 / 拒绝 / 取消' },
];
/* 注意：必须是**函数**而不是常量。	ypeCatalog() 依赖 coreService，
 * 而模块加载时 CORE 还没绑定（apply 才绑定），常量初始化会直接抛错。 */
function promptText() {
	return [

	'本会话可能被切到「按计划」权限档。这一档下"能干什么"由你领取的任务决定：',
	'- 先 `task_list` 看任务库；只有状态是「提交」的任务能被领取。',
	'- 用 `task_claim` 领取（用户也可以在面板点「领取」）。领取后按该任务写的子工作空间与权限档位干活；任务没写就按会话当前目录与档位。',
	'- 一次只做一个任务的事；同一会话同一时刻只能有一个「处理中」的任务，手上还有时领不了新的，先把它标成功/失败/取消。',
	'- 发现了不属于当前任务的活，用 `task_submit` 新建一个任务（parent 指向当前任务，links 写 依赖/相关/约束/参考）挂上去，不要顺手做掉。',
	'- 做完 → `task_state` 改成「成功」；确认做不下去 → 「失败」；缺信息或要先调研 → 「需要信息」；代价大、要用户拍板 → 「需要授权」；用户明确否决 → 「拒绝」。',
	'- 搁置（需要信息 / 需要授权）时用 `task_state` 的 `note` 参数写清为什么停在这里（在等谁、等什么）；事后补写用 `task_note`。',
	'- 一个任务交付后会级联取消它下面停在「需要信息 / 需要授权」的派生任务，所以派生任务要赶在派生来源完成前处理掉。',
	'- 做完一张回到 `task_list` 继续领下一张，直到没有「提交」的任务；都没有就停下等用户，不要自己找事做。',
	'- 任务太大或含糊：先用 `task_template` 取模板，再用 `task_submit` 拆成派生任务，再执行。' +
		`可用模板：${typeCatalog()}。`,
	'- 领取前的硬规则：自己 `依赖:X` 的，X 必须「成功」。父节点是终结态时不能再派生。',
	'- **四个大类（凭"谁能标完成"区分）**：目标（派生任务全终结才算完，不占位）/ 设计（等用户点头，不占位）/ 记录（写完即完，不占位）/ 工作（AI 做出来，**占位**）。',
	'- **只有「工作」能被领取**，且一次只能做一个。目标/设计/记录根本不存在"领取"这个动作。',
	'- **工作不能派工作**：「能一次做完」和「能再拆」互斥 —— 还要拆说明它是容器，那就升级为目标。',
	'- 阻碍 = 记录类模板 `B`。它一出现，父工作从「处理中」转「需要信息」。阻碍解除后**不自动改状态**，靠查询判断能否继续（没有未终结的阻碍子节点就能继续）。',
	'- 状态三分类：**进行态**＝提交 / 处理中 / 需要信息 / 需要授权；**草稿**＝未指定（没采纳，不作数）；**完成态**＝成功 / 失败 / 取消 / 拒绝（已交付，不销毁）。',
	'- 派生就是父子结构：派生任务还有进行态时不能完成派生来源；派生来源搁置（需要信息 / 需要授权）时，进行态的派生任务一起转「需要授权」；派生来源终止（成功 / 失败 / 取消 / 拒绝）时，进行态的派生任务全部「取消」。草稿与完成态都不动。',
	'- 依赖链单向终结：前者「成功」→ 后者照常可领；前者失败 / 取消 / 拒绝 → 进行态的下游全部「取消」（递归）。已采纳的任务不能改，要重来只能 fork 出新任务。',
	'- 取代关系（新任务 links 写 `取代:X`）：新任务被采纳时，X 转「拒绝」，指向 X 的依赖自动转移到新任务，从 X 派生出去的下游全部「取消」。',
	'- 任务上的子工作空间与权限只在「按计划」档生效；其它档位（仅可查看/工作区内修改/完全权限/工具全关）一律按会话档位走，与任务无关。',
	'- 任务可以写两个工作区字段：`workspace`（子工作区，单个，主战场）与 `workspaces`（额外工作区，逗号分隔的绝对路径，可多个）。「工作区内修改」档下写在任一目录内都放行。',
	'- 按计划档不会死锁：任务管理类工具（task_list / task_get / task_submit / task_claim / task_state / task_update / task_template / task_note）永远放行。',
	'- 切任务不受任务权限限制：任务写「工具全关」或「仅可查看」时，工作区类工具被挡，但 task_state 永远能用——先结束或搁置当前任务，再 task_list + task_claim 领下一张。',
	'- 宿主暴露了 `planClaims` 服务（按会话 id 领取/查询/释放任务），给"一个任务 fork 一个会话"的调度器用；子智能体/团队走自己的权限档，不受任务权限约束。',
	'- 一个会话同一时刻只能做一个任务；不同会话可以并发各领一张，权限与工作空间各自独立、绝不并集。子 AI 可以用 `planClaims.claim(自己的id, 任务id)` 接入。',
].join('\n');
}

/* 常量（core 里的表，只读引用） */
const STATUS = ['未指定', '提交', '处理中', '需要信息', '需要授权', '成功', '失败', '取消', '拒绝'];
const KINDS = {
	goal: { name: '目标' },
	design: { name: '设计' },
	record: { name: '记录' },
	work: { name: '工作' },
};
const KIND_ORDER = ['goal', 'design', 'record', 'work'];
/* 模板名从 core 取 —— 两边各写一份必然漂移（core 有 37 项，这里曾经是空表）。 */
const typeNames = lazyTable('TYPE_NAMES');
const ENTITY_TYPES = new Set(['WT', 'WF', 'WI', 'WD', 'WE', 'WC', 'WP']);
const NOTE_LIMIT = 4000;
/*
 * 老类型：第一代单字母 + 第二代 H1–H8。
 *
 * H1–H8 曾经是"为什么停下来等人"的模板（阻碍的细分），
 * 后来降级成 RB 阻碍 正文里的理由词表，模板文件已删。
 * 但**老数据里还有**，所以读的时候必须认得出来 ——
 * 这也是为什么它们留在词表里却不在 TYPES 里。
 */
/*
 * 旧编号词表从 core 取。
 *
 * 之前这里是手抄的 23 项，core 有 46 项 —— 少的是第二代拼音前缀
 * （MG/ML/SQ/JB/GR/GD…）。后果：`type:'GD'` 这类 core 明确支持
 * （RENAME 有映射）的旧编号，被 tools 的校验直接拒掉。
 *
 * 两边各写一份必然漂移，所以只留真源。
 */
const legacyTypes = lazyTable('LEGACY_TYPES');

/** 读文本：只认 string。 */
function text(value) {
	return typeof value === 'string' ? value : '';
}
function summarize(task) {
	const groups = stategroupsOf(task.status);
	const kind = kindOf(task);
	const bits = [
		`${task.id} [${KINDS[kind]?.name ?? kind}/${task.type || '?'} ${typeNames()[task.type] || ''}] ${task.title}`,
		`状态=${task.status}` + (groups.length > 0 ? `（${groups.join('/')}）` : '（草稿）'),
	];
	if (task.parent) bits.push(`父=${task.parent}`);
	if (task.links) bits.push(`链接=${task.links}`);
	/* 标记放前面（紧挨状态），因为它们决定"要不要我现在看"。
	 * 用符号而不是文字，扫一眼就能看出哪几条在等我。 */
	const flags = parseFlags(task.flags);
	if (flags.length > 0) {
		const mark = flags
			.map((flag) => ({ unread: '●未读', read: '✓已读', 'needs-me': '◉待我', 'needs-review': '◇待审' })[flag] || flag)
			.join(' ');
		bits.splice(2, 0, mark);
	}
	if (task.workspace) bits.push(`子工作空间=${task.workspace}`);
	if (text(task.workspaces) !== '') bits.push(`额外工作区=${task.workspaces}`);
	if (task.permission) bits.push(`权限=${task.permission}`);
	if (text(task.note) !== '') bits.push('备注=' + task.note.replace(/\s+/gu, ' ').slice(0, 40));
	return bits.join(' · ');
}

function renderList(tasks) {
	if (tasks.length === 0) return '任务库是空的（存储：' + storeFilePath() + '）';
	const lines = [`共 ${tasks.length} 份任务（存储：${storeFilePath()}）`];
	for (const task of tasks) lines.push(`- ${summarize(task)}`);
	lines.push(
		'',
		'状态组：进行=提交/处理中/需要信息/需要授权；搁置=需要信息/需要授权；结束=成功/失败/取消/拒绝。',
		'需要信息与需要授权同时属于「进行」和「搁置」——是进行中的暂停，不是终结。',
		'未指定=AI 提交但用户还没采纳，不能领取；提交=可以 task_claim。',
	);
	return lines.join('\n');
}

function renderFull(task, all) {
	const lines = [summarize(task), ''];

	/*
	 * 反向关系 —— 别人指向我的那一半。
	 *
	 * 没有它，「A 相关:D」在 D 那边完全看不见，无向就成了单行道。
	 *
	 * 相关是无向的，但按定法**只存后建的那一方**（先建的任务不可变），
	 * 所以只能查询时双向展开。
	 */
	if (Array.isArray(all) && all.length > 0) {
		const incoming = [];
		for (const other of all) {
			if (other.id === task.id) continue;
			for (const link of linkPairs(other)) {
				if (link.to !== task.id) continue;
				incoming.push(link.label + ':' + other.id);
			}
		}
		if (incoming.length > 0) lines.push('被别人指向=' + incoming.join(', '));
	}

	if (task.body) lines.push(task.body);
	return lines.join('\n');
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

function registerTools(ctx) {
	ctx.tools.register(
		defineTool({
			name: 'task_list',
			description:
				'**不传 group 就列出所有分组**（各自几条、哪个是当前组）；' +
				'**传了 group 就列出那一组里的任务**（只给头部：id、类型、状态、父、链接、标签、工作空间、权限档位）。' +
				'这是两级跳：先看有哪些组，再进组看内容——' +
				'理由（用户原话）：「你不可能在程序里面去查绘画的风格。」' +
				'状态「未指定」是 AI 提交但用户还没采纳的，不能领取；「提交」才能 task_claim。',
			parameters: {
				group: {
					type: 'string',
					description: 'null/空 = 列出所有分组；给分组 id = 列出该组任务；"all" = 列出全部任务',
				},
			},
			output: {
				schema: { type: 'object', additionalProperties: false, properties: { text: { type: 'string' } } },
				render: (_args, value) => [{ type: 'text', text: value.text }],
			},
			async execute(args) {
				const all = await listAll();
				const groups = (await listWorkgroups()).filter((entry) => entry.name !== '');
				const current = await readCurrentWorkgroup(currentSessionId());
				const wanted = String(args?.group ?? '').trim();

				/* ① 没传 group → 列出所有分组（不列任务）。 */
				if (wanted === '') {
					if (groups.length === 0) {
						return { text: '还没有任何工作组。用 task_workgroup action=create name=… 建一个。' };
					}
					const lines = groups.map((group) => {
						const live = group.members.filter((id) => all.some((item) => item.id === id));
						const mark = group.id === current ? '★ ' : '  ';
						const tag = group.archived ? '（已归档）' : '';
						return `${mark}${group.id} · ${group.name}${tag}（${live.length} 条）`;
					});
					const head =
						current === ''
							? '当前没有激活的分组（0 个也可以，不是必须有一个）。'
							: `当前激活的分组：${current}`;
					return {
						text: `${head}\n共 ${groups.length} 个分组：\n${lines.join('\n')}\n\n进某个组看内容：task_list group=<分组 id>`,
					};
				}

				/* ② all → 列出全部任务。 */
				if (wanted === 'all') return { text: renderList(all) };

				/* ③ 给了分组 id → 列出该组任务。 */
				const target = groups.find((entry) => entry.id === wanted);
				if (target === undefined) {
					throw new Error(`没有这个分组：${wanted}。现有：${groups.map((entry) => entry.id).join(' / ') || '（没有）'}`);
				}
				const mine = new Set(target.members);
				const inside = all.filter((item) => mine.has(item.id));
				return {
					text: `分组 ${target.id} · ${target.name}（${inside.length} 条）\n\n` + renderList(inside),
				};
			},
		}),
	);

	ctx.tools.register(
		defineTool({
			name: 'task_get',
			description:
				'读一个任务的全文（头部 + 正文）。' +
				'**group 为 null 时按当前组查**：只在该组里找这个 id。' +
				'给了 group 就只在那一个组里找。' +
				'为什么加 group：不同组里可能有同编号的任务（例如两边都有 WI-01），' +
				'不指定范围会读到另一组的东西。',
			parameters: {
				id: { type: 'string', required: true, description: '任务 id，例如 WI-01' },
				group: {
					type: 'string',
					description: '在哪个分组里找（null/空 = 当前组；传 "all" = 不限分组）',
				},
			},
			output: {
				schema: { type: 'object', additionalProperties: false, properties: { text: { type: 'string' } } },
				render: (_args, value) => [{ type: 'text', text: value.text }],
			},
			async execute(args) {
				const wanted = String(args.id ?? '').trim();
				const task = await readTask(wanted);
				if (task === undefined) throw new Error(`task_get: 没有这个任务：${wanted}`);
				/* 归属校验：防止跨组读到同编号的东西。 */
				const scope = String(args.group ?? '').trim();
				if (scope !== 'all') {
					const groups = (await listWorkgroups()).filter((entry) => entry.name !== '');
					const workgroupId = scope !== '' ? scope : await readCurrentWorkgroup(currentSessionId());
					if (workgroupId !== '') {
						const group = groups.find((entry) => entry.id === workgroupId);
						if (group === undefined) {
							throw new Error(`没有这个分组：${workgroupId}。现有：${groups.map((g) => g.id).join(' / ') || '（没有）'}`);
						}
						if (!group.members.includes(wanted)) {
							throw new Error(
								`${wanted} 不在分组 ${group.id}（${group.name}）里。\n` +
									'跨组读取要显式传 group="all"，或者传那个任务真正所属的 group。',
							);
						}
					}
				}
				return { text: renderFull(task, await listAll()) };
			},
		}),
	);

	ctx.tools.register(
		defineTool({
			name: 'task_submit',
			description:
				'提交一个任务草稿。状态固定为「未指定」，用户在面板里采纳之后变成「提交」才能被领取。' +
				`type 取其一：${typeCatalog()}；留空 = 空模板（正文自由写）。` +
				'kind 取 goal(目标) / design(设计) / record(记录) / work(工作)，留空按 type 推断。' +
				'四个大类的区别是**谁能标完成**：目标由派生任务决定、设计等用户点头、记录写完即完、工作由 AI 做出来。' +
				'只有「工作」能被领取，且一次只能做一个。' +
				'工作不能再派工作（能一次做完和能再拆互斥，要拆就先升级为目标）。' +
				'workspace 填子工作空间（主战场，单个绝对路径，可空 = 会话目录）；' +
				'workspaces 填额外工作区（要读写的其它目录，逗号分隔的绝对路径，可空）；' +
				'permission 填 仅可查看/工作区内修改/完全权限/工具全关，可空。',
			parameters: {
				title: { type: 'string', required: true, description: '一句话标题' },
				type: { type: 'string', description: `${TYPES.join('/')}，或留空 = 空模板` },
				kind: { type: 'string', description: 'goal/design/record/work；留空则按 type 推断' },
				body: {
					/*
					 * 正文接受两种形态，所以用 `json`（任意 JSON 值）而不是 `string`。
					 *
					 *   · 对象 —— 新格式，按章节 id 索引：
					 *       { want: { action: 'textarea', value: '…' },
					 *         how:  { action: 'choose', options: ['A','B'] } }
					 *   · 字符串 —— 旧的 Markdown 全文，原样保存（用户明确说不迁移）
					 *
					 * 为什么不在 schema 里把两种都列出来：`dsh-tools` 的 DSL 没有
					 * union，只能二选一。而正文的具体形状要跟模板章节对照才能校验，
					 * 那件事放在 execute 里做（checkBody），schema 只保证"是个 JSON 值"。
					 */
					type: 'json',
					required: true,
					description:
						'正文。对象形态：按章节 id 索引，每个值是带 action 的 object，' +
						'如 {"want":{"action":"textarea","value":"…"}}；' +
						'字符串形态：旧的 Markdown 全文（兼容）。',
				},
				parent: { type: 'string', description: '派生来源 id，空 = 顶层' },
				links: { type: 'string', description: '链接，例如「依赖:GD-01, 派生:GR-01」' },
				workspace: { type: 'string', description: '子工作空间绝对路径（单个）' },
				workspaces: { type: 'string', description: '额外工作区，逗号分隔的绝对路径（可多个）' },
				permission: { type: 'string', description: '仅可查看 / 工作区内修改 / 完全权限 / 工具全关' },
				deny: { type: 'string', description: '按描述符再收窄，逗号分隔：write / destructive / external / idempotent' },
				group: { type: 'string', description: '所属工作组 id（可选；给了派生来源就跟随父的工作组）' },
			},
			output: {
				schema: { type: 'object', additionalProperties: false, properties: { text: { type: 'string' } } },
				render: (_args, value) => [{ type: 'text', text: value.text }],
			},
			async execute(args) {
				const type = normalizeType(args.type);
				/* 空字符串 = 空模板（面板的 /task-create 一直允许，工具这边也放开）。 */
				if (type !== '' && !allTypes().includes(type)) {
					throw new Error(`task_submit: type 必须留空或取 ${allTypes().join('/')}，收到「${args.type}」`);
				}
				const title = text(args.title).trim();
				if (title === '') throw new Error('task_submit: 标题不能为空');
				/* kind 先算：assertParent 要拿它判断"工作不能派工作"。 */
				const kind = resolveKindArg(args.kind, type);
				await assertParent(text(args.parent), kind, type);
				/* 分组归属（**不存在「未归组」**，但也**不必每次指定**）。
				 *
				 * 用户原话：
				 *   「元组是不能有未归组。因为闲聊是不会创建出来任务的。」
				 *   「不需要必须指定分组。不指定就是用"当前组"。」
				 *
				 * 判定顺序：
				 *   1. 显式 args.group
				 *   2. parent 的分组（派生任务跟随父）
				 *   3. **当前组**（跟随会话）
				 *   4. 都没有 → 拒绝（说明怎么设当前组）
				 */
				const groups = (await listWorkgroups()).filter((entry) => entry.name !== '');
				const parentId = text(args.parent);
				let workgroupId = text(args.group);
				if (workgroupId === '' && parentId !== '') {
					const owner = groups.find((entry) => entry.members.includes(parentId));
					if (owner !== undefined) workgroupId = owner.id;
				}
				if (workgroupId === '') {
					/* 回落到当前组。sessionId 由工具上下文给（agent.id），
					   没有就用 _default。 */
					workgroupId = await readCurrentWorkgroup(currentSessionId());
				}
				if (workgroupId === '') {
					throw new Error(
						'task_submit: 没有分组可归属。\n' +
							'每个工作组 = 一件事 / 一个项目；"闲聊不会创建出任务"，所以任务必须有归属。\n' +
							(groups.length === 0
								? '现在一个工作组都没有，先用 task_workgroup action=create name=… 建一个。'
								: '设一个「当前组」就不用每次指定了：task_workgroup action=select group=…\n' +
									`现有分组：${groups.map((entry) => `${entry.id}（${entry.name}）`).join(' / ')}`),
					);
				}
				const target = groups.find((entry) => entry.id === workgroupId);
				if (target === undefined) {
					throw new Error(`没有这个分组：${workgroupId}。现有：${groups.map((entry) => entry.id).join(' / ') || '（没有）'}`);
				}
				/* 额外工作区：校验绝对路径并归一（逗号分隔）；非法直接拒，不落盘。 */
				const workspaces = splitWorkspaces(args.workspaces).join(', ');
				/*
				 * 正文校验 —— **落盘之前**。
				 *
				 * 用户原话：
				 *   > 架构校验不能过，直接拒绝这个任务提案。工具返回就是报错的。
				 *   > 校验过了，才上任务板。然后解析器工作。
				 *
				 * 所以这里抛错 = 整个提案不成立，任务板上不会出现不合法的正文。
				 * 校验只看「正文 vs 模板声明的章节」，不看业务规则（那些在 core）。
				 *
				 * `args.body` 现在允许两种：
				 *   · 字符串 —— 旧的 Markdown，原样放行（用户明确说不迁移）
				 *   · 对象   —— 按章节 id 索引，{ want: { action:'textarea', value:'…' } }
				 */
				const bodyCheck = await checkBody(args.body, {
					type,
					loadTemplate: (wanted) => loadTemplate(wanted),
				});
				if (!bodyCheck.ok) {
					throw new Error(`task_submit: 正文不合法 —— ${bodyCheck.reason}`);
				}
				/*
				 * 初始状态按类别定（GU-08 2.1 / 3.1 / 4.1）。
				 *
				 *   目标  未指定     ← 要人「采纳」才进推导（1.1）
				 *   工作  未指定     ← 要人「采纳」才能领（3.1）
				 *   设计  需要授权   ← AI 无权改，必须人拍板（2.1）
				 *   记录  需要授权   ← 等人看过才作数（4.1）
				 *
				 * 用户原话（为什么设计初始不是「需要信息」）：
				 *   > 授权，意味着这个东西必须由用户拍板。ai无权从需要授权
				 *   > 转变状态。而信息是ai可以操作的
				 *
				 * 所以「提问」这种听起来像"要信息"的东西，初始也是「需要授权」——
				 * 因为答案是**人**给的，AI 不能自己填上然后标成功。
				 */
				const initialStatus = kind === 'design' || kind === 'record' ? '需要授权' : '未指定';
				const id = await createNew({
					title,
					type,
					kind,
					status: initialStatus,
					parent: text(args.parent),
					links: normalizeLinks(args.links),
					workspace: text(args.workspace),
					workspaces,
					permission: text(args.permission),
					deny: text(args.deny),
					claimed_by: '',
					body: bodyCheck.body,
				});
				/* 建完立刻认领进分组（同一把锁里已算好 workgroupId）。 */
				await saveWorkgroup({
					id: target.id,
					name: target.name,
					members: [...new Set([...target.members, id])],
					createdAt: target.createdAt,
				});
				return {
					text:
						`已提交 ${id}（状态=未指定，等用户采纳后变成「提交」才能领取）。\n` +
						`存储：${storeFilePath()}`,
				};
			},
		}),
	);

	ctx.tools.register(
		defineTool({
			name: 'task_claim',
			description:
				'领取一份「提交」状态的任务，返回它的子工作空间与权限档位。' +
				'未指定、拒绝、成功、需要信息、需要授权的任务都不能领取。领取后状态变成「处理中」，并在任务头上记下领取的会话。',
			parameters: { id: { type: 'string', required: true, description: '任务 id，例如 MG-01' } },
			output: {
				schema: { type: 'object', additionalProperties: false, properties: { text: { type: 'string' } } },
				render: (_args, value) => [{ type: 'text', text: value.text }],
			},
			async execute(args, exec) {
				const agent = exec?.agent;
				/* 走唯一的改状态入口：这里拿到写锁（并发双领会被串行化），
				   并且 CLAIMS / 级联 / 转移校验全部由 setStateInner 一处维护。 */
				const task = await setState(args.id, '处理中', agent, false);
				const lines = [`已领取 ${task.id}：${task.title}`, `类型：${task.type} ${typeNames()[task.type] || ''}`];
				lines.push(`子工作空间：${task.workspace || '（任务没写，按会话当前工作目录）'}`);
				lines.push(`额外工作区：${task.workspaces || '（无）'}`);
				lines.push(`权限档位：${task.permission || '（任务没写，按会话当前档位）'}`);
				lines.push('', '提醒：任务的附属权限只在会话权限档位为「按计划」时生效；其它档位按会话当前权限执行。');
				/* 约束 / 参考：**不阻断领取，但要说出来**。
				 *
				 * 约束常常是外部条件（没梯子、没权限），硬拒会让任务永远领不了；
				 * 但也不能不提——用户要的是"领之前知道有这个限制"。 */
				const hints = await claimHints(task);
				if (hints.length > 0) {
					lines.push('', '这个任务挂着：');
					for (const hint of hints) lines.push('  ' + hint);
				}
				return { text: lines.join('\n') };
			},
		}),
	);
}

function registerCommands(ctx) {
	/*
	 * 原型预览：把研究沙盘里那套 HTML 原样吐出来。
	 *
	 * ## 为什么走命令而不是静态资源
	 *
	 * 客户端插件拿不到自己的资源 URL（没有 `import.meta.url` 之类）。
	 * 它唯一能跟宿主说话的路是 `remote.commands.execute`。
	 * 所以把 HTML 当命令返回值传过去，前端用 iframe srcDoc 渲染。
	 *
	 * ## 文件在哪
	 *
	 * `packages/ui/prototype/` 下两份快照。它们是**研究阶段的产物**，
	 * 跟着仓库走（不依赖 研究/沙盘 目录在不在一起）。
	 */
	ctx.commands.register({
		name: 'taskboard-prototype',
		description: '输出原型预览页的 HTML（面板用 iframe 显示）',
		recordInput: false,
		async handler() {
			const which = 'work';
			try {
				const html = await readFile(
					join(dirname(fileURLToPath(import.meta.url)), '..', 'ui', 'prototype', `${which}.html`),
					'utf8',
				);
				return { kind: 'success', text: html };
			} catch (failure) {
				return {
					kind: 'error',
					text: `原型快照读不出来：${failure?.message ?? failure}\n（文件应在 packages/ui/prototype/${which}.html）`,
				};
			}
		},
	});

	ctx.commands.register({
		name: 'tasks',
		description: '输出任务库全部任务头的 JSON（面板读取）',
		recordInput: false,
		async handler() {
			const tasks = await listAll();
			/* 每个任务属于哪些分组：反查一遍，别让面板自己拼。 */
			const groups = (await listWorkgroups()).filter((group) => group.name !== '');
			const workgroupOfTask = new Map();
			for (const group of groups) {
				for (const member of group.members) {
					if (!workgroupOfTask.has(member)) workgroupOfTask.set(member, []);
					workgroupOfTask.get(member).push(group.id);
				}
			}
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
							/* 状态组：数组，一个状态可以属于多个组。面板按这个着色/分区。 */
							groups: stategroupsOf(head.status),
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
							/* 归档：面板默认不显示，但**照样返回**——
							   用户明确要求"已经归档的，ai 仍然可以用工具查看"。 */
							archived: head.archived === true,
							/* 属于哪些分组（id 数组）。 */
							stategroupsOf: workgroupOfTask.get(head.id) ?? [],
							/* 标签：多个，自由字符串。用于跨组检索。 */
							tags: Array.isArray(head.tags) ? head.tags : [],
							/* 标记：与状态正交（unread/read/needs-me/needs-review）。 */
							flags: parseFlags(head.flags),
						});
					}),
				),
			};
		},
	});

	ctx.commands.register({
		name: 'task-stategroups',
		description: '输出状态组定义（面板读取；状态 → 组的映射，多组状态返回数组）',
		recordInput: false,
		async handler() {
			return {
				kind: 'success',
				text: JSON.stringify({
					groups: GROUPS,
					status: STATUS.map((status) => ({ status, groups: stategroupsOf(status) })),
				}),
			};
		},
	});

	ctx.commands.register({
		name: 'task-approve',
		description: '用户采纳一个任务（未指定 → 提交，面板按钮调用）',
		input: { hint: '<任务 id>' },
		recordInput: false,
		async handler({ rawInput }) {
			const id = text(rawInput).trim();
			const task = await readTask(id);
			if (task === undefined) return { kind: 'error', text: `没有这个任务：${id}` };
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
		description: '用户打回一个任务（面板按钮调用）',
		input: { hint: '<任务 id>' },
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

function registerExtraTools(ctx) {
	ctx.tools.register(
		defineTool({
			name: 'task_template',
			description:
				'取一种任务模板（GitHub issue forms 的 YAML）。写任务前先取模板，按 body 里的字段填。' +
				`可选模板：${typeCatalog()}。` +
				'每个模板声明了 default_kind（默认大类）与 behavior（界面形态）。' +
				'给了 `from`（派生来源 id）时，会同时列出该派生来源允许派发的模板——' +
				'不允许的会说明原因（例如工作不能再派另一件要做的事）。',
			parameters: {
				type: { type: 'string', required: true, description: `${TYPES.join('/')}` },
				from: { type: 'string', description: '派生来源 id；给了就一并校验能否派发' },
			},
			output: {
				schema: { type: 'object', additionalProperties: false, properties: { text: { type: 'string' } } },
				render: (_args, value) => [{ type: 'text', text: value.text }],
			},
			async execute(args) {
				const yaml = await loadTemplate(args.type);
				const fromId = String(args.from ?? '').trim();
				if (fromId === '') return { text: yaml };
				/* 顺带把"这个模板能不能挂在那个派生来源下"一起回答，
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
				'列出某个任务下面**允许派发**哪些模板（以及为什么另一些不行）。' +
				'判定三层：大类规则（工作不能派另一件要做的事）、父模板的 dispatch 收窄、子模板的 default_kind。' +
				'不给 id 时返回全部模板（等于没限制）。',
			parameters: { id: { type: 'string', description: '派生来源 id，例如 WI-01；空 = 全部模板' } },
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
					lines.push('全部可用模板（没指定派生来源，等于没限制）：');
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
				'改一个任务的状态（九态）：未指定 / 提交 / 处理中 / 需要信息 / 需要授权 / 成功 / 失败 / 取消 / 拒绝。' +
				'改「成功」时，进行态的派生任务会被自动取消；改「需要信息 / 需要授权」时，进行态的派生任务转「需要授权」。' +
				'可选 note 一起写下理由（搁置时最该填：为什么需要授权 / 为什么缺信息）。',
			parameters: {
				id: { type: 'string', required: true, description: '任务 id，例如 MG-01' },
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
				'读一个任务的事件历史（时间、谁改的、状态从什么变成什么、备注）。**只读**，不改任何东西。' +
				'老事件没有时间戳/actor 时显示为「—」。',
			parameters: {
				id: { type: 'string', required: true, description: '任务 id，例如 MG-01' },
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
			name: 'task_workgroup',
			description:
				'管理「工作组」：**一个工作组 = 一件事 / 一个项目**，不是主题分类。' +
				'用户原话：「分组是没有关联的事情。一个程序做的怎么样跟另一个程序无关。' +
				'而用户一个时候只会验收一个程序，只有一个主要目标。」' +
				'**硬规则：一个任务只能属于一个工作组，且建好后不能迁移**（工作组代表' +
				'"这件事是哪次工作里提出的"，事后改归属会让历史失真）。' +
				'action：list 列出 / create 新建 / rename 改名 / add 认领成员 / delete 删除。',
			parameters: {
				action: { type: 'string', required: true, description: 'list/create/rename/add/delete' },
				group: { type: 'string', description: '分组 id（create 时可留空自动编号）' },
				name: { type: 'string', description: '分组名字（create/rename 用）' },
				ids: { type: 'string', description: '成员 id，逗号分隔（add 用）' },
			},
			output: {
				schema: { type: 'object', additionalProperties: false, properties: { text: { type: 'string' } } },
				render: (_args, value) => [{ type: 'text', text: value.text }],
			},
			async execute(args) {
				const action = String(args.action ?? '').trim();
				const groups = await listWorkgroups();
				if (action === 'list') {
					if (groups.length === 0) return { text: '还没有分组。用 task_workgroup action=create name=… 建一个。' };
					const current = await readCurrentWorkgroup(currentSessionId());
					const lines = groups.map((group) => {
						const mark = group.id === current ? '★ ' : '  ';
						const sample = group.members.slice(0, 6).join(', ');
						const more = group.members.length > 6 ? ` 等 ${group.members.length} 条` : '';
						return `${mark}${group.id} · ${group.name}（${group.members.length} 条）${sample ? '：' + sample + more : ''}`;
					});
					const head = current === '' ? '（还没设当前分组；用 action=select 设一个）' : `当前分组：${current}`;
					return { text: `${head}\n共 ${groups.length} 个分组：\n` + lines.join('\n') };
				}
				if (action === 'select') {
					/* 设 / 取消激活当前分组。
					 *
					 * 用户原话：
					 *   「需要有一个当前组。工具的查找是默认对当前组里面找的。」
					 *   「最多有一个当前组。但可以没有激活的。」
					 *
					 * 所以传空 = 取消激活。取消之后 task_list 不带 group
					 * 就只是"列出有哪些组"，不是"看全部任务"。 */
					const wanted = String(args.group ?? '').trim();
					if (wanted === '') {
						await writeCurrentWorkgroup('', currentSessionId());
						return { text: '已取消激活的分组（现在没有当前组；tool 调用要显式传 group）' };
					}
					const hit = groups.find((entry) => entry.id === wanted);
					if (hit === undefined) {
						throw new Error(`没有这个分组：${wanted}。现有：${groups.map((entry) => `${entry.id}（${entry.name}）`).join(' / ') || '（没有）'}`);
					}
					await writeCurrentWorkgroup(hit.id, currentSessionId());
					return { text: `当前分组已设为 ${hit.id} · ${hit.name}（${hit.members.length} 条）` };
				}
				if (action === 'create') {
					const name = String(args.name ?? '').trim();
					if (name === '') throw new Error('create 需要 name');
					/* 编号：g-1、g-2…取当前最大值 +1 */
					const used = groups
						.map((group) => Number(/^g-(\d+)$/u.exec(group.id)?.[1] ?? 0))
						.filter((value) => Number.isFinite(value));
					const id = `g-${used.length === 0 ? 1 : Math.max(...used) + 1}`;
					await saveWorkgroup({ id, name, members: [] });
					return { text: `已建分组 ${id} · ${name}` };
				}
				const id = String(args.group ?? '').trim();
				const found = groups.find((item) => item.id === id);
				if (found === undefined) throw new Error(`没有这个分组：${id}`);
				if (action === 'rename') {
					const name = String(args.name ?? '').trim();
					if (name === '') throw new Error('rename 需要 name');
					await saveWorkgroup({ id, name, members: found.members, createdAt: found.createdAt });
					return { text: `分组 ${id} 改名为「${name}」` };
				}
				if (action === 'delete') {
					/* 删除 = 把名字记成墓碑，面板会过滤掉。成员不删，任务本身还在。 */
					await saveWorkgroup({ id, name: '', members: [], createdAt: found.createdAt });
					return { text: `已删除分组 ${id}（成员任务本身没动）` };
				}
				if (action === 'add') {
					const wanted = String(args.ids ?? '')
						.split(/[,，\s]+/u)
						.map((part) => part.trim())
						.filter((part) => part !== '');
					if (wanted.length === 0) throw new Error('add 需要 ids');
					/* **一个任务只能属于一个分组，且不能迁移。**
					 *
					 * 用户原话：「任务只能在一个组里面创建。……
					 * 但任务是不能迁移到另一个组的。」
					 *
					 * 所以这里不是"加进去"，是**认领**：已被别的组认领的直接拒绝，
					 * 并告诉它现在在哪。这样分组代表的事实是稳定的——
					 * 一个任务的归属不会因为后来有人点了另一个组而变。 */
					const taken = new Map();
					for (const group of groups) {
						if (group.id === id) continue;
						for (const member of group.members) taken.set(member, group.id);
					}
					const conflicts = wanted.filter((member) => taken.has(member));
					if (conflicts.length > 0) {
						const detail = conflicts.map((member) => `${member} 已在 ${taken.get(member)}`).join('、');
						throw new Error(
							`这些任务已经属于别的分组，不能迁移（${detail}）。\n` +
								'分组代表"这件事是哪次工作里提出的"，事后改归属会让历史失真。',
						);
					}
					const members = new Set(found.members);
					for (const member of wanted) members.add(member);
					await saveWorkgroup({ id, name: found.name, members: [...members], createdAt: found.createdAt });
					return { text: `分组 ${id} · ${found.name} 现在有 ${members.size} 条（认领了 ${wanted.length} 条）` };
				}
				throw new Error(`不认识的 action：${action}`);
			},
		}),
	);

	ctx.tools.register(
		defineTool({
			name: 'task_answer',
			description:
				'回答设计类任务里的**某一个开放问题**（正文「要定的点 / 待定」小标题下编号的那些）。' +
				'与 task_note 的区别：note 是一整段自由结论，answer 是**逐条应答**，' +
				'面板会把它们渲染成一问一答，能看出哪几条还没答。' +
				'question 用编号（"1" / "2"），空字符串表示删掉这条回答。',
			parameters: {
				id: { type: 'string', required: true, description: '任务 id，例如 DP-05' },
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
			name: 'task_flag',
			description:
				'给任务打**标记**（与状态正交，四个固定枚举）。' +
				'unread（新建/被改动，我没看过）/ read（看过了）/ ' +
				'needs-me（卡在我这里，等我动手）/ needs-review（我做的，等你审）。' +
				'与状态的区别：「已读」不是生命周期的一部分——一件「处理中」的任务可以已读也可以未读；' +
				'而「需要处理」可能对应多个状态（需要授权/待选/需要信息），语义都是"等我"。' +
				'read 与 unread 互斥（后设的覆盖前一个）。给空数组表示清空全部标记。',
			parameters: {
				id: { type: 'string', required: true, description: '任务 id' },
				flags: { type: 'string', required: true, description: '逗号分隔的标记；空串 = 清空' },
			},
			output: {
				schema: { type: 'object', additionalProperties: false, properties: { text: { type: 'string' } } },
				render: (_args, value) => [{ type: 'text', text: value.text }],
			},
			async execute(args) {
				const list = parseFlags(args.flags);
				const task = await setFlags(args.id, list);
				const now = parseFlags(task.flags);
				return {
					text:
						now.length === 0
							? `已清空 ${task.id} 的标记`
							: `${task.id} 的标记：${now.join(', ')}`,
				};
			},
		}),
	);

	ctx.tools.register(
		defineTool({
			name: 'task_tag',
			description:
				'给任务打**标签**（多个，自由字符串）。与分组的区别：' +
				'分组 = 这件事属于哪次工作（一个，不能改）；tag = 这条讲的是什么（多个，随便加）。' +
				'用途（用户原话）：「他可以被标记为什么 tag，例如用户风格。' +
				'让 ai 看不是当前任务组的时候知道看什么。' +
				'也可以看里面有没有描述了现在用的库的使用方法。」' +
				'给空数组表示清掉全部标签。',
			parameters: {
				id: { type: 'string', required: true, description: '任务 id' },
				tags: { type: 'string', required: true, description: '标签，逗号分隔；空串 = 清空' },
			},
			output: {
				schema: { type: 'object', additionalProperties: false, properties: { text: { type: 'string' } } },
				render: (_args, value) => [{ type: 'text', text: value.text }],
			},
			async execute(args) {
				const list = String(args.tags ?? '')
					.split(/[,，\s]+/u)
					.map((tag) => tag.trim())
					.filter((tag) => tag !== '');
				const task = await setTags(args.id, list);
				return {
					text:
						(task.tags ?? []).length === 0
							? `已清空 ${task.id} 的标签`
							: `${task.id} 的标签：${(task.tags ?? []).join('、')}`,
				};
			},
		}),
	);

	ctx.tools.register(
		defineTool({
			name: 'task_note',
			description:
				'改一个任务的备注（附加信息 / 搁置理由）。**不受「只有未指定可改」的限制**——' +
				'进行中的任务也能补一句「我在等什么」。空字符串表示清空备注。',
			parameters: {
				id: { type: 'string', required: true, description: '任务 id，例如 MG-01' },
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

	/*
	 * task_progress —— 写一个「进展」章节。
	 *
	 * 和 task_update 的区别：那个有一道锁，只有「未指定」能改。
	 * 这个**没有锁**，任务采纳之后能写、终结之后也能写。
	 *
	 * 因为它本来就是"随时间变化"的东西：AI 自己定的阶段目标、阶段性进展。
	 * 写一次就锁死的话它就没意义了。
	 */
	ctx.tools.register(
		defineTool({
			name: 'task_progress',
			description:
				'写一个"进展"章节。**不受「只有未指定可改」的限制** —— 任务采纳之后能写，' +
				'终结之后也能写。只有模板里标了 aiWritable: true 的章节允许。' +
				'用来记：我自己定的阶段目标、阶段性进展、卡住时的临时说明。',
			parameters: {
				id: { type: 'string', required: true, description: '任务 id' },
				section: { type: 'string', required: true, description: '章节 id（模板里那一章的 id）' },
				value: { type: 'string', required: true, description: '写什么；空串 = 清空' },
			},
			output: {
				schema: { type: 'object', additionalProperties: false, properties: { text: { type: 'string' } } },
				render: (_args, value) => [{ type: 'text', text: value.text }],
			},
			async execute(args) {
				const task = await setProgress(args.id, args.section, args.value);
				const written = String(task.body?.[String(args.section)]?.value ?? '');
				return {
					text:
						written === ''
							? `已清空 ${task.id} 的「${args.section}」`
							: `已写入 ${task.id} 的「${args.section}」（${written.length} 字）`,
				};
			},
		}),
	);
}

function registerExtraCommands(ctx) {
	ctx.commands.register({
		name: 'task-history',
		description: '输出一个任务的事件历史 JSON（面板读取时间线）',
		input: { hint: '<任务 id> [limit]' },
		recordInput: false,
		async handler({ rawInput }) {
			const parts = String(rawInput ?? '').trim().split(/\s+/u);
			if (parts.length < 1 || parts[0] === '') return { kind: 'error', text: '用法：/task-history <任务 id> [limit]' };
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

	   留着它是因为它对**人**有用：想看任务库落在哪、或者宿主按 $DSH_HOME
	   解析到了什么位置，敲一下就知道。 */
	ctx.commands.register({
		name: 'task-paths',
		description: '输出任务库与模板的绝对路径（人工排查用；面板不依赖它）',
		recordInput: false,
		async handler() {
			return {
				kind: 'success',
				text: JSON.stringify({
					store: storeFilePath(),
					templates: templateDir(),
					home: resolveDshHome(),
				}),
			};
		},
	});

	/*
	 * 模板索引文件：`templates/INDEX.json`。
	 *
	 * 为什么需要它：面板要拿模板清单，但**不能用命令通道**——
	 * 命令通道每调用一次就往会话日志写一对 `command/run` + `command/done`，
	 * 它们会渲染成聊天流里的系统消息。用户点一下「新建」就冒出一条
	 * `>_ task-templates [{...}]`，非常干扰。
	 *
	 * 所以：宿主在启动时把清单落成**一个静态 JSON 文件**，
	 * 面板用文件通道读它（纯读，不进日志）。清单里带 yaml 全文，
	 * 面板读一次就够了，不用再逐个读 27 个 .yml。
	 *
	 * 文件在 `templates/` 里，所以模板目录是唯一真源这一点不变。
	 */
	ctx.effect(() => {
		const writeIndex = async () => {
			/*
			 * availableTypes() 本身也可能抛（templates 服务还没就绪、
			 * 或者 core 拿不到模板表）。它原来不在 try 里，一抛就整个
			 * writeIndex 中断 —— 而调用点是 `void writeIndex()`，
			 * 未处理的 rejection 被静默吞掉，于是 INDEX.json 永远不更新，
			 * 面板就报「读不到模板」。
			 */
			const out = [];
			let types = [];
			try {
				types = await availableTypes();
			} catch (error) {
				process.stderr.write(`[taskboard] 取模板类型失败：${String(error)}\n`);
				types = [];
			}
			for (const type of types) {
				try {
					const yaml = await loadTemplate(type);
					/*
					 * 带上 `domain`，客户端要靠它做那三个开关的过滤。
					 *
					 * 宿主自己**不按开关过滤**——它拿不到解析后的 config
					 * （`default(true).volatile()` 的布尔字段传进来是 `{}`，
					 * 值丢了，见 templates 包里的说明）。所以宿主只管把
					 * 全集交出去，过滤留给拿得到真值的客户端。
					 */
					const hit = String(yaml)
						.split('\n')
						.slice(0, 20)
						.find((line) => line.startsWith('domain:'));
					const domain = hit === undefined ? 'core' : hit.slice('domain:'.length).trim();
					out.push({ type, domain, yaml });
				} catch (error) {
					out.push({ type, domain: 'core', yaml: '' });
				}
			}
			/*
			 * **写两份，内容一样。**
			 *
			 * 第一份在模板目录里（`core/templates/INDEX.json`）——
			 * 那是模板自己的家，人看得也方便。
			 *
			 * 第二份在**数据目录**（`~/.dsh/taskboard/templates.json`）——
			 * 这一份是给面板用的。面板跑在浏览器里，拿不到 `import.meta.url`，
			 * 没法像宿主那样从包位置推导模板目录。它原来把
			 * `X:\temp\dsh\开发\taskboard\packages` **写死**在源码里，
			 * 换台机器、换个安装位置就瞎了。
			 *
			 * 而数据目录面板本来就知道（它已经在读同目录的 plans.jsonl /
			 * groups.jsonl / current.json），所以放这里它一定找得到。
			 */
			const payload = JSON.stringify(out);
			try {
				await writeFile(join(templateDir(), 'INDEX.json'), payload, 'utf8');
			} catch (error) {
				process.stderr.write(`[taskboard] 写模板索引失败：${String(error)}\n`);
			}
			try {
				/*
				 * 数据目录 = store 文件所在目录。store 路径由 store 包决定，
				 * 这里不另猜一份，直接问它拿，保证两边永远一致。
				 */
				const dataDir = dirname(storeFilePath());
				await mkdir(dataDir, { recursive: true });
				await writeFile(join(dataDir, 'templates.json'), payload, 'utf8');
			} catch (error) {
				process.stderr.write(`[taskboard] 写模板清单失败：${String(error)}\n`);
			}
		};
		/*
		 * 写索引的**时机**很要紧。
		 *
		 * availableTypes() 靠 TEMPLATES_SERVICE，而 templates 是独立插件，
		 * 它注册提供者的时机不保证在 tools 之前。第一次写的时候如果它还没就绪，
		 * 只会写出内置那 4 个 —— 正是之前「只有 4 项」的原因。
		 *
		 * 所以：先写一次，再隔一会儿写一次；数量变了就再写，直到稳定。
		 * 三次足够（实测第二轮就齐了），失败不重试（写不出来是配置问题，不是时序）。
		 */
		/*
		 * 常驻监听，不是"写几次就停"。
		 *
		 * 模板清单会**在运行期变**：
		 *   · 用户在插件页关掉 templates 包 → 领域模板整体消失
		 *   · 在模板的配置里关掉「绘画」→ 只剩代码/小说/通用
		 *   · 新建 / 删除模板文件
		 *
		 * 原来写 5 次就返回，只在启动时正确；之后用户改开关，
		 * 面板读到的还是那份旧清单 —— 表现就是「关掉模板插件，
		 * 绘画类的『上色』模板还在」。
		 *
		 * 现在改成每秒查一次 availableTypes() 的签名，变了就重写。
		 * 查询是纯内存的（读一个数组长度 + 拼接），代价可以忽略；
		 * 真正的写盘只在变化时发生。
		 */
		const signature = async () => {
			try {
				return (await availableTypes()).join(',');
			} catch (error) {
				return '';
			}
		};
		const watch = async () => {
			let last = '';
			/*
			 * 先查 alive 再睡，不是睡完再查。
			 *
			 * 原来的顺序是 `sleep(1000) → if (!alive) return`，
			 * 清理函数把 alive 置 false 之后，循环还会**再跑一轮**：
			 * 多一次 signature() + 可能的 writeIndex()。
			 * 单次代价不大，但 effect 反复挂载/卸载时会累积，
			 * 而且写盘发生在插件已经卸载之后，属于不该有的副作用。
			 */
			while (alive) {
				const now = await signature();
				if (now !== last) {
					await writeIndex();
					last = await signature();
				}
				await new Promise((resolve) => setTimeout(resolve, 1000));
			}
		};
		let alive = true;
		watch().catch((error) => {
			process.stderr.write(`[taskboard] 写模板索引异常：${String(error)}\n`);
		});
		return () => {
			alive = false;
		};
	});


	ctx.commands.register({
		name: 'task-archive',
		description: '归档 / 取消归档一个任务（连它的整棵子树）。面板调用；JSON：{id,archived}',
		input: { hint: '{"id":"T-001","archived":true}' },
		recordInput: false,
		async handler({ rawInput }) {
			let parsed = null;
			try {
				parsed = JSON.parse(String(rawInput ?? '').trim() || '{}');
			} catch (error) {
				return { kind: 'error', text: '参数不是合法 JSON' };
			}
			const id = String(parsed?.id ?? '').trim();
			if (id === '') return { kind: 'error', text: '要说明归档哪个任务' };
			try {
				const touched = await archiveSubtree(id, parsed?.archived === true);
				return {
					kind: 'success',
					text: JSON.stringify({ archived: parsed?.archived === true, count: touched.length, ids: touched }),
				};
			} catch (error) {
				return { kind: 'error', text: String((error && error.message) || error) };
			}
		},
	});

	ctx.commands.register({
		name: 'task-workgroup-list',
		description: '输出全部分组（面板读；JSON：[{id,name,members}]）',
		recordInput: false,
		async handler() {
			/* 名字为空 = 墓碑（已删除），不返回给面板。 */
			const groups = (await listWorkgroups()).filter((group) => group.name !== '');
			return { kind: 'success', text: JSON.stringify(groups) };
		},
	});

	ctx.commands.register({
		name: 'task-workgroup-archive',
		description: '归档 / 取回一个分组（面板调用；JSON：{group,archived}）。任务数据不动。',
		input: { hint: '{"group":"g-1","archived":true}' },
		recordInput: false,
		async handler({ rawInput }) {
			let parsed = null;
			try {
				parsed = JSON.parse(String(rawInput ?? '').trim() || '{}');
			} catch (error) {
				return { kind: 'error', text: '参数不是合法 JSON' };
			}
			const wanted = String(parsed?.group ?? '').trim();
			if (wanted === '') return { kind: 'error', text: '要说明归档哪个分组' };
			const groups = (await listWorkgroups()).filter((entry) => entry.name !== '');
			const hit = groups.find((entry) => entry.id === wanted);
			if (hit === undefined) return { kind: 'error', text: `没有这个分组：${wanted}` };
			await saveWorkgroup({
				id: hit.id,
				name: hit.name,
				members: hit.members,
				createdAt: hit.createdAt,
				archived: parsed?.archived === true,
			});
			return {
				kind: 'success',
				text: JSON.stringify({ group: hit.id, archived: parsed?.archived === true, members: hit.members.length }),
			};
		},
	});

	ctx.commands.register({
		name: 'task-workgroup-select',
		description: '设置「当前分组」（面板切换分组时调用；JSON：{group}，空 = 清空）',
		input: { hint: '{"group":"g-2"}' },
		recordInput: false,
		async handler({ rawInput }) {
			let parsed = null;
			try {
				parsed = JSON.parse(String(rawInput ?? '').trim() || '{}');
			} catch (error) {
				return { kind: 'error', text: '参数不是合法 JSON' };
			}
			const wanted = String(parsed?.group ?? '').trim();
			if (wanted === '') {
				await writeCurrentWorkgroup('', parsed?.session);
				return { kind: 'success', text: JSON.stringify({ group: '' }) };
			}
			const groups = (await listWorkgroups()).filter((entry) => entry.name !== '');
			const hit = groups.find((entry) => entry.id === wanted);
			if (hit === undefined) return { kind: 'error', text: `没有这个分组：${wanted}` };
			await writeCurrentWorkgroup(hit.id, parsed?.session);
			return { kind: 'success', text: JSON.stringify({ group: hit.id, name: hit.name }) };
		},
	});

	ctx.commands.register({
		name: 'task-workgroup-save',
		description: '面板保存分组（JSON：{id?,name,members}；id 空 = 新建）',
		input: { hint: '{"name":"插件开发","members":["WI-01"]}' },
		recordInput: false,
		async handler({ rawInput }) {
			let parsed = null;
			try {
				parsed = JSON.parse(String(rawInput ?? '').trim() || '{}');
			} catch (error) {
				return { kind: 'error', text: '参数不是合法 JSON' };
			}
			const name = String(parsed?.name ?? '').trim();
			if (name === '') return { kind: 'error', text: '分组要有名字' };
			const members = Array.isArray(parsed?.members) ? parsed.members.map(String) : [];
			let id = String(parsed?.id ?? '').trim();
			if (id === '') {
				const groups = await listWorkgroups();
				const used = groups
					.map((group) => Number(/^g-(\d+)$/u.exec(group.id)?.[1] ?? 0))
					.filter((value) => Number.isFinite(value));
				id = `g-${used.length === 0 ? 1 : Math.max(...used) + 1}`;
			}
			const existing = (await listWorkgroups()).find((group) => group.id === id);
			await saveWorkgroup({ id, name, members, createdAt: existing?.createdAt });
			return { kind: 'success', text: JSON.stringify({ id, name, members }) };
		},
	});

	ctx.commands.register({
		name: 'task-dispatch',
		description: '列出某个任务下面允许派发的模板（面板读；JSON：{id} → {allowed,blocked}）',
		input: { hint: '{"id":"WI-01"}' },
		recordInput: false,
		async handler({ rawInput }) {
			let id = '';
			try {
				const parsed = JSON.parse(String(rawInput ?? '').trim() || '{}');
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
			for (const type of await availableTypes()) {
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
		description: '新建一个任务（面板调用；JSON：{title,type,body,parent,workspace,workspaces,permission,status}）',
		input: { hint: '{"title":"…","type":"C","body":"…"}' },
		recordInput: false,
		async handler({ rawInput }) {
			try {
				const input = JSON.parse(String(rawInput ?? '{}'));
				const type = normalizeType(input.type);
				if (type !== '' && !allTypes().includes(type)) return { kind: 'error', text: `type 必须是 ${allTypes().join('/')}，或留空（空模板）` };
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
					links: normalizeLinks(input.links),
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
		description: '取一个任务的全文 JSON（面板读取正文）',
		input: { hint: '<任务 id>' },
		recordInput: false,
		async handler({ rawInput }) {
			const task = await readTask(String(rawInput ?? '').trim());
			if (task === undefined) return { kind: 'error', text: `没有这个任务：${rawInput}` };
			return { kind: 'success', text: JSON.stringify(task) };
		},
	});
	ctx.commands.register({
		name: 'task-answer',
		description: '回答某一条开放问题（面板调用；JSON：{id,question,answer}）',
		input: { hint: '{"id":"DP-05","question":"1","answer":"…"}' },
		recordInput: false,
		async handler({ rawInput }) {
			let parsed = null;
			try {
				parsed = JSON.parse(String(rawInput ?? '').trim() || '{}');
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
		description: '改一个任务的备注 / 搁置理由（面板调用；不受「只有未指定可改」限制）',
		input: { hint: '<任务 id> <备注文本>' },
		recordInput: false,
		async handler({ rawInput }) {
			const raw = String(rawInput ?? '').trim();
			/* 备注本身含空格，所以只把第一段当 id，其余整段是正文。 */
			const cut = raw.indexOf(' ');
			if (cut <= 0) return { kind: 'error', text: '用法：/task-note <任务 id> <备注文本>' };
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
		description: '改一个任务的状态（面板调用；九态之一）',
		input: { hint: '<任务 id> <状态> [备注]' },
		recordInput: false,
		async handler({ agent, rawInput }) {
			const raw = String(rawInput ?? '').trim();
			const parts = raw.split(/\s+/u);
			if (parts.length < 2) return { kind: 'error', text: '用法：/task-state <任务 id> <状态> [备注]' };
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


function registerUpdate(ctx) {
	ctx.tools.register(
		defineTool({
			name: 'task_update',
			description:
				'改一份已有任务的内容（标题 / 类型 / 派生来源 / 关联 / 子工作空间 / 权限 / 正文）。只改内容，不改状态——状态用 task_state。',
			parameters: {
				id: { type: 'string', required: true, description: '任务 id，例如 SQ-01' },
				title: { type: 'string', description: '新标题' },
				type: { type: 'string', description: 'A/B/C/D/R/F，或空串表示空模板' },
				kind: { type: 'string', description: 'goal/design/record/work；空则按 type 推断' },
				body: {
					/* 和 task_submit 一样：对象（按章节 id 索引）或字符串（旧 Markdown）。 */
					type: 'json',
					description: '新正文。对象形态按章节 id 索引，字符串形态是旧的 Markdown 全文。',
				},
				parent: { type: 'string', description: '派生来源 id，空 = 顶层' },
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
				/*
				 * 逐个字段取，但**不要一律 String()** ——
				 * `body` 可能是对象，`String(obj)` 会得到 "[object Object]"。
				 * 所以 body 单独处理，其余仍是字符串字段。
				 */
				for (const field of ['title', 'type', 'kind', 'parent', 'links', 'workspace', 'workspaces', 'permission', 'deny']) {
					if (args[field] !== undefined) patch[field] = String(args[field]);
				}
				if (patch.type !== undefined) {
					patch.type = patch.type.toUpperCase();
					if (patch.type !== '' && !allTypes().includes(patch.type)) throw new Error(`type 必须是 ${allTypes().join('/')} 或留空`);
				}
				/* 正文：改了才校验，校验用的是**改完之后的 type**（可能同时改了 type）。 */
				if (args.body !== undefined) {
					let wantedType = patch.type;
					if (wantedType === undefined) {
						const current = await readTask(args.id);
						wantedType = current === undefined ? '' : String(current.type ?? '');
					}
					const bodyCheck = await checkBody(args.body, {
						type: wantedType,
						loadTemplate: (wanted) => loadTemplate(wanted),
					});
					if (!bodyCheck.ok) throw new Error(`task_update: 正文不合法 —— ${bodyCheck.reason}`);
					patch.body = bodyCheck.body;
				}
				const task = await updateTask(args.id, patch);
				return { text: `已更新 ${task.id}：${task.title}` };
			},
		}),
	);

	ctx.commands.register({
		name: 'task-update',
		description: '改一份已有任务的内容（面板调用；JSON：{id,title?,type?,body?,parent?,links?,workspace?,permission?}）',
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
/*
 * ── 插件入口 ───────────────────────────────────────────────────────────
 *
 * inject 里带了 `taskboardCore`，所以进到这里时 core 一定已经就绪。
 * 注册面：14 个工具 + 面板命令 + 系统提示。
 */
export function apply(ctx) {
	CORE = ctx.taskboardCore;

	registerTools(ctx);
	registerCommands(ctx);
	registerExtraTools(ctx);
	registerExtraCommands(ctx);
	registerUpdate(ctx);

	/* 系统提示：告诉模型这套工具怎么用。 */
	try {
		const prompts = ctx.get('systemPrompt');
		if (prompts && typeof prompts.section === 'function') {
			ctx.effect(() => prompts.section({ name: 'taskboard', order: 60, text: promptText() }));
		}
	} catch (failure) {
		/* 没有 systemPrompt 服务时只是少一段约定，不影响工具 */
	}
}
