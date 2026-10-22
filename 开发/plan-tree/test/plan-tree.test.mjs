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
		/** 权限目录：lock 会往里注入 plan-write 这一档。 */
		permissionPresets: { presets: {} },
		/** catalog-changed 之类的广播，桩里只记事件名。 */
		emitted: [],
		emit(type) {
			ctx.emitted.push(type);
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
	const host = new Set(['tools', 'commands', 'sessionProjections', 'agents', 'permissionPresets']);
	for (const { sub, inject } of mounted) {
		for (const dep of inject) {
			assert.ok(provided.includes(dep) || host.has(dep), `${sub} injects unknown service ${dep}`);
		}
	}

	assert.deepEqual(
		ctx.tools.tools.map((tool) => tool.name).sort(),
		['plan_dispatch', 'plan_export', 'plan_file', 'plan_show', 'plan_status', 'plan_tree', 'plan_write', 'sub_workspace'],
	);
	assert.deepEqual(
		ctx.commands.commands.map((command) => command.name).sort(),
		['plan-adopt', 'plan-new', 'plan-reject', 'plan-shelve', 'plan-status', 'plan-tree', 'sub-workspace'],
	);
	assert.deepEqual([...ctx.sessionProjections.defs.keys()].sort(), ['nodes', 'plans', 'subWorkspaces']);
	assert.equal(ctx.tools.guards.length, 1, '只有锁注册守卫；闸门是纯函数，停轮走 exec.concludeTurn()');
});

test('计划模式预设：注入 plan-write 这一档，卸载只还原自己那条', async () => {
	const { ctx } = await mountAll();
	const lock = await load('src/lock.js');

	const spec = ctx.permissionPresets.presets[lock.PLAN_PRESET];
	assert.ok(spec, 'plan-write 应该出现在权限目录里');
	assert.equal(spec.sandbox, 'workspace-write', '沙箱边界交给宿主，计划模式只在里面收窄');
	assert.equal(spec.approval, 'never', '计划模式不自己发起提权审批');
	assert.ok(ctx.emitted.includes('permission-presets/catalog-changed'), '注入后要重发目录，客户端才看得到');

	const entry = ctx.effects.find((effect) => String(effect.label).includes('plan-write'));
	assert.ok(entry, '注入必须挂在 ctx.effect 上（随 fiber 卸载）');
	const before = ctx.emitted.filter((type) => type === 'permission-presets/catalog-changed').length;
	entry.dispose();
	assert.equal(ctx.permissionPresets.presets[lock.PLAN_PRESET], undefined, '卸载后不留档位');
	assert.equal(
		ctx.emitted.filter((type) => type === 'permission-presets/catalog-changed').length,
		before + 1,
		'卸载后也要重发目录，否则菜单里挂着已失效的档',
	);
});

