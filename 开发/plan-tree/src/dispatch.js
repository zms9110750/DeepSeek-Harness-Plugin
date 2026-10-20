/**
 * plan-dispatch · 把一份已采纳的计划派成一条分支。
 *
 * 顺序是有讲究的：
 *   1. 先认领工作区（如果带 workspace）——这条事件必须落在分叉边界**之前**，
 *      否则子会话看不见自己的写范围，会在自己的目录里被锁成只读；
 *   2. 再把派发事件写进父日志（必须是 ignorable 的插件记录）；
 *   3. 用父日志拼种子，边界就是刚才那条事件（含）；
 *   4. 建子会话（origin:'subagent'，不进会话列表）；
 *   5. 把工单塞进子的收件箱，它停稳后把最后一条消息带回父。
 *
 * @module @local/plan-tree/dispatch
 */
import { randomUUID } from 'node:crypto';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { buildForkSeed } from '@deepseek-ai/dsh-session/fork';
import { createUserMessage, boundContextSummary } from '@deepseek-ai/dsh-llm';

export const name = 'plan-dispatch';

export const inject = ['tools', 'agents', 'sessionProjections', 'planEvents', 'planGate'];

const SETTLEMENT_KEYS = ['verdict', 'conclusion', 'evidence', 'artifacts', 'pitfalls', 'where'];
const VERDICTS = ['success', 'reject', 'shelved'];

/**
 * 写进工单的六行格式。权威是 `计划/结算格式.md`（出口锚那份文件）：
 * 改那边就要改这里——两处必须一致，否则子按一套写、父按另一套解析。
 */
const SETTLEMENT = [
	'verdict: success | reject | shelved — your own call on whether the goal was met.',
	'conclusion: what was done, or what could not be done. One line.',
	'evidence: how it was confirmed — command and reading, file path and line.',
	'artifacts: paths created or changed, one per line.',
	'pitfalls: the route that was tried and does not work, one line.',
	'where: which node or file to read for the detail.',
].join('\n');

/** 读子会话最后一条助手消息里的六行结算；缺项或裁决不认识就返回 undefined。 */
export function parseSettlement(body) {
	const fields = {};
	let current;
	for (const line of String(body).split(/\r?\n/)) {
		const match = /^(verdict|conclusion|evidence|artifacts|pitfalls|where)\s*:\s*(.*)$/i.exec(line);
		if (match !== null) {
			current = match[1].toLowerCase();
			fields[current] = match[2];
			continue;
		}
		if (current !== undefined) fields[current] += `\n${line}`;
	}
	const verdict = String(fields.verdict ?? '').trim().toLowerCase();
	if (!VERDICTS.includes(verdict)) return undefined;
	for (const key of SETTLEMENT_KEYS) {
		if (String(fields[key] ?? '').trim() === '') return undefined;
	}
	return { ...fields, verdict };
}

