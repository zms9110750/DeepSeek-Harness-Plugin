/**
 * ⑦ 任务卡 —— 包壳。
 *
 * 任务对象本身：创建、编辑、fork、备注。状态只是它的一个字段。
 *
 * 备注归它自己 —— 采纳冻结后唯一还能改的地方，没有任何角色「需要」这个能力，
 * 所以不做成服务，只是卡上的一个字段与一个永远允许的写入口。
 *
 * 本包当前只有壳。职责边界见 `docs/07-taskcard.md`。
 */
export const name = 'taskboard2-taskcard';

/* 类型体系（状态/分类/模板/编号）+ 关系。 */
export const inject = ['taskboard2Types', 'taskboard2Relation'];

export function apply(ctx: any): void {
	/* 待实现。 */
	void ctx;
}
