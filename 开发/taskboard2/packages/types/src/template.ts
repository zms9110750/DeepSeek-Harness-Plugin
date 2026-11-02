/**
 * ③ template —— 模板注册表：元数据 + 章节声明，**不含任何 payload**。
 *
 * 本文件提供三件事：
 *   1) `registerTemplate`：注册（普通模板与预设模板走同一张表，用 `presetOf` 判别）；
 *   2) `resolve` / `sectionsOf` / `templateMeta`：三个查询面（分别给 ⑧⑦ / ⑧ / ⑩）；
 *   3) `findByFullName`：入口别名解析（`fullName → name`）。
 *
 * 三条硬约束：
 *   - **零依赖、不读 YAML、不碰文件系统**：注册由 ⑧ 在启动期读 YAML 解析后调用本函数。
 *   - **`apply` 里不自动注册任何模板**：`apply` 跑完模板并不在，必须 ⑧ 显式触发。
 *   - **`ref` 就是 `name`**：卡上字段叫 `template.ref`，值是模板的 `name` 字符串。
 */

import { getKind, type Kind } from './kind.js';

/**
 * 章节接受哪些 action。
 *
 * 三态：
 *   - 非空数组 = 只允许这些 `$type`；
 *   - `[]` = **该章节不接受任何 action**（禁止）；
 *   - `'any'` = 章节省略了 `accepts` ⇒ 任意已注册 action。
 *
 * **没有第四态**：模板 / 章节查不到时由查询函数整体返回 `undefined`。
 */
export type Accept = readonly string[] | 'any';

/** 章节声明。 */
export type SectionDef = {
	/** 模板内唯一；正则 `/^[A-Za-z][A-Za-z0-9_-]*$/`。 */
	readonly id: string;
	/** 纯文本标签，不渲染 md。 */
	readonly label: string;
	readonly accepts: Accept;
	/** 纯元数据，无校验语义（② 不读、⑧ 不拦）。可省，省 = 未声明。 */
	readonly required?: boolean;
	/** 给 AI 挑 action 看的「我要什么」。 */
	readonly hint?: string;
};

/** 模板注册项。 */
export type TemplateDef = {
	/** 稳定英文标识。**卡上 `template.ref` 存的就是它**。 */
	readonly name: string;
	/** 入口别名（用户输入面）。当前与 `name` 同值。 */
	readonly fullName?: string;
	readonly kind: Kind;
	/** 纯展示，中文字面量，不校验语言。 */
	readonly domain: string;
	/** 拼编号用；`''` 合法（= 不提供字母段），`null`/`undefined` 非法。 */
	readonly codePrefix: string;
	/** 章节声明。可省（= 零章节，如空模板）。 */
	readonly sections?: readonly SectionDef[];
	/** 展示名（不落中文 —— 中文只在终端）。 */
	readonly displayName?: string;
	/** 列表里那行小字（给 ⑩，core 不读）。 */
	readonly usage?: string;
	/** 点模板才展开的完整说明（给 ⑩，core 不读）。 */
	readonly description?: string;
	/** 预设模板指向的目标模板 `name`。**有它就是预设**。 */
	readonly presetOf?: string;
};

/** `registerTemplate` 的可选入参。 */
export type RegisterTemplateOptions = {
	/**
	 * 已注册的 action `$type` 清单。
	 *
	 * 传了就校验 `accepts ⊆ actionTypes`；不传则跳过该项校验。
	 * **生产装配必须传**（API 可选只为单测）—— 不传等于放弃一道校验。
	 */
	readonly actionTypes?: readonly string[];
};

/** `resolve` 的返回：core / taskcard 用的最小元数据。 */
export type ResolvedTemplate = {
	readonly name: string;
	readonly kind: Kind;
	readonly domain: string;
	readonly codePrefix: string;
	readonly sections: readonly { readonly id: string; readonly accepts: Accept }[];
};

/** `sectionsOf` 的返回元素。 */
export type SectionAccepts = {
	readonly id: string;
	readonly accepts: Accept;
};

