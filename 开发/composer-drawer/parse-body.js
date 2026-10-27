/**
 * 正文解析器 —— 把「按章节 id 索引的 object」变成「可渲染的条目列表」。
 *
 * ## 为什么不再解析 Markdown
 *
 * 用户原话：
 *
 *   > 不存 md 了。你存 md 你还要走 md 解析器。那你解析器不是白做了？
 *   > 要 md 就把文本框直接走 md 的解析器。
 *
 * 所以正文的存储形态是：
 *
 * ```js
 * {
 *   want: { action: 'textarea', value: '把任务板修好' },
 *   how:  { action: 'choose', options: ['A','B'], picked: 'A' },
 * }
 * ```
 *
 * Markdown 只是某个 action 的**载荷**（`value` 的内容），不是正文的格式。
 * `parseSections`（按 `## ` 切字符串）整个不需要了。
 *
 * ## 这个文件做什么
 *
 * 输入：正文 object + 模板章节（要知道顺序和标题）
 * 输出：条目数组，每项已经绑定好渲染器
 *
 * 顺序来自**模板**，不是 object 的键顺序 ——
 * 键顺序在 JSON 里虽然稳定，但模型生成的顺序不可控，
 * 而模板里 `body` 的顺序是作者排好的。
 *
 * ## 兼容旧数据
 *
 * 老数据（和旧的工具参数）正文是 Markdown 字符串。用户明确说不迁移。
 * 这里把字符串当成「一整块 markdown」，不切分、不猜结构 ——
 * 切了就等于我又写了一遍 Markdown 解析器，正是用户反对的事。
 *
 * @module taskboard-interact/parse-body
 */

import { getAction } from '../taskboard/packages/actions/index.js';
import { getRenderer } from './renderers.js';

/**
 * 一个可渲染的条目。
 *
 * @typedef {object} BodyEntry
 * @property {string} id        章节 id
 * @property {string} label     章节标题
 * @property {string} action    行动名
 * @property {object} value     这个章节的值（不含 action）
 * @property {boolean} required 模板里是否必填
 * @property {Function | null} render 渲染函数；null = 没有注册器（显示灰色卡片）
 * @property {object | null} schema  行动的 schema（灰色卡片里用来提示字段）
 */

/**
 * 解析正文。
 *
 * @param {unknown} body      正文（object 或旧的 Markdown 字符串）
 * @param {Array<{id: string, label: string, type: string[], required: boolean}>} sections 模板章节
 * @returns {BodyEntry[]}
 */
export function parseBody(body, sections) {
	/* ── 旧格式：整段 Markdown，当成一个 markdown 条目 ── */
	if (typeof body === 'string') {
		if (body.trim() === '') return [];
		return [
			{
				id: '__legacy__',
				label: '',
				action: 'markdown',
				value: { value: body },
				required: false,
				render: getRenderer('Markdown') ?? null,
				schema: getAction('markdown')?.schema ?? null,
			},
		];
	}

	if (body === null || typeof body !== 'object' || Array.isArray(body)) return [];

	/** @type {BodyEntry[]} */
	const entries = [];

	/*
	 * 先按模板顺序走 —— 这样显示的次序是作者排的，不是模型写的。
	 * 同时把用掉的键记下来，后面补"模板里没有但正文里有"的。
	 */
	const used = new Set();
	for (const section of Array.isArray(sections) ? sections : []) {
		const id = String(section?.id ?? '');
		const label = String(section?.label ?? id);
		if (id === '') continue;

		/* 正文里按 id 找；找不到再按 label 找（兼容手写的）。 */
		let raw = body[id];
		let key = id;
		if (raw === undefined) {
			raw = body[label];
			key = label;
		}
		used.add(key);

		/* 模板里有、正文里没有：**不生成条目**。
		 * 空章节不画出来 —— 编辑时由表单补，只看时不该占位置。 */
		if (raw === undefined || raw === null) continue;

		const entry = toEntry(id, label, raw, section.required === true);
		if (entry !== null) entries.push(entry);
	}

	/*
	 * 正文里有、模板里没有的键：也显示出来，但标成"未知章节"。
	 *
	 * 为什么不丢：这些数据是用户/模型写的，静默丢掉等于数据消失，
	 * 而且找不到原因。显示成一条灰的，至少看得见。
	 */
	for (const [key, raw] of Object.entries(body)) {
		if (used.has(key)) continue;
		const entry = toEntry(key, key, raw, false);
		if (entry !== null) entries.push(entry);
	}

	return entries;
}

/**
 * 把一个章节的原始值变成条目。
 *
 * @param {string} id
 * @param {string} label
 * @param {unknown} raw
 * @param {boolean} required
 * @returns {BodyEntry | null}
 */
function toEntry(id, label, raw, required) {
	if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
		/* 坏数据：给一个能显示的兜底，别让整份正文塌掉 */
		return {
			id,
			label,
			action: 'markdown',
			value: { value: String(raw ?? '') },
			required,
			render: getRenderer('Markdown') ?? null,
			schema: getAction('markdown')?.schema ?? null,
		};
	}

	const action = String(raw.action ?? '').trim();
	if (action === '') return null;

	const { action: _ignored, ...value } = raw;
	const spec = getAction(action);

	return {
		id,
		label,
		action,
		value,
		required,
		/* 渲染器按**行动自己的 render 名字**查，不是按 action 名 ——
		 * 两者可以不同（比如 action 叫 creat_link，render 叫 Derive）。 */
		render: getRenderer(spec?.render ?? action) ?? null,
		schema: spec?.schema ?? null,
	};
}

/**
 * 把条目数组还原成正文 object（编辑后保存用）。
 *
 * @param {BodyEntry[]} entries
 * @returns {Record<string, object>}
 */
export function buildBody(entries) {
	const out = {};
	for (const entry of Array.isArray(entries) ? entries : []) {
		if (entry.id === '__legacy__') return entry.value.value;
		out[entry.id] = { action: entry.action, ...entry.value };
	}
	return out;
}
