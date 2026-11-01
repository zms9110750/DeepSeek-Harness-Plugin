/**
 * ③ 状态（status）—— 状态的标识与分组。
 *
 * 词汇来源：Agent2Agent (A2A) 协议的 `TaskState` 枚举（`spec/a2a.proto` 为权威定义）。
 * 九个值，一个不多一个不少。
 *
 * 本文件只承担两件事：
 *   1) 九个状态的标识（常量 + 由常量派生的联合类型）；
 *   2) 把若干状态用**类型联合**归成组，用途仅限「判断某个状态是否属于该组」。
 *
 * 本文件不含任何行为：没有状态转移、没有合法性判定、没有读写存储、没有按分类的权限，
 * 也没有为分组提供函数。分组判断在调用侧用普通比较即可，与「对多个枚举值分别判断」等价。
 */

/** A2A `TaskState` 全集。键为短名，值为协议枚举名。 */
export const TaskState = {
	UNSPECIFIED: 'TASK_STATE_UNSPECIFIED',
	SUBMITTED: 'TASK_STATE_SUBMITTED',
	WORKING: 'TASK_STATE_WORKING',
	INPUT_REQUIRED: 'TASK_STATE_INPUT_REQUIRED',
	AUTH_REQUIRED: 'TASK_STATE_AUTH_REQUIRED',
	COMPLETED: 'TASK_STATE_COMPLETED',
	FAILED: 'TASK_STATE_FAILED',
	CANCELED: 'TASK_STATE_CANCELED',
	REJECTED: 'TASK_STATE_REJECTED',
} as const;

/** 九个状态中的任一。 */
export type TaskState = (typeof TaskState)[keyof typeof TaskState];

/** 九个状态的集合（顺序同 A2A 枚举）。 */
export const TASK_STATES: readonly TaskState[] = Object.values(TaskState);

/**
 * 组「进行」= 提交 + 处理中。
 *
 * 待裁决：`WORKING` 的中文名「处理中」/「进行中」尚未确定，两个候选都由用户提出。
 */
export type ActiveStatus =
	| typeof TaskState.SUBMITTED
	| typeof TaskState.WORKING;

/** 组「搁置」= 需要信息 + 需要授权。 */
export type ShelvedStatus =
	| typeof TaskState.INPUT_REQUIRED
	| typeof TaskState.AUTH_REQUIRED;

/** 组「结束」= 成功 + 失败 + 拒绝 + 取消。 */
export type EndedStatus =
	| typeof TaskState.COMPLETED
	| typeof TaskState.FAILED
	| typeof TaskState.REJECTED
	| typeof TaskState.CANCELED;

/*
 * 待裁决：`TASK_STATE_UNSPECIFIED` 不属于以上任何一组。
 * 用户给出的三组共覆盖 8 个状态，而九态中的第 9 个正是它。
 * 这里不替用户决定它的归属，因此本文件不为它声明任何组类型。
 */