/** `templateMeta` 的返回：给 ⑩ 的展示面。 */
export type TemplateMeta = {
	readonly displayName?: string;
	readonly usage?: string;
	readonly description?: string;
	readonly sections: readonly {
		readonly id: string;
		readonly label: string;
		readonly hint?: string;
	}[];
};

/** 章节 id 的合法形式：**必须以字母开头**（正向白名单，杜绝整数键导致的对象键序重排）。 */
const SECTION_ID_RE = /^[A-Za-z][A-Za-z0-9_-]*$/;

/** 模板注册表。key = `name`。 */
const TEMPLATES = new Map<string, TemplateDef>();

/**
 * 注册表是否已由 ⑧ 触发过注册。
 *
 * 用于区分两种失败：**未初始化**（时序 bug，抛错）与**没这个模板**（数据问题，返回 `undefined`）。
 */
let initialized = false;

/**
 * 标记注册表已初始化。
 *
 * 由 ⑧ 在「读完 YAML、注册完全部模板」之后调用一次。
 * 之后 `resolve` 未命中才返回 `undefined`；之前未命中一律抛错（时序 bug，不能被静默吞掉）。
 */
export function markTemplateRegistryReady(): void {
	initialized = true;
}

/** 注册表是否已初始化。 */
export function isTemplateRegistryReady(): boolean {
	return initialized;
}

/** `accepts` 的运行时形状守卫（`Accept` 只有三态，没有第四态）。 */
function isAccept(value: unknown): value is Accept {
	return value === 'any' || Array.isArray(value);
}

/** 校验章节声明。任何一条不合规即抛错（fail-closed）。 */
function assertSections(sections: readonly SectionDef[], templateName: string): void {
	const seen = new Set<string>();
	for (const section of sections) {
		if (typeof section.id !== 'string' || !SECTION_ID_RE.test(section.id)) {
			throw new Error(
				`taskboard2-types: 模板 "${templateName}" 的章节 id 非法（${String(section.id)}），必须以字母开头`,
			);
		}
		if (seen.has(section.id)) {
			throw new Error(`taskboard2-types: 模板 "${templateName}" 的章节 id 重复（${section.id}）`);
		}
		seen.add(section.id);
		const accepts: unknown = section.accepts;
		if (!isAccept(accepts)) {
			throw new Error(
				`taskboard2-types: 模板 "${templateName}" 章节 "${section.id}" 的 accepts 非法（必须是数组或 'any'）`,
			);
		}
	}
}

/** 注册一个模板（或预设模板）。已存在同名 ⇒ 抛错（不静默覆盖）。 */
export function registerTemplate(def: TemplateDef, opts?: RegisterTemplateOptions): void {
	if (typeof def?.name !== 'string' || def.name === '') {
		throw new Error('taskboard2-types: 模板必须有非空 name');
	}
	if (TEMPLATES.has(def.name)) {
		throw new Error(`taskboard2-types: 模板 "${def.name}" 已注册（不接受覆盖）`);
	}
	if (typeof def.codePrefix !== 'string') {
		throw new Error(
			`taskboard2-types: 模板 "${def.name}" 的 codePrefix 必须是字符串（'' 合法，null 非法）`,
		);
	}
	/* `kind` 值域 = 已注册分类的英文 id。中文值会被拒（fail-closed），不静默进库。 */
	if (getKind(def.kind) === undefined) {
		throw new Error(
			`taskboard2-types: 模板 "${def.name}" 的 kind 非法（${String(def.kind)}），必须是已注册分类的英文 id`,
		);
	}
	const sections: readonly SectionDef[] = def.sections ?? [];
	assertSections(sections, def.name);

	/* 预设：目标模板必须已注册。 */
	const presetOf: string | undefined = def.presetOf;
	if (presetOf !== undefined) {
		const target = TEMPLATES.get(presetOf);
		if (target === undefined) {
			throw new Error(
				`taskboard2-types: 预设模板 "${def.name}" 指向的模板 "${presetOf}" 未注册`,
			);
		}
		/* 预设的章节集必须与目标模板一致（同样的 id）。 */
		const want = (target.sections ?? []).map((section) => section.id).join('\u0000');
		const have = sections.map((section) => section.id).join('\u0000');
		if (want !== have) {
			throw new Error(
				`taskboard2-types: 预设模板 "${def.name}" 的章节集与目标模板 "${presetOf}" 不一致`,
			);
		}
	}

	/*
	 * 可选：若调用方给了 action 名单，则校验 accepts ⊆ actionTypes。
	 * 不传 ⇒ 跳过（生产装配必须传；API 可选只为单测）。
	 */
	const actionTypes = opts?.actionTypes;
	if (actionTypes !== undefined) {
		const allowed = new Set<string>(actionTypes);
		for (const section of sections) {
			const accepts = section.accepts;
			if (accepts === 'any') continue;
			for (const type of accepts) {
				if (!allowed.has(type)) {
					throw new Error(
						`taskboard2-types: 模板 "${def.name}" 章节 "${section.id}" 声明了未注册的 action（${type}）`,
					);
				}
			}
		}
	}

	TEMPLATES.set(def.name, def);
}

