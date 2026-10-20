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

export function apply(ctx) {
	ctx.provide('planEvents', {
		type: RECORD,

		/** 唯一的写入口。 */
		append(session, op, data) {
			appendPluginRecord(session, RECORD, { op, ...data });
		},

		/** 一条事件属于哪个 op；不是本插件的事件返回 undefined。 */
		opOf(event) {
			if (event?.type === RECORD) return event.data?.op;
			return LEGACY[event?.type];
		},
	});
}
