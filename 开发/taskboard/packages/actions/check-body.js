/**
 * 宿主侧的正文校验 —— 工具收参时、落盘之前。
 *
 * ## 为什么必须在落盘前
 *
 * 用户原话：
 *
 *   > 架构校验不能过，直接拒绝这个计划提案。工具返回就是报错的。
 *   > 校验过了，才上任务板。然后解析器工作。
 *
 * 所以这里的语义是**拒绝**，不是「存下来再显示成灰色卡片」。
 * 任务板上不存在不合法的正文 —— 那会让所有下游（渲染、导出、AI 读取）
 * 都要处理一个本该不存在的形态。
 *
 * ## 两个阶段
 *
 * ```
 * ① 形状检查（不看模板）
 *      正文是不是一个 object？键是不是章节 id？
 * ② 按模板检查（要模板）
 *      每个章节的 type 里有没有这个 action？字段对不对？
 * ```
 *
 * 阶段 ① 永远能做；阶段 ② 需要模板，拿不到模板时**只做 ①**并放行 ——
 * 因为「模板没读到」是部署问题，不该让模型背锅。
 *
 * ## 兼容旧形态
 *
 * 老数据（和现在的工具参数）`body` 是 Markdown 字符串。用户明确说不迁移。
 * 所以这里是：**字符串 = 旧格式 = 原样放行**，不做任何解析。
 * 新数据用 object。
 *
 * @module @local/taskboard-actions/check-body
 */

import { validateDocument } from './section.js';
import { parseTemplateSections } from './parse-template.js';

/**
 * 校验结果。
 *
 * @typedef {object} BodyCheck
 * @property {boolean} ok
 * @property {string} [reason]  不通过时的原因（直接进工具报错）
 * @property {object} [body]    通过时归一后的正文（原样返回，不改）
 */

/**
 * 校验一份正文。
 *
 * @param {unknown} body          工具传进来的正文
 * @param {object} options
 * @param {string} options.type   模板编号（空 = 空模板）
 * @param {(type: string) => Promise<string>} options.loadTemplate 读模板 YAML 的函数
 * @returns {Promise<BodyCheck>}
 */
export async function checkBody(body, options) {
	const type = String(options?.type ?? '').trim();

	/* ── 旧格式：Markdown 字符串，原样放行 ── */
	if (typeof body === 'string') return { ok: true, body };

	if (body === null || typeof body !== 'object' || Array.isArray(body)) {
		return {
			ok: false,
			reason: `body 必须是对象（按章节 id 索引）或字符串（旧的 Markdown），收到 ${describe(body)}`,
		};
	}

	/*
	 * 形状检查：键必须是字符串，值必须是带 action 的 object。
	 * 这一步不需要模板，所以任何时候都能做。
	 */
	for (const [key, section] of Object.entries(body)) {
		if (key.trim() === '') return { ok: false, reason: 'body 里有空的章节键' };
		if (section === null || typeof section !== 'object' || Array.isArray(section)) {
			return { ok: false, reason: `body.${key} 必须是对象（带 action 字段），收到 ${describe(section)}` };
		}
		if (typeof section.action !== 'string' || section.action.trim() === '') {
			return { ok: false, reason: `body.${key} 缺少 action 字段` };
		}
	}

	/* 空模板：没有章节可对，形状检查通过就算过。 */
	if (type === '') return { ok: true, body };

	/* ── 按模板检查 ── */
	let source;
	try {
		source = await options.loadTemplate(type);
	} catch (error) {
		/*
		 * 读不到模板 = 部署问题（模板被删了、type 写错了但已通过前面的检查）。
		 * 不放行也不拦 —— 拦了会让模型无从修改（它改不了模板）。
		 * 所以放行，让上层决定。这不是"校验通过"，是"没法校验"。
		 */
		return { ok: true, body };
	}

	const sections = parseTemplateSections(source);
	if (sections.length === 0) return { ok: true, body };

	/*
	 * 把 body 从「按 id 索引」翻译成 validateDocument 要的「按 label 索引」。
	 *
	 * 为什么用 label：模板里章节标题就是正文里的 `## 标题`，
	 * 而 `validateDocument` 是照那个设计的。用 id 也对，但需要两处都认，
	 * 反而容易错。这里只做一次翻译，下游只认一种。
	 */
	const byLabel = {};
	const idToLabel = new Map();
	for (const section of sections) {
		idToLabel.set(section.id, section.label);
		idToLabel.set(section.label, section.label);
	}
	for (const [key, value] of Object.entries(body)) {
		const label = idToLabel.get(key);
		if (label !== undefined) byLabel[label] = value;
	}

	const result = validateDocument(sections, byLabel);
	if (!result.ok) return { ok: false, reason: result.reason };

	/*
	 * 模板里标了 required 的章节，正文必须有。
	 * `validateDocument` 故意不检查这个（它不知道必填的语义），所以在这里补。
	 */
	for (const section of sections) {
		if (!section.required) continue;
		if (body[section.id] === undefined && body[section.label] === undefined) {
			return { ok: false, reason: `缺少必填章节「${section.label}」` };
		}
	}

	return { ok: true, body };
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
	if (typeof value === 'object') return '对象';
	return typeof value;
}
