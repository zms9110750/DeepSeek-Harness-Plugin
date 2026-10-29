/**
 * 领域模板扩展包。
 *
 * ## 它和 @local/taskboard-templates 的分工
 *
 * 用户原话（GU-08）：
 *
 *   > 领域模板在模板扩展包里面。而且他们可能就没有自带的状态转移行为了。
 *   > 状态转移行为就在 core 里面。
 *
 * 所以：
 *
 *   核心模板包   9 个地基模板（用户需求 / 提问 / 决策 / 调研 / 校验 /
 *                阻碍 / 交付 / 复盘 / 留档）
 *                —— 这九个是支撑体系的地基，四类的状态规则靠它们成立
 *
 *   本包         领域模板（代码 / 写作 / 绘画）
 *                —— 只提供章节，**不带状态规则**
 *
 * ## 不带状态规则是什么意思
 *
 * 一条 `WD 起草` 挂在目标下面时，它仍然是「工作」类：
 * 要靠「交付」派生任务才能被 AI 标成功，要靠「阻碍」才能标失败 ——
 * 这些规则来自 core，不来自这个模板。
 *
 * 模板自己只决定「这个任务的正文长什么样」。
 */

import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const name = 'taskboard-extra-templates';

export const inject = ['taskboard-templates'];

const TEMPLATE_DIR = join(dirname(fileURLToPath(import.meta.url)), 'templates');

/**
 * 极简 YAML 读取 —— 只取本包需要的几个顶层字段。
 *
 * 完整解析在 @local/taskboard-templates 里（那边有 schema 校验）。
 * 这里刻意不复用：领域模板的结构规则可能和核心模板不一样，
 * 而复用会让两边耦合。
 *
 * @param {string} source
 * @returns {Record<string, unknown>}
 */
function parseMeta(source) {
	const meta = {};
	for (const line of source.split(/\r?\n/u)) {
		/* 只认顶层键（缩进 0），跳过注释和空行。 */
		if (line === '' || line.startsWith('#') || /^\s/u.test(line)) continue;
		const at = line.indexOf(':');
		if (at <= 0) continue;
		const key = line.slice(0, at).trim();
		const value = line.slice(at + 1).trim();
		if (value === '') continue;
		meta[key] = value;
	}
	return meta;
}

/** 扫描本包的全部领域模板。 */
async function scanTemplates() {
	let files;
	try {
		files = await readdir(TEMPLATE_DIR);
	} catch {
		return [];
	}

	const found = [];
	for (const file of files.filter((f) => f.endsWith('.yml')).sort()) {
		const code = file.replace(/\.yml$/u, '').toUpperCase();
		const source = await readFile(join(TEMPLATE_DIR, file), 'utf8');
		const meta = parseMeta(source);
		found.push({
			type: code,
			name: String(meta.name ?? code),
			kind: String(meta.default_kind ?? 'work'),
			domain: String(meta.domain ?? 'core'),
			description: String(meta.description ?? ''),
			/* 领域模板不带状态规则 —— 这个字段恒为 false，写在数据里是为了
			   让读的人一眼看出"它们和核心模板的差别在哪"。 */
			carriesStateRules: false,
		});
	}
	return found;
}

/**
 * 注册给 templates 服务的领域模板清单。
 *
 * 没有配置项 —— 领域模板的开关在 templates 服务的 configForm 里，
 * 这里只是把"有哪些"报上去。
 */
export async function apply(ctx) {
	let cache;

	ctx.set('taskboard-extra-templates', {
		/** 全部领域模板。 */
		async list() {
			if (cache === undefined) cache = await scanTemplates();
			return cache;
		},
		/** 强制重扫（改完模板文件后调）。 */
		async rescan() {
			cache = await scanTemplates();
			return cache;
		},
	});

	ctx.logger?.info?.('taskboard-extra-templates: 扫描领域模板目录');
}
