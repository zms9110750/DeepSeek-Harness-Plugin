/**
 * taskboard 宿主插件的单元测试（JSONL 存储版）：不开 DSH、不碰真实任务库。
 *
 * 做法：
 *   · 桩 ctx 只收集 tools / commands / guard / effect / provide 注册项，然后直接调用
 *     注册出来的 execute / handler —— 插件本身不依赖宿主的调度；
 *   · 存储是单个 JSONL（index.js 里 `STORE_FILE = process.env.TASKBOARD_STORE || …`，
 *     默认 `%USERPROFILE%\.dsh\taskboard\plans.jsonl`）。测试把 `TASKBOARD_STORE` 指到
 *     `node:os` 临时目录，老格式（`任务\*.md`）迁移源 `TASKBOARD_ROOT` 也一起指过去，
 *     所以真实存储与真实 `任务\` 一个字节都不会被写；跑完还会复查真实 plans.jsonl 没变。
 *   · `@deepseek-ai/dsh-tools` 从当前 DSH profile 里解析（插件是 link 进 profile 的，
 *     从 `开发\taskboard` 直接 import 时 Node 往上找不到 node_modules，这里用
 *     `module.registerHooks` 把裸导入接到 profile 里的真包）。
 *
 * 跑法（在 `开发/taskboard` 下）：
 *   C:\Users\16229\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe --test test/taskboard.test.mjs
 */
import { after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire, registerHooks } from 'node:module';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PLUGIN_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const INDEX = join(PLUGIN_DIR, 'index.js');

/* ── 1. 先把 dsh-tools 的裸导入接到 profile 里的真包 ─────────────────────── */

function locateDshTools() {
	const home = process.env.DSH_HOME ?? join(homedir(), '.dsh');
	const profile = process.env.DSH_PROFILE ?? 'desktop';
	const candidates = [
		process.env.DSH_PROFILE_DIR,
		process.env.DSH_PROFILE_DIR === undefined
			? undefined
			: join(process.env.DSH_PROFILE_DIR, '..', profile),
		join(home, 'profiles', profile),
		join(home, 'profiles', 'desktop'),
	].filter((entry) => entry !== undefined);
	for (const dir of candidates) {
		try {
			return createRequire(join(dir, 'package.json')).resolve('@deepseek-ai/dsh-tools');
		} catch {
			/* 换下一个候选 */
		}
	}
	throw new Error(
		'找不到 @deepseek-ai/dsh-tools：需要设 DSH_HOME / DSH_PROFILE_DIR 指向已安装 DSH 的 profile',
	);
}

const DSH_TOOLS = locateDshTools();
registerHooks({
	resolve(specifier, context, nextResolve) {
		if (specifier === '@deepseek-ai/dsh-tools') {
			return { url: pathToFileURL(DSH_TOOLS).href, shortCircuit: true };
		}
		return nextResolve(specifier, context);
	},
});

/* ── 2. 把存储与老格式迁移源都指到临时目录，再 import 插件 ──────────────── */

/* 安全闸：两个环境变量必须还被 index.js 认，否则测试会写真实存储/真实任务目录。 */
const pluginSource = readFileSync(INDEX, 'utf8');
assert.match(
	pluginSource,
	/process\.env\.TASKBOARD_STORE/u,
	'index.js 的存储路径必须可被 TASKBOARD_STORE 覆盖，测试不碰真实 plans.jsonl',
);
assert.match(
	pluginSource,
	/process\.env\.TASKBOARD_ROOT/u,
	'index.js 的迁移源必须可被 TASKBOARD_ROOT 覆盖，测试不碰真实 任务\\ 目录',
);

const TMP_ROOT = mkdtempSync(join(tmpdir(), 'taskboard-test-'));
process.env.TASKBOARD_ROOT = TMP_ROOT;
process.env.TASKBOARD_STORE = join(TMP_ROOT, 'plans.jsonl');
/* 分组、当前组也要隔离：它们的默认路径是 ~/.dsh/taskboard/，
   不覆盖的话测试会读到真实的 groups.jsonl / current.json，
   于是"当前组"指向一个测试里不存在的分组。 */
process.env.TASKBOARD_GROUPS = join(TMP_ROOT, 'groups.jsonl');
process.env.TASKBOARD_CURRENT = join(TMP_ROOT, 'current.json');

const STORE_PATH = process.env.TASKBOARD_STORE;
assert.ok(process.env.TASKBOARD_STORE.startsWith(TMP_ROOT), '存储必须在临时目录里');

/** 真实存储与真实老目录：跑完复查，证明测试没写它们。 */
const REAL_STORE = join(homedir(), '.dsh', 'taskboard', 'plans.jsonl');
const REAL_LEGACY = 'X:\\temp\\dsh\\任务';

const plugin = await import(pathToFileURL(INDEX).href);
/* apply() 里有一次不 await 的 refreshClaims()，等它落定再开始用例，避免首条用例被插队。 */
await new Promise((resolve) => setTimeout(resolve, 50));

/* ── 3. 桩 ctx ─────────────────────────────────────────────────────────── */

/** 只做注册、不做调度的桩 ctx；把注册面暴露出来给断言/直接调用。 */
function makeCtx() {
	const tools = new Map();
	const commands = new Map();
	const guards = [];
	const effects = [];
	const emitted = [];
	const services = new Map();
	const ctx = {
		tools: {
			register(definition) {
				tools.set(definition.name, definition);
			},
			guard(fn) {
				guards.push(fn);
			},
		},
		commands: {
			register(definition) {
				commands.set(definition.name, definition);
			},
		},
		permissionPresets: { presets: {} },
		sessionProjections: {
			stateOf() {
				return undefined;
			},
		},
		effect(callback, label) {
			const dispose = callback();
			effects.push({ label, dispose });
			return () => {};
		},
		emit(type) {
			emitted.push(type);
		},
		provide(name, value) {
			services.set(name, value);
			ctx[name] = value;
		},
		get(name) {
			return services.get(name);
		},
	};
	plugin.apply(ctx);
	return { ctx, tools, commands, guards, effects, emitted };
}

const { ctx, tools, commands, guards, effects, emitted } = makeCtx();

/** 取注册出来的模型工具。 */
function tool(name) {
	const definition = tools.get(name);
	assert.ok(definition, `没有注册工具 ${name}`);
	return definition;
}

/** 取注册出来的斜杠命令。 */
function command(name) {
	const definition = commands.get(name);
	assert.ok(definition, `没有注册命令 /${name}`);
	return definition;
}

/* ── 4. 存储（JSONL）小工具 ────────────────────────────────────────────── */

/** 读全部事件行；文件不存在 = 没有事件。顺带断言每行都是合法 JSON。 */
function events() {
	let raw = '';
	try {
		raw = readFileSync(STORE_PATH, 'utf8');
	} catch (error) {
		if (error?.code === 'ENOENT') return [];
		throw error;
	}
	return raw
		.split(/\r?\n/u)
		.filter((line) => line.trim() !== '')
		.map((line, index) => {
			try {
				return JSON.parse(line);
			} catch {
				assert.fail(`第 ${index + 1} 行不是合法 JSON：${line}`);
			}
		});
}

/** 按 index.js 的折叠规则（upsert 覆盖，patch 合并）取一份计划的当前值。 */
function taskOf(id) {
	const wanted = String(id);
	let task;
	for (const event of events()) {
		if (event.op === 'upsert' && event.task?.id) {
			if (String(event.task.id) === wanted) task = event.task;
		} else if (event.op === 'patch' && String(event.id) === wanted && task !== undefined) {
			task = Object.assign({}, task, event.patch);
		}
	}
	return task;
}

/** 临时目录里当前有哪些文件。 */
function tmpFiles() {
	return readdirSync(TMP_ROOT).sort();
}

let sessionSeq = 0;
/** 每个用例用独立的会话 id，避免模块内 CLAIMS 缓存跨用例串味。 */
function newSession() {
	sessionSeq += 1;
	return `session-${sessionSeq}`;
}

/* ── 5. 操作小工具 ─────────────────────────────────────────────────────── */

/** 跑一次 task_submit，返回新计划 id。 */
/** 每个用例前确保有一个默认分组（事项必须归组）。 */
async function ensureGroup() {
	const listed = await command('task-group-list').handler({});
	const groups = JSON.parse(listed.text);
	if (groups.length > 0) return groups[0].id;
	const made = await tool('task_group').execute({ action: 'create', name: '测试组' });
	const id = /已建分组 (g-\d+)/u.exec(made.text)?.[1];
	assert.ok(id, `建分组没返回 id：${made.text}`);
	return id;
}

async function submit(overrides = {}) {
	const group = overrides.group !== undefined ? overrides.group : await ensureGroup();
	const result = await tool('task_submit').execute({
		title: '测试计划',
		/* 默认用 D（实现）→ kind=work，因为只有工作能被领取。
		   以前默认 A/C，它们现在属于「设计」，不再参与领取。 */
		type: 'WI',
		body: '## 正文\n一句话正文。',
		...overrides,
		group,
	});
	/* 新编号格式：模板编号 + 流水号，例如 MG-01 / GD-03。 */
	const id = /已提交 ([A-Z]{1,2}-\d+)/u.exec(result.text)?.[1];
	assert.ok(id, `task_submit 没返回计划 id：${result.text}`);
	return id;
}

/** 用户采纳（/task-approve）。 */
async function approve(id) {
	const result = await command('task-approve').handler({ rawInput: id });
	assert.equal(result.kind, 'success', `采纳 ${id} 失败：${result.text}`);
	return result;
}

/** 模型领取（task_claim），带会话 id。 */
async function claim(id, sessionId) {
	return tool('task_claim').execute({ id }, { agent: { id: sessionId } });
}

/** 模型改状态（task_state，byUser=false）。 */
/** 从 /tasks 输出里取某个目标的推导状态（DP-02）。 */
async function derivedOf(id) {
	const listed = await command('tasks').handler({ rawInput: '' });
	const rows = JSON.parse(listed.text);
	const row = rows.find((item) => item.id === id);
	assert.ok(row, `${id} 不在 /tasks 输出里`);
	assert.ok('derived' in row, `/tasks 输出缺 derived 字段：${JSON.stringify(Object.keys(row))}`);
	return row.derived;
}

async function changeState(id, status, note) {
	/* 转「失败」必须有理由载体（WI-01）。这里默认给一句，
	   免得每个用例都要单独补——专门验证拒绝的用例会显式不传。 */
	const args = { id, status };
	if (note !== undefined) args.note = note;
	else if (status === '失败') args.note = '测试用：卡在依赖上，过不去';
	return tool('task_state').execute(args);
}

function escapeRegExp(value) {
	return String(value).replace(/[\\^$.*+?()[\]{}|]/gu, '\\$&');
}

/* ── 6. 每个用例前清空临时存储（id 从 T-001 重新开始，断言稳定） ────────── */

beforeEach(() => {
	for (const entry of readdirSync(TMP_ROOT)) rmSync(join(TMP_ROOT, entry), { recursive: true, force: true });
});

/* 跑完删临时目录，并复查真实存储 / 真实老目录没被碰过。 */
function fileSnapshot(path) {
	try {
		const info = statSync(path);
		return `${info.size}:${info.mtimeMs}`;
	} catch {
		return 'missing';
	}
}

function dirSnapshot(path) {
	try {
		return readdirSync(path)
			.sort()
			.map((name) => {
				try {
					const info = statSync(join(path, name));
					return `${name}:${info.size}:${info.mtimeMs}`;
				} catch {
					return name;
				}
			})
			.join('|');
	} catch {
		return 'missing';
	}
}

const REAL_STORE_BEFORE = fileSnapshot(REAL_STORE);
const REAL_LEGACY_BEFORE = dirSnapshot(REAL_LEGACY);

