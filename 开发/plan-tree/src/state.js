/**
 * plan-state · 计划的状态机。
 *
 * 状态**名字与形状借 A2A 的 `TaskState`**（Agent2Agent 1.0.0），不自己发明词汇：
 * 九个值、终结态不可重启、中断态可恢复——这些是标准。**转移规则是我们自己的**
 * （A2A 里没有"用户采纳"、"这一层被否了三次"这些业务）。
 *
 * 两个本地约定（A2A 没有对应值，用"没有 task"来表达，不硬造新状态）：
 *   · 草案（还没采纳）= `status: null` —— 它还不是一个 task；
 *   · 搁置 = `input-required` —— 按"需要输入就是搁置"。
 *
 * @module @local/plan-tree/state
 */

export const name = 'plan-state';

export const inject = [];

/** A2A TaskState 的九个值（原样，小写连字符形式）。 */
export const STATUS = {
	UNSPECIFIED: 'unspecified',
	SUBMITTED: 'submitted',
	WORKING: 'working',
	INPUT_REQUIRED: 'input-required',
	AUTH_REQUIRED: 'auth-required',
	COMPLETED: 'completed',
	FAILED: 'failed',
	CANCELED: 'canceled',
	REJECTED: 'rejected',
};

/** 终结态：进去就回不来（A2A 明确规定的硬规则）。 */
export const TERMINAL = new Set([STATUS.COMPLETED, STATUS.FAILED, STATUS.CANCELED, STATUS.REJECTED]);

/** 中断态：可以回到 working（A2A 的 interrupted 语义）。 */
export const INTERRUPTED = new Set([STATUS.INPUT_REQUIRED, STATUS.AUTH_REQUIRED]);

/** 界面文案。状态码给协议与存储，文案给人。 */
export const LABEL = {
	unspecified: '未定',
	submitted: '计划',        // 已采纳、还没派发
	working: '进行中',
	'input-required': '搁置',
	'auth-required': '待授权',
	completed: '完成计划',
	failed: '失败计划',
	canceled: '已取消',
	rejected: '否决',
};

/**
 * 扳机表：谁做了什么 → 写什么 op → 状态变成什么。
 * 这是本案的权威表述，测试拿它对照。
 */
export const TRIGGERS = [
	{ trigger: '父写草案', op: 'plan', to: null },
	{ trigger: '用户采纳', op: 'adopt', to: STATUS.SUBMITTED },
	{ trigger: '用户否决草案', op: 'reject-draft', to: STATUS.REJECTED },
	{ trigger: '用户搁置草案', op: 'shelve-draft', to: STATUS.INPUT_REQUIRED },
	{ trigger: '父派发', op: 'dispatch', to: STATUS.WORKING },
	{ trigger: '子报完成', op: 'file:success', to: STATUS.COMPLETED },
	{ trigger: '子报否决', op: 'file:reject', to: STATUS.FAILED },
	{ trigger: '子报中断', op: 'file:shelved', to: STATUS.INPUT_REQUIRED },
	{ trigger: '搁置的判死', op: 'status:fail', to: STATUS.FAILED },
	{ trigger: '搁置的恢复', op: 'status:resume', to: STATUS.WORKING },
];

/** 界面文案。 */
export function labelOf(status) {
	if (status === null || status === undefined) return '草案';
	return LABEL[status] ?? String(status);
}

/**
 * 老记录的兜底：没有 `status` 字段时，从布尔与节点推出来。
 * 新记录一律由 fold 直接写 `status`，不再走这里。
 *
 * @param plan - `plans` 投影里的一条。
 * @param nodes - 属于这份计划的派发节点。
 */
export function statusOf(plan, nodes) {
	if (plan === undefined) return undefined;
	// 用户拍板的状态是权威：否决、搁置、取消、待授权，一锤定音。
	if (plan.status !== undefined && plan.status !== null && [STATUS.REJECTED, STATUS.INPUT_REQUIRED, STATUS.CANCELED, STATUS.AUTH_REQUIRED].includes(plan.status)) {
		return plan.status;
	}
	// 其余由节点推导（派发/结算的事实比记录更可信）。
	const own = nodes ?? [];
	if (own.some((node) => node.status === 'open')) return STATUS.WORKING;
	if (own.some((node) => node.verdict === 'success')) return STATUS.COMPLETED;
	if (own.some((node) => node.verdict === 'reject')) return STATUS.FAILED;
	if (own.some((node) => node.verdict === 'shelved')) return STATUS.INPUT_REQUIRED;
	if (plan.status !== undefined) return plan.status;
	if (plan.rejected === true) return STATUS.REJECTED;
	if (plan.shelved === true) return STATUS.INPUT_REQUIRED;
	if (plan.adopted === true) return STATUS.SUBMITTED;
	return null;
}

/** 这个状态算不算"真的派出去过并失败"——只有它进该层计数。 */
export function counting(status) {
	return status === STATUS.FAILED;
}

export function apply(ctx) {
	ctx.provide('planStates', { STATUS, TERMINAL, INTERRUPTED, LABEL, TRIGGERS, labelOf, statusOf, counting });
}
