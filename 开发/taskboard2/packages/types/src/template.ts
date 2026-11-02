/**
 * ③ template —— 模板注册表：元数据 + 章节声明 + 派生按钮。
 *
 * 本文件提供三件事：
 *   1) `registerTemplate`：注册（**只有一种模板，没有"预设"这个概念**）；
 *   2) `resolve` / `sectionsOf` / `templateMeta`：三个查询面（分别给 ⑧⑦ / ⑧ / ⑩）；
 *   3) `findByFullName`：入口别名解析（`fullName → name`）。
 *
 * 本文件**不读 YAML、不碰文件系统** —— 「读 YAML → 解析 → 调 `registerTemplate`」
 * 在 `templates.ts`（同包另一文件）。分工：
 *   - 本文件：**注册表 + 查询**（纯内存、纯函数）；
 *   - `templates.ts`：**加载器**（I/O、YAML、错误收集）。
 *
 * `ref` 就是 `name`：卡上字段叫 `template.ref`，值是模板的 `name` 字符串。
 *
 * 不解释、不校验的三个字段：
 *   - `SectionDef.default`：一份填好的 action payload，**③ 不透明**（合法性归 ②）；
 *   - `TemplateDef.domain`：纯展示字符串，**不校验语言**；
 *   - `DeriveDef.description`：纯展示文案。
 */

import { getKind, type Kind } from './kind.js';

/** 章节声明。 */
export type SectionDef = {
	/** 模板内唯一；正则 `/^[A-Za-z][A-Za-z0-9_-]*$/`。 */
	readonly id: string;
	/** 纯文本标签，不渲染 md。 */
	readonly label: string;
	/** 给 AI 挑 action 看的「我要什么」。 */
	readonly hint?: string;
	/**
	 * 该章节的预填 payload（一份填好的 action）。
	 *
	 * **③ 不解释、不校验**：形状归 ②，合法性最终在建卡时由 ② 的 `validateForCreate` 判。
	 * 用 `unknown` 而不是对象类型 —— 写成对象类型会暗示"③ 懂它的形状"。
	 *
	 * 用途：⑧ 的 fork 补缺章用它，⑩ 的预填也用它。
	 */
	readonly default?: unknown;
};

/**
 * 一个派生按钮的声明。
 *
 * 用户 `11:26` 起，按钮的**行为写死在代码里**（⑧ 的 `deriveDefaults`）：
 * `template` = 指向的模板、父任务 = 当前卡、标题 = `父标题-label`（`label` 缺 ⇒ 模板 `displayName`）。
 * **⇒ 模板只声明「有这个按钮、指向哪个模板、叫什么」，不声明行为。**
 *
 * 本类型只承载**声明**，不承载行为 —— ③ 不认识"点下去会建什么卡"。
 */
export type DeriveDef = {
	/** 指向的模板 `name`。**必填**（没有它按钮不知道建什么卡）。 */
	readonly template: string;
	/** 按钮文字；**也是拼标题的后半段**。缺了就用目标模板的 `displayName`。 */
	readonly label?: string;
	/** 按钮悬浮描述（纯展示）。 */
	readonly description?: string;
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
	/** 展示名。**必填** —— 派生按钮拼标题要用它，给兜底值是 ③ 在造数据。 */
	readonly displayName: string;
	/** 列表里那行小字（给 ⑩，core 不读）。 */
	readonly usage?: string;
	/** 点模板才展开的完整说明（给 ⑩，core 不读）。 */
	readonly description?: string;
	/**
	 * 派生按钮（并列、有序，顺序 = YAML 里的书写顺序）。
	 *
	 * **由 ③ 的 YAML 解析层填**（`templates.ts` 的 `parseDerive`），
	 * **⑧ 直接消费，不再自己解析第二遍** —— 否则就是"读两遍 YAML、两套解析"。
	 */
	readonly derive?: readonly DeriveDef[];
};

/** `resolve` 的返回：core / taskcard 用的最小元数据。 */
export type ResolvedTemplate = {
	readonly name: string;
	readonly displayName: string;
	readonly kind: Kind;
	readonly domain: string;
	readonly codePrefix: string;
	readonly sections: readonly {
		readonly id: string;
		/** 章节名（中文显示名）。**建卡时抄进卡上**（用户 14:47「任务卡要存一个章节名字的副本」）。 */
		readonly label: string;
		readonly default?: unknown;
	}[];
	/** 派生按钮。可省（模板没写 `derive`）。 */
	readonly derive?: readonly DeriveDef[];
};

/** `sectionsOf` 的返回元素。 */
export type SectionInfo = {
	readonly id: string;
	/**
	 * 章节名（中文显示名）。
	 *
	 * **必填**：⑧ 的建卡（`sectionsFromDefaults`）要把 `label` 抄进卡上，
	 * 卡的 `sections` 形状是 `{ [sectionId]: { label, payload } }`。
	 * 用户 `14:47`「任务卡要存一个章节名字的副本。以防止万一。因为考虑领域类模板是 mod 携带的。
	 * 就可能关闭 mod 而无法加载模板。任务卡必须在无模板的情况下正常显示。」
	 */
	readonly label: string;
	/** 该章节预填 payload；没有就是 `undefined`（⑧ fork 补缺章时"没有就报错，不猜"）。 */
	readonly default?: unknown;
};

/** `templateMeta` 的返回：给 ⑩ 的展示面。 */
export type TemplateMeta = {
	readonly displayName: string;
	readonly usage?: string;
	readonly description?: string;
	readonly sections: readonly {
		readonly id: string;
		readonly label: string;
		readonly hint?: string;
		readonly default?: unknown;
	}[];
};

