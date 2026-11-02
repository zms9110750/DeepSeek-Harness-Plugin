/**
 * ⑧ core —— 模板加载（启动期编排）。
 *
 * ## 为什么由 ⑧ 做
 *
 * ③ 是**零依赖**包：不 import 任何 `@local/*`、不用第三方库、不碰文件系统。
 * 它只提供 `registerTemplate(obj)` —— 收**已解析的 JS 对象**。
 * ⇒ **"读 YAML、解析、注册"整个动作必须在 ⑧ 完成**（③ 的 `apply` 不注册任何东西）。
 *
 * ## 本文件零 `@local/*` import
 *
 * ③ 的能力以**参数**传入（`TypesRegistry`）。理由与 `ports.ts` 相同：
 * 编译期没有 `node_modules` 可解析，`import` 会直接编译失败；
 * 而且"服务名是契约"要求走运行时 inject，不走编译期焊死。
 *
 * ## 目录位置与扫描范围
 *
 * 模板文件在**仓库根** `templates/`（不在 `packages/core/` 里）。构建后本文件位于
 * `packages/core/lib/templates.js`，所以包根是 `lib/` 的上一级，仓库根再上一级。
 *
 * **扫描范围**：
 *   1. `templates/` 根目录下散落的 `.yaml`（若有）；
 *   2. `templates/` 的**一级子目录**（`core/`、`code/`、将来新增的领域目录…），
 *      **排除 `actions/`** —— 那里是行为定义，不是模板。
 *
 * ⚠ **不递归**：`templates/` 只有两层，递归会连 `actions/` 的子层也扫进来，
 * 而"按已知层级扫"比"递归乱扫 + 黑名单"更稳。
 *
 * ⚠ **不写死单一路径**：按候选顺序逐个探测，第一个存在的即用。
 * 因为"模板运行期从哪读"是待裁项（见 `docs/08-core.md` U2），
 * 单一路径会把一个未裁结论焊进代码。
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse as parseYaml } from 'yaml';

import { coreError, type CoreError } from './errors.js';
import type { TemplateDefForRegistry, TypesRegistry } from './ports.js';

/** 本文件所在目录（构建后是 `.../packages/core/lib`）。 */
const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * 模板根目录的候选路径，按顺序探测。
 *
 * 1. `../../../templates` —— 构建后在 `packages/core/lib/` ⇒ 仓库根（**生产路径**）
 * 2. `../../templates` —— 若将来把 `templates/` 挪进 `packages/core/`
 * 3. `./templates` —— 若将来把模板与构建产物放在一起（安装进 dsh 之后的可能形态）
 */
