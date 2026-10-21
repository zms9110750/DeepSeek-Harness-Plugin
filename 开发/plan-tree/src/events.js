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
const MIRRORED = new Set(['plan', 'adopt', 'reject', 'shelve', 'status', 'dispatch', 'file']);

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
				stores.atSession(session).appendEvent(session.id, seq, JSON.stringify(record));
			} catch (error) {
				// 镜像失败绝不影响日志本身：日志才是会话能继续跑的前提。
				ctx.logger?.warn?.(`plan-events: 树库镜像失败（日志已写）：${String(error?.message ?? error)}`);
			}
		},

		/** 一条事件属于哪个 op；不是本插件的事件返回 undefined。 */
		opOf(event) {
			if (event?.type === RECORD) return event.data?.op;
			return LEGACY[event?.type];
		},
	});
}
