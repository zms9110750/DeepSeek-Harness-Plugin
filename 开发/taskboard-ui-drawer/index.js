/**
 * 抽屉 UI —— 独立包、独立插件。
 *
 * 用户要求：「抽屉 ui：可以从输入栏旁边的箭头打开 ui 界面。」
 *
 * 为什么是独立包而不是包里的一个子目录：
 * 客户端半边靠包级 `dsh.client` 声明（在 package.json 上）被发现，
 * 而加载器扫的是 **loader entry 的模块名** 对应的那个 package.json。
 * 写在子目录里扫不到 —— 这正是 UI 消失的原因。
 *
 * 功能全在 client.js。
 */
export const name = 'taskboard-ui-drawer';

/* 纯客户端插件：宿主侧没有要注入的服务。 */
export const inject = [];

export function apply() {}
