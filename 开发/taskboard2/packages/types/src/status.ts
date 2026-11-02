/**
 * ③ status —— 状态的标识与分组。
 *
 * 词汇来源：Agent2Agent (A2A) 协议的 `TaskState` 枚举。九个值，一个不多一个不少。
 *
 * 本文件只承担两件事：
 *   1) 九个状态的标识（常量 + 由常量派生的联合类型）；
 *   2) 把若干状态用**类型联合**归成组，用途仅限「判断某个状态是否属于该组」。
 *
 * 本文件不含任何行为：没有状态转移、没有合法性判定、没有读写存储、没有按分类的权限，
 * 也没有为分组提供函数。分组判断在调用侧用普通比较即可，与「对多个枚举值分别判断」等价。
 *
 * 字面量取 A2A 协议全名（`TASK_STATE_*`），不取线上短横线小写。
 * 状态字面量单源在本文件：任何包都不得自行书写状态字符串字面量。
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
 * 草稿 = 未指定。
 *
 * 独立常量，**不进 `TaskState` 对象**，因此 `Object.values(TaskState)` 仍是 9 项无重复。
 * 「草稿」是它的中文术语；代码里一律用本常量，不写字面量。
 */
export const DRAFT = TaskState.UNSPECIFIED;

/** 组「进行」= 提交 + 处理中。 */
export type ActiveStatus =
	| typeof TaskState.SUBMITTED
	| typeof TaskState.WORKING;

/** 组「搁置」= 需要信息 + 需要授权。 */
export type ShelvedStatus =
	| typeof TaskState.INPUT_REQUIRED
	| typeof TaskState.AUTH_REQUIRED;

/**
 * 组「完成」= 成功 + 失败 + 取消 + 拒绝。
 *
 * 用户 06:55：「"完成"，是一个状态组。包括成功，失败，取消，拒绝。」
 * 即终态与完成态是同一个集合。
 */
export type EndedStatus =
	| typeof TaskState.COMPLETED
	| typeof TaskState.FAILED
	| typeof TaskState.REJECTED
	| typeof TaskState.CANCELED;

/*
 * `TASK_STATE_UNSPECIFIED`（草稿）不属于以上任何一组。用户 00:57：「草稿不是组。」
 * 单成员联合没有判别力，因此不为它声明组类型。
 */
