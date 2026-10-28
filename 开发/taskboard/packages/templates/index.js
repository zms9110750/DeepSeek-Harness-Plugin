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
/*
 * 三个领域开关。
 *
 * 用户原话：
 *   > 通用任务模板始终自带。
 *   > 领域任务模板在这里打开。并给他加配置。
 *   > 配置内容是：代码，小说，绘画。三个 bool
 *
 * 模板文件里本来就有 `domain:` 字段，取值是 general / code / writing / art。
 * 「通用」（general）**不属于这个包** —— 它在 core 的内置模板里，
 * 所以这里只有三个领域，而且关掉本包也不影响通用那批。
 */
export const Config = z.object({
	code: z.boolean().default(true).description('代码类模板（接口 / 评审 / 实现 / 修 bug…）').volatile(),
	writing: z.boolean().default(true).description('小说类模板（构思 / 章节 / 写作…）').volatile(),
	art: z.boolean().default(true).description('绘画类模板（画作 / 定调 / 出图…）').volatile(),
});

/* 只往 ctx 上 provide，不需要任何前置服务。 */
export const inject = [];

const TEMPLATE_DIR = join(dirname(fileURLToPath(import.meta.url)), 'templates');

/**
 * 领域模板在扩展包里（GU-08）。
 *
 * 用户原话：
 *   > 领域模板在模板扩展包里面。而且他们可能就没有自带的状态转移行为了。
 *   > 状态转移行为就在 core 里面。
 *
 * 所以这个包（templates）负责**全部**模板的读取和校验，
 * 但领域模板的**文件**放在 extra-templates 包里。
 *
 * 两个目录都扫，核心的在前（编号一样时核心赢）。
 */
const EXTRA_DIR = join(
	dirname(fileURLToPath(import.meta.url)),
	'..',
	'extra-templates',
	'templates',
);

/** 当前可用的模板编号（扫描目录得到，不是硬编码）。 */
let TYPES = [];