test('状态机：九态取自 A2A，扳机表与 statusOf 一致', async () => {
	const { STATUS, TRIGGERS, statusOf, labelOf, TERMINAL } = await load('src/state.js');

	const draft = { id: 'p1', status: null };
	const adopted = { id: 'p1', adopted: true };
	const rejected = { id: 'p1', rejected: true };
	const node = (status) => [{ planId: 'p1', status }];

	// 有 status 字段就以字段为准（新记录）；没有才从布尔与节点推（老记录）。
	assert.equal(statusOf(draft, []), null);
	assert.equal(labelOf(null), '草案');
	assert.equal(statusOf(rejected, []), STATUS.REJECTED);
	assert.equal(statusOf(adopted, []), STATUS.SUBMITTED);
	// 节点状态就是九态（v1 的 open/success… 读端会先归一，见下）。
	assert.equal(statusOf(adopted, node(STATUS.WORKING)), STATUS.WORKING);
	assert.equal(statusOf(adopted, node(STATUS.COMPLETED)), STATUS.COMPLETED);
	assert.equal(statusOf(adopted, node(STATUS.FAILED)), STATUS.FAILED);
	assert.equal(statusOf(adopted, node(STATUS.INPUT_REQUIRED)), STATUS.INPUT_REQUIRED);
	assert.equal(statusOf(adopted, node(STATUS.AUTH_REQUIRED)), STATUS.AUTH_REQUIRED);
	// 搁置中的节点被父交付取消之后，计划跟着 canceled。
	assert.equal(statusOf(adopted, node(STATUS.CANCELED)), STATUS.CANCELED);

	// 显式写下的状态优先于旧节点事实：plan_status(p1 → completed) 之后，
	// 节点可能还停在 working（子会话没停稳），树不能把它盖回"进行中"。
	assert.equal(statusOf({ id: 'p1', status: STATUS.COMPLETED }, node(STATUS.WORKING)), STATUS.COMPLETED);
	assert.equal(statusOf({ id: 'p1', status: STATUS.FAILED }, node(STATUS.WORKING)), STATUS.FAILED);
	assert.equal(statusOf({ id: 'p1', status: STATUS.REJECTED }, node(STATUS.WORKING)), STATUS.REJECTED);
	// 采纳（submitted）不是"事实之外的拍板"：派发之后仍应由节点事实说"进行中"。
	assert.equal(statusOf({ id: 'p1', status: STATUS.SUBMITTED }, node(STATUS.WORKING)), STATUS.WORKING);

	// 旧日志（v1 投影）的节点状态仍能推：open/success/reject/shelved → 九态。
	assert.equal(statusOf({ id: 'p1', adopted: true }, node('open')), STATUS.WORKING);
	assert.equal(statusOf({ id: 'p1', adopted: true }, node('success')), STATUS.COMPLETED);
	assert.equal(statusOf({ id: 'p1', adopted: true }, node('reject')), STATUS.FAILED);
	assert.equal(statusOf({ id: 'p1', adopted: true }, node('shelved')), STATUS.INPUT_REQUIRED);

	// 文案与终结态。
	assert.equal(labelOf(STATUS.FAILED), '失败计划');
	assert.equal(labelOf(STATUS.INPUT_REQUIRED), '搁置');
	assert.equal(labelOf(STATUS.AUTH_REQUIRED), '待授权');
	assert.equal(labelOf(STATUS.CANCELED), '已取消');
	assert.ok(TERMINAL.has(STATUS.REJECTED));
	assert.ok(TERMINAL.has(STATUS.CANCELED));
	assert.ok(TERMINAL.has(STATUS.COMPLETED));
	assert.ok(TERMINAL.has(STATUS.FAILED));
	assert.equal(TERMINAL.has(STATUS.WORKING), false);

	// 表里每一行的终态都必须是真实存在的状态之一（草案允许 null）。
	const states = new Set([...Object.values(STATUS), null]);
	for (const row of TRIGGERS) assert.ok(states.has(row.to), `trigger ${row.op} points at unknown state ${row.to}`);
	assert.equal(TRIGGERS.length, 13, '九态 + 取消 + 复盘两类自动动作');
});

test('闸门：层序与类型照旧，模板累计失败只提示不拦', async () => {
	const { check } = await load('src/gate.js');
	const plan = (over) => ({ id: 'p1', type: 'plan', layer: 'B系列-设计', layerIndex: 1, ...over });

	const root = undefined;
	assert.equal(check({ plan: plan(), self: root }).ok, true);

	// 只能往更深的层派。
	const atB = { type: 'plan', layer: 'B系列-设计', layerIndex: 1 };
	assert.equal(check({ plan: plan(), self: atB }).ok, false);
	assert.equal(check({ plan: plan({ layer: 'A系列-问题', layerIndex: 0 }), self: atB }).ok, false);
	assert.equal(check({ plan: plan({ layer: 'C系列-接口', layerIndex: 2 }), self: atB }).ok, true);

	// 同一模板累计失败三次：不拦截（用户否掉了"禁模板"），只给提示。
	const hinted = check({ plan: plan({ layer: 'C系列-接口', layerIndex: 2 }), self: atB, failures: 3 });
	assert.equal(hinted.ok, true, '不再按失败次数拦派发');
	assert.match(hinted.hint, /累计 3 次失败/);
	assert.match(hinted.hint, /复盘/);
	// 不到阈值没有提示。
	assert.equal(check({ plan: plan({ layer: 'C系列-接口', layerIndex: 2 }), self: atB, failures: 2 }).hint, undefined);

	// 研究/复盘没有层坐标：层规则不适用，也不看失败计数。
	const research = check({ plan: { id: 'p2', type: 'research' }, self: atB, failures: 9 });
	assert.equal(research.ok, true);
	assert.equal(research.layer, null);
	const review = check({ plan: { id: 'F1', type: 'review' }, self: atB, failures: 9 });
	assert.equal(review.ok, true);
	assert.equal(review.layer, null);

	// 研究/复盘只能派研究/复盘。
	const fromResearch = { type: 'research', layer: null, layerIndex: null };
	assert.equal(check({ plan: plan(), self: fromResearch }).ok, false);
});

