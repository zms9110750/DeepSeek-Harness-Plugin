/**
 * plan-tree2 的单元测试：不开 DSH、不碰真会话。
 *
 * 桩 ctx 只实现这十个插件用到的四个注册面和 `provide`/`get`：
 * 每个插件都能被单独 mount、单独断言，这就是"一个包十个插件"的意义。
 *
 * 跑法：在 `开发/plan-tree` 下 `node --test`
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const ROOT = 'X:/temp/dsh/开发/plan-tree';
const load = (sub) => import(pathToFileURL(`${ROOT}/${sub}`).href);

/** 桩 ctx：只做注册，不做调度。 */
function makeCtx() {
	const services = new Map();
	const ctx = {
		tools: { guards: [], tools: [], guard(fn) { this.guards.push(fn); }, register(def) { this.tools.push(def); } },
		commands: { commands: [], register(def) { this.commands.push(def); } },
		sessionProjections: {
			defs: new Map(),
			register(def) { this.defs.set(def.key, def); },
			stateOf(_session, key) {
				const cell = cells.get(key);
				return cell === undefined ? undefined : cell;
			},
		},
		agents: { create: async () => { throw new Error('stub: no agents'); } },
		/** 卸载钩子：真 fiber 会收集这些；桩里存下来，测试可以主动触发。 */
		effects: [],
		effect(callback, label) {
			const dispose = callback();
			if (typeof dispose === 'function') ctx.effects.push({ label, dispose });
			return () => {};
		},
		provide(name, value) {
			services.set(name, value);
			ctx[name] = value;
		},
		get(name) {
			return services.get(name);
		},
	};
	const cells = new Map();
	/** 把一条事件喂给某个投影，返回折叠后的状态。 */
	ctx.foldInto = (key, events) => {
		const def = ctx.sessionProjections.defs.get(key);
		assert.ok(def, `projection ${key} is not registered`);
		let state = cells.get(key) ?? def.init();
		for (const event of events) state = def.apply(state, event);
		cells.set(key, state);
		return state;
	};
	ctx.reset = () => cells.clear();
	return ctx;
}

const MODULES = ['events', 'template', 'state', 'sub-workspace', 'gate', 'record', 'tree', 'settle', 'dispatch', 'lock'];

async function mountAll() {
	const ctx = makeCtx();
	const mounted = [];
	for (const sub of MODULES) {
		const mod = await load(`src/${sub}.js`);
		mod.apply(ctx);
		mounted.push({ sub, name: mod.name, inject: mod.inject });
	}
	return { ctx, mounted };
}

test('十个插件各自 mount，注册面齐全', async () => {
	const { ctx, mounted } = await mountAll();

	assert.deepEqual(
		mounted.map((m) => m.name),
		['plan-events', 'proposal-template', 'plan-state', 'sub-workspace', 'plan-gate', 'plan-record', 'plan-tree', 'plan-settle', 'plan-dispatch', 'plan-lock'],
	);

	// 每个插件的名字唯一，且 inject 只引用真实存在的服务名（或宿主自带的那几个）。
	const provided = ['planEvents', 'proposalTemplate', 'planStates', 'subWorkspaces', 'planGate'];
	const host = new Set(['tools', 'commands', 'sessionProjections', 'agents']);
	for (const { sub, inject } of mounted) {
		for (const dep of inject) {
			assert.ok(provided.includes(dep) || host.has(dep), `${sub} injects unknown service ${dep}`);
		}
	}

	assert.deepEqual(
		ctx.tools.tools.map((tool) => tool.name).sort(),
		['plan_dispatch', 'plan_export', 'plan_file', 'plan_tree', 'plan_write'],
	);
	assert.deepEqual(
		ctx.commands.commands.map((command) => command.name).sort(),
		['plan', 'plan-adopt', 'plan-new', 'plan-reject', 'plan-shelve', 'sub-workspace'],
	);
	assert.deepEqual([...ctx.sessionProjections.defs.keys()].sort(), ['nodes', 'plans', 'subWorkspaces']);
	assert.equal(ctx.tools.guards.length, 1, '只有锁注册守卫；闸门是纯函数，不注册 guard');
});

