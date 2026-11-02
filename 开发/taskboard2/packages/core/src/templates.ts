/**
 * ⑧ core —— 模板加载（启动期编排）。
 *
 * ## 为什么由 ⑧ 做
 *
 * ③ 是**零依赖**包：不 import 任何 `@local/*`、不用第三方库、不碰文件系统。
 * 它只提供 `registerTemplate(obj)` —— 收**已解析的 JS 对象**。
 * ⇒ **"读 YAML、解析、注册"整个动作必须在 ⑧ 完成**（③ 的 `apply` 不注册任何东西）。
 *
 * ## 本文件同样零 `@local/*` import
 *
 * ③ 的能力以**参数**传入（`TypesRegistry`）。理由与 `ports.ts` 相同：
 * 编译期没有 `node_modules` 可解析，`import` 会直接编译失败；
 * 而且"服务名是契约"要求走运行时 inject，不走编译期焊死。
 *
 * ## 目录位置
 *
 * 模板文件在**仓库根** `templates/`（不在 `packages/core/` 里）。构建后本文件位于
 * `packages/core/lib/templates.js`，所以包根是 `lib/` 的上一级，仓库根再上一级。
 *
 * ⚠ **不写死单一路径**：按候选顺序逐个探测，第一个存在的即用。
 * 因为"模板运行期从哪读"是待裁项（见 `docs/08-core.md` U2），
 * 单一路径会把一个未裁结论焊进代码。
 *
 * ## 预设模板的 payload 存在哪
 *
 * ③ 的 `TemplateDef` **不含 payload**（它只存声明）。而预设的意义就是"内容已填好"。
 * ⇒ **预设的 payload 由 ⑧ 自己保存**（`PRESET_PAYLOADS`），③ 只知道有这么一个模板。
 * 注册给 ③ 的预设项，章节声明**从目标模板继承**（同 id、同 label、同 accepts）——
 * 这样 ③ 的"预设章节集 = 目标章节集"校验天然成立。
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse as parseYaml } from 'yaml';

import { coreError, type CoreError } from './errors.js';
import type { Accepts, TemplateDefForRegistry, TypesRegistry } from './ports.js';

/** 预设模板 `name` → 该模板各章的 payload（`{ [sectionId]: payload }`）。 */
const PRESET_PAYLOADS = new Map<string, Record<string, unknown>>();

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

/** 一章的声明（YAML 侧）。 */
interface RawSection {
	readonly id: string;
	readonly label: string;
	readonly accepts: Accepts;
	readonly hint?: string;
	readonly required?: boolean;
}

/**
 * 把 YAML 的 `sections`（object：章节名 → 声明）转成数组。
 *
 * **顺序 = YAML 里的书写顺序**（`Object.entries` 保持插入序）。
 * 为什么要数组：③ 的"全章齐"要按清单遍历；object 的 key 顺序不可依赖。
 */
function sectionsOf(raw: unknown, file: string, failures: CoreError[]): RawSection[] {
	const record = asRecord(raw);
	if (record === undefined) {
		if (raw !== undefined) {
			failures.push(coreError('TEMPLATE_PARSE_FAILED', `${file}: sections 必须是对象`));
		}
		return [];
	}

	const out: RawSection[] = [];
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
		const acceptsRaw = section['accepts'];
		let accepts: Accepts;
		if (acceptsRaw === undefined) {
			accepts = 'any';
		} else if (Array.isArray(acceptsRaw) && acceptsRaw.every((item) => typeof item === 'string')) {
			accepts = acceptsRaw as readonly string[];
		} else {
			failures.push(
				coreError('TEMPLATE_PARSE_FAILED', `${file}: 章节「${id}」的 accepts 必须是字符串数组`),
			);
			continue;
		}
		const hint = asString(section['hint']);
		const out0: RawSection = {
			id,
			label,
			accepts,
			...(hint === undefined ? {} : { hint }),
			...(typeof section['required'] === 'boolean' ? { required: section['required'] } : {}),
		};
		out.push(out0);
	}
	return out;
}