test('折叠：记录、采纳、派发、结算之后，两份投影各自正确', async () => {
	const { ctx } = await mountAll();
	// 直接构造日志里那几行：投影只认 { type, data:{ op, … } }。
	const rec = (op, data) => ({ type: ctx.planEvents.type, data: { op, ...data } });
	const TEMPLATE = 'X:/t/提案格式.md';

	const events = [
		rec('plan', { id: 'p1', title: '甲', layer: 'B系列-设计', layerIndex: 1, type: 'plan', topic: '甲', templatePath: TEMPLATE }),
		rec('adopt', { id: 'p1' }),
		rec('dispatch', { id: 'n1', planId: 'p1', type: 'plan', layer: 'B系列-设计', layerIndex: 1, topic: '甲', reason: 'r', childId: 'c1', parentSession: 'session-x', templatePath: TEMPLATE }),
		rec('file', { id: 'n1', verdict: 'reject', conclusion: '不行', evidence: 'e', artifacts: 'a', pitfalls: 'p', where: 'w' }),
	];

	const plans = ctx.foldInto('plans', events);
	const nodes = ctx.foldInto('nodes', events);

	assert.equal(plans.plans.p1.title, '甲');
	assert.equal(plans.plans.p1.adopted, true, '采纳记在计划上');
	assert.equal(plans.planSeq, 2, 'id 按序发放');
	assert.equal(nodes.nodes.n1.planId, 'p1', '节点认得出自己属于哪份计划');
	assert.equal(nodes.nodes.n1.verdict, 'reject');
	assert.equal(nodes.nodes.n1.status, 'failed', '结算判定落九态');
	assert.equal(nodes.failures['x:/t/提案格式.md'], 1, '失败按模板累计（键已归一）');
	assert.equal(nodes.nextId, 2);

	// 同一模板再来一份，成功结算：失败计数**不归零**（累计，不是按层）。
	ctx.reset();
	const later = [
		...events,
		rec('plan', { id: 'p2', title: '乙', layer: 'B系列-设计', layerIndex: 1, type: 'plan', topic: '乙', templatePath: TEMPLATE }),
		rec('dispatch', { id: 'n2', planId: 'p2', type: 'plan', layer: 'B系列-设计', layerIndex: 1, topic: '乙', reason: 'r', childId: 'c2', parentSession: 'session-x', templatePath: TEMPLATE }),
		rec('file', { id: 'n2', verdict: 'success', conclusion: '成了' }),
	];
	const after = ctx.foldInto('nodes', later);
	assert.equal(after.failures['x:/t/提案格式.md'], 1, '成功不归零：模板失败是累计值');
	assert.equal(after.nodes.n2.status, 'completed');
});

test('显式状态：plan_status 写计划 → 节点不动，但推导与树都认这个状态', async () => {
	const { ctx } = await mountAll();
	const rec = (op, data) => ({ type: ctx.planEvents.type, data: { op, ...data } });
	const events = [
		rec('plan', { id: 'p1', title: '甲', layer: 'B系列-设计', layerIndex: 1, type: 'plan', topic: '甲' }),
		rec('adopt', { id: 'p1' }),
		rec('dispatch', { id: 'n1', planId: 'p1', type: 'plan', layer: 'B系列-设计', layerIndex: 1, topic: '甲', reason: 'r', childId: 'c1', parentSession: 's' }),
		// 用户/模型显式补档：计划完成，但子会话的节点还没停稳（仍 working）。
		rec('status', { id: 'p1', to: 'completed', scope: 'plan' }),
	];
	const plans = ctx.foldInto('plans', events);
	const nodes = ctx.foldInto('nodes', events);

	assert.equal(plans.plans.p1.status, 'completed', '计划记录写上九态码');
	assert.equal(nodes.nodes.n1.status, 'working', '节点状态不被顺带改掉');
	// 关键回归：树不能因为节点还 working 就把计划盖回"进行中"。
	assert.equal(ctx.planStates.statusOf(plans.plans.p1, [nodes.nodes.n1]), 'completed');
});