test('状态机：B-03 的扳机表与 statusOf 一致', async () => {
	const { STATUS, TRIGGERS, statusOf } = await load('src/state.js');

	const draft = { id: 'p1' };
	const adopted = { id: 'p1', adopted: true };
	const rejected = { id: 'p1', rejected: true };
	const node = (verdict, status = verdict) => [{ planId: 'p1', status, verdict }];

	assert.equal(statusOf(draft, []), STATUS.DRAFT);
	assert.equal(statusOf(adopted, []), STATUS.PLAN);
	assert.equal(statusOf(rejected, []), STATUS.SHELVED_DRAFT);
	assert.equal(statusOf(adopted, node(null, 'open')), STATUS.RUNNING);
	assert.equal(statusOf(adopted, node('success')), STATUS.DONE);
	assert.equal(statusOf(adopted, node('reject')), STATUS.FAILED);
	assert.equal(statusOf(adopted, node('shelved')), STATUS.HELD);

	// 表里每一行的终态都必须是真实存在的状态之一。
	const states = new Set(Object.values(STATUS));
	for (const row of TRIGGERS) assert.ok(states.has(row.to), `trigger ${row.op} points at unknown state ${row.to}`);
	assert.equal(TRIGGERS.length, 9);
});

test('闸门：三项检查各自会拒，研究不受层规则约束', async () => {
	const { check, MAX_REJECTIONS } = await load('src/gate.js');
	const plan = (over) => ({ id: 'p1', type: 'plan', layer: 'B系列-设计', layerIndex: 1, ...over });

	const root = undefined;
	assert.equal(check({ plan: plan(), self: root, counts: {} }).ok, true);

	// 只能往更深的层派。
	const atB = { type: 'plan', layer: 'B系列-设计', layerIndex: 1 };
	assert.equal(check({ plan: plan(), self: atB, counts: {} }).ok, false);
	assert.equal(check({ plan: plan({ layer: 'A系列-问题', layerIndex: 0 }), self: atB, counts: {} }).ok, false);
	assert.equal(check({ plan: plan({ layer: 'C系列-接口', layerIndex: 2 }), self: atB, counts: {} }).ok, true);

	// 同层被否三次之后，这一层只收研究。
	const counts = { 'C系列-接口': MAX_REJECTIONS };
	const blocked = check({ plan: plan({ layer: 'C系列-接口', layerIndex: 2 }), self: atB, counts });
	assert.equal(blocked.ok, false);
	assert.match(blocked.reason, /consecutive rejections/);

	// 研究没有层坐标：层规则不适用，也不看计数。
	const research = check({ plan: { id: 'p2', type: 'research' }, self: atB, counts });
	assert.equal(research.ok, true);
	assert.equal(research.layer, null);

	// 研究只能派研究。
	const fromResearch = { type: 'research', layer: null, layerIndex: null };
	assert.equal(check({ plan: plan(), self: fromResearch, counts: {} }).ok, false);
});

