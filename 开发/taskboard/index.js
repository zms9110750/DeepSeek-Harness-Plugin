/**
 * 任务板 —— 一个包，一个客户端入口，一个设置页。
 *
 * 用户要求：
 *   「我要的是归属。因为他的插件有一级菜单和点进去的二级菜单。
 *     我的整个事情是一个任务库。然后 ui 是任务库里面的东西。」
 *   「那就做一个插件，然后把他的配置弄出来，开两个 bool。」
 *
 * ## 为什么客户端只能在根包
 *
 * DSH 的客户端模块发现只认**裸包名**（dsh-client-modules 源码）：
 *
 *     function exactPackageSpecifier(specifier) {
 *       if (specifier.startsWith('@')) {
 *         const parts = specifier.split('/');
 *         return parts.length === 2 && parts.every(Boolean) ? specifier : undefined;
 *       }
 *       return specifier.length > 0 && !specifier.includes('/') && !specifier.includes(':')
 *         ? specifier : undefined;
 *     }
 *
 *     locatePkgJson(loaderName) {
 *       const expected = exactPackageSpecifier(loaderName);
 *       if (!pathLike && expected === undefined) return undefined;   // ← 放弃扫描
 *     }
 *
 * `@local/taskboard/ui-drawer` 是三段 → 返回 undefined → 不做客户端发现。
 * 所以一个包只有一个客户端入口，两个 UI 合成一份 client.js，
 * 由下面 Config 的两个 bool 分别控制。
 */
import z from '@deepseek-ai/schemastery';

export const name = 'taskboard';

/*
 * 设置页的配置。用户要求：「开两个 bool」。
 *
 *   ui.drawer   输入框旁边的箭头抽屉
 *   ui.sidebar  右侧栏的「任务」标签页
 *
 * 关掉抽屉不影响右侧栏，反之亦然——它们是同一份 client.js 里的两段注册。
 */
/*
 * 设置页的配置。用户要求：「开两个 bool」。
 *
 *   ui.drawer   输入框旁边的箭头抽屉
 *   ui.sidebar  右侧栏的「任务」标签页
 *
 * ## ⚠️ 每个字段都必须 `.volatile()`
 *
 * 这是设置页能渲染表单的**硬条件**。源码（dsh-settings 的 volatileForm）：
 *
 *     function volatileForm(schema) {
 *       if (schema.meta.volatile) return plainSchema(schema);
 *       if (schema.type === 'object') {
 *         const dict = Object.fromEntries(Object.entries(schema.dict ?? {}).flatMap(([key, child]) => {
 *           const field = volatileForm(child);
 *           return field === undefined ? [] : [[key, field]];
 *         }));
 *         return Object.keys(dict).length === 0 ? undefined : z.object(dict);
 *       }
 *     }
 *
 * 没有 volatile 的字段会被整个丢掉；全都不是 volatile 就返回 undefined，
 * 于是没有表单、`props.form` 是 undefined —— 这就是「没有 bool 开关」的原因。
 *
 * 「volatile」在这里的含义是：**改完立刻生效，不需要重新挂载插件**。
 * 我们的两个开关正好是这种，改了就重注册 UI，不重启。
 *
 * 参照 @deepseek-ai/dsh-experimental-client-ui-cot-translation 的 Config：
 *   static Config = z.object({
 *     provider: z.union(...).default('bing').volatile(),
 *     targetLanguage: z.string().pattern(...).default('auto').volatile(),
 *   });
 */
export const Config = z.object({
	ui: z
		.object({
			drawer: z.boolean().default(true).description('输入框旁边的箭头抽屉').volatile(),
			sidebar: z.boolean().default(true).description('右侧栏的「任务」标签页').volatile(),
		})
		.description('界面入口')
		.default({ drawer: true, sidebar: true }),
});

/*
 * 宿主侧不需要做任何事：后端在 packages/core（那是一条独立的 row）。
 * 这个包存在的意义是**承载客户端**与**设置页**。
 */
export function apply() {}