export function apply(ctx) {
	const { append } = ctx.planEvents;
	const gate = ctx.planGate;

	/**
	 * 卸载闸门：回传是挂在子会话上的异步续体，插件被关掉之后它还会醒过来。
	 * 没有这个闸门，它会在自己的 fiber 已经销毁之后继续往日志里写记录。
	 */
	let disposed = false;
	ctx.effect(() => () => {
		disposed = true;
	}, 'plan-dispatch: 卸载闸门');

	ctx.tools.register(
		defineTool({
			name: 'plan_dispatch',
			description:
				'Dispatch an adopted plan as its own forked session, and record it as a node in the plan tree. ' +
				'The child inherits this session up to the moment of dispatch; this session will only receive its final answer. ' +
				'The gate refuses a plan that is not deeper than the layer this session occupies, or whose layer already ' +
				'has too many consecutive rejections — dispatch a research node first in that case.',
			parameters: {
				plan: { type: 'string', required: true, description: 'Adopted plan id from plan_write (for example p1).' },
				reason: { type: 'string', required: true, description: 'One-line reason this node exists, for the tree.' },
				workspace: { type: 'string', description: 'Writable directory this child owns. Children cannot change it.' },
			},
			output: {
				schema: {
					type: 'object',
					additionalProperties: false,
					properties: {
						id: { type: 'string', required: true },
						childId: { type: 'string', required: true },
						layer: { type: 'string' },
					},
				},
				render: (_args, value) => [{ type: 'text', text: `dispatched ${value.id} as child session ${value.childId}` }],
			},
			async execute(args, exec) {
				const agent = exec.agent;
				if (!agent) throw new Error('plan_dispatch requires an owning agent session');

				const plans = ctx.sessionProjections.stateOf(agent.session, 'plans');
				if (!plans) throw new Error('plan_dispatch: the plans projection is not available in this session');
				const tree = ctx.sessionProjections.stateOf(agent.session, 'nodes');
				if (!tree) throw new Error('plan_dispatch: the nodes projection is not available in this session');

				const plan = plans.plans[args.plan];
				if (plan === undefined) throw new Error(`plan_dispatch: no plan "${args.plan}" — write it with plan_write first`);
				// 采纳是分叉的前提。
				if (plan.adopted !== true) {
					throw new Error(`plan_dispatch: plan "${args.plan}" has not been adopted — adopt it in the plan panel first`);
				}

				const self = gate.selfNode(tree.nodes, agent.session.id);
				const verdict = gate.check({ plan, self, counts: tree.counts });
				if (!verdict.ok) throw new Error(verdict.reason);

				const id = `n${tree.nextId}`;
				const childId = `session-${randomUUID()}`;

				// 1. 先认领工作区：这条事件必须在分叉边界之前，子才看得见自己的写范围。
				const workspace = typeof args.workspace === 'string' && args.workspace.trim() !== '' ? args.workspace.trim() : undefined;
				if (workspace !== undefined) {
					const scopes = ctx.get('subWorkspaces');
					if (scopes === undefined) throw new Error('plan_dispatch: 没有装 sub-workspace，不能指定工作区');
					scopes.claim(agent, workspace, plan.id);
				}

				const prompt = [
					`You are executing plan node ${id}${verdict.layer === null ? ' (research)' : ` (layer ${verdict.layer})`}.`,
					'',
					`Topic: ${plan.topic}`,
					`Goal: ${plan.goal}`,
					`Done when: ${plan.done_when}`,
					`Where to learn how: ${plan.where_to_learn}`,
					...(workspace === undefined ? [] : [`Writable directory: ${workspace}`]),
					// 计划正文在日志里、不在消息里：子会话看不到它，除非写进这张工单。
					...(typeof plan.body === 'string' && plan.body.trim() !== ''
						? ['', 'The plan you are executing:', '', plan.body]
						: []),
					'',
					'Work in this session. The parent does not see your messages or tool calls — it receives only your final answer.',
					'When you finish, reply with exactly these six lines and nothing else, so the parent can file them:',
					SETTLEMENT,
				].join('\n');

				// 2. 派发事件写进父日志。
				append(agent.session, 'dispatch', {
					id,
					parentSession: agent.session.id,
					planId: plan.id,
					type: verdict.type,
					layer: verdict.layer,
					layerIndex: verdict.layerIndex,
					topic: plan.topic,
					reason: args.reason,
					childId,
				});

				// 3. 用父日志拼种子，边界就是刚才那条事件（含）。
				const events = agent.session.snapshotEvents();
				const boundary = events.length - 1;
				const seed = buildForkSeed(events, boundary);

				// 4. 建子会话。
				const presets = ctx.get('agentPresets');
				const presetId = presets?.composedPreset?.(agent.ctx);
				const selection = ctx.get('agentDefaultModel')?.currentSelection?.();
				const header = agent.session.header;
				const cwd = workspace ?? header.cwd;
				const meta = {
					...(cwd === undefined ? {} : { cwd }),
					...(presetId === undefined ? {} : { agentPreset: presetId }),
					parentSession: header.id,
					isSeeded: true,
					origin: 'subagent',
					delegationDepth: (header.delegationDepth ?? 0) + 1,
				};

				let handle;
				try {
					handle = await ctx.agents.create({
						sessionId: childId,
						parentAgent: agent,
						meta,
						seed,
						inheritedEventCount: boundary + 1,
						...(selection === undefined ? {} : { agentOptions: selection }),
						...(presetId === undefined || presets === undefined
							? {}
							: { setup: async (childCtx) => { await presets.mount(childCtx, presetId); } }),
					});
				} catch (error) {
					// 事件已经写进日志，但子会话没建成。别留一个永远 open 的幽灵节点。
					append(agent.session, 'file', {
						id,
						verdict: 'shelved',
						conclusion: `派发失败，未建成子会话：${String(error?.message ?? error)}`,
						evidence: 'ctx.agents.create() 抛出',
						artifacts: '无',
						pitfalls: '节点已写入日志但无对应会话',
						where: '本会话日志',
					});
					throw error;
				}

				// 5. 接线：工单进子的收件箱；停稳后把它最后一段话带回父。
				const child = handle.agent ?? handle;
				if (typeof child.followup !== 'function') {
					throw new Error('plan_dispatch: the created child does not expose followup()');
				}
				child.followup(createUserMessage({ content: [{ type: 'text', text: prompt }], source: { kind: 'user' } }));

				const settle = child.whenIdle ?? handle.whenIdle;
				if (typeof settle === 'function') {
					Promise.resolve(settle.call(child))
						.then(() => {
							// 插件已经卸载：这条回传不再属于任何活着的 fiber，丢掉。
							if (disposed) return;
							const tail = child.session.snapshotEvents().slice(-40);
							const last = [...tail].reverse().find((event) => event.type === 'assistant/message');
							const blocks = last?.data?.message?.content ?? [];
							const body =
								blocks.filter((block) => block.type === 'text').map((block) => block.text).join('\n\n') ||
								'(no final text)';
							const text = `[node ${id} finished]\n${body}`;
							// 子自己报了六行就直接归档，不再要父手工 plan_file。
							const settlement = parseSettlement(body);
							let autoFiled = false;
							if (settlement !== undefined) {
								try {
									append(agent.session, 'file', { id, ...settlement });
									autoFiled = true;
								} catch {
									autoFiled = false;
								}
							}
							// 宿主消息只能走 user/message：system/message 是步骤内的面事件，
							// 异步回传时根本没有打开的步骤，写进去必炸。
							const firstLine = body.split('\n')[0]?.trim() || `node ${id}`;
							const note = autoFiled
								? `[已自动归档：${settlement.verdict}]`
								: '[未自动归档：子没按六行回报，需要父手工 plan_file]';
							if (typeof agent.followup === 'function') {
								agent.followup(
									createUserMessage({
										content: [{ type: 'text', text: `${text}\n\n${note}` }],
										source: {
											kind: 'subagent-settled',
											form: 'notice',
											summary: boundContextSummary(firstLine),
											senderSessionId: childId,
										},
									}),
								);
							}
						})
						.catch(() => {});
				}

				return { id, childId, ...(verdict.layer === null ? {} : { layer: verdict.layer }) };
			},
		}),
	);
}