/** 读模板文件的内容。核心目录优先，找不到再去扩展包找。 */
async function readTemplate(type) {
	const wanted = String(type ?? '').trim().toUpperCase();
	if (wanted === '') throw new Error('模板类型不能为空');
	for (const dir of [TEMPLATE_DIR, EXTRA_DIR]) {
		try {
			return await readFile(join(dir, `${wanted}.yml`), 'utf8');
		} catch (failure) {
			if (failure?.code !== 'ENOENT') throw failure;
		}
	}
	throw new Error(`没有这个模板：${wanted}`);
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
	/*
	 * 三个领域开关，缺省都是开。
	 *
	 * 关掉某个领域 = 那类模板**不进 TYPES** → core 的 availableTypes()
	 * 就不会列出它们，选择器里也看不到。
	 *
	 * 通用（general）不受影响：它在 core 的内置模板里，从来不经过这里。
	 */
	const setting = config !== null && typeof config === 'object' ? config : {};
	/*
	 * ⚠️ 这三个开关是 `.volatile()` 的 —— 语义是「改完立刻生效，
	 * 不需要重新挂载插件」。
	 *
	 * 但 `apply` 只在挂载时跑一次，所以如果只在这里读一次 config，
	 * 之后用户在设置页改开关，这个模块完全不知道。
	 *
	 * 这就是「关掉绘画之后，绘画类的『上色』模板还在」的原因：
	 * 面板已经重读了 templates.json，但宿主写进去的还是旧内容 ——
	 * 因为 TYPES 从来没被重新算过。
	 *
	 * 下面的 scan() 接受**最新的 config**，配一个订阅来重复调用。
	 */
	/**
	 * 从一个字段值里读出真正的布尔。
	 *
	 * 宿主传进来的 config 可能有两种形态：
	 *   · `true` / `false` —— 明确的布尔
	 *   · `{}` —— Schemastery 的 `.volatile()` 包装，值在别处（默认值）
	 *
	 * 实测：patch 里写 `art: false`，apply 收到的却是 `{"art":{}}`。
	 * 如果只写 `value !== false`，`{}` 会被当成"没说" → 默认开 →
	 * 于是「关掉绘画，绘画模板还在」。
	 *
	 * 所以：只有明确拿到 `false` 才算关；`{}` 这种拿不到真值的，
	 * 交给下面的 configForms 订阅去纠正。
	 */
	const asBool = (value, fallback) => {
		if (value === true) return true;
		if (value === false) return false;
		if (value !== null && typeof value === 'object') {
			if (value.value === true) return true;
			if (value.value === false) return false;
		}
		return fallback;
	};

	let domains = {
		code: asBool(setting.code, true),
		writing: asBool(setting.writing, true),
		art: asBool(setting.art, true),
	};

	/**
	 * 扫目录，按当前 domains 过滤，结果写进 TYPES。
	 *
	 * @param {object | undefined} latest 最新的 config（省略时用闭包里那份）
	 * @returns {Promise<void>}
	 */
	const scan = async (latest) => {
		if (latest !== null && typeof latest === 'object') {
			domains = {
				code: asBool(latest.code, domains.code),
				writing: asBool(latest.writing, domains.writing),
				art: asBool(latest.art, domains.art),
			};
		}
		try {
			/* 两个目录：核心（本包）+ 领域（扩展包）。 */
			const sets = [];
			for (const dir of [TEMPLATE_DIR, EXTRA_DIR]) {
				try {
					const files = await readdir(dir);
					sets.push({ dir, codes: files.filter((f) => f.endsWith('.yml')).map((f) => f.replace(/\.yml$/u, '').toUpperCase()) });
				} catch {
					/* 扩展包没装就跳过 */
				}
			}
			const all = [...new Set(sets.flatMap((s) => s.codes))].sort();
			/*
			 * **不在这里按开关过滤。**
			 *
			 * 原因：宿主侧拿不到解析后的 config。
			 *
			 * 实测（加日志打的）：
			 *
			 *   patch 里写   config: { code: true, writing: true, art: false }
			 *   apply 收到   { code: {}, writing: {}, art: {} }
			 *
			 * —— `default(true).volatile()` 的布尔字段到这里变成空对象，
			 * 值丢了。宿主无从判断用户到底关没关。
			 *
			 * 而**客户端**能拿到真值：它用 `ctx.configForms.get(ns)` +
			 * `getSnapshot()`，那条路是通的（抽屉 / 右侧栏两个开关就是这么工作的）。
			 *
			 * 于是分工改成：
			 *   宿主   —— 扫出全部模板，写进清单
			 *   客户端 —— 按三个开关过滤显示
			 *
			 * 这样开关立刻生效（客户端本来就订阅 config 变化），
			 * 也不依赖宿主能不能读懂 config。
			 */
			const kept = [];
			for (const type of all) {
				/* 核心优先：先试本包，再试扩展包。 */
				for (const set of sets) {
					if (!set.codes.includes(type)) continue;
					try {
						await readFile(join(set.dir, `${type}.yml`), 'utf8');
						kept.push(type);
						break;
					} catch {
						/* 读不出来就跳过 */
					}
				}
			}
			TYPES = kept;
		} catch (failure) {
			TYPES = [];
		}
	};

	/* 扫目录拿 TYPES。放 ctx.effect 里是为了热重载时能重新扫。 */
	ctx.effect(() => {
		let alive = true;
		void scan().then(() => {
			if (!alive) TYPES = [];
		});
		return () => {
			alive = false;
		};
	}, 'taskboard-templates: 扫描模板目录');

	/*
	 * 订阅配置变化，重新扫。
	 *
	 * 用 `ctx.configForms.get(key)` —— key 是 patch 里的 **id**
	 * （`taskboard-templates`），不是包名。
	 *
	 * 拿不到 configForms（老宿主 / 独立测试）就退化成"只在挂载时算一次"，
	 * 功能仍然可用，只是改开关要重启。
	 */
	try {
		const form = ctx.configForms?.get?.('taskboard-templates');
		if (form !== undefined && form !== null && typeof form.subscribe === 'function') {
			ctx.effect(() => {
				return form.subscribe(() => {
					const snapshot = typeof form.getSnapshot === 'function' ? form.getSnapshot() : undefined;
					void scan(snapshot?.value);
				});
			}, 'taskboard-templates: 领域开关变化重新扫描');
		}
	} catch (failure) {
		/* 没有 configForms 就只按挂载时的 config 走 */
	}

	try {
		ctx.provide('taskboardTemplates', service);
	} catch (failure) {
		/* 没有 provide 能力时，core 那边会回落到自己的内置实现 */
	}
}