after(() => {
	for (const effect of effects) {
		try {
			effect.dispose?.();
		} catch {
			/* 卸载失败不影响结论 */
		}
	}
	rmSync(TMP_ROOT, { recursive: true, force: true });
	/* 注意：如果同时还有别的 DSH 会话在写真实库，这里也会失败——那说明有并发写，重跑即可；
	   测试自身只写 TMP_ROOT。 */
	assert.equal(fileSnapshot(REAL_STORE), REAL_STORE_BEFORE, `测试写了真实存储：${REAL_STORE}`);
	assert.equal(dirSnapshot(REAL_LEGACY), REAL_LEGACY_BEFORE, '测试动了真实任务目录 任务\\');
});

/* ── 7. 用例 ───────────────────────────────────────────────────────────── */

test('apply 注册十三个工具、十八条面板命令、「按计划」预设、守卫和 planClaims', () => {
	assert.deepEqual([...tools.keys()].sort(), [
		'task_answer',
		'task_claim',
		'task_dispatch',
		'task_get',
		'task_group',
		'task_history',
		'task_list',
		'task_note',
		'task_state',
		'task_submit',
		'task_tag',
		'task_template',
		'task_update',
	]);
	assert.deepEqual([...commands.keys()].sort(), [
		'task-answer',
		'task-approve',
		'task-archive',
		'task-create',
		'task-dispatch',
		'task-get',
		'task-group-list',
		'task-group-save',
		'task-group-select',
		'task-groups',
		'task-history',
		'task-note',
		'task-paths',
		'task-reject',
		'task-state',
		'task-templates',
		'task-update',
		'tasks',
	]);
	assert.equal(ctx.permissionPresets.presets.plan?.name, '按计划');
	assert.equal(guards.length, 1, '按计划守卫应注册一次');
	assert.ok(emitted.includes('permission-presets/catalog-changed'));
	for (const method of ['claim', 'current', 'release', 'list']) {
		assert.equal(typeof ctx.planClaims?.[method], 'function', `planClaims.${method} 没注册`);
	}
});

test('备注：可写可清空，不受「只有未指定可改」限制，task_state 可顺带写理由', async () => {
	const id = await submit({ title: '需要授权的计划' });
	await approve(id);

	/* 采纳之后（不是「未指定」）仍然能写备注——这正是这个功能的要点 */
	const wrote = await tool('task_note').execute({ id, note: '要花钱买 X，得你点头。' });
	assert.match(wrote.text, /已更新/u);
	assert.equal(taskOf(id).note, '要花钱买 X，得你点头。');

	/* 列表里能看到备注摘要 */
	const listed = await tool('task_list').execute({});
	assert.match(listed.text, /要花钱买 X/u);

	/* task_state 一次写完状态 + 理由 */
	await tool('task_state').execute({
		id,
		status: '需要授权',
		note: '方案 A 要动生产库，代价太大。',
	});
	const stored = taskOf(id);
	assert.equal(stored.status, '需要授权');
	assert.equal(stored.note, '方案 A 要动生产库，代价太大。');

	/* 命令路径：备注含空格也要整段保留 */
	const viaCommand = await command('task-note').handler({
		rawInput: `${id} 用户去吃饭了，等他回来确认预算`,
	});
	assert.equal(viaCommand.kind, 'success');
	assert.equal(taskOf(id).note, '用户去吃饭了，等他回来确认预算');

	/* /task-state 的第三个参数起也是备注（含空格） */
	const stateWithNote = await command('task-state').handler({
		rawInput: `${id} 需要补充 缺三样东西：预算 / 期限 / 验收人`,
	});
	assert.equal(stateWithNote.kind, 'success');
	assert.equal(taskOf(id).status, '需要补充');
	assert.equal(taskOf(id).note, '缺三样东西：预算 / 期限 / 验收人');

	/* 空串清空 */
	await tool('task_note').execute({ id, note: '' });
	assert.equal(taskOf(id).note, '');

	/* 超长拒绝 */
	await assert.rejects(
		() => tool('task_note').execute({ id, note: 'x'.repeat(4001) }),
		/备注太长/u,
	);
});

test('失败必须有理由：没阻碍子事项、也没 note 时拒绝', async () => {
	/* 用户要求：点失败 = 新建 -> 记录 -> 阻碍。
	   理由要有载体，不能是一句空话。 */
	const id = await submit({ title: '会失败的活', type: 'WI' });
	await approve(id);
	await claim(id, newSession());

	/* 什么都没有 → 拒绝，且报错要说清两个办法 */
	await assert.rejects(
		() => tool('task_state').execute({ id, status: '失败' }),
		/得先说明失败的原因/u,
	);
	/* 报错要给出路，不能只说"不允许" */
	await assert.rejects(
		() => tool('task_state').execute({ id, status: '失败' }),
		/派一条记录/u,
	);
	assert.equal(taskOf(id).status, '处理中', '被拒后状态不变');

	/* 出路 1：派一条记录（阻碍） */
	await submit({ title: '卡在没有梯子', type: 'RB', parent: id });
	await tool('task_state').execute({ id, status: '失败' });
	assert.equal(taskOf(id).status, '失败');
});

test('失败必须有理由：note 也能当理由载体（AI 走工具路径时）', async () => {
	/* 面板会引导用户建阻碍，但 AI 调 task_state 不会弹窗。
	   对它来说 note 就是那句话的载体。 */
	const id = await submit({ title: '会失败的活', type: 'WI' });
	await approve(id);
	await claim(id, newSession());
	await tool('task_state').execute({ id, status: '失败', note: '卡在权限上，没有可用的网络出口' });
	assert.equal(taskOf(id).status, '失败');
	assert.equal(taskOf(id).note, '卡在权限上，没有可用的网络出口');
});

test('失败必须有理由：记录类子事项就算理由，不必非得是阻碍', async () => {
	/* 用户说"不区分具体是什么记录"。所以 RR / RF / RD 都算。 */
	const id = await submit({ title: '会失败的活', type: 'WI' });
	await approve(id);
	await claim(id, newSession());
	await submit({ title: '一份复盘', type: 'RF', parent: id });
	await tool('task_state').execute({ id, status: '失败' });
	assert.equal(taskOf(id).status, '失败');
});

test('开放问题：能从正文里数出来，且能逐条回答', async () => {
	/* 设计类事项正文里常有「## 两个要定的点」这种开放问题。
	   用户要求能一条一条回答，不能全堆在备注里。 */
	const id = await submit({
		title: '一个设计',
		type: 'DP',
		body: [
			'## 要做什么',
			'',
			'随便写点。',
			'',
			'## 两个要定的点',
			'',
			'1. **约束和阻碍的区别**：会不会重叠？',
			'',
			'2. **相关能不能跨树**：我倾向能。',
			'',
		].join('\n'),
	});

	/* 逐条回答 */
	await tool('task_answer').execute({ id, question: '1', answer: '不重叠：阻碍是性质，约束是关系' });
	await tool('task_answer').execute({ id, question: '2', answer: '能跨树' });
	assert.equal(taskOf(id).answers['1'], '不重叠：阻碍是性质，约束是关系');
	assert.equal(taskOf(id).answers['2'], '能跨树');

	/* 空串删掉那一条 */
	await tool('task_answer').execute({ id, question: '2', answer: '' });
	assert.equal(taskOf(id).answers['2'], undefined);
	assert.equal(taskOf(id).answers['1'], '不重叠：阻碍是性质，约束是关系');

	/* 不同问题互不覆盖 */
	assert.equal(Object.keys(taskOf(id).answers).length, 1);
});

test('开放问题：正文里没有「要定的点」时不产生问题', async () => {
	const id = await submit({
		title: '没有开放问题',
		type: 'DP',
		body: '## 要做什么\n\n只有这一节。\n',
	});
	/* 没答过 → answers 是空的 */
	assert.deepEqual(taskOf(id).answers ?? {}, {});
});

test('九态分组：一个状态可属于多个组，三分类由分组派生', async () => {
	const c = command('task-groups');
	const raw = (await c.handler({})).text;
	const model = JSON.parse(raw);

	const of = (status) => model.status.find((row) => row.status === status).groups;
	assert.deepEqual(of('未指定'), [], '草稿不属于任何组');
	assert.deepEqual(of('提交'), ['进行']);
	assert.deepEqual(of('处理中'), ['进行']);
	assert.deepEqual(of('完成'), ['完成']);
	assert.deepEqual(of('失败'), ['完成']);
	assert.deepEqual(of('取消'), ['完成']);
	assert.deepEqual(of('拒绝'), ['完成']);
	/* 关键：搁置的两种同时属于「进行」和「搁置」 */
	assert.deepEqual(of('需要补充'), ['进行', '搁置']);
	assert.deepEqual(of('需要授权'), ['进行', '搁置']);

	assert.deepEqual(
		model.groups.map((g) => g.id),
		['进行', '搁置', '完成'],
	);

	/* /tasks 的每一行带上 groups，面板据此着色 */
	const id = await submit({ title: '带分组的计划' });
	const rows = JSON.parse((await command('tasks').handler({})).text);
	const row = rows.find((item) => item.id === id);
	assert.deepEqual(row.groups, [], '未指定是草稿');
	await approve(id);
	const rows2 = JSON.parse((await command('tasks').handler({})).text);
	assert.deepEqual(rows2.find((item) => item.id === id).groups, ['进行']);
});

test('task_submit 落「未指定」：JSONL 一行 upsert，正文/关联/附属权限原样保存', async () => {
	const workspace = 'X:\\temp\\dsh\\探针\\claim';
	const id = await submit({
		title: '面板里放任务卡',
		type: 'R',
		body: '## 问题\n痛点在这里。',
		links: '依赖:T-999, 依赖:t-999, 派生:T-004',
		workspace,
		permission: '工作区内修改',
	});
	assert.match(id, /^[A-Z]{1,2}-\d{2}$/u);
	assert.match(id, /^[A-Z]{1,2}-01$/u, '清空存储后第一份编号应是 前缀-01');

	/* 文件是 JSONL：一行一个事件，字段都在事件里 */
	const lines = readFileSync(STORE_PATH, 'utf8')
		.split(/\r?\n/u)
		.filter((line) => line !== '');
	assert.equal(lines.length, 1, '一次提交只追加一行事件');
	const event = JSON.parse(lines[0]);
	assert.equal(event.op, 'upsert');
	assert.equal(event.task.id, id);
	assert.equal(event.task.status, '未指定');
	assert.equal(event.task.title, '面板里放任务卡');
	assert.equal(event.task.type, 'WR');
	assert.equal(event.task.body, '## 问题\n痛点在这里。');
	assert.equal(event.task.links, '依赖:T-999, 派生:T-004', 'links 应去重（大小写不敏感）');
	assert.equal(event.task.workspace, workspace);
	assert.equal(event.task.permission, '工作区内修改');
	assert.equal(event.task.claimed_by, '');

	/* 老格式（一计划一 md）不再产生 */
	assert.deepEqual(
		tmpFiles().filter((name) => name.endsWith('.md')),
		[],
		'JSONL 存储不应再写 .md 计划文件',
	);
	assert.ok(tmpFiles().includes('plans.jsonl'), '应写入临时 JSONL 存储');
});

test('task_submit 校验类型与标题，失败不落事件；type 留空 = 空模板', async () => {
	await assert.rejects(
		() => tool('task_submit').execute({ title: 'x', type: 'Z', body: '' }),
		/type 必须留空或取 GU\/GO\/GA\/GV\/DC\/DP\/DQ\/DI\/DB\/DT\/RB\/RR\/RF\/RS\/RD\/RE\/WX\/WR\/WI\/WT\/WF\/WV\/WL\/WC\/WD\/WE\/WP/u,
	);
	await assert.rejects(
		() => tool('task_submit').execute({ title: '  ', type: 'DB', body: '' }),
		/标题不能为空/u,
	);
	assert.deepEqual(events(), []);

	/* 空模板：type 留空也能提交（用来记录待定事项，不套模板小节） */
	const blank = await submit({ title: '空模板记录', type: '', body: '随手记一句。' });
	const stored = taskOf(blank);
	assert.equal(stored.type, '');
	assert.equal(stored.status, '未指定');
	assert.equal(stored.body, '随手记一句。');
});

