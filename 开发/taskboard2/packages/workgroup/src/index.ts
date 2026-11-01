/**
 * ⑥ 工作组 —— 包壳。
 *
 * 容器本身：组、成员、归档、会话级当前指针。**不关心里面是什么。**
 *
 * 本包当前只有壳。职责边界见 `docs/06-workgroup.md`。
 */
export const name = 'taskboard2-workgroup';

/* 存储 + 编号（g-N 与任务编号同一个生成器）。 */
export const inject = ['taskboard2Store', 'taskboard2Types'];

export function apply(ctx: any): void {
	/* 待实现。 */
	void ctx;
}
