/**
 * plan-events · 树/计划共用的那一类日志事件。
 *
 * 一个插件一种事件类型，一条事件带 `op`。这里除了类型和写入口之外什么都没有，
 * 但它是整套东西唯一允许写日志的地方，所以单独成一个插件：换掉它，就换掉了
 * "记录长什么样"，其余插件只认 `opOf()` 的返回值。
 *
 * 两条硬约束（两次事故换来的，别动）：
 *   1. 必须 appendPluginRecord：它强制 `plugin:` 命名空间并标 `ignorable:true`。
 *      裸 `session.append('自定义类型')` 写出的是"未知且不可忽略"的类型，加载器
 *      会拒绝解释整份日志。
 *   2. `user/message` 是唯一不受 turn/step 约束的面事件；`system/message` 之类
 *      只能在打开的步骤里写，异步写必炸。
 *
 * @module @local/plan-tree/events
 */
import { appendPluginRecord } from '@deepseek-ai/dsh-session';
import { createUserMessage } from '@deepseek-ai/dsh-llm';

export const name = 'plan-events';

export const inject = [];

/** 唯一的自有类型。op 在数据里，不一个动作一个类型。 */
export const RECORD = 'plugin:plan-tree/node';

/** 更早版本的形状；读端认得，写端不再用。 */
const LEGACY = {
	'plan-tree/dispatch': 'dispatch',
	'plugin:plan-tree/dispatch': 'dispatch',
	'plan-tree/file': 'file',
	'plugin:plan-tree/file': 'file',
};

/** 只有这几种记录进树库：它们是树本身，不是旁注。 */
const MIRRORED = new Set(['plan', 'adopt', 'reject-draft', 'shelve-draft', 'status', 'dispatch', 'link', 'file']);

/** 只有这几件事算"状态变了"，要告诉父与同层兄弟；派发与链接是父自己做的，不用通知自己。 */
const NOTIFIED = new Set(['adopt', 'reject-draft', 'shelve-draft', 'status', 'file']);

/** op → 状态码。file 看判定，其余看动作。 */
function statusAfter(op, data) {
	if (op === 'adopt') return 'submitted';
	if (op === 'reject-draft') return 'rejected';
	if (op === 'shelve-draft') return data?.shelved === false ? null : 'input-required';
	if (op === 'status') return data?.to ?? null;
	if (op === 'file') return { success: 'completed', reject: 'failed', shelved: 'input-required' }[data?.verdict] ?? 'working';
	return null;
}

/**
 * 状态一变，告诉父与同层兄弟。
 *
 * B-03 定的做法：宿主往它们各 append 一条 `user/message`，正文一句话，
 * `source.kind = 'plan-state'`；细节让它们自己 `plan_tree` / `plan_show`。
 * 用 `followup` 而不是直接写日志：目标是**别人的会话**，只有 followup 能把它唤醒成一轮。
 */
function broadcast(ctx, session, op, data) {
	if (!NOTIFIED.has(op)) return;
	const agents = ctx.get('agents');
	if (agents === undefined) return;

	const status = statusAfter(op, data);
	const label = ctx.get('planStates')?.labelOf?.(status) ?? String(status ?? '草案');
	const text = `[计划状态] ${String(data?.id ?? '?')} → ${label}`;

	const targets = new Set();
	const parent = session.header?.parentSession;
	if (typeof parent === 'string' && parent.length > 0) targets.add(parent);
	// 同层兄弟：本会话的 nodes 投影里，层相同、子会话不是自己的节点。
	const nodes = ctx.get('sessionProjections')?.stateOf?.(session, 'nodes')?.nodes ?? {};
	for (const node of Object.values(nodes)) {
		if (typeof node.childId !== 'string' || node.childId === session.id) continue;
		targets.add(node.childId);
	}

	for (const id of targets) {
		try {
			const target = agents.get?.(id);
			target?.followup?.(
				createUserMessage({
					content: [{ type: 'text', text }],
					source: { kind: 'plan-state', form: 'notice', senderSessionId: session.id },
				}),
			);
		} catch (error) {
			ctx.logger?.warn?.(`plan-events: 状态通知投递失败（${id}）：${String(error?.message ?? error)}`);
		}
	}
}

export function apply(ctx) {
	ctx.provide('planEvents', {
		type: RECORD,

		/** 唯一的写入口。 */
		append(session, op, data) {
			const record = { op, ...data };
			appendPluginRecord(session, RECORD, record);

			// 树管的是提案本身，所以提案也进树库：日志丢了库还在，界面也不必非等会话打开。
			// 单会话视图：写入方就是这条记录的主人，读方只读自己那一串（见 15/README 第 10 条）。
			const stores = ctx.get('treeSessions');
			if (stores === undefined || !MIRRORED.has(op)) return;
			try {
				const seq = session.snapshotEvents().length - 1;
				stores.atSession(session).appendRecord(session.id, seq, JSON.stringify(record));
			} catch (error) {
				// 镜像失败绝不影响日志本身：日志才是会话能继续跑的前提。
				ctx.logger?.warn?.(`plan-events: 树库镜像失败（日志已写）：${String(error?.message ?? error)}`);
			}

			// 状态变了就通知父与同层兄弟（B-03）。通知失败同样不影响记录。
			try {
				broadcast(ctx, session, op, record);
			} catch (error) {
				ctx.logger?.warn?.(`plan-events: 状态通知失败：${String(error?.message ?? error)}`);
			}
		},

		/** 一条事件属于哪个 op；不是本插件的事件返回 undefined。 */
		opOf(event) {
			if (event?.type === RECORD) return event.data?.op;
			return LEGACY[event?.type];
		},
	});
}