test('未指定不可领；工具路径不能采纳；命令路径采纳后才能领', async () => {
	const workspace = 'X:\\temp\\dsh\\探针\\claim';
	const id = await submit({ title: '可领取的计划', workspace, permission: '完全权限' });
	const mine = newSession();

	/* 未指定：不能领取（现在的文案直接说明「草稿必须先被采纳」） */
	await assert.rejects(() => claim(id, mine), /草稿（未指定）必须先由用户.*采纳/u);
	/* 工具路径（byUser=false）不能把计划改成「提交」 */
	await assert.rejects(() => changeState(id, '提交'), /采纳（→提交）只能由用户执行/u);
	assert.equal(taskOf(id).status, '未指定');

	/* 命令路径（byUser=true）可以采纳 */
	const approved = await approve(id);
	assert.match(approved.text, /已采纳/u);
	assert.equal(taskOf(id).status, '提交');
	/* 重复采纳幂等，不追加事件 */
	const before = events().length;
	const again = await approve(id);
	assert.match(again.text, /已经是「提交」/u);
	assert.equal(events().length, before, '已经是「提交」时不应再写事件');

	/* 采纳后领取：提交 → 处理中，交回工作空间与权限，并记下会话 */
	const claimed = await claim(id, mine);
	assert.match(claimed.text, /已领取/u);
	assert.match(claimed.text, new RegExp(escapeRegExp(workspace), 'u'));
	assert.match(claimed.text, /完全权限/u);
	const stored = taskOf(id);
	assert.equal(stored.status, '处理中');
	assert.equal(stored.claimed_by, mine);
	assert.equal(events().length, 3, 'submit + approve + claim 各追加一行');
	assert.equal(events().at(-1).task.status, '处理中', '折叠取最后一条 upsert');

	/* /task-state 命令路径（byUser=true）也能采纳 */
	const viaCommand = await submit({ title: '命令采纳的计划' });
	const accepted = await command('task-state').handler({
		agent: { id: newSession() },
		rawInput: `${viaCommand} 提交`,
	});
	assert.equal(accepted.kind, 'success', accepted.text);
	assert.equal(taskOf(viaCommand).status, '提交');

	/* 拒绝的计划不能领取（终态，只有用户能重开） */
	const rejected = await submit({ title: '会被拒绝的计划' });
	await approve(rejected);
	assert.equal((await command('task-reject').handler({ rawInput: rejected })).kind, 'success');
	await assert.rejects(() => claim(rejected, newSession()), /拒绝.*只有用户能重开|只有用户能重开/u);
});

test('依赖未完成不能领取；依赖不存在不能领取；依赖完成后可以领取', async () => {
	const dep = await submit({ title: '前置依赖' });
	const id = await submit({ title: '依赖它的计划', links: `依赖:${dep}` });
	await approve(dep);
	await approve(id);

	await assert.rejects(
		() => claim(id, newSession()),
		new RegExp(`依赖 ${dep} 还没完成`, 'u'),
	);

	const missing = await submit({ title: '缺依赖的计划', links: '依赖:T-999' });
	await approve(missing);
	await assert.rejects(() => claim(missing, newSession()), /依赖 T-999 不存在/u);

	/* 依赖完成后放行 */
	await changeState(dep, '完成');
	assert.equal(taskOf(dep).status, '完成');
	const claimed = await claim(id, newSession());
	assert.match(claimed.text, /已领取/u);
	assert.equal(taskOf(id).status, '处理中');
});

test('依赖失败 / 取消 / 拒绝时拒领，且报错带出当前状态；多个依赖报第一个未满足的', async () => {
	for (const [status, hint] of [
		['失败', '失败'],
		['取消', '取消'],
		['拒绝', '拒绝'],
	]) {
		const dep = await submit({ title: `会被${status}的前置` });
		await approve(dep);
		await changeState(dep, status);
		/* 前置已经死了，之后才建的依赖计划（避免被前者的级联取消带走），单独验领取判定 */
		const id = await submit({ title: '依赖它的计划', links: `依赖:${dep}` });
		await approve(id);
		await assert.rejects(
			() => claim(id, newSession()),
			new RegExp(`依赖 ${dep} 还没完成（当前「${hint}」）`, 'u'),
		);
	}

	/* 多个依赖：报第一个没满足的 */
	const okDep = await submit({ title: '已完成的前置' });
	await changeState(okDep, '完成');
	const badDep = await submit({ title: '没完成的前置' });
	const multi = await submit({ title: '两个依赖', links: `依赖:${okDep}, 依赖:${badDep}` });
	await approve(multi);
	await assert.rejects(
		() => claim(multi, newSession()),
		new RegExp(`依赖 ${badDep} 还没完成`, 'u'),
	);
});

test('派生关系不再要求「派生源处于处理中」（四类别模型）', async () => {
	/* 旧规则：派生源必须在「处理中」，被派生的才能领。
	   这条在四类别模型下删了，因为它是死锁来源：
	   容器（目标/设计）本来就不该「处理中」，却要求它处理中才能派活。

	   新的口径：派生只是记录"我从哪来"，不构成领取限制。
	   能不能派生由模板的 dispatch 表和 kind 决定，不由父节点在不在跑决定。 */
	const child = await submit({ title: '被派生出来的计划' });
	const source = await submit({ title: '派生源', links: `派生:${child}` });
	await approve(child);
	await approve(source);

	/* 派生源还是「提交」状态，child 也应该能直接领 */
	const a = newSession();
	const claimed = await claim(child, a);
	assert.match(claimed.text, /已领取/u);
	assert.equal(taskOf(child).status, '处理中');
	/* 派生源没被动过 */
	assert.equal(taskOf(source).status, '提交');
});

test('父节点已终结时，不能再往下派生（创建阶段就挡住）', async () => {
	/* 这是保留下来的限制：父都收尾了，孩子不该再冒出来。
	   注意它跟"父必须在处理中"完全不同——后者已被删除。

	   生效点在**创建阶段**（assertParent），比领取阶段更早挡住。

	   用「拒绝」而不是「完成」：目标的状态是推导的，不能手动设完成（DP-02）。
	   拒绝是目标上唯一该有的手动终止动作。 */
	const parent = await submit({ title: '父', type: 'GU' });
	await approve(parent);
	await changeState(parent, '拒绝', '这个目标不要了');
	assert.equal(taskOf(parent).status, '拒绝');

	await assert.rejects(
		() => submit({ title: '子', type: 'WI', parent }),
		/已「拒绝」，不能再往下派生/u,
	);
});

test('同一会话一次只能有一个「处理中」；换会话可以并行', async () => {
	const first = await submit({ title: '第一张' });
	const second = await submit({ title: '第二张' });
	await approve(first);
	await approve(second);

	const a = newSession();
	await claim(first, a);
	await assert.rejects(() => claim(second, a), /一次只能做一个/u);
	/* /task-state 命令路径同样受「一次一个」约束 */
	const blocked = await command('task-state').handler({
		agent: { id: a },
		rawInput: `${second} 处理中`,
	});
	assert.equal(blocked.kind, 'error');
	assert.match(blocked.text, /一次只能做一个/u);

	/* 限制是「同一个会话」：换个会话可以做第二张 */
	const b = newSession();
	await claim(second, b);
	assert.equal(taskOf(first).claimed_by, a);
	assert.equal(taskOf(second).claimed_by, b);
});

test('终态（完成 / 失败 / 取消 / 拒绝）清空 claimed_by', async () => {
	for (const status of ['完成', '失败', '取消', '拒绝']) {
		const id = await submit({ title: `要进入终态的 ${status}` });
		await approve(id);
		const mine = newSession();
		await claim(id, mine);
		assert.equal(taskOf(id).claimed_by, mine);
		await changeState(id, status);
		const stored = taskOf(id);
		assert.equal(stored.status, status);
		assert.equal(stored.claimed_by, '', `「${status}」应清空 claimed_by`);
	}
});

test('采纳「取代」：旧计划转拒绝、依赖转移到新计划、派生下游递归取消（防环）', async () => {
	/* 旧计划（已采纳） */
	const old = await submit({ title: '旧计划' });
	await approve(old);

	/* 一条依赖旧计划的计划 */
	const dependent = await submit({ title: '依赖旧计划的计划', links: `依赖:${old}, 来源:T-000` });

	/* 旧计划的派生下游：x → y → x（刻意造环，证明会终止）。
	   两张都先采纳成「提交」——按三分类，「提交」是进行态，才会被级联取消；
	   「未指定」是草稿，不作数。 */
	const x = await submit({ title: '派生一' });
	const y = await submit({ title: '派生二', links: `派生:${x}` });
	await tool('task_update').execute({ id: x, links: `派生:${old}, 派生:${y}` });
	await approve(x);
	await approve(y);

	/* 无关计划 */
	const unrelated = await submit({ title: '无关计划' });

	/* 新计划采纳时写入「取代:旧」 */
	const next = await submit({ title: '新计划', links: `取代:${old}` });
	await approve(next);

	assert.equal(taskOf(old).status, '拒绝', '旧计划应转「拒绝」');
	assert.equal(taskOf(dependent).links, `依赖:${next}, 来源:T-000`, '依赖应转移到新计划');
	assert.equal(taskOf(x).status, '取消', '直接从旧计划派生的下游应取消');
	assert.equal(taskOf(y).status, '取消', '派生链应递归取消，且遇环终止');
	assert.equal(taskOf(next).status, '提交');
	assert.equal(taskOf(unrelated).status, '未指定', '无关计划不该动');
	assert.equal(
		taskOf(dependent).status,
		'未指定',
		'依赖已经转移到新计划的，不该被旧计划的拒绝级联带走',
	);

	/* 再次采纳同一份新计划是幂等的，不会把旧计划改回去 */
	await approve(next);
	assert.equal(taskOf(old).status, '拒绝');
});

test('task_update 只允许「未指定」的计划改内容，且不改状态', async () => {
	const id = await submit({
		title: '原始标题',
		type: 'DB',
		body: '旧正文',
		links: '依赖:T-003, 依赖:t-003',
	});
	const result = await tool('task_update').execute({
		id,
		title: '新标题',
		body: '新正文',
		links: '依赖:T-003, 派生:T-004',
		workspace: 'X:\\temp\\dsh\\探针\\upd',
	});
	assert.match(result.text, /已更新/u);

	const stored = taskOf(id);
	assert.equal(stored.title, '新标题');
	assert.equal(stored.body, '新正文');
	assert.equal(stored.links, '依赖:T-003, 派生:T-004', 'links 应去重');
	assert.equal(stored.workspace, 'X:\\temp\\dsh\\探针\\upd');
	assert.equal(stored.type, 'DB', '未提供的字段保持原值');
	assert.equal(stored.status, '未指定');
	assert.equal(stored.claimed_by, '');

	/* 非法类型拒绝 */
	await assert.rejects(() => tool('task_update').execute({ id, type: 'Z' }), /type 必须是/u);

	/* 已采纳的计划不能直接改（工具与命令两条路都拒） */
	await approve(id);
	await assert.rejects(
		() => tool('task_update').execute({ id, title: '再改' }),
		/已采纳的计划不能直接改/u,
	);
	const cmdBlocked = await command('task-update').handler({
		rawInput: JSON.stringify({ id, title: '再改' }),
	});
	assert.equal(cmdBlocked.kind, 'error');
	assert.match(cmdBlocked.text, /已采纳的计划不能直接改/u);

	/* 命令路径改「未指定」的计划 */
	const draft = await submit({ title: '命令改的计划' });
	const cmdOk = await command('task-update').handler({
		rawInput: JSON.stringify({ id: draft, title: '命令改后' }),
	});
	assert.equal(cmdOk.kind, 'success', cmdOk.text);
	assert.equal(taskOf(draft).title, '命令改后');
	assert.equal(taskOf(draft).status, '未指定');

	/* 缺 id */
	assert.equal((await command('task-update').handler({ rawInput: '{}' })).kind, 'error');
});