const CANDIDATES = [
	join(HERE, '..', '..', '..', 'templates'),
	join(HERE, '..', '..', 'templates'),
	join(HERE, 'templates'),
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
		const absolute = resolve(candidate);
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

/** 读一个 YAML 文件并解析。解析失败 ⇒ 收集成 `CoreError`，**不抛**。 */
function readYamlFile(file: string, displayPath: string, failures: CoreError[]): unknown {
	let text: string;
	try {
		text = readFileSync(file, 'utf8');
	} catch (error) {
		failures.push(
			coreError(
				'TEMPLATE_PARSE_FAILED',
				`读不到模板文件 ${displayPath}：${error instanceof Error ? error.message : String(error)}`,
			),
		);
		return undefined;
	}
	try {
		return parseYaml(text);
	} catch (error) {
		failures.push(
			coreError(
				'TEMPLATE_PARSE_FAILED',
				`模板文件 ${displayPath} 不是合法 YAML：${error instanceof Error ? error.message : String(error)}`,
			),
		);
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
 *
 * ⚠ **`accepts` 已彻底移除**：章节不再声明"接受哪些 action"，
 * 取而代之的是 `default` —— 该章初始化时的 payload。
 */
function sectionsOf(raw: unknown, file: string, failures: CoreError[]) {
	const record = asRecord(raw);
	if (record === undefined) {
		if (raw !== undefined) {
			failures.push(coreError('TEMPLATE_PARSE_FAILED', `${file}: sections 必须是对象`));
		}
		return [];
	}

	const out: NonNullable<TemplateDefForRegistry['sections']>[number][] = [];
	for (const [id, value] of Object.entries(record)) {
		const section = asRecord(value);
		if (section === undefined) {
			failures.push(coreError('TEMPLATE_PARSE_FAILED', `${file}: 章节「${id}」的声明必须是对象`));
			continue;
		}
		const label = asString(section['label']);
		if (label === undefined || label === '') {
			failures.push(coreError('TEMPLATE_PARSE_FAILED', `${file}: 章节「${id}」缺 label`));
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
			...(typeof section['required'] === 'boolean' ? { required: section['required'] } : {}),
			...(fallback === undefined ? {} : { default: fallback }),
		});
	}
	return out;
}

/** 把一份 YAML 解析成 ③ 的注册项。解析不出 ⇒ 记 `failure` 并返回 `undefined`。 */
function parseTemplate(
	raw: Record<string, unknown>,
	file: string,
	failures: CoreError[],
): TemplateDefForRegistry | undefined {
	const name = asString(raw['name']);
	if (name === undefined || name === '') {
		failures.push(coreError('TEMPLATE_PARSE_FAILED', `${file}: 缺 name`));
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
		failures.push(coreError('TEMPLATE_PARSE_FAILED', `${file}: 缺 kind`));
		return undefined;
	}
	if (domain === undefined) {
		failures.push(coreError('TEMPLATE_PARSE_FAILED', `${file}: 缺 domain`));
		return undefined;
	}
	if (codePrefix === undefined) {
		failures.push(coreError('TEMPLATE_PARSE_FAILED', `${file}: 缺 codePrefix`));
		return undefined;
	}
	if (displayName === undefined || displayName === '') {
		failures.push(coreError('TEMPLATE_PARSE_FAILED', `${file}: 缺 displayName`));
		return undefined;
	}

	const usage = asString(raw['usage']);
	const description = asString(raw['description']);
	/* 派生按钮。**数组**（并列按钮）；每项 `{ label?, description?, template }`。 */
	const derive = parseDerive(raw['derive'], file, failures);

	return {
		name,
		kind,
		domain,
		codePrefix,
		displayName,
		sections: sectionsOf(raw['sections'], file, failures),
		...(usage === undefined ? {} : { usage }),
		...(description === undefined ? {} : { description }),
		...(derive === undefined ? {} : { derive }),
	};
}

/**
 * 解析 `derive`（派生按钮）。
 *
 * **⑧ 只负责搬运**：注册到 ③ 供 ⑩ 画按钮、供 ⑧ 拼初始化字段。
 * 按钮点下去之后的建卡行为在 `create.ts` 的 `deriveDefaults` 里（纯函数）。
 *
 * `template` 必填；`label` 可省（缺了拼标题时回落到 `displayName`）；`description` 可省。
 *
 * ## ⚠ 为什么 ⑧ 要在这里拦字段
 *
 * ③ 的 `TemplateDef` **没有 `derive`**，而 `registerTemplate` **不拒多余字段**（宽收）⇒
 * **`derive` 的结构错误 ③ 拦不住，只能 ⑧ 在 YAML 解析层拦**。
 *
 * 特别是 `title` / `relations`：它们**已从语法里删除**（用户 11:26 把派生行为改成写死）。
 * 接受它们等于"字段已删但被静默忽略" —— 有人写了会以为生效。⇒ **显式报错。**
 */
function parseDerive(
	raw: unknown,
	file: string,
	failures: CoreError[],
): NonNullable<TemplateDefForRegistry['derive']> | undefined {
	if (raw === undefined) return undefined;
	if (!Array.isArray(raw)) {
		failures.push(coreError('TEMPLATE_PARSE_FAILED', `${file}: derive 必须是数组`));
		return undefined;
	}

	/** 派生按钮里**不许出现**的字段（已从语法删除，出现即配置错误）。 */
	const REMOVED_FIELDS = ['title', 'relations'] as const;

	const out: NonNullable<TemplateDefForRegistry['derive']>[number][] = [];
	for (const [index, item] of raw.entries()) {
		const entry = asRecord(item);
		if (entry === undefined) {
			failures.push(
				coreError('TEMPLATE_PARSE_FAILED', `${file}: derive[${index}] 必须是对象`),
			);
			continue;
		}

		/* 已删除的字段：显式拒绝，不静默忽略。 */
		const removed = REMOVED_FIELDS.filter((field) => Object.hasOwn(entry, field));
		if (removed.length > 0) {
			failures.push(
				coreError(
					'TEMPLATE_PARSE_FAILED',
					`${file}: derive[${index}] 含已删除字段（${removed.join(' / ')}）——` +
						'派生按钮的行为已写死在代码里，不再由模板声明。请删掉这些字段。',
					{ index, removed },
				),
			);
			continue;
		}

		const template = asString(entry['template']);
		if (template === undefined || template === '') {
			failures.push(
				coreError('TEMPLATE_PARSE_FAILED', `${file}: derive[${index}] 缺 template`),
			);
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

/* ─────────────────────────────────────────────────────────────
 * 对外
 * ───────────────────────────────────────────────────────────── */

/** `loadTemplates` 的入参。 */
export interface LoadTemplatesOptions {
	/** ③ 的注册面（`registerTemplate` / `markTemplateRegistryReady`）。 */
	readonly registry: TypesRegistry;
	/** 覆盖模板根目录（测试用）。省略则按 `findTemplatesDir` 探测。 */
	readonly dir?: string;
}

/** `loadTemplates` 的结果。 */
export interface LoadTemplatesResult {
	/** 成功注册的模板名。 */
	readonly registered: readonly string[];
	/** 失败项。非空 ⇒ 调用方必须决定中止（本函数不替你吞掉）。 */
	readonly failures: readonly CoreError[];
}

/**
 * 读 `templates/`（根目录 + 一级子目录，排除 `actions/`）下的全部 YAML，注册进 ③。
 *
 * **失败处理**：逐个收集、**不中途抛**，让一次启动就能看到全部问题；
 * 全部跑完后调用方若发现 `failures` 非空，应中止启动。
 *
 * **就绪标记**：只有在零失败时才调 `markTemplateRegistryReady` ——
 * 半套模板进注册表会让"模板不存在"与"注册没跑完"混成同一种错。
 */
export function loadTemplates(options: LoadTemplatesOptions): LoadTemplatesResult {
	const failures: CoreError[] = [];
	const dir = options.dir ?? findTemplatesDir();

	if (dir === undefined) {
		failures.push(
			coreError('TEMPLATES_DIR_MISSING', `找不到模板目录（探测过：${CANDIDATES.join(' / ')}）`),
		);
		return { registered: [], failures };
	}

	const files = collectTemplateFiles(dir);
	if (files.length === 0) {
		failures.push(
			coreError('TEMPLATES_DIR_MISSING', `模板目录「${dir}」里没有找到任何 .yaml 文件`),
		);
		return { registered: [], failures };
	}

	const registered: string[] = [];
	const seen = new Map<string, string>();

	for (const { file, displayPath } of files) {
		const data = readYamlFile(file, displayPath, failures);
		const record = asRecord(data);
		if (record === undefined) continue;

		const def = parseTemplate(record, displayPath, failures);
		if (def === undefined) continue;

		/* 同名模板：**两份文件撞名**是配置错误，报出来而不是让后者静默覆盖。 */
		const previous = seen.get(def.name);
		if (previous !== undefined) {
			failures.push(
				coreError(
					'TEMPLATE_REGISTER_REJECTED',
					`模板「${def.name}」在 ${previous} 与 ${displayPath} 重复定义`,
					{ name: def.name, files: [previous, displayPath] },
				),
			);
			continue;
		}

		try {
			options.registry.registerTemplate(def);
			registered.push(def.name);
			seen.set(def.name, displayPath);
		} catch (error) {
			failures.push(
				coreError(
					'TEMPLATE_REGISTER_REJECTED',
					`模板「${def.name}」注册失败：${error instanceof Error ? error.message : String(error)}`,
				),
			);
		}
	}

	/* 只有零失败才标记就绪。 */
	if (failures.length === 0) options.registry.markTemplateRegistryReady();

	return { registered, failures };
}