/** 清空注册表（仅供测试与重新装配使用）。 */
export function resetTemplateRegistry(): void {
	TEMPLATES.clear();
	initialized = false;
}

/**
 * 取模板的完整注册项。
 *
 * 两条失败路径**不合并**：
 *   - 注册表**未初始化** ⇒ 抛错（时序 / 系统未就绪）；
 *   - 已初始化但**无此模板** ⇒ 返回 `undefined`（数据错误，调用方 fail-closed）。
 *
 * `ref` 就是 `name`：`getTemplate(card.template.ref)` 与 `getTemplate(name)` 是同一个调用。
 */
export function getTemplate(ref: string): TemplateDef | undefined {
	if (!initialized) {
		throw new Error(
			'taskboard2-types: 模板注册表尚未初始化（⑧ 必须读完 YAML 并注册完毕后调用 markTemplateRegistryReady）',
		);
	}
	return TEMPLATES.get(ref);
}

/** 列出全部已注册模板（按注册顺序）。 */
export function listTemplates(): readonly TemplateDef[] {
	return [...TEMPLATES.values()];
}

/**
 * 解析模板 —— core / taskcard 用的最小元数据。
 *
 * 未命中规则见 `getTemplate`。
 */
export function resolve(ref: string): ResolvedTemplate | undefined {
	const def = getTemplate(ref);
	if (def === undefined) return undefined;
	return {
		name: def.name,
		kind: def.kind,
		domain: def.domain,
		codePrefix: def.codePrefix,
		sections: (def.sections ?? []).map((section) => ({
			id: section.id,
			accepts: section.accepts,
		})),
	};
}

/**
 * 取模板的权威章节集（`{ id, accepts }` 数组，顺序 = 声明顺序）。
 *
 * 建卡时 ⑧ 用它做「缺章 / 多章」双向比对。
 * 模板不存在 ⇒ 整体 `undefined`（元素级不可能「解析失败」）。
 */
export function sectionsOf(ref: string): readonly SectionAccepts[] | undefined {
	const def = getTemplate(ref);
	if (def === undefined) return undefined;
	return (def.sections ?? []).map((section) => ({ id: section.id, accepts: section.accepts }));
}

/**
 * 取模板的展示元数据（给 ⑩）。
 *
 * **不含任何中文以外的"文案"**：`displayName` / `usage` / `description` 由模板声明提供，
 * 本函数只做搬运，不生成任何语言。
 */
export function templateMeta(ref: string): TemplateMeta | undefined {
	const def = getTemplate(ref);
	if (def === undefined) return undefined;
	return {
		displayName: def.displayName,
		usage: def.usage,
		description: def.description,
		sections: (def.sections ?? []).map((section) => ({
			id: section.id,
			label: section.label,
			hint: section.hint,
		})),
	};
}

/**
 * 入口别名解析：`fullName → name`。
 *
 * **未命中 ⇒ `undefined`，不抛错** —— 这是**外部输入**（用户/AI 手输），打错字是正常的。
 * 与 `getTemplate` 的「内部键未命中 = bug（抛错）」形成对照。
 */
export function findByFullName(fullName: string): string | undefined {
	for (const def of TEMPLATES.values()) {
		if ((def.fullName ?? def.name) === fullName) return def.name;
	}
	return undefined;
}