test('/task-create 默认「未指定」，参数校验失败不落事件', async () => {
	const workspace = 'X:\\temp\\dsh\\探针\\new';
	const created = await command('task-create').handler({
		rawInput: JSON.stringify({
			title: '面板新建的计划',
			type: 'C',
			body: '## 接口\n新增一个命令。',
			workspace,
			permission: '仅可查看',
		}),
	});
	assert.equal(created.kind, 'success', created.text);
	const { id, status } = JSON.parse(created.text);
	assert.match(id, /^[A-Z]{1,2}-\d{2}$/u);
	assert.equal(status, '未指定', '面板新建默认应是「未指定」，等用户采纳');

	const stored = taskOf(id);
	assert.equal(stored.status, '未指定');
	assert.equal(stored.title, '面板新建的计划');
	assert.equal(stored.type, 'DI');
	assert.equal(stored.workspace, workspace);
	assert.equal(stored.permission, '仅可查看');
	assert.equal(stored.body, '## 接口\n新增一个命令。');

	/* 显式 status=提交 才直接采纳 */
	const direct = await command('task-create').handler({
		rawInput: JSON.stringify({ title: '直接提交的计划', type: 'WI', status: '提交' }),
	});
	assert.equal(direct.kind, 'success');
	assert.equal(JSON.parse(direct.text).status, '提交');
	assert.equal(taskOf(JSON.parse(direct.text).id).status, '提交');

	/* type 可留空（空模板） */
	const empty = await command('task-create').handler({
		rawInput: JSON.stringify({ title: '空模板计划' }),
	});
	assert.equal(empty.kind, 'success');
	assert.equal(taskOf(JSON.parse(empty.text).id).type, '');

	/* 非法类型 / 空标题：返回 error 且不落事件 */
	const before = events().length;
	const badType = await command('task-create').handler({
		rawInput: JSON.stringify({ title: 'x', type: 'Z' }),
	});
	assert.equal(badType.kind, 'error');
	const badTitle = await command('task-create').handler({ rawInput: JSON.stringify({ title: ' ' }) });
	assert.equal(badTitle.kind, 'error');
	assert.equal(events().length, before, '校验失败不应追加事件');
});

test('27 个模板都能读，且每个都声明了 kind 与 behavior', async () => {
	const all = ['GU','GO','GA','GV','DC','DP','DQ','DI','DB','DT','RB','RR','RF','RS','RD','RE','WX','WR','WI','WT','WF','WV','WL','WC','WD','WE','WP'];
	for (const type of all) {
		const result = await tool('task_template').execute({ type });
		assert.match(result.text, /^name: /mu, `${type}.yml 缺 name`);
		assert.match(result.text, /^(default_)?kind: /mu, `${type}.yml 缺 kind / default_kind`);
		assert.match(result.text, /^behavior: /mu, `${type}.yml 缺 behavior`);
		assert.match(result.text, /^body:/mu, `${type}.yml 缺 body`);
	}
	await assert.rejects(() => tool('task_template').execute({ type: 'ZZ' }), /模板类型必须是/u);

	const batch = await command('task-templates').handler({});
	assert.equal(batch.kind, 'success');
	const list = JSON.parse(batch.text);
	assert.deepEqual(
		list.map((item) => item.type),
		all,
	);
});

test('模板的 kind 与大类表一致：G 是目标、B/W/F 是记录、R/D/I 是工作', async () => {
	/* 模板自己声明的 kind 必须和 TYPE_TO_KIND 的推断一致，否则会出现
	   "看起来是记录、实际按工作占位"这种撕裂。 */
	const expected = {
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
	};
	for (const [type, kind] of Object.entries(expected)) {
		const yaml = (await tool('task_template').execute({ type })).text;
		assert.match(yaml, new RegExp(`^(default_)?kind: ${kind}$`, 'mu'), `${type}.yml 的 kind 应是 ${kind}`);
	}
});

test('每个模板都至少有一个必填小节，且 hints 存在', async () => {
	/* 没有必填小节的模板等于没问东西；没有 hints 的模板等于没给 AI 指引。 */
	for (const type of ['GU','GO','GA','GV','DC','DP','DQ','DI','DB','DT','RB','RR','RF','RS','RD','RE','WX','WR','WI','WT','WF','WV','WL','WC','WD','WE','WP']) {
		const yaml = (await tool('task_template').execute({ type })).text;
		assert.match(yaml, /required: true/u, `${type}.yml 至少要有一个必填小节`);
		assert.match(yaml, /^hints:/mu, `${type}.yml 缺 hints`);
	}
});

test('阻碍模板（B）在「失败」提示里禁止穷举', async () => {
	/* 用户明确要求：失败/信息不足的提示语里必须防止穷举。
	   这是"列清单"式偷懒的防线，要钉死在测试里。 */
	const yaml = (await tool('task_template').execute({ type: 'RB' })).text;
	assert.match(yaml, /不要穷举/u, 'B.yml 的 hints 必须写明不要穷举');
	assert.match(yaml, /一个原因|只写一个/u, 'B.yml 必须要求只写一个原因');
});

test('旧模板 H1..H8 已降级为停止原因，可读但不在一等模板列表里', async () => {
	/* 列表里不该再有 H*；但读文件仍应成功（老数据兼容，文件已删则报错也可接受）。 */
	const batch = await command('task-templates').handler({});
	const list = JSON.parse(batch.text);
	assert.equal(
		list.some((item) => /^H/u.test(item.type)),
		false,
		'模板列表里不该再有 H1..H8',
	);
	/* 停止原因词表文件存在 */
	const reasons = await tool('task_template').execute({ type: 'RB' });
	assert.match(reasons.text, /停下来的原因/u, '阻碍模板应包含停止原因小节');
});

