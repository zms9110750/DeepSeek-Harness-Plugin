/**
 * 工作区 UI —— 独立包、独立插件。
 *
 * 用户要求：「工作区 ui：在右边的工作区添加入口」
 *
 * 与抽屉 UI **共用同一个 TaskBoard 视图**（用户原话：「他们拥有相同的视图」），
 * 所以两者的 client.js 由同一份源码 + 不同构建参数产出，改一处两边都对。
 *
 * 为什么是独立包：见 taskboard-ui-drawer/index.js 的说明 ——
 * 包级 `dsh.client` 只能在自己的 package.json 上，子目录里无效。
 */
export const name = 'taskboard-ui-sidebar';

/* 纯客户端插件：宿主侧没有要注入的服务。 */
export const inject = [];

export function apply() {}
