/**
 * ② 行为 —— 包壳。
 *
 * 一个行为 = 一份 JSON 架构 + 渲染器。章节靠它说清「填什么、怎么显示、什么算合法」。
 *
 * 本包当前只有壳。职责边界见 `docs/02-action.md`。
 */
export const name = 'taskboard2-action';

/* 零依赖。 */
export const inject = [];

export function apply(ctx: any): void {
	/* 待实现。 */
	void ctx;
}