/**
 * 一份 YAML 解析出来的两种东西。
 *
 * **判据是"有没有 `template` 字段"**：有 ⇒ 预设（`presetOf` 指向目标），无 ⇒ 普通模板。
 * 这条判据来自模板文件自己的注释：「预设必有 template，普通模板必无 —— 双射」。
 *
 * 用判别式联合而不是拿空串占位：预设**没有** `kind` / `domain` / `codePrefix` /
 * `sections` 声明（全部继承自目标模板）。拿占位值硬塞进注册项，会造出一个
 * "看起来合法、其实字段是空的"中间态 —— 那种值一旦被别处读到，就是第二处真值。
 */
type ParsedTemplate =
	| { readonly type: 'normal'; readonly def: TemplateDefForRegistry }
	| {
			readonly type: 'preset';
			readonly name: string;
			readonly presetOf: string;
			readonly displayName?: string;
			readonly payloads: Record<string, unknown>;
	  };

/** 把一份 YAML 解析成普通模板或预设。解析不出 ⇒ 记 `failure` 并返回 `undefined`。 */
function parseTemplate(
	raw: Record<string, unknown>,
	file: string,
	failures: CoreError[],
): ParsedTemplate | undefined {
	const name = asString(raw['name']);
	if (name === undefined || name === '') {
		failures.push(coreError('TEMPLATE_PARSE_FAILED', `${file}: 缺 name`));
		return undefined;
	}

	const displayName = asString(raw['displayName']);

	/* ── 预设模板：只带 name / presetOf / displayName / payloads ── */
	const presetOf = asString(raw['template']);
	if (presetOf !== undefined) {
		if (presetOf === '') {
			failures.push(coreError('TEMPLATE_PARSE_FAILED', `${file}: template 不能是空串`));
			return undefined;
		}
		const payloads = asRecord(raw['sections']);
		if (payloads === undefined) {
			failures.push(coreError('TEMPLATE_PARSE_FAILED', `${file}: 预设必须给出 sections`));
			return undefined;
		}
		return {
			type: 'preset',
			name,
			presetOf,
			...(displayName === undefined ? {} : { displayName }),
			payloads: { ...payloads },
		};
	}

	/* ── 普通模板 ── */
	const kind = asString(raw['kind']);
	const domain = asString(raw['domain']);
	const codePrefix = asString(raw['codePrefix']);

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

	const usage = asString(raw['usage']);
	const description = asString(raw['description']);

	return {
		type: 'normal',
		def: {
			name,
			kind,
			domain,
			codePrefix,
			sections: sectionsOf(raw['sections'], file, failures),
			...(displayName === undefined ? {} : { displayName }),
			...(usage === undefined ? {} : { usage }),
			...(description === undefined ? {} : { description }),
		},
	};
}

/* ─────────────────────────────────────────────────────────────
 * 对外
 * ───────────────────────────────────────────────────────────── */

/** `loadTemplates` 的入参。 */
export interface LoadTemplatesOptions {
	/** ③ 的注册面（`registerTemplate` / `markTemplateRegistryReady`）。 */
	readonly registry: TypesRegistry;
	/** 已注册的 action `$type`（② 的 `list()`）。**生产装配必须传** —— 不传等于放弃一道校验。 */
	readonly actionTypes: readonly string[];
	/** 覆盖模板根目录（测试用）。省略则按 `findTemplatesDir` 探测。 */
	readonly dir?: string;
}

/** `loadTemplates` 的结果。 */
export interface LoadTemplatesResult {
	/** 成功注册的模板名（含预设）。 */
	readonly registered: readonly string[];
	/** 失败项。非空 ⇒ 调用方必须决定中止（本函数不替你吞掉）。 */
	readonly failures: readonly CoreError[];
}

