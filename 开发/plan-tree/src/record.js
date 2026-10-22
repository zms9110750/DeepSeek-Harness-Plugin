/**
 * plan-record · 计划记录的持久化与用户决定。
 *
 * 计划**不落盘**：正文是日志里的一条可忽略记录（`op:'plan'`），投影 `plans`
 * 把它带给面板。所以只读会话也能记计划——它不动工作区，也就绕不过权限；
 * 而 agent 循环只把 surface 事件映射成消息，这条记录不进上下文。
 *
 * 这里也是"用户对草案做了什么"的唯一入口：采纳、否决、搁置。
 * 状态本身怎么算在 plan-state 里，这里只写事件。
 *
 * @module @local/plan-tree/record
 */
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { defineTool } from '@deepseek-ai/dsh-tools';

export const name = 'plan-record';

export const inject = ['tools', 'commands', 'sessionProjections', 'planEvents', 'proposalTemplate', 'planStates'];

const stateSchema = z.object({
	plans: z.record(z.string(), z.any()),
	planSeq: z.number(),
});

/** 文件名安全的名字；保留中日韩，去掉标点与空白。 */
export function slugify(title) {
	const cleaned = String(title)
		.trim()
		.replace(/[\\/:*?"<>|\s]+/g, '-')
		.replace(/-+/g, '-')
		.replace(/^-|-$/g, '');
	return cleaned === '' ? randomUUID().slice(0, 8) : cleaned.slice(0, 60);
}

export function apply(ctx) {
	const { append, opOf } = ctx.planEvents;
	const template = ctx.proposalTemplate;

	const init = () => ({ plans: {}, planSeq: 1 });

	const fold = (state, event) => {
		const op = opOf(event);
		const data = event.data;

		if (op === 'plan') {
			return {
				...state,
				planSeq: state.planSeq + 1,
				// 草案还不是一个 task，所以 status 为空；采纳之后才变成 submitted。
				// 复盘任务（F 系列）也走这条路：它先是草案，用户采纳后才派。
				plans: { ...state.plans, [data.id]: { ...data, adopted: false, status: null } },
			};
		}

		if (op === 'adopt' || op === 'reject-draft' || op === 'shelve-draft' || op === 'status') {
			// status op 也可能指向节点（n1），那不是计划的状态，别在这里改。
			if (op === 'status' && /^n\d+$/u.test(String(data.id ?? ''))) return state;
			const plan = state.plans[data.id];
			if (plan === undefined) return state;
			// 状态词汇与转移只在 plan-state 一处定义；这里不自己写 if/else。
			const patch = ctx.planStates?.planPatchAfter?.(op, data);
			if (patch === undefined) return state;
			return { ...state, plans: { ...state.plans, [plan.id]: { ...plan, ...patch } } };
		}

		return state;
	};

	ctx.sessionProjections.register({
		key: 'plans',
		stateVersion: 2,
		stateSchema,
		init,
		apply: fold,
		wire: { viewSchema: stateSchema, view: (state) => state },
	});

	const plansOf = (agent) => {
		const state = ctx.sessionProjections.stateOf(agent.session, 'plans');
		if (!state) throw new Error('plans 投影不可用：没有装 plan-record？');
		return state;
	};

	/** id 优先，其次认老的"文件路径"引用。 */
	const byRef = (state, ref) => {
		const text = String(ref ?? '').trim();
		if (text === '') return undefined;
		const plan = state.plans[text];
		if (plan !== undefined) return plan;
		return Object.values(state.plans).find((candidate) => candidate.path === text);
	};

	/** 唯一的"记一份计划"实现：模型和面板走同一条路。 */
	const createPlan = (agent, args) => {
		const state = plansOf(agent);
		const research = args.type === 'research';
		const templatePath = template.resolve(args.template);

		let layer = { title: '研究', sections: [] };
		let layerIndex = null;
		if (!research) {
			const layers = template.load(templatePath);
			const asked = String(args.layer ?? '').trim();
			layerIndex = layers.findIndex(
				(candidate) => candidate.title === asked || candidate.title.toUpperCase().startsWith(asked.toUpperCase()),
			);
			if (layerIndex < 0) {
				throw new Error(
					`plan_write: no layer "${asked}" in ${templatePath}; available: ` +
						layers.map((candidate) => candidate.title).join(' / '),
				);
			}
			layer = layers[layerIndex];
		}

		const id = `p${state.planSeq}`;
		append(agent.session, 'plan', {
			id,
			title: args.title,
			body: template.render(args, layer),
			// 提案所在的文件夹（人写的那份文档在这儿），结算据此指回来。
			dir: String(args.dir ?? '').trim() || null,
			type: research ? 'research' : 'plan',
			layer: layer.title,
			layerIndex,
			templatePath,
			topic: args.title,
			// 用户自拟的计划可能没有目的/判据/去处：记录里给标题兜底，派发时子会话不会读到空值。
			goal: String(args.goal ?? '').trim() || String(args.title ?? ''),
			done_when: String(args.done_when ?? '').trim(),
			where_to_learn: String(args.where_to_learn ?? '').trim(),
			author: args.author === 'user' ? 'user' : 'model',
			createdAt: Date.now(),
			parentSession: agent.session.id,
		});
		return { id };
	};

	ctx.tools.register(
		defineTool({
			name: 'plan_write',
			description:
				'Record one plan for the user to review. The plan lives in this session\'s log as an ignorable plugin record — ' +
				'nothing is written to the workspace and nothing enters the conversation, so this is allowed even while the session is read-only. ' +
				'It does not dispatch anything: the user adopts it in the plan panel, and dispatching is a separate call.',
			parameters: {
				title: { type: 'string', required: true, description: 'Heading of the plan.' },
				goal: { type: 'string', required: true, description: 'What this plan is for.' },
				done_when: { type: 'string', required: true, description: 'How the work will be judged finished.' },
				where_to_learn: { type: 'string', required: true, description: 'Where to look when the executor does not know how.' },
				body: { type: 'string', description: 'Optional free text appended after the template skeleton.' },
				type: { type: 'string', enum: ['plan', 'research'], description: 'plan (default) or research.' },
				layer: { type: 'string', description: 'Layer for a plan; omit for research.' },
				template: { type: 'string', description: 'Template markdown file whose ## layers and - sections shape the document.' },
				dir: { type: 'string', description: 'Proposal folder this plan belongs to (for example 计划/15-计划即提案). Recorded so that a settlement can be traced back to the proposal it came from.' },
			},
			output: {
				schema: { type: 'object', additionalProperties: false, properties: { id: { type: 'string', required: true } } },
				render: (_args, value) => [{ type: 'text', text: `recorded plan ${value.id}` }],
			},
			execute(args, exec) {
				if (!exec.agent) throw new Error('plan_write requires an owning agent session');
				return createPlan(exec.agent, args);
			},
		}),
	);

	// ---- 导出：唯一一条把计划写进工作区的路，而且必须是显式动作 ----
	ctx.tools.register(
		defineTool({
			name: 'plan_export',
			description:
				'Export one recorded plan to a markdown file — for example into `docs/` — when the user wants a document. ' +
				'Plans themselves are never files and nothing is written automatically: this tool is the only way out, ' +
				'it is an explicit action, and the write goes through the same write lock as any other write.',
			parameters: {
				plan: { type: 'string', required: true, description: 'Plan id from plan_write, for example p3.' },
				path: { type: 'string', required: true, description: 'Target path: absolute, or relative to the session working directory. A missing extension becomes .md.' },
				overwrite: { type: 'boolean', description: 'Replace an existing file. Defaults to false.' },
			},
			output: {
				schema: {
					type: 'object',
					additionalProperties: false,
					properties: {
						path: { type: 'string', required: true },
						bytes: { type: 'integer', required: true },
					},
				},
				render: (_args, value) => [{ type: 'text', text: `exported to ${value.path} (${value.bytes} bytes)` }],
			},
			execute(args, exec) {
				const agent = exec.agent;
				if (!agent) throw new Error('plan_export requires an owning agent session');
				const state = plansOf(agent);
				const plan = byRef(state, args.plan);
				if (plan === undefined) throw new Error(`plan_export: 没有这份计划：${args.plan}`);

				const body = typeof plan.body === 'string' && plan.body !== ''
					? plan.body
					// 0.15.x 的老记录只有文件：把它读回来，导出的东西才完整。
					: (() => {
							if (typeof plan.path !== 'string' || plan.path === '') {
								throw new Error(`plan_export: ${plan.id} 没有正文（老记录也没有文件可读）`);
							}
							try {
								return readFileSync(plan.path, 'utf8');
							} catch (error) {
								throw new Error(`plan_export: 读不到 ${plan.path}：${String(error?.message ?? error)}`);
							}
						})();

				const cwd = agent.session.header.cwd ?? process.cwd();
				let target = String(args.path ?? '').trim();
				if (target === '') throw new Error('plan_export: 目标路径不能为空');
				if (!isAbsolute(target)) target = join(cwd, target);
				if (target.toLowerCase().endsWith('.md') === false && /\.[a-z0-9]+$/i.test(target) === false) target = `${target}.md`;

				if (existsSync(target) && args.overwrite !== true) {
					throw new Error(`plan_export: ${target} 已存在；要覆盖就传 overwrite: true`);
				}
				mkdirSync(dirname(target), { recursive: true });
				writeFileSync(target, body, 'utf8');
				return { path: target, bytes: statSync(target).size };
			},
		}),
	);

	// ---- 采纳**不在**这里 ----
	// 采纳是用户的决定：面板按钮，或 `/plan-adopt` 命令（下面注册）。模型没有这个工具，
	// 所以它不能自己批准自己的计划。开发期要让 agent 自己走完闭环，装 `@local/plan-debug`，
	// 那条授权在那个包里，拆掉即恢复。

	// ---- 用户对草案的决定：三条命令，面板和输入框都走它们 ----
	const decideByRef = (rawInput, decide) => {
		const ref = String(rawInput ?? '').trim();
		if (ref === '') return { kind: 'error', text: '用法：/plan-adopt <计划 id，如 p3>（老计划也可以用文件路径）' };
		try {
			return { kind: 'success', text: decide(ref) };
		} catch (error) {
			return { kind: 'error', text: String(error?.message ?? error) };
		}
	};

	ctx.commands.register({
		name: 'plan-adopt',
		description: '采纳一份计划（面板按钮调用）',
		input: { hint: '<计划 id>' },
		recordInput: false,
		handler({ agent, rawInput }) {
			return decideByRef(rawInput, (ref) => {
				const state = plansOf(agent);
				const plan = byRef(state, ref);
				if (plan === undefined) throw new Error(`没有这份计划：${ref}`);
				if (plan.rejected === true) throw new Error(`${plan.id} 已被否决，另写一份`);
				if (plan.adopted !== true) append(agent.session, 'adopt', { id: plan.id });
				return `已采纳 ${plan.id}`;
			});
		},
	});

	ctx.commands.register({
		name: 'plan-reject',
		description: '否决一份计划草案（面板按钮调用）',
		input: { hint: '<计划 id>' },
		recordInput: false,
		handler({ agent, rawInput }) {
			return decideByRef(rawInput, (ref) => {
				const state = plansOf(agent);
				const plan = byRef(state, ref);
				if (plan === undefined) throw new Error(`没有这份计划：${ref}`);
				if (plan.rejected !== true) append(agent.session, 'reject-draft', { id: plan.id });
				return `已否决 ${plan.id}`;
			});
		},
	});

	ctx.commands.register({
		name: 'plan-shelve',
		description: '搁置 / 取消搁置一份计划草案（面板按钮调用）',
		input: { hint: '<计划 id>' },
		recordInput: false,
		handler({ agent, rawInput }) {
			return decideByRef(rawInput, (ref) => {
				const state = plansOf(agent);
				const plan = byRef(state, ref);
				if (plan === undefined) throw new Error(`没有这份计划：${ref}`);
				if (plan.adopted === true) throw new Error(`${plan.id} 已采纳，不能搁置`);
				if (plan.rejected === true) throw new Error(`${plan.id} 已否决，不能搁置`);
				const shelved = plan.shelved !== true;
				append(agent.session, 'shelve-draft', { id: plan.id, shelved });
				return shelved ? `已搁置 ${plan.id}` : `已取消搁置 ${plan.id}`;
			});
		},
	});

	// 面板的「新建计划」：一行 JSON 进，和 plan_write 走同一条写路径。
	ctx.commands.register({
		name: 'plan-new',
		description: '面板新建一份计划（JSON：{title, layer, body}）',
		input: { hint: '{"title":"…","layer":"…","body":"…"}' },
		recordInput: false,
		handler({ agent, rawInput }) {
			let payload;
			try {
				payload = JSON.parse(String(rawInput ?? '').trim() === '' ? '{}' : String(rawInput).trim());
			} catch {
				return { kind: 'error', text: '新建计划要一行 JSON：{"title":"…","layer":"…","body":"…"}' };
			}
			const title = String(payload?.title ?? '').trim();
			if (title === '') return { kind: 'error', text: '新建计划缺少标题' };
			const layer = String(payload?.layer ?? '').trim() || 'A';
			try {
				const { id } = createPlan(agent, {
					title,
					type: 'plan',
					layer,
					goal: String(payload?.goal ?? '').trim(),
					done_when: String(payload?.done_when ?? '').trim(),
					where_to_learn: String(payload?.where_to_learn ?? '').trim(),
					body: String(payload?.body ?? ''),
					author: 'user',
				});
				return { kind: 'success', text: `已登记 ${id}：${title}（${layer}）` };
			} catch (error) {
				return { kind: 'error', text: String(error?.message ?? error) };
			}
		},
	});

	// ---- 状态的写入口 ----
	// 状态是九态，但**不是谁都能写**：白名单在 plan-state（MODEL_WRITABLE / assertStatusWriter）。
	// 模型侧只开放"由执行事实推导"的那几个；auth-required 与 rejected 只能由用户命令写；
	// canceled 只由宿主在父交付时自动写——这里没有工具能让模型把节点标成"待授权/已取消"。

	const STATUS_ALIAS = {
		working: 'working', 进行中: 'working', resume: 'working', 恢复: 'working',
		completed: 'completed', 完成: 'completed',
		failed: 'failed', 失败: 'failed', fail: 'failed',
		'input-required': 'input-required', 搁置: 'input-required', hold: 'input-required',
		'auth-required': 'auth-required', 授权: 'auth-required', auth: 'auth-required',
		rejected: 'rejected', 否决: 'rejected', reject: 'rejected',
	};

	ctx.tools.register(
		defineTool({
			name: 'plan_status',
			description:
				'Set the nine-state status of one dispatched node or plan. Model-writable subset only: working, completed, ' +
				'failed, input-required. auth-required is the user\'s call, rejected is the user\'s call, and canceled happens ' +
				'automatically when a parent delivers — those are refused here, see the error for who may write them.',
			parameters: {
				target: { type: 'string', required: true, description: 'Node id (n3) or plan id (p2 / F1).' },
				status: {
					type: 'string',
					required: true,
					enum: ['working', 'completed', 'failed', 'input-required'],
					description: 'Next status. Only the model-writable subset is exposed.',
				},
				reason: { type: 'string', description: 'One line: why this status now (kept in the record).' },
			},
			output: {
				schema: {
					type: 'object',
					additionalProperties: false,
					properties: { target: { type: 'string', required: true }, status: { type: 'string', required: true } },
				},
				render: (_args, value) => [{ type: 'text', text: `${value.target} → ${ctx.planStates?.labelOf?.(value.status) ?? value.status}` }],
			},
			execute(args, exec) {
				if (!exec.agent) throw new Error('plan_status requires an owning agent session');
				// 守卫：模型只允许写白名单里的状态；越界直接抛错并说明该找谁。
				ctx.planStates?.assertStatusWriter?.('model', args.status);
				const id = String(args.target ?? '').trim();
				if (id === '') throw new Error('plan_status: target 不能为空');
				append(exec.agent.session, 'status', {
					id,
					to: args.status,
					scope: /^n\d+$/u.test(id) ? 'node' : 'plan',
					reason: String(args.reason ?? '').trim() || null,
					by: 'model',
				});
				return { target: id, status: args.status };
			},
		}),
	);

	// 用户命令：auth-required 与 rejected 的唯一写法（没有对应工具，模型调不到）。
	// 用法：/plan-status auth n3  或  /plan-status n3 auth
	ctx.commands.register({
		name: 'plan-status',
		description: '用户设置状态（auth / reject / hold / resume / fail / complete），模型无权',
		input: { hint: '<状态> <节点或计划 id>' },
		recordInput: false,
		handler({ agent, rawInput }) {
			const tokens = String(rawInput ?? '').trim().split(/\s+/u).filter((token) => token !== '');
			if (tokens.length < 2) return { kind: 'error', text: '用法：/plan-status auth <id>（或 /plan-status <id> auth）' };
			const asStatus = (token) => STATUS_ALIAS[token] ?? STATUS_ALIAS[token.replace(/^-/u, '')] ?? undefined;
			const declared = asStatus(tokens[0]);
			const declaredSecond = asStatus(tokens[1]);
			const to = declared ?? declaredSecond;
			const id = declared === undefined ? tokens[0] : tokens[1];
			if (to === undefined) {
				return { kind: 'error', text: `不认识的状态「${tokens[0]}」；可用：${Object.keys(STATUS_ALIAS).join(' / ')}` };
			}
			if (id === undefined || id === '') return { kind: 'error', text: '缺少节点或计划 id' };
			try {
				// 用户也不能写 canceled / unspecified：那两个归属宿主动作。
				ctx.planStates?.assertStatusWriter?.('user', to);
				append(agent.session, 'status', {
					id,
					to,
					scope: /^n\d+$/u.test(id) ? 'node' : 'plan',
					reason: null,
					by: 'user',
				});
				return { kind: 'success', text: `已把 ${id} 置为 ${ctx.planStates?.labelOf?.(to) ?? to}` };
			} catch (error) {
				return { kind: 'error', text: String(error?.message ?? error) };
			}
		},
	});
}

