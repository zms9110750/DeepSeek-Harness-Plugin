/**
 * append-probe · 一次性探针：验证「给别人的会话塞一条消息，但不唤醒它」。
 *
 * 两组：
 *   A) 直接写日志：session.append('user/message', msg, { surfaceOp: 'append' })
 *   B) 宿主入口：agent.inject(msg)          （next-step、wakeup=false）
 *
 * 每组都在一个「跑完一轮、已经停稳」的目标会话上做，然后：
 *   1. 投递后 5 秒内轮询：日志里不得出现 turn/start 或 step/start，状态必须一直 idle；
 *   2. 检查消息是否立刻进入 surface（model-visible 的顺序）；
 *   3. 检查是否落盘（直接解 session.v4.jsonl.zstd 找 marker，不靠推断）；
 *   4. 最后用 followup 主动唤醒，让它"把收到的用户消息逐条列出来"，看 marker 在不在。
 *
 * 结果写到本目录 last-report.json，同时作为工具返回值给模型原样打印。
 * 不碰 plan-tree，不改任何配置。
 *
 * @module @local/append-probe
 */
import { randomUUID } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { zstdDecompressSync } from 'node:zlib';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { createUserMessage } from '@deepseek-ai/dsh-llm';

export const name = 'append-probe';

export const inject = ['tools', 'agents'];

/** 宿主会话日志的候选根（dev 档可能是隔离数据目录，所以多找几处）。 */
function candidateSessionRoots() {
	const roots = [];
	if (typeof process.env.DSH_HOME === 'string' && process.env.DSH_HOME !== '') roots.push(join(process.env.DSH_HOME, 'sessions'));
	roots.push('C:/Users/16229/.dsh/sessions');
	roots.push('C:/Users/16229/.dsh/profiles');
	return roots;
}
/** 报告落盘位置：模型输出被截断时，仍然可以从这里读全量。 */
const REPORT_FILE = 'X:/temp/dsh/探针/append-probe/last-report.json';
/** 投递后观察窗口：这段时间内不许有任何轮次启动。 */
const QUIET_WINDOW_MS = 5000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function withTimeout(promise, ms, label) {
	let timer;
	const expiry = new Promise((_resolve, reject) => {
		timer = setTimeout(() => reject(new Error(`${label} 超时（${ms}ms）`)), ms);
		timer.unref?.();
	});
	return Promise.race([promise, expiry]).finally(() => clearTimeout(timer));
}

function statusOf(agent) {
	try {
		const status = agent.status;
		const value = typeof status === 'function' ? status() : status;
		if (value !== undefined && value !== null) return value;
	} catch {
		/* 取不到就退到 phase */
	}
	const kind = agent.phase?.kind ?? agent.loop?.phase?.kind;
	return kind === undefined ? 'unknown' : kind;
}

/** 判据 a 只看"有没有跑起来"：任何一次采样是 running 就算失败；unknown 不算失败（但要写进报告）。 */
function stayedIdle(watch) {
	return watch.turnStarts.length === 0 && !watch.statuses.some((status) => status === 'running');
}

function messageText(message) {
	const blocks = Array.isArray(message?.content) ? message.content : [];
	return blocks
		.filter((block) => block?.type === 'text')
		.map((block) => String(block.text ?? ''))
		.join('\n');
}

/** 从日志尾部往前找最后一条助手消息的纯文本。 */
function lastAssistantText(agent) {
	const events = agent.session.snapshotEvents();
	for (let index = events.length - 1; index >= 0; index -= 1) {
		if (events[index].type !== 'assistant/message') continue;
		return messageText(events[index].data?.message);
	}
	return '';
}

/** seq >= fromSeq 的事件摘要。 */
function eventsSince(agent, fromSeq) {
	return agent.session
		.snapshotEvents()
		.filter((event) => event.seq >= fromSeq)
		.map((event) => ({
			seq: event.seq,
			type: event.type,
			...(event.surfaceOp === undefined ? {} : { surfaceOp: event.surfaceOp }),
		}));
}

/** seq > afterSeq 的 turn/start 与 step/start。 */
function turnStartsAfter(agent, afterSeq) {
	return agent.session
		.snapshotEvents()
		.filter((event) => event.seq > afterSeq && (event.type === 'turn/start' || event.type === 'step/start'))
		.map((event) => `${event.seq}:${event.type}`);
}

/** 当前 surface（模型可见顺序）里所有文本拼起来 —— 不依赖模型自述。 */
function surfaceText(session) {
	const bySeq = new Map(session.snapshotEvents().map((event) => [event.seq, event]));
	const parts = [];
	for (const seq of session.surface.nodes) {
		const event = bySeq.get(seq);
		if (event === undefined) continue;
		const message = session.surface.deriveEventMessage(event);
		if (message === null) continue;
		parts.push(messageText(message));
	}
	return parts.join('\n');
}

