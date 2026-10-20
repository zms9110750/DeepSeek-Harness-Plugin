/**
 * plan-state · 计划的状态机（B-03）。
 *
 * 状态是**计划**的属性，不是执行节点的属性。草案在执行之外；采纳仍不算执行；
 * 派发才进入"执行中"。
 *
 * 这个插件只提供"什么是状态、扳机怎么改状态"的纯定义，不碰存储也不碰事件：
 * 存储（`plans` 投影）在 plan-record 里，它按这里的判定渲染状态。
 * 第二阶段把 `status` 变成记录上的字段时，改的是这里 + record 的 fold，别处不动。
 *
 * @module @local/plan-tree/state
 */

export const name = 'plan-state';

export const inject = [];

/** 七个状态。前两类在执行之外，后五类属于"这一支已经派出去过"。 */
export const STATUS = {
	DRAFT: '草案',
	PLAN: '计划',
	RUNNING: '进行中',
	DONE: '完成计划',
	FAILED: '失败计划',
	HELD: '搁置的计划',
	SHELVED_DRAFT: '搁置草案',
};

/**
 * B-03 的扳机表，一行一条。它是这份设计的权威表述，测试拿它对照 statusOf。
 * `event` 是写进日志的 op；`to` 是状态变成什么。
 */
export const TRIGGERS = [
	{ trigger: '父写草案', op: 'plan', to: STATUS.DRAFT },
	{ trigger: '用户采纳', op: 'adopt', to: STATUS.PLAN },
	{ trigger: '用户否决草案', op: 'reject-draft', to: STATUS.SHELVED_DRAFT },
	{ trigger: '父派发', op: 'dispatch', to: STATUS.RUNNING },
	{ trigger: '子报完成', op: 'file:success', to: STATUS.DONE },
	{ trigger: '子报否决', op: 'file:reject', to: STATUS.FAILED },
	{ trigger: '子报中断', op: 'file:shelved', to: STATUS.HELD },
	{ trigger: '否决搁置中的', op: 'status:fail', to: STATUS.FAILED },
	{ trigger: '重启搁置中的', op: 'status:resume', to: STATUS.RUNNING },
];

/**
 * 一份计划当前处于哪个状态。按日志里已经发生的事推出来，不另存一份。
 * @param plan - `plans` 投影里的一条。
 * @param nodes - 属于这份计划的派发节点（按 planId 过滤好的）。
 * @returns 七个状态之一。
 */
export function statusOf(plan, nodes) {
	if (plan === undefined) return undefined;
	// 草案被否、被搁置：都停在"搁置草案"，但记录里保留 rejected / shelved 两个来源，
	// 因为计数与筛选要分开看（否决次数按节点算，草案否决不计数）。
	const own = nodes ?? [];
	if (own.some((node) => node.status === 'open')) return STATUS.RUNNING;
	if (own.some((node) => node.verdict === 'success')) return STATUS.DONE;
	if (own.some((node) => node.verdict === 'reject')) return STATUS.FAILED;
	if (own.some((node) => node.verdict === 'shelved')) return STATUS.HELD;
	if (plan.rejected === true || plan.shelved === true) return STATUS.SHELVED_DRAFT;
	if (plan.adopted === true) return STATUS.PLAN;
	return STATUS.DRAFT;
}

/** 这个状态算不算"已经派出去过"——只有这类状态才进该层的否决计数。 */
export function counting(status) {
	return status === STATUS.FAILED;
}

export function apply(ctx) {
	ctx.provide('planStates', { STATUS, TRIGGERS, statusOf, counting });
}
