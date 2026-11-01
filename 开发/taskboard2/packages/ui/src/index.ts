/**
 * ⑩ UI —— 包壳（宿主侧）。
 *
 * 一个包，三个模块，**画面只有一份**：
 *
 *   提供层   provider        —— 画面本身 + 数据通道 + 状态（重资产）
 *   入口 A   entry-workspace —— 右侧栏页签
 *   入口 B   entry-drawer    —— 输入框旁抽屉
 *
 * 为什么三个模块在一个包里：两个入口都是提供层的薄壳，拆开后单独打开
 * 任何一个都不起作用；而提供层才是重资产。拆包反而是跨包依赖 UI 组件。
 *
 * 宿主侧不提供任何服务 —— 画面在浏览器里跑。宿主侧只承载入口开关。
 *
 * 本包当前只有壳。职责边界见 `docs/10-ui.md`。
 */
export const name = 'taskboard2-ui';

/* 宿主侧不需要任何服务。 */
export const inject = [];

export function apply(ctx: any): void {
	/* 待实现。 */
	void ctx;
}