// ── 磁盘侧：直接解 zstd，证明"真的落盘了" ──────────────────────────────

const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);

function decompressAll(buffer) {
	const starts = [];
	for (let index = 0; index + 4 <= buffer.length; index += 1) {
		if (buffer.compare(ZSTD_MAGIC, 0, 4, index, index + 4) === 0) starts.push(index);
	}
	if (starts.length === 0) return buffer.toString('utf8');
	const parts = [];
	for (let index = 0; index < starts.length; index += 1) {
		const slice = buffer.subarray(starts[index], starts[index + 1] ?? buffer.length);
		try {
			parts.push(zstdDecompressSync(slice).toString('utf8'));
		} catch {
			/* 半截帧，忽略 */
		}
	}
	return parts.join('');
}

function walkForSession(dir, sessionId, depth) {
	let entries;
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch {
		return undefined;
	}
	for (const entry of entries) {
		if (!entry.isDirectory()) continue;
		if (entry.name === sessionId) {
			const file = join(dir, entry.name, 'session.v4.jsonl.zstd');
			if (existsSync(file)) return file;
		}
		if (depth > 0) {
			const hit = walkForSession(join(dir, entry.name), sessionId, depth - 1);
			if (hit !== undefined) return hit;
		}
	}
	return undefined;
}

function findSessionLog(sessionId) {
	for (const root of candidateSessionRoots()) {
		if (!existsSync(root)) continue;
		const hit = walkForSession(root, sessionId, 4);
		if (hit !== undefined) return hit;
	}
	return undefined;
}

/** { file, bytes, contains, error? } —— contains 表示 marker 已经真的在磁盘日志里。 */
function diskProbe(sessionId, needle) {
	const file = findSessionLog(sessionId);
	if (file === undefined) return { file: null, bytes: 0, contains: false, error: '尚未找到日志文件' };
	try {
		return { file, bytes: statSync(file).size, contains: decompressAll(readFileSync(file)).includes(needle) };
	} catch (error) {
		return { file, bytes: 0, contains: false, error: String(error?.message ?? error) };
	}
}

// ── 目标会话 ─────────────────────────────────────────────────────────

/**
 * 建一个"只属于本次探针"的会话（origin: subagent，不进会话列表）。
 * 配方与 plan-tree/src/dispatch.js 一致：模型、预设都必须显式给，否则第一轮就 error。
 */
async function createTarget(ctx, agent) {
	const header = agent.session.header;
	const presets = ctx.get('agentPresets');
	const presetId = presets?.composedPreset?.(agent.ctx);
	const selection = ctx.get('agentDefaultModel')?.currentSelection?.();
	const agentOptions = selection === undefined ? undefined : JSON.parse(JSON.stringify(selection));
	const baseMeta = {
		...(header.cwd === undefined ? {} : { cwd: header.cwd }),
		treeRoot: header.treeRoot ?? agent.session.id,
		parentSession: header.id,
		isSeeded: false,
		origin: 'subagent',
		delegationDepth: (header.delegationDepth ?? 0) + 1,
	};

	let sessionId = `session-${randomUUID()}`;
	let mode = 'full';
	let handle;
	try {
		handle = await ctx.agents.create({
			sessionId,
			parentAgent: agent,
			meta: { ...baseMeta, ...(presetId === undefined ? {} : { agentPreset: presetId }) },
			...(agentOptions === undefined ? {} : { agentOptions }),
			...(presets === undefined || presetId === undefined
				? {}
				: { setup: async (childCtx) => { await presets.mount(childCtx, presetId); } }),
			inheritedEventCount: 0,
		});
	} catch (error) {
		// 全参数建不出来就退到最小参数；报告里写明走了哪条路，别把失败当成功。
		mode = `minimal（full 失败：${String(error?.message ?? error)}）`;
		sessionId = `session-${randomUUID()}`;
		handle = await ctx.agents.create({ sessionId, parentAgent: agent, meta: baseMeta, inheritedEventCount: 0 });
	}

	const child = handle.agent ?? handle;
	if (typeof child?.followup !== 'function') throw new Error('目标会话没有 followup()：宿主接口对不上');
	// whenIdle 可能在 handle 上而不在 agent 上（dispatch.js 就是两处都取），所以都兜住。
	const whenIdle = child.whenIdle ?? handle.whenIdle;
	if (typeof whenIdle !== 'function') throw new Error('目标会话没有 whenIdle()：宿主接口对不上');
	return { child, waitIdle: () => whenIdle.call(child), sessionId, mode };
}

