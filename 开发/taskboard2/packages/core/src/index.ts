/**
 * ⑧ 核心 —— 包壳。
 *
 * 唯一编排入口。事务边界、调用顺序、对外门面。
 *
 * 强依赖、不可解耦的东西在这里。核心里有 if 形式的业务规则就是错的。
 *
 * 本包当前只有壳。职责边界见 `docs/08-core.md`。
 */
export const name = 'taskboard2-core';

export const inject = [
	'taskboard2Store',
	'taskboard2Action',
	'taskboard2Types',
	'taskboard2Relation',
	'taskboard2Search',
	'taskboard2Workgroup',
	'taskboard2Taskcard',
];

export function apply(ctx: any): void {
	/* 待实现。 */
	void ctx;
}