/**
 * 读 `templates/` 与 `templates/presets/` 下的全部 YAML，注册进 ③。
 *
 * **顺序**：
 *   1. 先注册普通模板（预设要指向它们）；
 *   2. 再注册预设（章节声明**从目标模板继承**，于是 ③ 的"章节集一致"校验天然成立）。
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

	const normal: TemplateDefForRegistry[] = [];
	const presets: Extract<ParsedTemplate, { type: 'preset' }>[] = [];

	/* ── 1. 普通模板 ── */
	for (const name of yamlFilesIn(dir)) {
		const data = readYamlFile(join(dir, name), name, failures);
		const record = asRecord(data);
		if (record === undefined) continue;
		const parsed = parseTemplate(record, name, failures);
		if (parsed === undefined) continue;
		if (parsed.type === 'preset') presets.push(parsed);
		else normal.push(parsed.def);
	}

	/* ── 2. 预设模板 ── */
	const presetDir = join(dir, 'presets');
	for (const name of yamlFilesIn(presetDir)) {
		const displayPath = join('presets', name);
		const data = readYamlFile(join(presetDir, name), displayPath, failures);
		const record = asRecord(data);
		if (record === undefined) continue;
		const parsed = parseTemplate(record, displayPath, failures);
		if (parsed === undefined) continue;
		if (parsed.type !== 'preset') {
			failures.push(
				coreError(
					'TEMPLATE_PARSE_FAILED',
					`${displayPath}: presets/ 下的文件必须带 template 字段`,
				),
			);
			continue;
		}
		presets.push(parsed);
	}

	/* ── 3. 注册普通模板 ── */
	const registered: string[] = [];
	const byName = new Map<string, TemplateDefForRegistry>();

	for (const def of normal) {
		try {
			options.registry.registerTemplate(def, { actionTypes: options.actionTypes });
			registered.push(def.name);
			byName.set(def.name, def);
		} catch (error) {
			failures.push(
				coreError(
					'TEMPLATE_REGISTER_REJECTED',
					`模板「${def.name}」注册失败：${error instanceof Error ? error.message : String(error)}`,
				),
			);
		}
	}

	/* ── 4. 注册预设：章节声明从目标模板继承 ── */
	for (const preset of presets) {
		const target = byName.get(preset.presetOf);
		if (target === undefined) {
			failures.push(
				coreError(
					'TEMPLATE_REGISTER_REJECTED',
					`预设「${preset.name}」指向的模板「${preset.presetOf}」未注册成功`,
				),
			);
			continue;
		}
		/*
		 * 章节声明整份继承自目标模板 —— 于是 ③ 的「预设章节集 = 目标章节集」校验天然成立，
		 * 且预设与目标的 `accepts` 不会各写一份（那是第二处真值）。
		 */
		const def: TemplateDefForRegistry = {
			name: preset.name,
			presetOf: preset.presetOf,
			kind: target.kind,
			domain: target.domain,
			codePrefix: target.codePrefix,
			sections: target.sections,
			...(preset.displayName === undefined ? {} : { displayName: preset.displayName }),
		};
		try {
			options.registry.registerTemplate(def, { actionTypes: options.actionTypes });
			registered.push(def.name);
			/* payload 只在注册成功后保存：注册失败的预设不该留下"可建卡"的假象。 */
			PRESET_PAYLOADS.set(preset.name, preset.payloads);
		} catch (error) {
			failures.push(
				coreError(
					'TEMPLATE_REGISTER_REJECTED',
					`预设「${preset.name}」注册失败：${error instanceof Error ? error.message : String(error)}`,
				),
			);
		}
	}

	/* ── 5. 只有零失败才标记就绪 ── */
	if (failures.length === 0) options.registry.markTemplateRegistryReady();

	return { registered, failures };
}

/**
 * 取某个预设模板的 payload 集合（建卡时作为 `sections` 初值）。
 *
 * 普通模板 ⇒ `undefined`（没有预置内容，由用户填）。
 */
export function presetPayloadsOf(name: string): Record<string, unknown> | undefined {
	const payloads = PRESET_PAYLOADS.get(name);
	if (payloads === undefined) return undefined;
	/* 返回副本：调用方会把它当 `sections` 改，不能污染注册表里那份。 */
	return { ...payloads };
}

/** 清空预设 payload 缓存（测试 / 重新装配用）。 */
export function resetPresetPayloads(): void {
	PRESET_PAYLOADS.clear();
}
