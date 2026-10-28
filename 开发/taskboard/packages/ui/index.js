/**
 * 任务板 · 界面（UI）。
 *
 * 用户要求拆八块，这是第 ④ 块：
 *   > 4.UI（bool开关放在这里，抽屉和工作区。如果两个都不要就整个关掉整个插件，
 *   >   这样ui的提供设施都没了。很合理。）
 *
 * ## 为什么 UI 能是独立包
 *
 * 官方「智能体团队」就是这么做的（dsh-experimental-agent-team-profile
 * 的 cordis.patch.yml）：
 *
 *     - id: agent-team
 *       name: '@deepseek-ai/dsh-experimental-agent-team'
 *     - id: tool-agent-team
 *       name: '@deepseek-ai/dsh-experimental-tool-agent-team'
 *     - id: ui-agent-team
 *       name: '@deepseek-ai/dsh-experimental-client-ui-agent-team'   ← UI 独立包
 *
 * 三个包，一张卡片。所以「整个事情是一个任务库」和「UI 独立成包」不冲突。
 *
 * ## 硬限制：包名必须是两段
 *
 * dsh-client-modules 的 exactPackageSpecifier：
 *
 *     function exactPackageSpecifier(specifier) {
 *       if (specifier.startsWith('@')) {
 *         const parts = specifier.split('/');
 *         return parts.length === 2 && parts.every(Boolean) ? specifier : undefined;
 *       }
 *       ...
 *     }
 *
 *   @local/taskboard-ui   → ['@local','taskboard-ui']  两段 ✅
 *   @local/taskboard/ui   → 三段                        ❌ 客户端永不加载
 *
 * 所以 UI 只能是**独立包**，不能用根包的子路径。
 *
 * ## 三个开关
 *
 *   drawer   输入框旁边的箭头抽屉
 *   sidebar  右侧栏的「任务」标签页
 *
 * 两个都关掉 = 界面上什么入口都没有。这时可以直接把这条 row 也关掉，
 * 客户端代码根本不加载，UI 的提供设施整个消失——这正是用户要的语义。
 */
import z from '@deepseek-ai/schemastery';

export const name = 'taskboard-ui';

/* 宿主侧不需要任何前置服务：UI 全在 client.js 里，浏览器加载。
 * 早先写了 inject: ['remote']，那是**客户端**服务，宿主侧不存在，
 * 于是这一行永远停在「等待依赖」。 */
export const inject = [];

/*
 * 设置页的配置。
 *
 * ## ⚠️ 每个字段都必须 `.volatile()`
 *
 * 源码（dsh-settings 的 volatileForm）：
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
 * 没有 volatile 的字段被整个丢掉；全都不是 volatile 就返回 undefined，
 * 于是没有表单、props.form 是 undefined —— 这就是之前「没有 bool 开关」的原因。
 *
 * 「volatile」= **改完立刻生效，不需要重新挂载插件**。
 */
export const Config = z.object({
	drawer: z.boolean().default(true).description('输入框旁边的箭头抽屉').volatile(),
	sidebar: z.boolean().default(true).description('右侧栏的「任务」标签页').volatile(),
	/*
	 * 原型预览：一个全屏 iframe，装的是研究沙盘里那套 HTML。
	 *
	 * 用途是**对照**——改 mod 的时候开着它，能一眼看出"线上这个界面"
	 * 和"沙盘里那个界面"差在哪。
	 *
	 * 沙盘是研究阶段的产物，可能不存在（用户没把 研究/沙盘 一起 checkout）。
	 * 所以默认关，且打不开时给一条说明而不是白屏。
	 */
	prototype: z
		.boolean()
		.default(false)
		.description('原型预览：内嵌研究沙盘的界面（用于对照）')
		.volatile(),
});

/*
 * 宿主侧不需要做什么：UI 全在 client.js 里，浏览器加载。
 * apply 留空是正常的——这个包的宿主半身只负责承载 Config。
 */
export function apply() {}