test('老数据里的 H1..H8 仍能读（type 原样保留，kind 推成 record）', async () => {
	/* H* 已不是一等模板，但老记录里的 type 不能被破坏。
	   直接追加一条老格式事件，读出来应该正常。 */
	const id = await submit({ title: '兼容测试', type: 'DB' });
	const raw = readFileSync(STORE_PATH, 'utf8');
	/* 老数据没有 kind 字段——这正是要测的：靠 type 推。 */
	const seed = Object.assign({}, taskOf(id));
	delete seed.kind;
	const legacyTask = Object.assign({}, seed, { id: 'T-900', type: 'H1', title: '老的搁置记录' });
	writeFileSync(
		STORE_PATH,
		raw + JSON.stringify({ op: 'upsert', task: legacyTask }) + '\n',
		'utf8',
	);
	const got = taskOf('T-900');
	assert.equal(got.type, 'H1', '老 type 应原样保留');
	assert.equal(got.title, '老的搁置记录');
	/* 头部应把 H1 推成「记录」 */
	const rendered = await tool('task_get').execute({ id: 'T-900' });
	assert.match(rendered.text, /\[记录\//u, 'H1 应推成记录类');
});

test('停止原因词表：阻碍模板带 reason 小节，且词表文档存在', async () => {
	const yaml = (await tool('task_template').execute({ type: 'RB' })).text;
	assert.match(yaml, /reason/u, 'B.yml 应有 reason 小节');
	assert.match(yaml, /需要授权/u, 'reason 提示里应列出需要授权类');
	assert.match(yaml, /需要补充/u, 'reason 提示里应列出需要补充类');
});

test('/tasks 只给计划头、/task-get 给全文、/task-state 命令路径改状态并记 claim', async () => {
	/* kind=work：只有工作能领取；type=F 会推成 record，领不了。 */
	const id = await submit({ title: '命令读写的计划', type: 'RF', kind: 'work', body: '## 复盘\n一条。' });
	const mine = newSession();

	/* 命令路径采纳 + 领取（byUser=true），领取后 claimed_by 记到会话 */
	assert.equal(
		(
			await command('task-state').handler({
				agent: { id: mine },
				rawInput: `${id} 提交`,
			})
		).kind,
		'success',
	);
	assert.equal(taskOf(id).status, '提交');
	assert.equal(
		(
			await command('task-state').handler({
				agent: { id: mine },
				rawInput: `${id} 处理中`,
			})
		).kind,
		'success',
	);
	assert.equal(taskOf(id).status, '处理中');
	assert.equal(taskOf(id).claimed_by, mine);

	/* /tasks：只给头，不带正文 */
	const listed = await command('tasks').handler({});
	assert.equal(listed.kind, 'success');
	const heads = JSON.parse(listed.text);
	assert.equal(heads.length, 1);
	const found = heads[0];
	assert.equal(found.id, id);
	assert.equal(found.status, '处理中');
	assert.equal(found.title, '命令读写的计划');
	assert.equal(found.claimed_by, mine);
	assert.equal('body' in found, false, '/tasks 只给头，不带正文');
	assert.equal('file' in found, false, '/tasks 只给头，不带文件名');
	assert.equal(found.summary, '复盘', 'summary 取正文第一行去标记后的文字');

	/* /task-get：全文 */
	const full = await command('task-get').handler({ rawInput: id });
	assert.equal(full.kind, 'success');
	const detail = JSON.parse(full.text);
	assert.equal(detail.id, id);
	assert.match(detail.body, /一条。/u);
	assert.equal((await command('task-get').handler({ rawInput: 'T-999' })).kind, 'error');

	/* 用法错误 / 状态错误：返回 error 而不是抛 */
	assert.equal((await command('task-state').handler({ rawInput: id })).kind, 'error');
	assert.equal((await command('task-state').handler({ rawInput: `${id} 草稿` })).kind, 'error');
});

test('上行：子计划还有进行态时不许完成父计划；草稿与完成态不阻挡', async () => {
	const parent = await submit({ title: '父计划', type: 'RB', body: '父正文' });
	const pending = await submit({ title: '缺信息的子计划', type: 'C', parent });
	await changeState(pending, '需要补充');

	await assert.rejects(
		() => changeState(parent, '完成'),
		/子计划还在进行中/u,
		'子计划处于「需要补充」时父计划不能完成',
	);
	assert.equal(taskOf(parent).status, '未指定', '被拒后父计划状态不变');

	/* 进行态里的四种都挡：提交 / 处理中 / 需要补充 / 需要授权 */
	const submitted = await submit({ title: '还没领取的子计划', type: 'C', parent });
	await approve(submitted);
	await assert.rejects(() => changeState(parent, '完成'), /子计划还在进行中/u);

	/* 草稿（未指定）不作数、完成态（取消）不阻挡 → 可以完成 */
	const draft = await submit({ title: '草稿子计划', type: 'C', parent });
	await changeState(pending, '取消');
	await changeState(submitted, '取消');
	await changeState(parent, '完成');
	assert.equal(taskOf(parent).status, '完成');
	assert.equal(taskOf(draft).status, '未指定', '草稿子计划不该被父计划的完成改写');
});

test('下行：父计划终止（完成/失败/取消/拒绝）时，进行态的子计划全部取消（递归），草稿与完成态不动', async () => {
	/* 失败这条最典型：父计划走不下去，还活着的派生任务不该继续挂着 */
	const parent = await submit({ title: '父计划', type: 'RB', body: '父正文' });
	const active = await submit({ title: '待领取的子计划', type: 'C', parent });
	await approve(active);
	const shelved = await submit({ title: '搁置的子计划', type: 'C', parent });
	await changeState(shelved, '需要授权');
	const grandchild = await submit({ title: '孙计划', type: 'WI', parent: active });
	await approve(grandchild);
	const draft = await submit({ title: '草稿子计划', type: 'C', parent });
	const delivered = await submit({ title: '已交付的子计划', type: 'C', parent });
	await changeState(delivered, '完成');

	await changeState(parent, '失败');

	assert.equal(taskOf(parent).status, '失败');
	assert.equal(taskOf(active).status, '取消', '「提交」也是进行态，应被取消');
	assert.equal(taskOf(shelved).status, '取消', '需要授权是进行态，应被取消');
	assert.equal(taskOf(grandchild).status, '取消', '级联应递归到孙计划');
	assert.equal(taskOf(draft).status, '未指定', '草稿不作数，不该被动');
	assert.equal(taskOf(delivered).status, '完成', '完成态是已交付记录，不该被改写');
	assert.equal(taskOf(active).claimed_by, '');
});

test('下行：父计划「完成」时派生下游同样是空操作（子计划本来就都终结了）', async () => {
	const parent = await submit({ title: '父计划', type: 'RB' });
	const done = await submit({ title: '做完的子计划', type: 'C', parent });
	await changeState(done, '完成');
	await changeState(parent, '完成');
	assert.equal(taskOf(parent).status, '完成');
	assert.equal(taskOf(done).status, '完成', '已完成的子计划保持完成');
});

test('依赖链单向终结：前者失败/取消/拒绝，进行态的下游全部取消（递归），完成则放行', async () => {
	/* 前者完成 → 不级联 */
	const good = await submit({ title: '做得成的前者' });
	const after = await submit({ title: '依赖它的后者', links: `依赖:${good}` });
	await approve(good);
	await approve(after);
	await changeState(good, '完成');
	assert.equal(taskOf(after).status, '提交', '前者完成，后者照常待领');

	/* 前者失败 → 后者取消；再沿着链递归 */
	const bad = await submit({ title: '做不成的前者' });
	const mid = await submit({ title: '中间那个', links: `依赖:${bad}` });
	const tail = await submit({ title: '链尾那个', links: `依赖:${mid}` });
	const tailDraft = await submit({ title: '链尾的草稿', links: `依赖:${mid}` });
	await approve(mid);
	await approve(tail);
	await changeState(bad, '失败');
	assert.equal(taskOf(mid).status, '取消', '直接依赖失败者的应取消');
	assert.equal(taskOf(tail).status, '取消', '级联应顺着依赖链递归');
	assert.equal(taskOf(tailDraft).status, '未指定', '草稿不作数，不该被动');

	/* 前者被取消或拒绝，同样级联 */
	const dropped = await submit({ title: '被取消的前者' });
	const waiter = await submit({ title: '等它的人', links: `依赖:${dropped}` });
	await approve(waiter);
	await changeState(dropped, '取消');
	assert.equal(taskOf(waiter).status, '取消', '前者取消，后者也取消');

	const rejected = await submit({ title: '被拒绝的前者' });
	const waiter2 = await submit({ title: '另一个等它的人', links: `依赖:${rejected}` });
	await approve(waiter2);
	await changeState(rejected, '拒绝');
	assert.equal(taskOf(waiter2).status, '取消', '前者拒绝，后者也取消');

	/* 无关的计划不受影响 */
	const unrelated = await submit({ title: '无关计划' });
	assert.equal(taskOf(unrelated).status, '未指定');
});

test('老格式一次性迁移：`任务\\*.md` 导入 JSONL 后写 .migrated 标记，不重复导入', async () => {
	/* beforeEach 刚清空临时目录，此时存储文件不存在，正好触发 migrateLegacy() */
	writeFileSync(
		join(TMP_ROOT, 'T-009.md'),
		[
			'---',
			'id: T-009',
			'title: 老格式的计划',
			'type: A',
			'status: 处理中',
			'parent:',
			'links:',
			'workspace:',
			'permission:',
			'claimed_by: session-old',
			'---',
			'',
			'## 正文',
			'从 md 迁过来的。',
		].join('\n'),
		'utf8',
	);

	const listed = await tool('task_list').execute({});
	assert.match(listed.text, /T-009/u, '迁移后列表里应能看到老计划');

	const migrated = taskOf('T-009');
	assert.equal(migrated.status, '处理中');
	assert.equal(migrated.title, '老格式的计划');
	assert.match(migrated.body, /从 md 迁过来的。/u);
	assert.ok(tmpFiles().includes('plans.jsonl.migrated'), '迁移成功应写标记文件');

	/* 再读一次不会重复导入（存储已存在且标记在） */
	const before = events().length;
	const again = await tool('task_list').execute({});
	assert.match(again.text, /T-009/u);
	assert.equal(events().length, before, '重复读取不应再追加事件');
});

test('级联穿过整片下游：父计划失败后，子计划既取消也带走它自己的依赖方', async () => {
	/* 结构：parent(失败) → child(进行态) ← dependent(依赖 child)
	   以及 parent → child2 → grandchild，验证派生链递归 */
	const parent = await submit({ title: '父计划', type: 'RB' });
	const child = await submit({ title: '子计划', type: 'C', parent });
	await approve(child);
	const dependent = await submit({ title: '依赖子计划的人', links: `依赖:${child}` });
	await approve(dependent);
	const child2 = await submit({ title: '另一个子计划', type: 'C', parent });
	await approve(child2);
	const grandchild = await submit({ title: '孙计划', type: 'WI', parent: child2 });
	await approve(grandchild);

	await changeState(parent, '失败');

	assert.equal(taskOf(child).status, '取消');
	assert.equal(
		taskOf(dependent).status,
		'取消',
		'子计划被级联取消后，它自己的依赖方也要跟着取消',
	);
	assert.equal(taskOf(grandchild).status, '取消', '派生链要递归到底');
});

test('完成不级联依赖方：父计划成功，等它的人照常可领', async () => {
	const upstream = await submit({ title: '做得成的前置' });
	const waiter = await submit({ title: '等它的人', links: `依赖:${upstream}` });
	await approve(waiter);
	await changeState(upstream, '完成');
	assert.equal(taskOf(waiter).status, '提交', '前者成功，后者保持待领');
	const claimed = await claim(waiter, newSession());
	assert.match(claimed.text, /已领取/u);
});

test('取代：先转移依赖再判死刑，等旧计划的依赖方不会被误伤', async () => {
	/* 用 goal 当父节点：工作不能派工作，这是新模型的硬约束。 */
	const old = await submit({ title: '会被替代的计划', kind: 'goal' });
	await approve(old);
	/* 依赖方是进行态：如果先转「拒绝」，它就会被级联取消——那是不对的 */
	const dependent = await submit({ title: '依赖旧计划的人', links: `依赖:${old}` });
	await approve(dependent);
	const oldChild = await submit({ title: '旧计划的子计划', kind: 'design', parent: old });
	await approve(oldChild);

	const next = await submit({ title: '新计划', links: `取代:${old}` });
	await approve(next);

	assert.equal(taskOf(old).status, '拒绝');
	assert.equal(taskOf(dependent).status, '提交', '依赖已转移到新计划，应活着');
	assert.equal(taskOf(dependent).links, `依赖:${next}`);
	assert.equal(taskOf(oldChild).status, '取消', '旧计划自己的子计划仍要收掉');
});

test('/task-reject 与 planClaims.release 走同一个改状态入口，终止态照样触发级联', async () => {
	/* 面板「拒绝」按钮：绕过 setState 就会漏掉级联 */
	const parent = await submit({ title: '会被拒绝的父计划', kind: 'goal' });
	const child = await submit({ title: '进行态的子计划', kind: 'design', parent });
	await approve(child);
	assert.equal((await command('task-reject').handler({ rawInput: parent })).kind, 'success');
	assert.equal(taskOf(parent).status, '拒绝');
	assert.equal(taskOf(child).status, '取消', '/task-reject 也必须触发派生级联');

	const dep = await submit({ title: '会被拒绝的前置' });
	const waiter = await submit({ title: '依赖它的人', links: `依赖:${dep}` });
	await approve(waiter);
	assert.equal((await command('task-reject').handler({ rawInput: dep })).kind, 'success');
	assert.equal(taskOf(waiter).status, '取消', '/task-reject 也必须触发依赖级联');

	/* planClaims.release 释放到终止态时同样要级联。
	   注意：release 是针对「被领取的工作」，所以 core 必须是 work。
	   但 work 不能派 work —— 所以 kid 用 design（它也属进行态，会被级联到）。
	   显式给 type：空模板会走"没写 type"的分支，被当成 work。
	   release 不接受 note 参数，所以失败的理由走"派一条阻碍"这条路（WI-01）。 */
	const core = await submit({ title: '被 release 的父计划', type: 'WI' });
	const kid = await submit({ title: '它的子计划', type: 'DP', parent: core });
	/* 失败的理由载体：一条记录类子事项 */
	await submit({ title: '卡在哪', type: 'RB', parent: core });
	await approve(kid);
	await approve(core);
	const claims = ctx.planClaims;
	const session = newSession();
	await tool('task_state').execute({ id: core, status: '处理中' }, { agent: { id: session } });
	const released = await claims.release(session, '失败');
	assert.equal(released.status, '失败');
	assert.equal(taskOf(kid).status, '取消', 'release 到终止态也要级联');
});

test('按计划档不死锁：计划管理工具在「工具全关 / 仅可查看」下也永远放行', async () => {
	/* 直接拿守卫函数，构造一个「按计划」档的 exec。 */
	const guard = guards[0];
	const makeExec = (toolName, args) => ({
		agent: { id: 'session-guard', session: { id: 'session-guard', header: { cwd: 'X:\\temp\\dsh' } } },
		tool: { name: toolName },
		arguments: args || {},
	});
	/* 让 sessionProjections 报「按计划」档 */
	ctx.sessionProjections.stateOf = () => ({ preset: 'plan' });

	/* 没有领取任务时：计划管理工具放行，其它工具被拒 */
	for (const name of [
		'task_list',
		'task_get',
		'task_claim',
		'task_state',
		'task_submit',
		'task_update',
		'task_template',
		'task_note',
	]) {
		assert.equal(guard(makeExec(name)), undefined, `${name} 在没领取任务时也应放行`);
	}
	assert.match(String(guard(makeExec('write', { file_path: 'X:\\temp\\dsh\\a.txt' }))), /没有可用的领取/u);

	/* 领取一张「工具全关」的计划：切任务的工具仍然放行 */
	const locked = await submit({ title: '工具全关的计划', permission: '工具全关' });
	await approve(locked);
	await tool('task_state').execute(
		{ id: locked, status: '处理中' },
		{ agent: { id: 'session-guard' } },
	);
	assert.equal(guard(makeExec('task_state')), undefined, '工具全关也必须能改状态（否则锁死）');
	assert.equal(guard(makeExec('task_claim')), undefined, '工具全关也必须能领下一张');
	assert.equal(guard(makeExec('task_note')), undefined, '工具全关也必须能写备注');
	assert.match(String(guard(makeExec('write', { file_path: 'X:\\temp\\dsh\\a.txt' }))), /工具全关/u);
	/* 报错文案要指出路 */
	assert.match(String(guard(makeExec('write', { file_path: 'X:\\temp\\dsh\\a.txt' }))), /切任务不受限/u);

	/* 仅可查看：写工具被拒，但切任务放行 */
	const readOnly = await submit({ title: '仅可查看的计划', permission: '仅可查看' });
	await approve(readOnly);
	await tool('task_state').execute(
		{ id: locked, status: '完成' },
		{ agent: { id: 'session-guard' } },
	);
	await tool('task_state').execute(
		{ id: readOnly, status: '处理中' },
		{ agent: { id: 'session-guard' } },
	);
	assert.equal(guard(makeExec('task_state')), undefined);
	assert.match(String(guard(makeExec('pwsh', { command: 'echo hi' }))), /仅可查看/u);
	assert.match(String(guard(makeExec('pwsh', { command: 'echo hi' }))), /切任务不受限/u);
});

test('会话隔离：一个会话只执行一个任务；两个会话并发领取互不影响、权限不并集', async () => {
	const a = await submit({ title: '会话 A 的计划', workspace: 'X:\\temp\\dsh\\探针\\a', permission: '完全权限' });
	const b = await submit({ title: '会话 B 的计划', workspace: 'X:\\temp\\dsh\\探针\\b', permission: '仅可查看' });
	await approve(a);
	await approve(b);

	const claims = ctx.planClaims;
	const sessionA = 'subai-alpha';
	const sessionB = 'subai-beta';

	/* 两个会话并发各领一张：互不影响 */
	const [gotA, gotB] = await Promise.all([claims.claim(sessionA, a), claims.claim(sessionB, b)]);
	assert.equal(gotA.id, a);
	assert.equal(gotB.id, b);
	assert.equal(taskOf(a).claimed_by, sessionA);
	assert.equal(taskOf(b).claimed_by, sessionB);

	/* 每个会话只解析出自己那一份，绝不并集 */
	const effA = await claims.effective(sessionA);
	const effB = await claims.effective(sessionB);
	assert.equal(effA.id, a);
	assert.equal(effA.permission, '完全权限');
	assert.equal(effA.workspace, 'X:\\temp\\dsh\\探针\\a');
	assert.equal(effB.id, b);
	assert.equal(effB.permission, '仅可查看');
	assert.equal(effB.workspace, 'X:\\temp\\dsh\\探针\\b');

	/* 一个会话仍然只能有一个：A 想再领一张会被拒 */
	const third = await submit({ title: '第三张' });
	await approve(third);
	await assert.rejects(() => claims.claim(sessionA, third), /一次只能做一个/u);

	/* 释放后快取同步清掉：effective 立刻返回 undefined，不会残留旧权限 */
	await claims.release(sessionA, '完成');
	assert.equal(await claims.effective(sessionA), undefined);
	assert.equal(taskOf(a).status, '完成');
	/* B 不受影响 */
	assert.equal((await claims.effective(sessionB)).id, b);
});

test('claimed_by 为空的无主处理中计划，不会被任何会话顺手拿走（防权限并集）', async () => {
	const id = await submit({ title: '无主计划' });
	/* 手工造一条「处理中但没有 claimed_by」的记录（老数据或人工改库会出现） */
	const stored = taskOf(id);
	writeFileSync(
		STORE_PATH,
		JSON.stringify({ op: 'upsert', task: Object.assign({}, stored, { status: '处理中', claimed_by: '' }) }) + '\n',
		'utf8',
	);

	const guard = guards[0];
	const exec = (toolName) => ({
		agent: { id: 'anyone', session: { id: 'anyone', header: { cwd: 'X:\\temp\\dsh' } } },
		tool: { name: toolName },
		arguments: {},
	});
	ctx.sessionProjections.stateOf = () => ({ preset: 'plan' });

	assert.match(
		String(guard(exec('write'))),
		/没有可用的领取/u,
		'无主处理中计划不能被任何会话认领，必须走 task_claim',
	);
});

test('额外工作区 workspaces：可多个、校验绝对路径、并入「工作区内修改」的允许范围', async () => {
	const main = 'X:\\temp\\dsh\\探针\\main';
	const id = await submit({
		title: '要动两个地方的活',
		workspace: main,
		workspaces: 'X:\\temp\\dsh\\探针\\ref, X:\\temp\\dsh\\探针\\out',
		permission: '工作区内修改',
	});
	const stored = taskOf(id);
	assert.equal(stored.workspace, main);
	assert.equal(stored.workspaces, 'X:\\temp\\dsh\\探针\\ref, X:\\temp\\dsh\\探针\\out');

	/* 相对路径直接拒，不落盘 */
	const wsGroup = await ensureGroup();
	await assert.rejects(
		() => tool('task_submit').execute({
			title: '相对路径',
			type: 'DB',
			body: 'x',
			workspaces: 'some/rel/path',
			group: wsGroup,
		}),
		/额外工作区必须是绝对路径/u,
	);

	/* 领起来之后：三个目录都能写，其它目录不能 */
	await approve(id);
	await tool('task_claim').execute({ id }, { agent: { id: 'session-ws' } });

	const guard = guards[0];
	const exec = (filePath) => ({
		agent: { id: 'session-ws', session: { id: 'session-ws', header: { cwd: 'X:\\temp\\dsh' } } },
		tool: { name: 'write' },
		arguments: { file_path: filePath },
	});
	ctx.sessionProjections.stateOf = () => ({ preset: 'plan' });

	assert.equal(guard(exec('X:\\temp\\dsh\\探针\\main\\a.txt')), undefined, '主工作区可写');
	assert.equal(guard(exec('X:\\temp\\dsh\\探针\\ref\\b.txt')), undefined, '额外工作区 1 可写');
	assert.equal(guard(exec('X:\\temp\\dsh\\探针\\out\\c.txt')), undefined, '额外工作区 2 可写');
	const denied = String(guard(exec('X:\\temp\\dsh\\探针\\elsewhere\\d.txt')));
	assert.match(denied, /不在允许的目录内/u);
	/* 错误文案要列出全部允许目录 */
	assert.match(denied, /探针\\ref/u);
	assert.match(denied, /探针\\out/u);

	/* planClaims 也带回 workspaces（数组形式，给外部调度器） */
	const eff = await ctx.planClaims.effective('session-ws');
	assert.deepEqual(eff.workspaces, ['X:\\temp\\dsh\\探针\\ref', 'X:\\temp\\dsh\\探针\\out']);

	/* 面板/命令路径同样支持 */
	const viaCommand = await command('task-create').handler({
		rawInput: JSON.stringify({
			title: '命令建的多工作区',
			type: 'C',
			body: 'x',
			workspace: main,
			workspaces: 'X:\\temp\\dsh\\探针\\ref',
		}),
	});
	assert.equal(viaCommand.kind, 'success');
	const createdId = JSON.parse(viaCommand.text).id;
	assert.equal(taskOf(createdId).workspaces, 'X:\\temp\\dsh\\探针\\ref');
});

test('安全：草稿不能直接进「处理中」（堵自助提权），但草稿的其它出路保留', async () => {
	/* 这是 T-016 的核心：草稿是模型自己能写的，如果它能直接进「处理中」，
	     模型就能绕过「采纳只能由用户做」，给自己发一张「完全权限」的计划。 */
	const evil = await submit({ title: '恶意计划', permission: '完全权限', workspace: 'C:\\' });

	await assert.rejects(
		() => tool('task_state').execute({ id: evil, status: '处理中' }, { agent: { id: 'attacker' } }),
		/草稿（未指定）必须先由用户.*采纳/u,
	);
	assert.equal(taskOf(evil).status, '未指定', '被拒后草稿状态不变');

	/* 命令路径（byUser=true）同样不能把草稿直接推到处理中——
	   面板上的「领取」应该走 /task-state <id> 处理中，但草稿必须先被采纳。 */
	const viaCommand = await command('task-state').handler({
		agent: { id: 'attacker' },
		rawInput: `${evil} 处理中`,
	});
	assert.equal(viaCommand.kind, 'error');
	assert.match(viaCommand.text, /必须先由用户/u);

	/* 草稿的合法出路仍然保留：H1..H8 搁置模板就是这么用的 */
	const shelved = await submit({ title: '搁置模板草稿' });
	await tool('task_state').execute({ id: shelved, status: '需要授权', note: '等预算' });
	assert.equal(taskOf(shelved).status, '需要授权');
	assert.equal(taskOf(shelved).note, '等预算');

	/* 草稿也能被用户拒绝 */
	const dropped = await submit({ title: '被拒的草稿' });
	assert.equal((await command('task-reject').handler({ rawInput: dropped })).kind, 'success');
	assert.equal(taskOf(dropped).status, '拒绝');
});

test('重开（T-030）：终态可以被用户重开回「提交」，模型不能；且只能回「提交」', async () => {
	const id = await submit({ title: '会失败的计划' });
	await approve(id);
	await claim(id, newSession());
	await changeState(id, '失败');
	assert.equal(taskOf(id).status, '失败');

	/* 模型不能自己复活一张终态计划 */
	await assert.rejects(
		() => tool('task_state').execute({ id, status: '提交' }),
		/只有用户能重开/u,
	);

	/* 用户重开 → 回到「提交」（不是「处理中」，要重新领） */
	const reopened = await command('task-state').handler({ rawInput: `${id} 提交` });
	assert.equal(reopened.kind, 'success', reopened.text);
	assert.equal(taskOf(id).status, '提交');
	assert.equal(taskOf(id).claimed_by, '', '重开后不应残留领取');

	/* 终态不能直接跳到别的状态，只能回「提交」 */
	await claim(id, newSession());
	await tool('task_state').execute({ id, status: '完成' });
	assert.equal(taskOf(id).status, '完成');
	const jumped = await command('task-state').handler({ rawInput: `${id} 处理中` });
	assert.equal(jumped.kind, 'error');
	assert.match(jumped.text, /重开只能从「完成」回到「提交」/u);

	/* 重开可以真的继续干活：重开后重新领取 */
	await command('task-state').handler({ rawInput: `${id} 提交` });
	const reclaimed = await claim(id, newSession());
	assert.match(reclaimed.text, /已领取/u);
});

test('状态转移：采纳后可以直接拒绝 / 取消（T-037 第 1 条）', async () => {
	const a = await submit({ title: '采纳后直接拒绝' });
	await approve(a);
	assert.equal((await command('task-reject').handler({ rawInput: a })).kind, 'success');
	assert.equal(taskOf(a).status, '拒绝');

	const b = await submit({ title: '采纳后直接取消' });
	await approve(b);
	await tool('task_state').execute({ id: b, status: '取消' });
	assert.equal(taskOf(b).status, '取消');

	/* 处理中也能直接取消（T-038 第 2 条） */
	const c = await submit({ title: '做到一半取消' });
	await approve(c);
	await claim(c, newSession());
	await tool('task_state').execute({ id: c, status: '取消' });
	assert.equal(taskOf(c).status, '取消');
	assert.equal(taskOf(c).claimed_by, '');
});

test('CLAIMS 不会陈旧：用工具切任务后，旧 claim 立即失效（T-018）', async () => {
	/* 这条链以前是洞：task_claim 写入 CLAIMS，但用 task_state 工具完成时不清除，
	   于是完成之后同会话仍然持有那张计划的权限（已实测复现）。 */
	const id = await submit({ title: '会做完的计划', permission: '完全权限', workspace: 'C:\\' });
	await approve(id);

	const guard = guards[0];
	const exec = (toolName, args) => ({
		agent: { id: 'stale-session', session: { id: 'stale-session', header: { cwd: 'X:\\temp\\dsh' } } },
		tool: { name: toolName },
		arguments: args || {},
	});
	ctx.sessionProjections.stateOf = () => ({ preset: 'plan' });

	/* 领取后：有权限 */
	await tool('task_claim').execute({ id }, { agent: { id: 'stale-session' } });
	assert.equal(
		guard(exec('write', { file_path: 'C:\\Windows\\a.dll' })),
		undefined,
		'完全权限计划应当放行',
	);

	/* 用工具完成：CLAIMS 必须同步清掉 */
	await tool('task_state').execute({ id, status: '完成' }, { agent: { id: 'stale-session' } });
	assert.match(
		String(guard(exec('write', { file_path: 'C:\\Windows\\b.dll' }))),
		/没有可用的领取/u,
		'完成之后不能还持有旧计划的权限',
	);

	/* 重开 + 重新领取，权限回来；再搁置，权限再次消失 */
	await command('task-state').handler({ rawInput: `${id} 提交` });
	await tool('task_claim').execute({ id }, { agent: { id: 'stale-session' } });
	assert.equal(guard(exec('write', { file_path: 'C:\\Windows\\c.dll' })), undefined);
	await tool('task_state').execute({ id, status: '需要授权' }, { agent: { id: 'stale-session' } });
	assert.match(
		String(guard(exec('write', { file_path: 'C:\\Windows\\d.dll' }))),
		/没有可用的领取/u,
		'搁置之后也不能持有权限',
	);
});

test('并发领取被串行化：同一张计划只有一个会话能领到（T-018）', async () => {
	const id = await submit({ title: '被抢的计划' });
	await approve(id);

	/* 两个会话同时领同一张：必须恰好一个成功 */
	const results = await Promise.allSettled([
		ctx.planClaims.claim('racer-a', id),
		ctx.planClaims.claim('racer-b', id),
	]);
	const ok = results.filter((r) => r.status === 'fulfilled');
	assert.equal(ok.length, 1, '同一张计划只能被一个会话领到');
	assert.equal(taskOf(id).status, '处理中');

	const winner = ok[0].value;
	assert.equal(winner.id, id);
	const owner = taskOf(id).claimed_by;
	assert.ok(['racer-a', 'racer-b'].includes(owner), `claimed_by 应是某个竞争者，实际 ${owner}`);
});

test('并发领取：同一会话不能同时领到两张（一次一个）', async () => {
	const a = await submit({ title: '第一张' });
	const b = await submit({ title: '第二张' });
	await approve(a);
	await approve(b);

	const results = await Promise.allSettled([
		ctx.planClaims.claim('greedy', a),
		ctx.planClaims.claim('greedy', b),
	]);
	const ok = results.filter((r) => r.status === 'fulfilled');
	assert.equal(ok.length, 1, '同一会话并发领两张时，只能成功一张');
	const mine = [...[a, b]].filter((id) => taskOf(id).status === '处理中');
	assert.equal(mine.length, 1, '库里只能有一张处于处理中');
});

test('工具描述符（T-023）：四类描述 + 未知工具按最保守处理', async () => {
	/* 描述符表不对外暴露，但从守卫行为能反推：仅可查看档下，
	   带 write 或 external 描述的一律拒——包括以前漏掉的 plugin_manager / subagent / mcp__*。 */
	const id = await submit({ title: '只读计划', permission: '仅可查看' });
	await approve(id);
	await tool('task_claim').execute({ id }, { agent: { id: 'desc-session' } });

	const guard = guards[0];
	const exec = (name) => ({
		agent: { id: 'desc-session', session: { id: 'desc-session', header: { cwd: 'X:\\temp\\dsh' } } },
		tool: { name },
		arguments: {},
	});
	ctx.sessionProjections.stateOf = () => ({ preset: 'plan' });

	/* 纯只读：放行 */
	for (const name of ['read', 'glob', 'grep', 'task_list', 'task_get']) {
		assert.equal(guard(exec(name)), undefined, `${name} 是只读，应放行`);
	}

	/* 写：拒 */
	for (const name of ['write', 'edit', 'delete', 'apply_patch', 'pwsh', 'bash']) {
		assert.match(String(guard(exec(name))), /仅可查看/u, `${name} 带 write 描述，应拒`);
	}

	/* 能绕过权限模型的：拒（这是 T-017 的核心修复） */
	for (const name of ['plugin_manager', 'subagent', 'subagent_fork', 'workflow', 'mcp__fs__write_file', 'mcp__anything__else']) {
		assert.match(String(guard(exec(name))), /仅可查看/u, `${name} 必须被挡`);
	}

	/* 外部网络：拒 */
	for (const name of ['web_search', 'web_fetch']) {
		assert.match(String(guard(exec(name))), /仅可查看/u, `${name} 是 external，应拒`);
	}

	/* 完全没登记过的工具名：按最保守处理，也拒 */
	assert.match(String(guard(exec('some_future_tool'))), /仅可查看/u, '未知工具必须默认被拒（白名单口径）');
});

test('命令判定（T-018 第 2 项）：分句逐段判路径，堵住「拼一段 echo 就放行」的绕过', async () => {
	const id = await submit({ title: '可跑命令的计划', permission: '工作区内修改', workspace: 'X:\\temp\\dsh' });
	await approve(id);
	await tool('task_claim').execute({ id }, { agent: { id: 'cmd-session' } });

	const guard = guards[0];
	const exec = (command) => ({
		agent: { id: 'cmd-session', session: { id: 'cmd-session', header: { cwd: 'X:\\temp\\dsh' } } },
		tool: { name: 'pwsh' },
		arguments: { command },
	});
	ctx.sessionProjections.stateOf = () => ({ preset: 'plan' });

	/* 已知的绕过手法：必须被拒 */
	const bypass = String(guard(exec('Remove-Item C:\\Windows\\Temp\\zzz -Recurse -Force; echo X:\\temp\\dsh')));
	assert.match(bypass, /不在允许目录内/u, '分句里的越界路径要被抓到');

	/* 允许目录内的命令：放行 */
	assert.equal(guard(exec('Remove-Item X:\\temp\\dsh\\tmp\\a.txt -Force')), undefined);
	assert.equal(guard(exec('Test-Path X:\\temp\\dsh\\开发')), undefined);

	/* 纯只读、不带路径：放行 */
	assert.equal(guard(exec('echo hello')), undefined);
	assert.equal(guard(exec('git status')), undefined);

	/* 不带路径且不在只读白名单里：拒（看不出动哪） */
	assert.match(String(guard(exec('some-random-command --flag'))), /看不出要动哪个目录/u);

	/* 多段混合：只要有一段越界就整条拒 */
	assert.match(
		String(guard(exec('echo X:\\temp\\dsh; Copy-Item C:\\Windows\\x X:\\temp\\dsh\\y'))),
		/不在允许目录内/u,
	);
});

test('计划级描述符开关 deny：只能收窄，不能放宽', async () => {
	/* 完全权限 + deny destructive：命令类仍被拒。
	   注意 deny 要在**领取前**写好——领取时会把 workspace/permission/deny 快照进 CLAIMS。 */
	const id = await submit({ title: '完全权限但禁破坏', permission: '完全权限', deny: 'destructive, external' });
	await approve(id);
	await tool('task_claim').execute({ id }, { agent: { id: 'deny-session' } });

	assert.equal(taskOf(id).deny, 'destructive, external', 'deny 应被存下来');

	const guard = guards[0];
	const exec = (name) => ({
		agent: { id: 'deny-session', session: { id: 'deny-session', header: { cwd: 'X:\\temp\\dsh' } } },
		tool: { name },
		arguments: { command: 'echo hi', file_path: 'X:\\temp\\dsh\\x.txt' },
	});
	ctx.sessionProjections.stateOf = () => ({ preset: 'plan' });

	/* destructive 被关：pwsh / delete 拒 */
	assert.match(String(guard(exec('pwsh'))), /破坏/u);
	assert.match(String(guard(exec('delete'))), /破坏/u);
	/* write 没被关：write / edit 仍放行 */
	assert.equal(guard(exec('write')), undefined, 'write 没在 deny 里，应放行');
	/* external 被关：web_search 拒 */
	assert.match(String(guard(exec('web_search'))), /外部/u);
});

test('deny 只能收窄不能放宽：仅可查看 + 清空 deny 仍是只读', async () => {
	const id = await submit({ title: '只读且 deny 为空', permission: '仅可查看', deny: '' });
	await approve(id);
	await tool('task_claim').execute({ id }, { agent: { id: 'narrow-session' } });

	const guard = guards[0];
	const exec = (name) => ({
		agent: { id: 'narrow-session', session: { id: 'narrow-session', header: { cwd: 'X:\\temp\\dsh' } } },
		tool: { name },
		arguments: {},
	});
	ctx.sessionProjections.stateOf = () => ({ preset: 'plan' });

	/* 没有 deny，但权限档本身是只读 → 写工具仍然拒 */
	assert.match(String(guard(exec('write'))), /仅可查看/u);
	assert.equal(guard(exec('read')), undefined);
});

test('事件溯源（T-019）：新事件带 ts/actor/from→to，老事件仍可读且不被改写', async () => {
	const id = await submit({ title: '有历史可看的计划' });
	await approve(id);
	await tool('task_state').execute({ id, status: '处理中' }, { agent: { id: 'hist-session' } });
	await tool('task_state').execute({ id, status: '需要授权', note: '等预算' }, { agent: { id: 'hist-session' } });

	const list = await tool('task_history').execute({ id });
	assert.match(list.text, /历史/u);
	assert.match(list.text, /hist-session/u, '要能看出是谁改的');
	assert.match(list.text, /需要授权/u);

	/* 事件里确实有 ts / actor / from→to */
	const raw = readFileSync(STORE_PATH, 'utf8')
		.split(/\r?\n/u)
		.filter((line) => line.trim() !== '')
		.map((line) => JSON.parse(line));
	const mine = raw.filter((e) => e.op === 'upsert' && e.task && e.task.id === id);
	assert.ok(mine.length >= 3, '提交 + 采纳 + 两次状态变化');
	for (const event of mine) {
		assert.ok(typeof event.ts === 'string' && event.ts.includes('T'), '每条新事件都该有 ISO 时间戳');
	}
	const moved = mine.find((e) => e.from !== undefined && e.to !== undefined);
	assert.ok(moved, '状态变化事件应带 from/to');
	assert.equal(typeof moved.actor, 'string');
	/* from/to 只在真变化时写，值要对得上 */
	const transitions = mine.filter((e) => e.from !== undefined).map((e) => `${e.from}->${e.to}`);
	assert.ok(transitions.some((t) => t.includes('未指定->提交')), `实际转移：${transitions.join(', ')}`);
});

test('事件溯源：老事件（没有 ts/actor/from-to）照样能读，不会被补写或迁移', async () => {
	/* 造一份「老格式」存储：只有 op/task，没有任何新字段 */
	const legacy = [
		{ op: 'upsert', task: { id: 'T-001', title: '老计划', type: 'DB', status: '提交', claimed_by: '', body: 'x' } },
		{ op: 'upsert', task: { id: 'T-001', title: '老计划', type: 'DB', status: '完成', claimed_by: '', body: 'x' } },
	];
	writeFileSync(STORE_PATH, legacy.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf8');
	const before = readFileSync(STORE_PATH, 'utf8');

	/* 读得出来 */
	const listed = await tool('task_list').execute({});
	assert.match(listed.text, /老计划/u);
	const got = await tool('task_get').execute({ id: 'T-001' });
	assert.equal(taskOf('T-001').status, '完成', '折叠逻辑不受影响');

	/* 历史也能读，只是缺字段显示为 — */
	const history = await tool('task_history').execute({ id: 'T-001' });
	assert.match(history.text, /历史/u);
	assert.match(history.text, /无时间戳/u);

	/* 关键：读操作没有改写文件 */
	assert.equal(readFileSync(STORE_PATH, 'utf8'), before, '只读操作绝不能动存储文件');
});

test('事件溯源：坏事件行不影响历史读取', async () => {
	writeFileSync(
		STORE_PATH,
		[
			JSON.stringify({ op: 'upsert', ts: new Date().toISOString(), actor: 'a', task: { id: 'T-001', title: 'x', status: '提交', body: '' } }),
			'{ 这一行是坏的 json',
			JSON.stringify({ op: 'upsert', ts: new Date().toISOString(), actor: 'b', from: '提交', to: '完成', task: { id: 'T-001', title: 'x', status: '完成', body: '' } }),
		].join('\n') + '\n',
		'utf8',
	);
	const history = await tool('task_history').execute({ id: 'T-001' });
	assert.match(history.text, /历史/u);
	assert.doesNotMatch(history.text, /坏的/u);
});

test('四类别：只有「工作」能领取，目标/设计/记录都领不了', async () => {
	/* 这是死锁的根治：死锁来自「父节点占着会话位」，
	   而新模型里能当容器的父节点（目标）根本不可领取。

	   所以不是"允许父子换手"，是"父子争位这种情况不存在"。 */
	/* 用模板决定 kind，不要用 kind 覆盖 type——两者矛盾时 type 才是真源。 */
	const goal = await submit({ title: '目标', type: 'GU' });
	const design = await submit({ title: '设计', type: 'DP' });
	const record = await submit({ title: '记录', type: 'RR' });
	const work = await submit({ title: '工作', type: 'WI' });
	await approve(goal);
	await approve(design);
	await approve(record);
	await approve(work);

	const a = newSession();
	/* 三类都不能领，而且报错要说清为什么。
	   目标走的是「状态由子事项推导」这条路（DP-02），
	   设计和记录走的是「不是工作，不能领取」那条。 */
	for (const [id, label] of [
		[goal, '目标'],
		[design, '设计'],
		[record, '记录'],
	]) {
		await assert.rejects(() => claim(id, a), /不能/u, `${label}不该能被领取`);
	}
	await assert.rejects(() => claim(goal, a), /由子事项推导/u, '目标要说清是推导的');
	await assert.rejects(() => claim(design, a), /只有「工作」/u);
	await assert.rejects(() => claim(record, a), /只有「工作」/u);
	/* 只有工作能领 */
	await claim(work, a);
	assert.equal(taskOf(work).status, '处理中');
});

test('四类别：目标不占位，可以做多个工作互不影响', async () => {
	/* 目标没有自有状态，会话从来没"领"过它，所以它不占任何槽位。
	   这解开了旧模型的死结：一个会话领了父就领不了子。 */
	const goal = await submit({ title: '一个目标', kind: 'goal' });
	await approve(goal);
	const w1 = await submit({ title: '工作一', kind: 'work', parent: goal });
	const w2 = await submit({ title: '工作二', kind: 'work', parent: goal });
	await approve(w1);
	await approve(w2);

	const a = newSession();
	/* 领工作一，做完，再领工作二 —— 目标从头到尾没参与竞争 */
	await claim(w1, a);
	await changeState(w1, '完成');
	await claim(w2, a);
	assert.equal(taskOf(w2).status, '处理中');
	assert.equal(taskOf(goal).status, '提交', '目标状态不受领取影响');
});

test('四类别：不相干的两个工作仍然不能同时持有', async () => {
	const a = await submit({ title: '不相干 A', kind: 'work' });
	const b = await submit({ title: '不相干 B', kind: 'work' });
	await approve(a);
	await approve(b);

	const SAME = 'one-session-2';
	await claim(a, SAME);
	await assert.rejects(() => claim(b, SAME), /一次只能做一个/u);
});

test('目标的状态由子事项推导（DP-02）：五条规则', async () => {
	/* 用户给的五条，按优先级从上往下：
	     没有采纳的子任务 → 未开始
	     子任务都被需要授权 → 需要授权
	     子任务有采纳的且未完成未中断 → 进行中
	     子任务全部失败 → 失败
	     子任务都在完成态且不是全部失败 → 完成

	   推导值**不落盘**：只在 /tasks 输出里给面板看。 */
	const goal = await submit({ title: '带子事项的目标', type: 'GU' });
	await approve(goal);

	/* 没有子事项 → 未开始 */
	assert.equal(await derivedOf(goal), '未开始', '空目标应是未开始');

	/* 全是草稿 → 未开始（还没采纳等于没开始） */
	const draftKid = await submit({ title: '草稿子事项', type: 'WI', parent: goal });
	assert.equal(await derivedOf(goal), '未开始');

	/* 有已采纳但未完成的 → 进行中 */
	await approve(draftKid);
	assert.equal(await derivedOf(goal), '进行中');

	/* 子事项都在需要授权 → 需要授权 */
	await tool('task_state').execute({ id: draftKid, status: '需要授权', note: '等预算' });
	assert.equal(await derivedOf(goal), '需要授权');

	/* 子事项全失败 → 失败 */
	await tool('task_state').execute({ id: draftKid, status: '失败', note: '卡住了' });
	assert.equal(await derivedOf(goal), '失败');

	/* 全终结且不全是失败 → 完成。
	   换一个新目标测：失败是终态，不能重开（T-030）。 */
	const goal2 = await submit({ title: '第二个目标', type: 'GU' });
	await approve(goal2);
	const kid2 = await submit({ title: '子事项二', type: 'WI', parent: goal2 });
	await approve(kid2);
	await claim(kid2, newSession());
	await changeState(kid2, '完成');
	assert.equal(await derivedOf(goal2), '完成');
});

test('目标不能手动设状态：完成/处理中都被拒，拒绝和取消可以', async () => {
	/* 用户原话：「手动不能点完成。因为目标的语义就是无限的。
	   完成了还能重开。没意义。除了取消以外，不给手动按钮。」 */
	const goal = await submit({ title: '一个目标', type: 'GU' });
	await approve(goal);

	for (const status of ['完成', '处理中', '失败']) {
		await assert.rejects(
			() => changeState(goal, status, '随便写'),
			/由子事项推导/u,
			`目标不该能被手动设成「${status}」`,
		);
	}

	/* 拒绝可以：放弃整个目标 */
	await changeState(goal, '拒绝', '这个方向不要了');
	assert.equal(taskOf(goal).status, '拒绝');
});

test('四类别：兄弟工作之间也不能同时持有', async () => {
	const parent = await submit({ title: '父', kind: 'goal' });
	const sonA = await submit({ title: '子A', kind: 'work', parent });
	const sonB = await submit({ title: '子B', kind: 'work', parent });
	await approve(parent);
	await approve(sonA);
	await approve(sonB);

	const SAME = 'one-session-3';
	await claim(sonA, SAME);
	await assert.rejects(() => claim(sonB, SAME), /一次只能做一个/u);
});

test('kind 推断：老 type 映射到新 kind，零行为变更', async () => {
	/* 老数据没有 kind 字段，读的时候按 type 推。
	   task_get 头部是 `[种类/type 模板名]`，推断结果就在那里。 */
	const KIND_NAME = { goal: '目标', design: '设计', record: '记录', work: '工作' };
	const cases = [
		['DB', 'design'],
		['B', 'record'],
		['C', 'design'],
		['D', 'work'],
		['R', 'work'],
		['F', 'record'],
		['H1', 'record'],
		['H8', 'record'],
	];
	for (const [type, expected] of cases) {
		const id = await submit({ title: `type=${type}`, type });
		const got = await tool('task_get').execute({ id });
		assert.match(
			got.text,
			new RegExp(`\\[${KIND_NAME[expected]}/`, 'u'),
			`${type} 应推成 ${expected}，实际：${got.text.split('\n')[0]}`,
		);
	}
	/* 显式写了 kind 就原样保留，不被 type 覆盖 */
	const explicit = await submit({ title: '显式 kind', type: 'WI', kind: 'design' });
	const got = await tool('task_get').execute({ id: explicit });
	assert.match(got.text, /\[设计\//u, '显式 kind=design 应保留，不被 type=D 覆盖');
});

test('kind 校验：非法 kind 直接拒，不落盘', async () => {
	await assert.rejects(
		() => tool('task_submit').execute({ title: 'x', body: 'b', kind: 'not-a-kind' }),
		/kind 必须是/u,
	);
});

test('工作不能派「另一件要做的事」，但可以派调研/记录/设计', async () => {
	/* 口径（用户明确纠正过一次）：
	     工作**可以**派任何"项目"——调研、记录、复盘、设计都行。
	     比如线稿画到一半查参考（派 GR 调研），这是创作里最高频的动作。
	   工作**不能**派"另一件要做的事"（GI 实现项 / GX 缺陷 这类）。
	     那说明它本来就不是原子任务，该升级为目标。

	   所以判定按**模板**，不按 kind：GR/GN 是 work 但属于"项目"。 */
	const work = await submit({ title: '一个工作', kind: 'work' });
	await approve(work);

	/* 派另一件要做的事：拒 */
	await assert.rejects(
		() => submit({ title: '子实现项', type: 'WT', parent: work }),
		/不能再派另一件要做的事/u,
	);
	await assert.rejects(
		() => submit({ title: '子缺陷', type: 'WF', parent: work }),
		/不能再派另一件要做的事/u,
	);
	/* kind=work 但不写 type（空模板）也算"要做的事"：拒 */
	await assert.rejects(
		() => submit({ title: '裸工作', kind: 'work', parent: work }),
		/不能再派另一件要做的事/u,
	);

	/* 派调研：允许（这是核心修正） */
	const research = await submit({ title: '查一下参考', type: 'WR', parent: work });
	assert.ok(research, '工作应能派调研');

	/* 派设计 / 记录：允许 */
	const design = await submit({ title: '子设计', type: 'DC', parent: work });
	assert.ok(design);
	const record = await submit({ title: '子记录', type: 'RB', parent: work });
	assert.ok(record);
});

test('目标可以派目标（容器可以嵌套）', async () => {
	/* 与工作相反：目标不占位，所以同类嵌套是合法的。
	   用户原话：「用户提出，加一个日志。那用户目标本来就会制造目标的。」 */
	const outer = await submit({ title: '外层目标', kind: 'goal' });
	await approve(outer);
	const inner = await submit({ title: '内层目标', kind: 'goal', parent: outer });
	assert.ok(inner);
	assert.equal(taskOf(inner).parent, outer);
});

test('设计可以派设计（用户可以同时有多个待决问题）', async () => {
	const outer = await submit({ title: '大决策', kind: 'design' });
	await approve(outer);
	const inner = await submit({ title: '子决策', kind: 'design', parent: outer });
	assert.ok(inner);
});

test('task_dispatch：工作不能派「要做的事」，但能派调研/记录/设计', async () => {
	/* 模板里的 dispatch 现在**真的被读了**（以前只写在文件里，代码一个都不看）。
	   判定三层：大类规则 → 父模板 dispatch → 子模板 default_kind。 */
	const work = await submit({ title: '一个实现', type: 'WI' });
	await approve(work);

	const listed = await tool('task_dispatch').execute({ id: work });
	const text = listed.text;

	assert.match(text, /WR · 调研/u, '工作应能派调研');
	assert.match(text, /RB · 阻碍/u, '工作应能派记录');
	assert.match(text, /DC · 决策/u, '工作应能派设计');

	assert.match(text, /WT · 实现项/u, '工作不能派实现项');
	assert.match(text, /WF · 缺陷/u, '工作不能派缺陷');
	assert.match(text, /不能再派另一件要做的事/u, '要给原因');

	/* 目标下面什么都能派 */
	const goal = await submit({ title: '一个目标', type: 'GU' });
	const all = await tool('task_dispatch').execute({ id: goal });
	assert.match(all.text, /WT · 实现项/u, '目标应能派实现项');
	assert.match(all.text, /WR · 调研/u);
});

test('task_dispatch：目标下可派发的模板远多于工作下', async () => {
	const goal = await submit({ title: '目标', type: 'GU' });
	const work = await submit({ title: '实现', type: 'WI' });
	await approve(work);
	const goalText = (await tool('task_dispatch').execute({ id: goal })).text;
	const workText = (await tool('task_dispatch').execute({ id: work })).text;
	const count = (text) => (text.match(/✅/gu) ?? []).length;
	assert.ok(count(goalText) > count(workText), `目标(${count(goalText)}) 应多于工作(${count(workText)})`);
});

test('task_template 带 from 时，不能派的模板直接报错', async () => {
	/* 这样模型不用写完才发现被拒。 */
	const work = await submit({ title: '实现', type: 'WI' });
	await assert.rejects(
		() => tool('task_template').execute({ type: 'WT', from: work }),
		/不能把 WT 挂在/u,
	);
	const ok = await tool('task_template').execute({ type: 'WR', from: work });
	assert.match(ok.text, /^name: WR/u);
});

test('assertParent 与 task_dispatch 用同一套判定', async () => {
	/* 两处规则必须一致：按钮里没有的，task_submit 也不能建。 */
	const work = await submit({ title: '实现', type: 'WI' });
	await approve(work);
	await assert.rejects(
		() => submit({ title: '子实现项', type: 'WT', parent: work }),
		/不能再派另一件要做的事/u,
	);
	const research = await submit({ title: '子调研', type: 'WR', parent: work });
	assert.ok(research);
});

test('task_state 校验九态名与计划 id，非法值不改状态', async () => {
	const id = await submit({ title: '状态校验' });
	await assert.rejects(() => changeState(id, '草稿'), /状态必须是九态之一/u);
	await assert.rejects(() => changeState('T-999', '完成'), /没有这份计划：T-999/u);
	assert.equal(taskOf(id).status, '未指定');
});
