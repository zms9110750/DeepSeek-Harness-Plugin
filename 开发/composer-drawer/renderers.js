/**
 * 渲染器注册表 —— 把行动的 `render` 名字映射到真正的渲染函数。
 *
 * ## 为什么在客户端单独一份
 *
 * `actions` 包里每个行动只带一个 `render: 'Choose'` **字符串**，不是组件。
 * 原因是宿主跑在 Node、没有 React；渲染函数（React 组件）过不了进程边界。
 *
 * 所以：
 *
 *   宿主    用 schema 校验，不关心 `render` 是什么
 *   客户端  拿 `render` 名字在这里查组件
 *
 * ## 为什么可被外部写入（用户拍板选 B）
 *
 * 用户原话：
 *
 *   > 交互类型可以被外部注册。
 *
 * 如果渲染器只能中央硬编码，"外部注册"就只实现了一半 ——
 * 外部包能定义 schema，却不能定义**新形态**，只能组合已有渲染器。
 *
 * 所以这个表开放写入。外部包在自己的客户端代码里调 `registerRenderer`
 * 就能加进来。
 *
 * ## 代价（已接受）
 *
 * 装了外部包但只装了宿主半身时，它的 action 会显示成灰色卡片 ——
 * 有 schema、没渲染器。这是"外部可注册"必须付的价，
 * 和用户之前定的"未注册 type 显示灰色"是同一条规则。
 *
 * @module taskboard-interact/renderers
 */

/**
 * `render 名字 → 渲染函数`。
 *
 * 渲染函数签名：
 *
 * ```js
 * render({ value, onChange, readOnly, theme }) -> vnode
 * ```
 *
 *   value     这个章节当前的值（object，字段见对应 action 的 schema）
 *   onChange  改值时调用，传整个新值
 *   readOnly  已采纳后为 true（只能改"用户字段"，不能改声明）
 *   theme     主题 token（不给自定义 CSS 的入口）
 *
 * @type {Map<string, Function>}
 */
const RENDERERS = new Map();

/**
 * 注册一个渲染器。
 *
 * 同名字重复注册会**覆盖** —— 外部包想替换内置组件也允许，
 * 这是刻意的：整个 `actions` 体系都在鼓励"不喜欢就换掉"。
 *
 * @param {string} name   行动里的 `render` 名字
 * @param {Function} render 渲染函数
 * @returns {void}
 */
export function registerRenderer(name, render) {
	const key = String(name ?? '').trim();
	if (key === '') throw new TypeError('registerRenderer: name 不能为空');
	if (typeof render !== 'function') throw new TypeError(`registerRenderer(${key}): 需要一个函数`);
	RENDERERS.set(key, render);
}

/**
 * 取渲染器。
 *
 * @param {string} name
 * @returns {Function | undefined} 没注册返回 undefined（调用方显示灰色卡片）
 */
export function getRenderer(name) {
	return RENDERERS.get(String(name ?? '').trim());
}

/**
 * 是否认识这个渲染器。
 *
 * @param {string} name
 * @returns {boolean}
 */
export function hasRenderer(name) {
	return RENDERERS.has(String(name ?? '').trim());
}

/**
 * 全部渲染器名字（排查用）。
 *
 * @returns {string[]}
 */
export function listRendererNames() {
	return [...RENDERERS.keys()];
}
