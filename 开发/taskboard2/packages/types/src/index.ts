/**
 * ③ 类型体系 —— 包壳。
 *
 * 这个包装着任务类型的整套词汇与规则，四块：
 *
 *   status    九态（A2A 协议词汇）与三个组
 *   kind      分类：每个分类自带行为
 *   template  模板：含章节；章节接受行为
 *   id        编号：前缀 + 流水号 + 旧编号升级
 *
 * 为什么这四块在同一个包里：它们是一条严格单向链
 * `status → kind → template → id`，且九态是外部协议固定的词汇，
 * 分类与模板靠运行时 `register()` 扩展而不是靠换插件。
 * 拆开会形成包级 `inject` 环 —— 那是死锁，不是慢。
 *
 * 本包当前只有壳。职责边界见 `docs/03-types.md`。
 */
export const name = 'taskboard2-types';

/* 不依赖任何其它包的服务。 */
export const inject = [];

export function apply(ctx: any): void {
	/* 待实现。所有对外能力由用户设计并同意后再落下。 */
	void ctx;
}