/** 章节 id 的合法形式：**必须以字母开头**（正向白名单，杜绝整数键导致的对象键序重排）。 */
const SECTION_ID_RE = /^[A-Za-z][A-Za-z0-9_-]*$/;

/** 模板注册表。key = `name`。 */
const TEMPLATES = new Map<string, TemplateDef>();

/**
 * 注册表是否已就绪（**降级模式的判定依据**）。
 *
 * 用于区分两种失败：**未初始化**（时序 bug，`resolve` 抛错）与
 * **没这个模板**（数据问题，`resolve` 返回 `undefined`）。
 *
 * **⚠ 语义（已裁）：就绪 = 至少成功注册了 1 个模板，不要求零失败。**
 *
 * 依据用户 `14:50`：
 *   「但是如果他出错了，**core 可以继续开**。」
 *   「**可以展示，没有行为**，状态的切换按钮都不给。创建新卡没有模板选创建不了。」
 *
 * ⇒ 用户描述的是**降级可用**，不是"要么全好要么全坏"。
 * ⇒ 但必须有**下界**：0 个模板 = 什么都没注册上 = 不算就绪
 *   （否则"部分成功"会把"一个都没有"也算进去，那是错的）。
 *
 * **⚠ "这次加载有没有失败"不在这个函数里** —— 那是 `loadTemplates()` 返回的
 * `failures` 数组要表达的事。两个概念分开，别混成一个布尔。
 */
let initialized = false;

/**
 * 标记注册表已就绪。
 *
 * **调用条件（已裁）：至少成功注册了 1 个模板。**
 * 不要求零失败 —— 部分模板失败时其余仍可用（用户 `14:50`「core 可以继续开」）。
 *
 * 之后 `resolve` 未命中才返回 `undefined`；之前未命中一律抛错（时序 bug，不能被静默吞掉）。
 *
 * ⚠ **不要在"0 个模板"时调用**：那会让"什么都没加载上"被读成"就绪但模板不存在"，
 * 把装配问题和数据问题混成同一种错。
 */
export function markTemplateRegistryReady(): void {
	initialized = true;
}

/** 注册表是否已就绪（至少成功注册了 1 个模板）。见 `initialized` 的长注释。 */
export function isTemplateRegistryReady(): boolean {
	return initialized;
}

/** 已注册模板数（供诊断与"至少 1 个"的判定）。 */
export function templateCount(): number {
	return TEMPLATES.size;
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
	}
}

/** 注册一个模板。已存在同名 ⇒ 抛错（不静默覆盖）。 */
export function registerTemplate(def: TemplateDef): void {
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
	if (typeof def.displayName !== 'string' || def.displayName === '') {
		throw new Error(`taskboard2-types: 模板 "${def.name}" 必须有非空 displayName`);
	}
	/* `kind` 值域 = 已注册分类的英文 id。中文值会被拒（fail-closed），不静默进库。 */
	if (getKind(def.kind) === undefined) {
		throw new Error(
			`taskboard2-types: 模板 "${def.name}" 的 kind 非法（${String(def.kind)}），必须是已注册分类的英文 id`,
		);
	}
	assertSections(def.sections ?? [], def.name);

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
 *
 * ⚠️ **`sections[].label` 是必填** —— 用户 `14:47`「任务卡要存一个章节名字的副本」：
 * 领域类模板可能由 mod 携带，mod 被关掉后模板加载不了，
 * **卡必须能靠自己的副本正常显示** ⇒ 建卡时 ⑧ 会把 `label` 抄进卡上。
 */
export function resolve(ref: string): ResolvedTemplate | undefined {
	const def = getTemplate(ref);
	if (def === undefined) return undefined;
	const out: ResolvedTemplate = {
		name: def.name,
		displayName: def.displayName,
		kind: def.kind,
		domain: def.domain,
		codePrefix: def.codePrefix,
		sections: (def.sections ?? []).map((section) => ({
			id: section.id,
			label: section.label,
			default: section.default,
		})),
	};
	/* `derive` 只在模板真写了时才带出去（省得消费方判断 `[]` 与 `undefined` 两种空）。 */
	if (def.derive !== undefined) {
		return { ...out, derive: def.derive };
	}
	return out;
}

/**
 * 取模板的权威章节集（`{ id, label, default? }` 数组，顺序 = 声明顺序）。
 *
 * 建卡时 ⑧ 用它做「缺章 / 多章」双向比对；**fork 补缺章时取该章的 `default`**
 * （没有 `default` ⇒ 报错，不猜）；建卡铺初始 `sections` 时抄该章的 `label`。
 *
 * 模板不存在 ⇒ 整体 `undefined`（元素级不可能「解析失败」）。
 */
export function sectionsOf(ref: string): readonly SectionInfo[] | undefined {
	const def = getTemplate(ref);
	if (def === undefined) return undefined;
	return (def.sections ?? []).map((section) => ({
		id: section.id,
		label: section.label,
		default: section.default,
	}));
}

/**
 * 取模板的展示元数据（给 ⑩）。
 *
 * **不含任何中文以外的"文案"**：`displayName` / `usage` / `description` 由模板声明提供，
 * 本函数只做搬运，不生成任何语言。
 *
 * `sections[].default` 一并带出：**⑩ 预填要用它**（与 ⑧ 的 `sectionsOf` 取自同一处，
 * 但两条路各自完整，不互相依赖）。
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
			default: section.default,
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
