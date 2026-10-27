/**
 * 按章节校验一段正文。
 *
 * ## 这一层解决什么
 *
 * 行动库只知道「choose 需要哪些字段」。
 * 但宿主真正要校验的是**一份提案的某一章**：
 *
 *     「怎么做」这一章，模板声明可以是 [choose, textarea]，
 *     模型传进来是 { action: 'choose', options: ['A','B'] }
 *
 * 于是要串三步：
 *   ① 这一章的 `type` 里有没有 `action`？没有 → 拒绝（模型用错了行动）
 *   ② 有 → 取该行动的 schema，校验这个 object
 *   ③ 都对 → 通过
 *
 * ## 为什么放这里而不是 action 库里
 *
 * action 库是**正交的**：它只描述行动，不知道「章节」是什么。
 * 章节是模板的概念。把两者放一起，action 库就不再正交了 ——
 * 它会需要 import 模板的东西，而模板又会 import 行动名，成环。
 *
 * 所以这层单独一个文件，只依赖 action 库，不依赖模板：
 * 调用方把「这一章允许哪些行动」作为参数传进来。
 *
 * @module @local/taskboard-actions/section
 */

import { formatIssues, getAction, validate } from './index.js';

/**
 * 校验结果。
 *
 * @typedef {object} SectionResult
 * @property {boolean} ok
 * @property {string} [reason]    不通过时的一句话（可直接给模型看）
 * @property {string} [action]    通过时：这个 object 用的是哪个行动
 * @property {object} [value]     通过时：去掉 `action` 之后的字段（给渲染器用）
 */

/**
 * 校验一章的内容。
 *
 * @param {object} section          模板里的一章
 * @param {string} section.label    章节标题（报错时用）
 * @param {string | string[]} section.type  允许的行动名
 * @param {unknown} payload         模型传进来的 object
 * @returns {SectionResult}
 */
export function validateSection(section, payload) {
	const label = String(section?.label ?? '（未命名章节）');
	/*
	 * `type` 接受两种写法：
	 *
	 *   type: textarea              单个（现有 27 个模板全是这种）
	 *   type: [textarea, choose]    多个，这一章可以用其中任意一种
	 *
	 * 单写字符串时**不要**自动理解成"字符串的每个字符"——那是 JS 里
	 * 把 string 当数组遍历的经典坑（`'textarea'.includes('text')` 会意外为真）。
	 * 所以先归一成数组再用。
	 */
	const allowed = normalizeTypes(section?.type);

	if (allowed.length === 0) {
		return { ok: false, reason: `章节「${label}」没有声明任何 type，模板配置有问题` };
	}

	/* ① 这一章允许哪些行动 —— object 里必须自己说是哪个。 */
	if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
		return { ok: false, reason: `章节「${label}」需要一个对象（带 action 字段），收到 ${describe(payload)}` };
	}

	const actionName = String(payload.action ?? '').trim();
	if (actionName === '') {
		return {
			ok: false,
			reason: `章节「${label}」的 object 缺少 action 字段，可选：${allowed.join(' / ')}`,
		};
	}
	if (!allowed.includes(actionName)) {
		return {
			ok: false,
			reason: `章节「${label}」不接受 action「${actionName}」，它只接受：${allowed.join(' / ')}`,
		};
	}

	/* ② 取该行动的 schema。 */
	const action = getAction(actionName);
	if (action === undefined) {
		/*
		 * 章节声明了这个行动，但行动库里没有。
		 * 这是**部署问题**（模板和行动库版本不匹配），不是模型用错。
		 * 所以报错文案要指向配置，别让模型以为是自己写错了。
		 */
		return {
			ok: false,
			reason: `章节「${label}」用到了未注册的行动「${actionName}」（模板与行动库版本不匹配）`,
		};
	}

	/* ③ 校验字段。`action` 本身是调度用的，不进 schema。 */
	const { action: _ignored, ...fields } = payload;
	const issues = validate(action.schema, fields);
	if (issues.length > 0) {
		return {
			ok: false,
			reason: `章节「${label}」的 ${actionName} 字段不合法：${formatIssues(issues)}`,
		};
	}

	return { ok: true, action: actionName, value: fields };
}

/**
 * 校验整份正文。
 *
 * @param {Array<{label: string, type: string[]}>} sections 模板声明的章节（按顺序）
 * @param {Record<string, unknown>} payloads              按章节标题给的 object
 * @returns {{ ok: boolean, reason?: string, values?: Record<string, object> }}
 */
export function validateDocument(sections, payloads) {
	if (!Array.isArray(sections) || sections.length === 0) {
		return { ok: false, reason: '模板没有声明任何章节' };
	}
	const given = payloads !== null && typeof payloads === 'object' ? payloads : {};
	const values = {};

	for (const section of sections) {
		const label = String(section?.label ?? '');
		if (label === '') continue;

		const payload = given[label];
		/*
		 * 整章缺失：只有当这一章的所有 type 都是必填类行动时才是错。
		 *
		 * 现在的实现里「必填」是模板 body 里 `required: true` 表达的，
		 * 但那是**表单校验**的概念；这里的 payload 来自工具调用，
		 * 缺一章通常意味着模型没写完 —— 由模板的 required 决定要不要拦。
		 * 为了不让这一层依赖模板细节，缺章一律放过，留给调用方判断。
		 */
		if (payload === undefined) continue;

		const result = validateSection(section, payload);
		if (!result.ok) return { ok: false, reason: result.reason };
		values[label] = { action: result.action, ...result.value };
	}

	return { ok: true, values };
}

/**
 * 把章节的 `type` 归一成数组。
 *
 * 模板里两种写法都允许：
 *
 *   type: textarea              单个（现有 27 个模板全是这种）
 *   type: [textarea, choose]    多个
 *
 * 解析器和校验器都要用这个，所以单独导出 —— 两处各写一遍归一逻辑，
 * 迟早会有一处忘了处理字符串形态。
 *
 * @param {unknown} type
 * @returns {string[]} 去重后的行动名；不合法时返回空数组
 */
export function normalizeTypes(type) {
	if (typeof type === 'string') {
		const single = type.trim();
		return single === '' ? [] : [single];
	}
	if (!Array.isArray(type)) return [];
	const out = [];
	for (const item of type) {
		if (typeof item !== 'string') continue;
		const name = item.trim();
		if (name !== '' && !out.includes(name)) out.push(name);
	}
	return out;
}

/**
 * 报错用的类型名。
 *
 * @param {unknown} value
 * @returns {string}
 */
function describe(value) {
	if (value === null) return '空';
	if (Array.isArray(value)) return '数组';
	if (typeof value === 'object') return '对象（但没带 action）';
	return typeof value === 'string' ? `文本「${value.slice(0, 20)}」` : typeof value;
}