test('折叠：记录、采纳、派发、结算之后，两份投影各自正确', async () => {
	const { ctx } = await mountAll();
	// 直接构造日志里那几行：投影只认 { type, data:{ op, … } }。
	const rec = (op, data) => ({ type: ctx.planEvents.type, data: { op, ...data } });

	const events = [
		rec('plan', { id: 'p1', title: '甲', layer: 'B系列-设计', layerIndex: 1, type: 'plan', topic: '甲' }),
		rec('adopt', { id: 'p1' }),
		rec('dispatch', { id: 'n1', planId: 'p1', type: 'plan', layer: 'B系列-设计', layerIndex: 1, topic: '甲', reason: 'r', childId: 'c1', parentSession: 'session-x' }),
		rec('file', { id: 'n1', verdict: 'reject', conclusion: '不行', evidence: 'e', artifacts: 'a', pitfalls: 'p', where: 'w' }),
	];

	const plans = ctx.foldInto('plans', events);
	const nodes = ctx.foldInto('nodes', events);

	assert.equal(plans.plans.p1.title, '甲');
	assert.equal(plans.plans.p1.adopted, true, '采纳记在计划上');
	assert.equal(plans.planSeq, 2, 'id 按序发放');
	assert.equal(nodes.nodes.n1.planId, 'p1', '节点认得出自己属于哪份计划');
	assert.equal(nodes.nodes.n1.verdict, 'reject');
	assert.equal(nodes.counts['B系列-设计'], 1, '否决让该层 +1');
	assert.equal(nodes.nextId, 2);

	// 同一层再来一份，成功结算：计数归零。
	ctx.reset();
	const later = [
		...events,
		rec('plan', { id: 'p2', title: '乙', layer: 'B系列-设计', layerIndex: 1, type: 'plan', topic: '乙' }),
		rec('dispatch', { id: 'n2', planId: 'p2', type: 'plan', layer: 'B系列-设计', layerIndex: 1, topic: '乙', reason: 'r', childId: 'c2', parentSession: 'session-x' }),
		rec('file', { id: 'n2', verdict: 'success', conclusion: '成了' }),
	];
	const after = ctx.foldInto('nodes', later);
	assert.equal(after.counts['B系列-设计'], 0, '成功把该层计数归零');
	assert.equal(after.nodes.n2.status, 'success');
});

test('锁：没有认领就不拦；划了范围才收窄到范围里', async () => {
	const { ctx } = await mountAll();
	const [guard] = ctx.tools.guards;

	const empty = { claims: {} };
	const scoped = { claims: { 'x:\\a\\sub': { path: 'X:/a/sub', planId: 'p1' } } };
	const session = { id: 'session-x', header: { cwd: 'X:/a' } };
	const exec = (tool, args) => ({ agent: { session, id: 'agent' }, tool: { name: tool }, args });
	const at = (sandbox, state) => {
		ctx.sessionProjections.stateOf = (_session, key) => {
			if (key === 'permissions') return { sandbox };
			if (key === 'subWorkspaces') return state;
			return undefined;
		};
	};

	assert.equal(guard(exec('read', { file_path: 'X:/a/x' })), undefined, '读从不拦');

	// 没有认领：不拦。新会话开箱即用，锁不负责管它。
	at('workspace-write', empty);
	assert.equal(guard(exec('write', { file_path: 'X:/a/out.md' })), undefined);
	at('read-only', empty);
	assert.equal(guard(exec('pwsh', {})), undefined, '没有范围时连看不出目录的工具也不拦');

	// 划了范围：只许写范围内。
	at('workspace-write', scoped);
	assert.equal(guard(exec('write', { file_path: 'X:/a/sub/ok.md' })), undefined, '范围内放行');
	assert.match(String(guard(exec('write', { file_path: 'X:/a/out.md' }))), /不在任何子工作区/);
	assert.match(String(guard(exec('pwsh', {}))), /看不出要写哪个目录/);

	// 完全权限：整套跳过。
	at('danger-full-access', scoped);
	assert.equal(guard(exec('write', { file_path: 'X:/anywhere.md' })), undefined);

	// 用户手动放开。
	at('workspace-write', scoped);
	ctx.commands.commands.find((command) => command.name === 'plan').handler({ agent: { session, id: 'agent' }, rawInput: 'off' });
	assert.equal(guard(exec('write', { file_path: 'X:/anywhere.md' })), undefined);
});