test('显式状态：plan_status 写节点 → 节点变，计划跟着重推', async () => {
	const { ctx } = await mountAll();
	const rec = (op, data) => ({ type: ctx.planEvents.type, data: { op, ...data } });
	const events = [
		rec('plan', { id: 'p1', title: '甲', layer: 'B系列-设计', layerIndex: 1, type: 'plan', topic: '甲' }),
		rec('adopt', { id: 'p1' }),
		rec('dispatch', { id: 'n1', planId: 'p1', type: 'plan', layer: 'B系列-设计', layerIndex: 1, topic: '甲', reason: 'r', childId: 'c1', parentSession: 's' }),
		// 用户命令 /plan-status auth n1 → 待授权。
		rec('status', { id: 'n1', to: 'auth-required', scope: 'node' }),
	];
	const plans = ctx.foldInto('plans', events);
	const nodes = ctx.foldInto('nodes', events);

	assert.equal(nodes.nodes.n1.status, 'auth-required');
	assert.equal(ctx.planStates.statusOf(plans.plans.p1, [nodes.nodes.n1]), 'auth-required', '计划由节点事实推到待授权');
});

test('锁：普通模式没有认领就不拦；计划模式没有认领全拒', async () => {
	const { ctx } = await mountAll();
	// 守卫不止一个（派发后停轮的也算一个），所以取"第一个拒绝"，不是看第一条注册。
	const guard = (exec) => {
		for (const each of ctx.tools.guards) {
			const verdict = each(exec);
			if (verdict !== undefined) return verdict;
		}
		return undefined;
	};

	const empty = { claims: {} };
	const scoped = { claims: { 'x:\\a\\sub': { path: 'X:/a/sub', planId: 'p1' } } };
	const session = { id: 'session-x', header: { cwd: 'X:/a' } };
	// 真 exec：工具名在 `name`，参数在 `arguments`（老桩的 tool/args 形状同时保留，测兜底）。
	const exec = (tool, args) => ({ agent: { session, id: 'agent' }, name: tool, tool: { name: tool }, args, arguments: args });
	const at = (sandbox, state, preset = null) => {
		ctx.sessionProjections.stateOf = (_session, key) => {
			if (key === 'permissions') return { sandbox, preset };
			if (key === 'subWorkspaces') return state;
			return undefined;
		};
	};

	assert.equal(guard(exec('read', { file_path: 'X:/a/x' })), undefined, '读从不拦');

	// 普通模式：没有认领不拦。新会话开箱即用，锁不负责管它。
	at('workspace-write', empty);
	assert.equal(guard(exec('write', { file_path: 'X:/a/out.md' })), undefined);
	at('read-only', empty);
	assert.equal(guard(exec('pwsh', {})), undefined, '没有范围时连看不出目录的工具也不拦');

	// 普通模式：划了范围只许写范围内。
	at('workspace-write', scoped);
	assert.equal(guard(exec('write', { file_path: 'X:/a/sub/ok.md' })), undefined, '范围内放行');
	assert.match(String(guard(exec('write', { file_path: 'X:/a/out.md' }))), /不在任何子工作区/);
	assert.match(String(guard(exec('pwsh', {}))), /看不出要写哪个目录/);
	// 但命令文本里出现认领目录就放行——模型写文件几乎都用 pwsh。
	assert.equal(guard(exec('pwsh', { command: 'Set-Content X:/a/sub/x.md hi' })), undefined, '命令落在范围内 → 放行');
	assert.match(String(guard(exec('pwsh', { command: 'Set-Content X:/b/y.md hi' }))), /看不出要写哪个目录/, '命令全在范围外 → 拒');
	// 真 exec 只给 arguments 也要能读到路径（老 bug：读 args 永远读空）。
	assert.equal(
		guard({ agent: { session, id: 'agent' }, name: 'write', arguments: { file_path: 'X:/a/sub/ok.md' } }),
		undefined,
		'exec.arguments.file_path 读得到 → 范围内放行',
	);
	assert.match(
		String(guard({ agent: { session, id: 'agent' }, name: 'write', arguments: { file_path: 'X:/a/out.md' } })),
		/不在任何子工作区/,
		'exec.arguments.file_path 也参与范围判断',
	);
	// 相对路径按会话工作区解析（plan_export 允许相对路径）。
	assert.equal(guard(exec('plan_export', { plan: 'p1', path: 'sub/ok.md' })), undefined, '相对路径落在范围内 → 放行');

	// 普通模式：完全权限整套跳过。
	at('danger-full-access', scoped);
	assert.equal(guard(exec('write', { file_path: 'X:/anywhere.md' })), undefined);

	// 计划模式：没有子工作区 = 写工具全拒（跟真的计划模式一样）。
	at('workspace-write', empty, 'plan-write');
	const denied = String(guard(exec('write', { file_path: 'X:/a/out.md' })));
	assert.match(denied, /计划模式/);
	assert.match(denied, /没有声明任何子工作区/);
	assert.match(denied, /当前工作区：X:\/a/, '拒绝文案要写清当前工作区');
	assert.match(denied, /已声明范围：（无）/, '拒绝文案要写清已声明范围');
	assert.match(denied, /已知代价/, '拒绝文案要写清"计划模式下连只读命令也会被拒"的代价');
	assert.match(String(guard(exec('pwsh', { command: 'Get-ChildItem' }))), /计划模式/, '计划模式下连只读 pwsh 也被拒');
	assert.match(String(guard(exec('delete', { path: 'X:/a/x.md' }))), /计划模式/, 'delete 同样算写');
	assert.match(String(guard(exec('plan_export', { plan: 'p1', path: 'X:/a/out.md' }))), /计划模式/, 'plan_export 也走写锁');
	assert.equal(guard(exec('read', { file_path: 'X:/a/x' })), undefined, '计划模式不影响读工具');

	// 计划模式：有范围只许范围内。
	at('workspace-write', scoped, 'plan-write');
	assert.equal(guard(exec('write', { file_path: 'X:/a/sub/ok.md' })), undefined, '计划模式范围内容放行');
	assert.match(String(guard(exec('write', { file_path: 'X:/a/out.md' }))), /计划模式/);
	assert.equal(guard(exec('pwsh', { command: 'Set-Content X:/a/sub/x.md hi' })), undefined);
	assert.match(String(guard(exec('pwsh', { command: 'Set-Content X:/b/y.md hi' }))), /计划模式/);

	// 计划模式压过 danger-full-access：用户显式选的档优先。
	at('danger-full-access', empty, 'plan-write');
	assert.match(String(guard(exec('write', { file_path: 'X:/anywhere.md' }))), /计划模式/, '计划模式是显式范围，不能被 sandbox 绕过');

	// 逃生口 /plan-tree off：计划模式也能放开。
	at('workspace-write', empty, 'plan-write');
	ctx.commands.commands.find((command) => command.name === 'plan-tree').handler({ agent: { session, id: 'agent' }, rawInput: 'off' });
	assert.equal(guard(exec('write', { file_path: 'X:/anywhere.md' })), undefined, '/plan-tree off 是逃生口，计划模式也认');
});