/** 让它真跑完一轮并停稳 —— 这样"空闲"是跑过之后的空闲，不是从没启动过。 */
async function warmUp(child, waitIdle) {
	child.followup(
		createUserMessage({
			content: [{ type: 'text', text: '只回复 ok，不要调用任何工具。' }],
			source: { kind: 'user' },
		}),
	);
	await withTimeout(waitIdle(), 120_000, 'warmUp');
	await sleep(300);
}

/**
 * 在 ms 内每 250ms 采样一次：状态集合 + 有没有 turn/start / step/start。
 * 判据 a 就看这里：turnStarts 必须为空，statuses 必须只有 idle。
 */
async function watchQuiet(child, afterSeq, ms) {
	const statuses = new Set();
	const turnStarts = new Set();
	const deadline = Date.now() + ms;
	while (Date.now() < deadline) {
		statuses.add(String(statusOf(child)));
		for (const entry of turnStartsAfter(child, afterSeq)) turnStarts.add(entry);
		await sleep(250);
	}
	return { windowMs: ms, statuses: [...statuses], turnStarts: [...turnStarts] };
}

/** 主动唤醒，并要求它把收到的用户消息逐条列出来。 */
async function wakeAndAsk(child, waitIdle) {
	child.followup(
		createUserMessage({
			content: [{ type: 'text', text: '把你在本会话里收到的所有用户消息逐条列出，原样引用关键内容，每条一行。' }],
			source: { kind: 'user' },
		}),
	);
	await withTimeout(waitIdle(), 180_000, 'wake');
	await sleep(400);
}

// ── A 组：直接写日志 ──────────────────────────────────────────────────

async function runGroupA(ctx, agent) {
	const marker = `MARKER-A-${randomUUID().slice(0, 8)}`;
	const { child, waitIdle, sessionId, mode } = await createTarget(ctx, agent);
	await warmUp(child, waitIdle);

	const result = { marker, sessionId, createMode: mode, otherMessages: [] };
	const seqBefore = child.session.snapshotEvents().at(-1)?.seq ?? -1;

	const notice = createUserMessage({
		content: [{ type: 'text', text: `${marker} [兄弟] n2 已派发，负责「探针测试主题」，层 A` }],
		source: { kind: 'plan-state', form: 'notice' },
	});
	let logged;
	try {
		// 这就是待验的写法：surface-eligible 事件必须显式声明 surfaceOp。
		logged = child.session.append('user/message', notice, { surfaceOp: 'append' });
	} catch (error) {
		result.appendError = String(error?.message ?? error);
		return { ...result, verdict: { noWake: null, visibleAfterWake: null, persisted: false } };
	}

	result.append = {
		seq: logged.seq,
		type: logged.type,
		surfaceOp: logged.surfaceOp,
		newEvents: eventsSince(child, seqBefore + 1),
		inSurfaceImmediately: child.session.surface.nodes.includes(logged.seq),
	};
	result.diskAtAppend = diskProbe(sessionId, marker);
	await sleep(500);
	result.diskAfter500ms = diskProbe(sessionId, marker);

	result.watch = await watchQuiet(child, logged.seq, QUIET_WINDOW_MS);
	result.diskAfterWindow = diskProbe(sessionId, marker);

	await wakeAndAsk(child, waitIdle);
	const text = lastAssistantText(child);
	result.wake = {
		assistantText: text.slice(0, 1200),
		containsMarker: text.includes(marker),
		turnStarts: turnStartsAfter(child, logged.seq),
	};
	result.diskAfterWake = diskProbe(sessionId, marker);
	result.surfaceHasMarkerAfterWake = surfaceText(child.session).includes(marker);

	result.verdict = {
		noWake: stayedIdle(result.watch),
		inSurfaceImmediately: result.append.inSurfaceImmediately,
		visibleAfterWake: result.wake.containsMarker,
		persisted: result.diskAtAppend.contains || result.diskAfter500ms.contains || result.diskAfterWindow.contains || result.diskAfterWake.contains,
	};
	return result;
}

// ── B 组：宿主 inject ────────────────────────────────────────────────

