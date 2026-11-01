/**
 * ④ 关系 —— 包壳。
 *
 * 事项之间的边，以及沿边传播的**计划**。只算不写，执行是核心的事。
 *
 * 本包当前只有壳。职责边界见 `docs/04-relation.md`。
 */
export const name = 'taskboard2-relation';

/* 需要存储来读，不需要写。 */
export const inject = ['taskboard2Store'];

export function apply(ctx: any): void {
	/* 待实现。 */
	void ctx;
}