test('树简报：计划带状态，卡住的把坑带出来', async () => {
	const { ctx } = await mountAll();
	const rec = (op, data) => ({ type: ctx.planEvents.type, data: { op, ...data } });
	const events = [
		rec('plan', { id: 'p1', title: '甲', layer: 'B系列-设计', layerIndex: 1, type: 'plan', topic: '甲', dir: '计划/15-计划即提案' }),
		rec('adopt', { id: 'p1' }),
		rec('dispatch', { id: 'n1', planId: 'p1', type: 'plan', layer: 'B系列-设计', layerIndex: 1, topic: '甲', reason: '试试', childId: 'c1', parentSession: 's' }),
		rec('file', { id: 'n1', verdict: 'reject', conclusion: '不行', evidence: 'e', artifacts: 'a', pitfalls: '沙箱里 pwsh 起不来', where: 'w' }),
	];
	const nodes = ctx.foldInto('nodes', events);
	const plans = ctx.foldInto('plans', events);
	const { renderTree } = await load('src/tree.js');

	const out = renderTree(nodes, plans, ctx.planStates);
	assert.match(out.tree, /p1 \[B系列-设计\] 失败计划/);
	assert.ok(out.tree.includes('【计划/15-计划即提案】'), '计划行要带提案文件夹，结算才指得回去');
	assert.match(out.tree, /坑：沙箱里 pwsh 起不来/, '状态之外必须能读到为什么进行不下去');
	assert.match(out.tree, /n1 \[B系列-设计\] reject/);
	assert.match(out.counts, /B系列-设计:1/);

	// 缺 plans 投影时只是不报计划段，不影响节点树。
	const bare = renderTree(nodes, undefined, ctx.planStates);
	assert.doesNotMatch(bare.tree, /p1/);
});

test('导出：显式写文件，已存在则拒绝', async () => {
	const { ctx } = await mountAll();
	const rec = (op, data) => ({ type: ctx.planEvents.type, data: { op, ...data } });
	ctx.foldInto('plans', [rec('plan', { id: 'p1', title: '甲', body: '# 甲\n\n正文', type: 'plan' })]);

	const tool = ctx.tools.tools.find((entry) => entry.name === 'plan_export');
	assert.ok(tool, 'plan_export 应当注册');
	const agent = { session: { id: 's1', header: { cwd: 'X:/temp/dsh/探针' } }, id: 'a1' };

	const absolute = 'X:/temp/dsh/探针/export-test.md';
	rmSync(absolute, { force: true });
	rmSync('X:/temp/dsh/探针/export-rel.md', { force: true });
	const first = await tool.execute({ plan: 'p1', path: absolute }, { agent });
	assert.equal(first.path, absolute);
	assert.equal(readFileSync(absolute, 'utf8'), '# 甲\n\n正文');
	await assert.rejects(tool.execute({ plan: 'p1', path: absolute }, { agent }), /已存在/);

	// 相对路径按会话工作目录解析，缺扩展名补 .md。
	const relative = await tool.execute({ plan: 'p1', path: 'export-rel' }, { agent });
	assert.equal(relative.path.replace(/\\/g, '/'), 'X:/temp/dsh/探针/export-rel.md');

	rmSync(absolute, { force: true });
	rmSync(relative.path, { force: true });
});

test('子工作区：路径包含关系按目录边界，不按字符串前缀', async () => {
	const { within, normPath } = await load('src/sub-workspace.js');

	assert.equal(normPath('X:/a/B/'), 'x:\\a\\b');
	assert.equal(within('X:/a', 'X:/a/b/c.md'), true);
	assert.equal(within('X:/a', 'X:/a'), true);
	assert.equal(within('X:/a', 'X:/ab/c.md'), false, '/a 不是 /ab 的父目录');
	assert.equal(within('X:/a', 'X:/a2'), false);
	assert.equal(within('', 'X:/a'), false);
});

test('模板：层与小节解析、骨架渲染', async () => {
	const { parseTemplate, renderPlan } = await load('src/template.js');

	const layers = parseTemplate('## A系列\n### 痛点\n- 第一条\n### 验收\n## B系列\n### 目标\n');
	assert.deepEqual(layers.map((layer) => layer.title), ['A系列', 'B系列']);
	assert.deepEqual(layers[0].sections.map((section) => section.title), ['痛点', '验收']);
	assert.deepEqual(layers[0].sections[0].prompts, ['第一条']);

	const text = renderPlan({ title: '甲', goal: '做点什么', done_when: '', where_to_learn: '' }, layers[1]);
	assert.match(text, /^# 甲/m);
	assert.match(text, /### 目标/);
	assert.match(text, /回答：/);
	assert.doesNotMatch(text, /- 判据：/, '空的头部字段整行不写');
});
