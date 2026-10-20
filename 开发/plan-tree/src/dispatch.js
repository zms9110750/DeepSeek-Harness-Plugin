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
 * 要不要用分叉种子建子会话。
 *
 * 这个宿主上带种子会失败（`api-session/added ... not lossless JSON`，内置 `subagent_fork`
 * 同样失败），而且失败是"半成功"的：会话建出来了、转发炸了，于是不能靠重试兜底。
 * 所以先关掉——子会话照样干活，只是不继承父的上下文，工单里会写明。
 * 宿主修好后把这里改回 `true`，其余代码不用动。
 */
const USE_FORK_SEED = true;

/**
 * 「人工分叉」：宿主的分叉通道不可用时，把父会话最近的 surface 事件（用户与助手
 * 的纯文本）压成一段前缀注入子会话。
 *
 * 它替代不了真正的 fork——没有 KV cache 复用，也丢了工具结果——但它是**语义**的
 * 等价物：子会话因此知道这一段在做什么，而不只是拿到一张工单。
 * 从后往前取，先保证最近的几轮在里面。
 *
 * @param events - 父会话的事件数组。
 * @param limit - 最多取多少条消息。
 * @param budget - 字符预算，超出就从最旧的开始丢。
 */
export function contextDigest(events, limit = 24, budget = 12000) {
	const lines = [];
	for (const event of events) {
		if (event.type !== 'user/message' && event.type !== 'assistant/message') continue;
		const blocks = event.data?.message?.content ?? [];
		const text = blocks
			.filter((block) => block?.type === 'text')
			.map((block) => String(block.text ?? ''))
			.join('\n')
			.trim();
		if (text === '') continue;
		lines.push(`${event.type === 'user/message' ? '用户' : '助手'}：${text}`);
	}
	const picked = lines.slice(-limit);
	const kept = [];
	let used = 0;
	for (let index = picked.length - 1; index >= 0; index -= 1) {
		const entry = picked[index];
		if (used + entry.length > budget) break;
		kept.unshift(entry);
		used += entry.length;
	}
	return kept.join('\n\n');
}

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
					// 提案文件夹跟着节点走：结算因此能指回它出自哪份提案。
					dir: plan.dir ?? null,
					type: verdict.type,
					layer: verdict.layer,
					layerIndex: verdict.layerIndex,
					topic: plan.topic,
					reason: args.reason,
					childId,
				});

				// 3. 拼分叉种子。**这个宿主上先不用**：带种子建会话会在事件转发时抛
				//      forwarded host event "api-session/added" argument 0 is not lossless JSON data
				//    （内置 subagent_fork 同样失败，与本插件无关）。而且那次失败是**半成功**的：
				//    会话已经建出来了，只是转发炸了——所以"失败了再重试一次不带种子"会撞上
				//    那个半建的会话，报 `unseeded session inherited event count must be 0`。
				//    因此这里一次性决定，只调一次 create。宿主修好后把开关改回 true 即可。
				const events = agent.session.snapshotEvents();
				const boundary = events.length - 1;
				const seed = USE_FORK_SEED ? JSON.parse(JSON.stringify(buildForkSeed(events, boundary))) : undefined;

				// 4. 建子会话。
				//    **不覆盖预设、也不指定模型**：子会话走宿主默认那条路（和内置 `subagent` 一样）。
				//    覆盖过的两种都翻过车——
				//      · 传 agentPreset 但没挂载它（原来靠 setup 挂载，setup 是函数，见下）：
				//        系统提示词拼不出来，turn 直接 error：
				//        prompt variable "{{model}}" has no value (section "deployment:persona-prefix")；
				//      · 传 agentOptions 则可能把类实例塞进事件流。
				//    什么时候要按父的模型/预设走，等宿主提供正经的入参再说。
				const header = agent.session.header;
				const cwd = workspace ?? header.cwd;
				// 模型必须显式给：AgentOptions.provider + .model，否则系统提示词里的
				// {{model}} 取不到值，子会话第一轮就 error（实测两次）。形状就是
				// {provider, model, reasoningEffort?}，纯 JSON；仍过一道往返保险。
				const selection = ctx.get('agentDefaultModel')?.currentSelection?.();
				const agentOptions = selection === undefined ? undefined : JSON.parse(JSON.stringify(selection));
				// 预设不只是提示词，它还带**工具集**：不给预设，子会话只剩 plan_*/delete/
				// working_directory 这几个（实测，它连读文件的能力都没有）。而给了预设
				// 必须同时挂载它，否则系统提示词拼不出来。这是我们 0.14–0.16 跑通过的老组合。
				const presets = ctx.get('agentPresets');
				const presetId = presets?.composedPreset?.(agent.ctx);
				const meta = {
					...(cwd === undefined ? {} : { cwd }),
					// 预设与 setup 一律给：分叉出来的会话也要有完整工具集。
					// （README:65 说 fork 拒绝 agentPreset，但摘要清洗之后实测是通的——
					//  真分叉 + 完整工具集，两个都要。）
					...(presetId === undefined ? {} : { agentPreset: presetId }),
					parentSession: header.id,
					isSeeded: seed !== undefined,
					origin: 'subagent',
					delegationDepth: (header.delegationDepth ?? 0) + 1,
				};

				let handle;
				try {
					handle = await ctx.agents.create({
						sessionId: childId,
						parentAgent: agent,
						meta,
						...(agentOptions === undefined ? {} : { agentOptions }),
						...(presets === undefined || presetId === undefined
							? {}
							: {
									setup: async (childCtx) => {
										await presets.mount(childCtx, presetId);
									},
								}),
						...(seed === undefined
							? { inheritedEventCount: 0 }
							: { seed, inheritedEventCount: boundary + 1 }),
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
				// 没有种子时，用「人工分叉」把父最近的对话带进去。
				const digest = seed === undefined ? contextDigest(events) : '';
				child.followup(
					createUserMessage({
						content: [
							{
								type: 'text',
								text:
									seed === undefined
										? [
												// 人工分叉：把父最近的对话注入进来，别让子会话只拿一张工单。
												'The session you are working in was split off from a longer conversation. Here is its recent history, reproduced so you can pick up the thread:',
												'',
												digest,
												'',
												'--- end of history ---',
												'',
												prompt,
											].join('\n')
										: prompt,
							},
						],
						source: { kind: 'user' },
					}),
				);

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