test('树简报：只报标题与状态，内容是 plan_show 的事', async () => {
	const { ctx } = await mountAll();
	const rec = (op, data) => ({ type: ctx.planEvents.type, data: { op, ...data } });
	const TEMPLATE = 'X:/t/提案格式.md';
	const events = [
		rec('plan', { id: 'p1', title: '甲', layer: 'B系列-设计', layerIndex: 1, type: 'plan', topic: '甲', dir: '计划/15-计划即提案', body: '# 甲\n\n正文', templatePath: TEMPLATE }),
		rec('adopt', { id: 'p1' }),
		rec('dispatch', { id: 'n1', planId: 'p1', type: 'plan', layer: 'B系列-设计', layerIndex: 1, topic: '甲', reason: '试试', childId: 'c1', parentSession: 's', templatePath: TEMPLATE }),
		rec('file', { id: 'n1', verdict: 'reject', conclusion: '不行', evidence: 'e', artifacts: 'a', pitfalls: '沙箱里 pwsh 起不来', where: 'w' }),
	];
	const nodes = ctx.foldInto('nodes', events);
	const plans = ctx.foldInto('plans', events);
	const { renderTree, renderPlan } = await load('src/tree.js');

	const out = renderTree(nodes, plans, ctx.planStates);
	assert.match(out.tree, /p1 \[B系列-设计\] 失败计划/);
	assert.ok(out.tree.includes('【计划/15-计划即提案】'), '计划行要带提案文件夹，结算才指得回去');
	assert.match(out.tree, /n1 \[B系列-设计\] 失败计划/, '节点状态用九态文案，不露码值');
	assert.match(out.failures, /提案格式\.md:1/, '失败按模板计数');
	assert.match(out.failures, /每 3 次建一份复盘/);
	// 树是索引：正文、派发理由、结算都不在这里。
	assert.doesNotMatch(out.tree, /坑：/);
	assert.doesNotMatch(out.tree, /派发：/);
	assert.doesNotMatch(out.tree, /正文/);

	// 内容在展开层：一份提案的正文 + 它每个节点的结算。
	const open = renderPlan(plans.plans.p1, [nodes.nodes.n1], ctx.planStates);
	assert.match(open, /正文/, '展开要能看到提案正文');
	assert.match(open, /派发理由：试试/);
	assert.match(open, /坑：沙箱里 pwsh 起不来/, '为什么进行不下去在展开层读');
	assert.match(open, /判定：reject/);

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
