/**
 * ③ 模板加载器 —— **读 YAML、解析、注册进本包的注册表**。
 *
 * ## 为什么这件事从 ⑧ 搬到 ③
 *
 * 用户 `14:50`：
 *   「那他就管。他的行为确实是注册的。但是**初始化的时候自己注册一些默认的也很合理吧**。」
 *   「**是的。他要去读 yaml。读失败了要提供报错能力。**」
 *
 * ⇒ 模板是 ③ 的词汇，**加载也归 ③**。⑧ 只负责启动编排（调 `apply`）。
 *
 * ⚠ **这打破了 ③ 原本「零依赖 + 不碰 I/O」的边界 —— 用户已批准。**
 * 代价（如实记录）：
 *   1. `package.json` 多一个 `yaml` 依赖；
 *   2. 生成的 `.d.ts` 会引用 `node:fs` / `node:path` 类型 ⇒ 消费方需要 `@types/node`；
 *   3. `apply` 里**同步读盘**，会阻塞插件启动（当前 20 个文件，可接受）。
 *
 * ## 目录位置
 *
 * 模板随包分发：`packages/types/templates/`（**不是**仓库根）。
 * 构建后本文件位于 `packages/types/lib/templates.js` ⇒ 包根是 `lib/` 的上一级。
 *
 * **扫描范围**：
 *   1. `templates/` 根目录下散落的 `.yaml`（若有）；
 *   2. `templates/` 的**一级子目录**（`core/` / `code/` / 将来新增的领域目录…），
 *      **排除 `actions/`** —— 那里是行为定义，不是模板。
 *
 * ⚠ **不递归**：`templates/` 只有两层，递归会连 `actions/` 的子层也扫进来，
 * 而"按已知层级扫"比"递归乱扫 + 黑名单"更稳。
 *
 * ## 失败处理（用户 `14:50`「core 可以继续开」）
 *
 * **逐个收集、不中途抛**：一次启动就能看到全部问题。
 * 返回 `failures` 数组，**调用方（`apply`）只打日志、不抛**。
 *
 * **⚠ 就绪标记的条件（已裁）**：**至少成功注册 1 个模板**就调
 * `markTemplateRegistryReady()`，**不要求零失败**。
 * 0 个成功则不标记 ⇒ `resolve` 继续抛"未就绪"，如实反映"什么都没加载上"。
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse as parseYaml } from 'yaml';

import type { TemplateIssue } from './errors.js';
import { getKind } from './kind.js';
import {
	type DeriveDef,
	type SectionDef,
	type TemplateDef,
	markTemplateRegistryReady,
	registerTemplate,
	templateCount,
} from './template.js';

/** 本文件所在目录（构建后是 `packages/types/lib`）。 */
const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * 模板根目录的候选路径，按顺序探测。
 *
 * 1. `join(HERE, '..', 'templates')` —— 构建后在 `packages/types/lib/`
 *    ⇒ `packages/types/templates`（**生产路径，随包分发**）
 * 2. `join(HERE, 'templates')` —— 若将来把模板与构建产物放一起（安装进 dsh 后的可能形态）
 * 3. `join(HERE, '..', '..', '..', 'templates')` —— 兼容"模板仍在仓库根"的旧布局（过渡期）
 */
const CANDIDATES = [
	join(HERE, '..', 'templates'),
	join(HERE, 'templates'),
	join(HERE, '..', '..', '..', 'templates'),
];

/**
 * 不作为模板目录扫描的一级子目录。
 *
 * `actions/` 放的是**行为定义**（`text` / `ask` / `markdown`），不是模板：
 * 它们没有 `name` / `kind` / `codePrefix`，混进来会被当成坏模板报错。
 */
const NON_TEMPLATE_DIRS = new Set(['actions']);

/** 找到模板根目录；找不到返回 `undefined`（不抛错 —— 由调用方决定怎么报）。 */
export function findTemplatesDir(): string | undefined {
	for (const candidate of CANDIDATES) {
		const absolute = resolvePath(candidate);
		if (existsSync(absolute)) return absolute;
	}
	return undefined;
}