async function runGroupB(ctx, agent) {
	const marker = `MARKER-B-${randomUUID().slice(0, 8)}`;
	const { child, waitIdle, sessionId, mode } = await createTarget(ctx, agent);
	await warmUp(child, waitIdle);

	const result = { marker, sessionId, createMode: mode };
	const seqBefore = child.session.snapshotEvents().at(-1)?.seq ?? -1;
	const nodesBefore = child.session.surface.nodes.length;

	const notice = createUserMessage({
		content: [{ type: 'text', text: `${marker} [兄弟] n2 已派发，负责「探针测试主题」，层 A` }],
		source: { kind: 'plan-state', form: 'notice' },
	});
	let injectError;
	try {
		child.inject(notice);
	} catch (error) {
		injectError = String(error?.message ?? error);
	}

	result.inject = {
		error: injectError ?? null,
		immediateEvents: eventsSince(child, seqBefore + 1),
		surfaceNodesBefore: nodesBefore,
		surfaceNodesAfter: child.session.surface.nodes.length,
		inSurfaceImmediately: surfaceText(child.session).includes(marker),
	};
	// 「何时进日志」的第一手证据：投递当刻磁盘上有没有。
	result.diskAtInject = diskProbe(sessionId, marker);
	await sleep(500);
	result.diskAfter500ms = diskProbe(sessionId, marker);

	result.watch = await watchQuiet(child, seqBefore, QUIET_WINDOW_MS);
	result.diskAfterWindow = diskProbe(sessionId, marker);

	await wakeAndAsk(child, waitIdle);
	const text = lastAssistantText(child);
	result.wake = {
		assistantText: text.slice(0, 1200),
		containsMarker: text.includes(marker),
		turnStarts: turnStartsAfter(child, seqBefore),
	};
	result.diskAfterWake = diskProbe(sessionId, marker);
	result.surfaceHasMarkerAfterWake = surfaceText(child.session).includes(marker);

	result.verdict = {
		noWake: stayedIdle(result.watch),
		inSurfaceImmediately: result.inject.inSurfaceImmediately,
		visibleAfterWake: result.wake.containsMarker,
		persisted: result.diskAtInject.contains || result.diskAfter500ms.contains || result.diskAfterWindow.contains || result.diskAfterWake.contains,
	};
	return result;
}

// ── 对照表 ───────────────────────────────────────────────────────────

function buildTable(groupA, groupB) {
	const row = (label, group, whenLogged) => ({
		group: label,
		noWake: group?.verdict?.noWake ?? null,
		inSurfaceImmediately: group?.verdict?.inSurfaceImmediately ?? null,
		visibleAfterWake: group?.verdict?.visibleAfterWake ?? null,
		persisted: group?.verdict?.persisted ?? null,
		whenLogged,
	});
	return [
		row(
			'A: session.append + surfaceOp',
			groupA,
			groupA?.append === undefined ? '未写入' : `append 当刻写入日志 seq=${groupA.append.seq}（surfaceOp=${JSON.stringify(groupA.append.surfaceOp)}）`,
		),
		row(
			'B: agent.inject',
			groupB,
			groupB?.inject === undefined
				? '未投递'
				: groupB.inject.immediateEvents.length === 0
					? '投递当刻没有新事件（只在内存 inbox）'
					: `投递当刻新事件 ${JSON.stringify(groupB.inject.immediateEvents.map((event) => event.type))}`,
		),
	];
}

export function apply(ctx) {
	ctx.tools.register(
		defineTool({
			name: 'probe_append',
			description:
				'One-shot probe: create a stopped child session, then test two delivery paths that must NOT wake it — ' +
				'(A) session.append user/message with surfaceOp, (B) agent.inject. For each it checks: no turn/start within 5s, ' +
				'whether the message reached the model-visible surface, whether it is on disk, and whether a later explicit wake ' +
				'reveals it. Call with no arguments; the JSON report is returned and also written to last-report.json. ' +
				'This tool writes nothing outside X:/temp/dsh/探针/append-probe/.',
			parameters: {},
			timeoutMs: 600_000,
			output: {
				schema: {
					type: 'object',
					additionalProperties: false,
					properties: {
						summary: { type: 'string', required: true },
						report: { type: 'string', required: true },
					},
				},
				render: (_args, value) => [{ type: 'text', text: `${value.summary}\n\n${value.report}` }],
			},
			async execute(_args, exec) {
				const agent = exec.agent;
				if (!agent) throw new Error('probe_append requires an owning agent session');

				const report = {
					startedAt: new Date().toISOString(),
					parentSessionId: agent.session.id,
					cwd: agent.session.header?.cwd ?? null,
					quietWindowMs: QUIET_WINDOW_MS,
					sessionRoots: candidateSessionRoots(),
				};

				try {
					report.A = await runGroupA(ctx, agent);
				} catch (error) {
					report.AError = String(error?.stack ?? error?.message ?? error);
				}
				try {
					report.B = await runGroupB(ctx, agent);
				} catch (error) {
					report.BError = String(error?.stack ?? error?.message ?? error);
				}
				report.table = buildTable(report.A, report.B);
				report.finishedAt = new Date().toISOString();

				try {
					writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2));
				} catch (error) {
					report.reportFileError = String(error?.message ?? error);
				}

				const brief = report.table
					.map((row) => `${row.group}: 不唤醒=${row.noWake} 唤醒后可见=${row.visibleAfterWake} 持久化=${row.persisted}`)
					.join(' | ');
				return { summary: brief, report: JSON.stringify(report, null, 2) };
			},
		}),
	);
}
