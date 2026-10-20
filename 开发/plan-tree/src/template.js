/**
 * proposal-template · 提案格式：层、小节、要回答的问题。
 *
 * 模板是一个可手改的 markdown 文件（`templates/提案格式.md`）：
 *   `##` 是层，`###`–`######` 是层里的小节，`-` 开头的是这个小节要回答的问题。
 * 插件不认识任何固定的层名——人类改文件，插件读文件。
 *
 * @module @local/plan-tree/template
 */
import { readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const name = 'proposal-template';

export const inject = [];

const PLUGIN_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
export const TEMPLATES_DIR = join(PLUGIN_DIR, 'templates');
export const DEFAULT_TEMPLATE = join(TEMPLATES_DIR, '提案格式.md');

/**
 * 解析模板。
 * @param text - 模板文件内容。
 * @returns 按文件顺序的层，每层带自己的小节与问题。
 */
export function parseTemplate(text) {
	const layers = [];
	let current;
	for (const raw of String(text).split(/\r?\n/)) {
		const heading = /^(#{2,6})\s+(.+?)\s*$/.exec(raw);
		if (heading !== null) {
			if (heading[1].length === 2) {
				layers.push({ title: heading[2], sections: [] });
				current = undefined;
			} else if (layers.length > 0) {
				current = { title: heading[2], prompts: [] };
				layers[layers.length - 1].sections.push(current);
			}
			continue;
		}
		const prompt = /^\s*-\s*(.+?)\s*$/.exec(raw);
		if (prompt !== null && current !== undefined) current.prompts.push(prompt[1]);
	}
	return layers;
}

/** 读模板文件；文件不在就给一条带路径的错误。 */
export function loadTemplate(path) {
	let text;
	try {
		text = readFileSync(path, 'utf8');
	} catch {
		throw new Error(`proposal-template: no template at ${path} — put a markdown template in ${TEMPLATES_DIR}`);
	}
	const layers = parseTemplate(text);
	if (layers.length === 0) throw new Error(`proposal-template: ${path} declares no "## 层名" headings`);
	return layers;
}

/**
 * 渲染一份提案骨架。每个小节标题都会写出来，哪怕内容为空：
 * 标题代表"这一项想过"，内容由人/模型去填。
 * @param args - title / type / goal / done_when / where_to_learn / body / author。
 * @param layer - 模板里的一层。
 * @returns markdown 全文。
 */
export function renderPlan(args, layer) {
	/** 空的头部字段整行不写：用户自拟的计划只有标题和正文。 */
	const header = (label, value) => {
		const text = String(value ?? '').trim();
		return text === '' ? [] : [`- ${label}：${text}`];
	};
	const lines = [
		`# ${args.title}`,
		'',
		`- 类型：${args.type ?? 'plan'}`,
		`- 层：${layer.title}`,
		...header('目的', args.goal),
		...header('判据', args.done_when),
		...header('去处', args.where_to_learn),
		...(args.author === 'user' ? ['- 作者：用户'] : []),
		'',
		`## ${layer.title}`,
		'',
	];
	for (const section of layer.sections) {
		lines.push(`### ${section.title}`, '');
		if (section.prompts.length > 0) {
			lines.push('要回答：');
			for (const prompt of section.prompts) lines.push(`- ${prompt}`);
			lines.push('');
		}
		lines.push('回答：', '');
	}
	if (layer.sections.length === 0) lines.push('（模板未声明小节）');
	lines.push('');
	if (String(args.body ?? '').trim() !== '') lines.push('### 正文', '', args.body, '');
	return lines.join('\n');
}

/** 按名字或绝对路径找到模板文件。 */
export function resolveTemplate(named) {
	const text = String(named ?? '').trim();
	if (text === '') return DEFAULT_TEMPLATE;
	if (isAbsolute(text)) return text;
	return join(TEMPLATES_DIR, text.endsWith('.md') ? text : `${text}.md`);
}

export function apply(ctx) {
	ctx.provide('proposalTemplate', { parse: parseTemplate, load: loadTemplate, render: renderPlan, resolve: resolveTemplate, dir: TEMPLATES_DIR });
}
