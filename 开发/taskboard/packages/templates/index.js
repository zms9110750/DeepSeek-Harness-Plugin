/**
 * 默认任务模板 —— 独立插件。
 *
 * 一个包，七个插件（用户要求）：
 *   core / templates / plan-preset / workspace / ui-drawer / ui-sidebar
 *
 * 这个插件负责：27 个模板的**目录**与**读取**。
 *
 * 为什么单独一个插件（用户原话）：
 *   「再分一个插件出来：默认任务模板。」
 *
 * 分开的好处：想用自己的一套模板时，关掉这个、换一个提供同样接口的插件即可；
 * 不想用模板（只要空模板）也可以关掉——core 会回落到"没有模板"，
 * `task_template` 报错但其它工具照常工作。
 *
 * 依赖方向：templates →（无）。它是叶子。
 * 谁用我：core 的 `task_template` / `task_dispatch` 通过 `getTemplates()` 读。
 */
import z from '@deepseek-ai/schemastery';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const name = 'taskboard-templates';

/*
 * 领域模板开关。
 *
 * 用户要求：
 *   > 5.额外的模板（空模板和你写的"通用"分类的始终在核心里面提供。
 *   >   这里写"程序，项目"，"小说"，"绘画"这些特定领域的模板。
 *   >   并且这些都要作为一个 ui 的 bool 可以开关。）
 *
 * 所以这个包只管**领域模板**（程序 / 项目 / 小说 / 绘画…）。
 * 空模板和通用分类在 core 里，关掉这个包也还在。
 *
 * .volatile() 是设置页能渲染表单的硬条件（dsh-settings 的 volatileForm
 * 会把非 volatile 字段整个丢掉）。改完立刻生效。
 */
export const Config = z.object({
	enabled: z.boolean().default(true).description('领域模板（程序 / 项目 / 小说 / 绘画…）').volatile(),
});

/* 只往 ctx 上 provide，不需要任何前置服务。 */
export const inject = [];

const TEMPLATE_DIR = join(dirname(fileURLToPath(import.meta.url)), 'templates');

/** 当前可用的模板编号（扫描目录得到，不是硬编码）。 */
let TYPES = [];

/** 读模板文件的内容。 */
async function readTemplate(type) {
	const wanted = String(type ?? '').trim().toUpperCase();
	if (wanted === '') throw new Error('模板类型不能为空');
	const source = await readFile(join(TEMPLATE_DIR, `${wanted}.yml`), 'utf8');
	return source;
}

/** 列出所有模板（编号 + YAML 全文），给面板的 INDEX 用。 */
async function listTemplates() {
	const out = [];
	for (const type of TYPES) {
		try {
			out.push({ type, yaml: await readTemplate(type) });
		} catch (failure) {
			out.push({ type, yaml: '' });
		}
	}
	return out;
}

/*
 * 对外接口。core 通过 ctx.get('taskboardTemplates') 拿。
 *
 * 不给 core 直接 import 这个模块——那样 core 就硬依赖 templates，
 * 关掉 templates 插件时 core 会直接崩。通过服务查找，拿不到就优雅降级。
 */
const service = {
	/** 全部模板编号。 */
	types: () => TYPES.slice(),
	/** 读一个模板的 YAML。 */
	read: readTemplate,
	/** 全部模板（{type, yaml} 数组）。 */
	list: listTemplates,
};

export function apply(ctx, config) {
	const enabled = config === null || config === undefined || config.enabled !== false;
	/* 扫目录拿 TYPES。放 ctx.effect 里是为了热重载时能重新扫。 */
	ctx.effect(() => {
		let alive = true;
		void (async () => {
			try {
				/* 关掉时不扫目录：TYPES 空 → core 的 availableTypes() 只剩内置。 */
				if (!enabled) {
					if (alive) TYPES = [];
					return;
				}
				const files = await readdir(TEMPLATE_DIR);
				const found = files
					.filter((file) => file.endsWith('.yml'))
					.map((file) => file.replace(/\.yml$/u, '').toUpperCase())
					.sort();
				if (alive) TYPES = found;
			} catch (failure) {
				if (alive) TYPES = [];
			}
		})();
		return () => {
			alive = false;
		};
	}, 'taskboard-templates: 扫描模板目录');

	try {
		ctx.provide('taskboardTemplates', service);
	} catch (failure) {
		/* 没有 provide 能力时，core 那边会回落到自己的内置实现 */
	}
}