/** 列出 `dir` 下的 `.yaml` / `.yml` 文件（非递归）。目录不存在 ⇒ 空数组。 */
function yamlFilesIn(dir: string): string[] {
	if (!existsSync(dir)) return [];
	return readdirSync(dir)
		.filter((name) => name.endsWith('.yaml') || name.endsWith('.yml'))
		.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

/** 列出 `dir` 下的一级子目录名（排除非模板目录）。目录不存在 ⇒ 空数组。 */
function templateSubdirsIn(dir: string): string[] {
	if (!existsSync(dir)) return [];
	return readdirSync(dir, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name)
		.filter((name) => !NON_TEMPLATE_DIRS.has(name))
		.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

/**
 * 收集全部模板 YAML：根目录 + 一级子目录。
 *
 * 返回 `{ file, displayPath }`：`displayPath` 是相对模板根的可读路径，
 * **只用于报错定位**（错误里写 `core/userNeed.yaml` 比写绝对路径有用）。
 */
function collectTemplateFiles(dir: string): { file: string; displayPath: string }[] {
	const out: { file: string; displayPath: string }[] = [];

	/* ① 根目录散落的 yaml（当前没有，但保留 —— 否则将来有人放根目录会静默扫不到）。 */
	for (const name of yamlFilesIn(dir)) {
		out.push({ file: join(dir, name), displayPath: name });
	}

	/* ② 一级子目录（排除 actions/）。 */
	for (const sub of templateSubdirsIn(dir)) {
		for (const name of yamlFilesIn(join(dir, sub))) {
			out.push({ file: join(dir, sub, name), displayPath: join(sub, name) });
		}
	}

	return out;
}

/** 读一个 YAML 文件并解析。失败 ⇒ 记一条 issue，**不抛**。 */
function readYamlFile(
	file: string,
	displayPath: string,
	failures: TemplateIssue[],
): unknown {
	let text: string;
	try {
		text = readFileSync(file, 'utf8');
	} catch (error) {
		failures.push({
			code: 'TEMPLATE_PARSE_FAILED',
			message: `读不到模板文件 ${displayPath}：${error instanceof Error ? error.message : String(error)}`,
			file: displayPath,
		});
		return undefined;
	}
	try {
		return parseYaml(text);
	} catch (error) {
		failures.push({
			code: 'TEMPLATE_PARSE_FAILED',
			message: `模板文件 ${displayPath} 不是合法 YAML：${error instanceof Error ? error.message : String(error)}`,
			file: displayPath,
		});
		return undefined;
	}
}

/* ─────────────────────────────────────────────────────────────
 * YAML 对象 → ③ 的注册项
 * ───────────────────────────────────────────────────────────── */

function asRecord(value: unknown): Record<string, unknown> | undefined {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
	return value as Record<string, unknown>;
}

function asString(value: unknown): string | undefined {
	return typeof value === 'string' ? value : undefined;
}

/**
 * 把 YAML 的 `sections`（object：章节名 → 声明）转成数组。
 *
 * **顺序 = YAML 里的书写顺序**（`Object.entries` 保持插入序）。
 * 为什么要数组：③ 的"全章齐"要按清单遍历；object 的 key 顺序不可依赖。
 */
function parseSections(raw: unknown, file: string, failures: TemplateIssue[]): SectionDef[] {
	const record = asRecord(raw);
	if (record === undefined) {
		if (raw !== undefined) {
			failures.push({
				code: 'TEMPLATE_PARSE_FAILED',
				message: `${file}: sections 必须是对象`,
				file,
			});
		}
		return [];
	}

	const out: SectionDef[] = [];
	for (const [id, value] of Object.entries(record)) {
		const section = asRecord(value);
		if (section === undefined) {
			failures.push({
				code: 'TEMPLATE_PARSE_FAILED',
				message: `${file}: 章节「${id}」的声明必须是对象`,
				file,
			});
			continue;
		}
		const label = asString(section['label']);
		if (label === undefined || label === '') {
			failures.push({
				code: 'TEMPLATE_PARSE_FAILED',
				message: `${file}: 章节「${id}」缺 label`,
				file,
			});
			continue;
		}
		const hint = asString(section['hint']);
		/*
		 * `default`：该章初始化时的 payload（fork 补缺章就用它）。
		 * **不做形状校验** —— schema 只在创建时由 ② 校验，模板侧只搬运。
		 */
		const fallback = section['default'];
		out.push({
			id,
			label,
			...(hint === undefined ? {} : { hint }),
			...(fallback === undefined ? {} : { default: fallback }),
		});
	}
	return out;
}

/**
 * 解析 `derive`（派生按钮）。
 *
 * **③ 只承载声明**（`template` / `label` / `description`），**行为写死在 ⑧ 的
 * `deriveDefaults` 里**（用户 `11:26`）。
 *
 * ## ⚠ 为什么"拒绝 `title` / `relations`"必须在 ③ 做
 *
 * `registerTemplate` 是**宽收**（不拒多余字段，因为 TS 的 excess property check
 * 只在字面量赋值时生效，跨 `any`/JSON 传进来拦不住）。
 * ⇒ **若这里不显式拒，YAML 里写了 `title` / `relations` 会被静默忽略**，
 *   而写的人会以为它生效了 —— **「字段已删但被静默接受」比报错更坏**。
 *
 * ⇒ 这两个字段**已从派生语法中删除**（用户 `11:26` 把行为改成写死），出现即配置错误。
 */
function parseDerive(
	raw: unknown,
	file: string,
	failures: TemplateIssue[],
): DeriveDef[] | undefined {
	if (raw === undefined) return undefined;
	if (!Array.isArray(raw)) {
		failures.push({
			code: 'TEMPLATE_PARSE_FAILED',
			message: `${file}: derive 必须是数组`,
			file,
		});
		return undefined;
	}

	/** 派生按钮里**不许出现**的字段（已从语法删除，出现即配置错误）。 */
	const REMOVED_FIELDS = ['title', 'relations'] as const;

	const out: DeriveDef[] = [];
	for (const [index, item] of raw.entries()) {
		const entry = asRecord(item);
		if (entry === undefined) {
			failures.push({
				code: 'TEMPLATE_PARSE_FAILED',
				message: `${file}: derive[${index}] 必须是对象`,
				file,
				detail: { index },
			});
			continue;
		}

		/* 已删除的字段：显式拒绝，不静默忽略。 */
		const removed = REMOVED_FIELDS.filter((field) => Object.hasOwn(entry, field));
		if (removed.length > 0) {
			failures.push({
				code: 'TEMPLATE_PARSE_FAILED',
				message:
					`${file}: derive[${index}] 含已删除字段（${removed.join(' / ')}）——` +
					'派生按钮的行为已写死在代码里，不再由模板声明。请删掉这些字段。',
				file,
				detail: { index, removed },
			});
			continue;
		}

		const template = asString(entry['template']);
		if (template === undefined || template === '') {
			failures.push({
				code: 'TEMPLATE_PARSE_FAILED',
				message: `${file}: derive[${index}] 缺 template`,
				file,
				detail: { index },
			});
			continue;
		}
		const label = asString(entry['label']);
		const description = asString(entry['description']);
		out.push({
			template,
			...(label === undefined ? {} : { label }),
			...(description === undefined ? {} : { description }),
		});
	}
	return out;
}

/** 把一份 YAML 解析成 ③ 的注册项。解析不出 ⇒ 记 issue 并返回 `undefined`。 */
function parseTemplate(
	raw: Record<string, unknown>,
	file: string,
	failures: TemplateIssue[],
): TemplateDef | undefined {
	const name = asString(raw['name']);
	if (name === undefined || name === '') {
		failures.push({ code: 'TEMPLATE_PARSE_FAILED', message: `${file}: 缺 name`, file });
		return undefined;
	}

	const kind = asString(raw['kind']);
	const domain = asString(raw['domain']);
	const codePrefix = asString(raw['codePrefix']);
	/*
	 * `displayName`：**派生按钮拼标题要用它**（`title = 父标题-label`，
	 * label 缺失时回落到模板的 `displayName`）⇒ 必填。
	 */
	const displayName = asString(raw['displayName']);

	if (kind === undefined || kind === '') {
		failures.push({ code: 'TEMPLATE_PARSE_FAILED', message: `${file}: 缺 kind`, file });
		return undefined;
	}
	if (domain === undefined) {
		failures.push({ code: 'TEMPLATE_PARSE_FAILED', message: `${file}: 缺 domain`, file });
		return undefined;
	}
	if (codePrefix === undefined) {
		failures.push({ code: 'TEMPLATE_PARSE_FAILED', message: `${file}: 缺 codePrefix`, file });
		return undefined;
	}
	if (displayName === undefined || displayName === '') {
		failures.push({ code: 'TEMPLATE_PARSE_FAILED', message: `${file}: 缺 displayName`, file });
		return undefined;
	}

	/*
	 * `kind` 值域 = 已注册分类的英文 id（**分类内置，模块加载时已注册**，
	 * 所以这里能直接判）。中文值会被拒（fail-closed），不静默进库。
	 */
	if (getKind(kind) === undefined) {
		failures.push({
			code: 'TEMPLATE_REGISTER_REJECTED',
			message: `${file}: 模板「${name}」的 kind 非法（${kind}），必须是已注册分类的英文 id`,
			file,
			detail: { name, kind },
		});
		return undefined;
	}

	const usage = asString(raw['usage']);
	const description = asString(raw['description']);
	const derive = parseDerive(raw['derive'], file, failures);

	return {
		name,
		kind: kind as TemplateDef['kind'],
		domain,
		codePrefix,
		displayName,
		sections: parseSections(raw['sections'], file, failures),
		...(usage === undefined ? {} : { usage }),
		...(description === undefined ? {} : { description }),
		...(derive === undefined ? {} : { derive }),
	};
}

/* ─────────────────────────────────────────────────────────────
 * 对外
 * ───────────────────────────────────────────────────────────── */

/** `loadTemplates` 的入参。 */
export interface LoadTemplatesOptions {
	/** 覆盖模板根目录（测试用）。省略则按 `CANDIDATES` 探测。 */
	readonly dir?: string;
}

/** `loadTemplates` 的结果。 */
export interface LoadTemplatesResult {
	/** 成功注册的模板名。 */
	readonly registered: readonly string[];
	/** 失败项。**非空 ⇒ 部分降级**（不是失败：用户 `14:50`「core 可以继续开」）。 */
	readonly failures: readonly TemplateIssue[];
	/** 探测到的模板根目录；找不到则 `undefined`。 */
	readonly dir?: string;
}

/**
 * 读 `templates/`（根目录 + 一级子目录，排除 `actions/`）下的全部 YAML，注册进本包注册表。
 *
 * **失败处理**：逐个收集、**不中途抛**，让一次启动就能看到全部问题。
 *
 * **就绪标记**：**至少成功注册 1 个模板**就调 `markTemplateRegistryReady()`
 * （**不是零失败才标记** —— 已裁）。0 个成功则不标记。
 *
 * 本函数**不抛**（除极端环境错误）；调用方（`apply`）仍应包 try/catch 兜底。
 */
export function loadTemplates(options: LoadTemplatesOptions = {}): LoadTemplatesResult {
	const failures: TemplateIssue[] = [];
	const dir = options.dir ?? findTemplatesDir();

	if (dir === undefined) {
		failures.push({
			code: 'TEMPLATES_DIR_MISSING',
			message: `找不到模板目录（探测过：${CANDIDATES.join(' / ')}）`,
			detail: { candidates: CANDIDATES },
		});
		return { registered: [], failures };
	}

	const files = collectTemplateFiles(dir);
	if (files.length === 0) {
		failures.push({
			code: 'TEMPLATES_DIR_MISSING',
			message: `模板目录「${dir}」里没有找到任何 .yaml 文件`,
			detail: { dir },
		});
		return { registered: [], failures };
	}

	const registered: string[] = [];
	const seen = new Map<string, string>();

	for (const { file, displayPath } of files) {
		const data = readYamlFile(file, displayPath, failures);
		const record = asRecord(data);
		if (record === undefined) {
			/* YAML 合法但不是对象（如顶层是一个标量）—— 报出来，别静默跳过。 */
			if (data !== undefined) {
				failures.push({
					code: 'TEMPLATE_PARSE_FAILED',
					message: `${displayPath}: 顶层必须是对象（章节 / 元数据都写在映射里）`,
					file: displayPath,
				});
			}
			continue;
		}

		const def = parseTemplate(record, displayPath, failures);
		if (def === undefined) continue;

		/* 同名模板：**两份文件撞名**是配置错误，报出来而不是让后者静默覆盖。 */
		const previous = seen.get(def.name);
		if (previous !== undefined) {
			failures.push({
				code: 'TEMPLATE_REGISTER_REJECTED',
				message: `模板「${def.name}」在 ${previous} 与 ${displayPath} 重复定义`,
				file: displayPath,
				detail: { name: def.name, files: [previous, displayPath] },
			});
			continue;
		}

		try {
			registerTemplate(def);
			registered.push(def.name);
			seen.set(def.name, displayPath);
		} catch (error) {
			failures.push({
				code: 'TEMPLATE_REGISTER_REJECTED',
				message: `模板「${def.name}」注册失败：${error instanceof Error ? error.message : String(error)}`,
				file: displayPath,
				detail: { name: def.name },
			});
		}
	}

	/*
	 * ⚠ **就绪条件 = 至少 1 个成功**（已裁），不是"零失败"。
	 *
	 * 理由：用户 14:50「如果他出错了，core 可以继续开」「可以展示，没有行为」——
	 * 这是**降级可用**，不是"要么全好要么全坏"。
	 *
	 * 但下界必须有：0 个成功 ⇒ **不标记就绪**，
	 * 否则"什么都没加载上"会被读成"就绪但模板不存在"（装配问题被误读成数据问题）。
	 */
	if (templateCount() > 0) markTemplateRegistryReady();

	return { registered, failures, dir };
}
