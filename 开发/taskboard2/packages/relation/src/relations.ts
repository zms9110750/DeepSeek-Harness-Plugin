/**
 * ④ relation —— 关系域对象：条目、容器、校验。
 *
 * 本文件只做三件事：
 *   1) 定义关系条目的形状（`RelationEntry`）与容器的形状（`Relations` / `EditableRelations`）；
 *   2) 提供**唯一**的校验入口 `validateRelations`；
 *   3) 用私有 `makeRelations` 把"校验通过"变成类型上的事实。
 *
 * ## 为什么 `Relations` 要带一个私有 brand
 *
 * 因为"形状对"不等于"校验过"。若 `Relations` 只是普通的 `{ parent, links }`，
 * 任何人都能写一个对象字面量冒充它，于是"所有写入都经校验"就退化成一句约定。
 *
 * `REL` 是**本模块私有**的 `unique symbol`：只要不导出它，外部就写不出满足 `Relations` 的字面量，
 * 也做不出合法的 `as Relations`（`as any` 例外 —— 那是任何 TS 防护的边界）。
 *
 * ⚠ brand 的有效性**完全取决于 `REL` 不外泄**。一旦有人为了"方便"导出 `REL`，
 * brand 立刻退化为装饰，而且**不会有任何编译错误**。
 *
 * ## 见 docs/04-relation.md 2.2 / 2.3 / 2.4
 */

import { isLinkLabel, type LinkLabel } from './kinds.js';

/** 卡的编号。④ 不认识编号的格式，只当它是不透明字符串（编号生成归 ③）。 */
export type CardId = string;

/** 一条关系边。`to` 只写编号 —— 边不跨空间（用户 05:28），容器内解析即可。 */
export interface RelationEntry {
	readonly label: LinkLabel;
	readonly to: CardId;
}

/** 私有 brand 的键。**不导出**，见文件头。 */
declare const REL: unique symbol;

/**
 * 一份**已校验**的关系容器。
 *
 * `parent` 用 `''` 表示"没有父卡"，不用 `null`/`undefined` ——
 * 后者会让"没有父卡"出现两种表示，而 JSON 里"缺字段"与 `''` 的语义并不相同。
 *
 * ⚠ `links` 用的是**可变数组类型**（不是 `readonly RelationEntry[]`）：
 * 卡上的 relations 要落库、要与 ⑦ 的结构类型互换，而**只读数组不能赋给可变数组**。
 * 运行时仍然按不可变方式使用（每次都造新数组），这里放宽类型只为不挡住消费方。
 */
export type Relations = { readonly [REL]: true } & {
	readonly parent: CardId | '';
	links: RelationEntry[];
};

/**
 * 用户/AI 提交的**编辑视图**。
 *
 * 当前它与 `Relations` 的 `links` 形状相同 —— 因为**所有 label 都可编辑**（用户 13:18 推翻了
 * "取代不可编辑"）。保留两个名字只为表达用途差异（存储态 vs 编辑输入），
 * 是否合并成一个类型留待 ⑦ 定。
 */
export type EditableRelations = {
	readonly parent: CardId | '';
	links: RelationEntry[];
};

/**
 * 一条校验问题。
 *
 * `kind` 分四类，便于调用方按位置报错、也便于以后加细分而不用改结构：
 *   - `structure` —— 容器本身不成形（不是对象、`links` 不是数组）；
 *   - `parent`    —— 父卡字段有问题；
 *   - `link`      —— 某一条边有问题（`index` 是该卡 `links` 数组的下标）；
 *   - `patch`     —— 补丁应用阶段的问题（见 `patch.ts`）。
 *
 * ⚠ `reason` 里**不出现任何目标合法性**（存在 / 非草稿 / 非墓碑 / 同空间）——
 * 那归 core：④ 没有全量卡、也不认识状态（见 docs 2.4）。
 */
export type Issue =
	| { readonly kind: 'structure'; readonly reason: 'relations-not-object' | 'links-not-array' }
	| { readonly kind: 'parent'; readonly to: string; readonly reason: 'parent-not-string' }
	| {
			readonly kind: 'link';
			readonly index: number;
			readonly to: string;
			readonly reason: 'not-an-object' | 'label-not-string' | 'unknown-label' | 'to-empty';
	  }
	| {
			readonly kind: 'patch';
			readonly reason: 'ambiguous-match' | 'unsupported-op' | 'target-missing';
			readonly detail: string;
	  };

/** `validateRelations` 的结果：判别式联合，不做"抛异常 + 返回码"两套表示。 */
export type ValidationResult =
	| { readonly ok: true; readonly value: Relations }
	| { readonly ok: false; readonly issues: readonly Issue[] };

/**
 * **全仓库唯一允许 cast 成 `Relations` 的地方。**
 *
 * 不导出、不 provide —— 对外只有 `validateRelations`，它成功时才调本函数。
 * 若别处再出现一处 `as Relations`，"唯一产出点"就不成立了（见 docs 6.7 的可机械检查项）。
 */
function makeRelations(parent: CardId | '', links: readonly RelationEntry[]): Relations {
	return { parent, links } as unknown as Relations;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 校验并定型一份 relations。**纯函数**，无副作用、无 IO、不看卡的其他字段。
 *
 * 只判两件事（docs 2.4）：
 *   1) **结构是否成形** —— 对象 / 数组 / 非空字符串；
 *   2) **词汇是否合法** —— `label ∈ LINK_KINDS`。
 *
 * 不做：目标合法性（归 core）、取代的来源规则（已随作者三档一并作废）、
 * 数量限制（取代可以有多个，用户 13:18）。
 *
 * **一次报全部问题**，不是遇到第一个就返回 —— 否则用户改一个报一个。
 */
export function validateRelations(input: unknown): ValidationResult {
	if (!isPlainObject(input)) {
		return { ok: false, issues: [{ kind: 'structure', reason: 'relations-not-object' }] };
	}

	const issues: Issue[] = [];

	const parentRaw = input['parent'];
	if (typeof parentRaw !== 'string') {
		issues.push({ kind: 'parent', to: '', reason: 'parent-not-string' });
	}

	const linksRaw = input['links'];
	if (!Array.isArray(linksRaw)) {
		issues.push({ kind: 'structure', reason: 'links-not-array' });
		/* `links` 都不是数组了，没有逐条可查的东西。 */
		return { ok: false, issues };
	}

	const links: RelationEntry[] = [];
	for (let index = 0; index < linksRaw.length; index += 1) {
		const raw: unknown = linksRaw[index];
		if (!isPlainObject(raw)) {
			issues.push({ kind: 'link', index, to: '', reason: 'not-an-object' });
			continue;
		}

		const labelRaw = raw['label'];
		const toRaw = raw['to'];
		const to = typeof toRaw === 'string' ? toRaw : '';

		let bad = false;
		if (typeof labelRaw !== 'string') {
			issues.push({ kind: 'link', index, to, reason: 'label-not-string' });
			bad = true;
		} else if (!isLinkLabel(labelRaw)) {
			issues.push({ kind: 'link', index, to, reason: 'unknown-label' });
			bad = true;
		}

		if (typeof toRaw !== 'string' || toRaw === '') {
			issues.push({ kind: 'link', index, to, reason: 'to-empty' });
			bad = true;
		}

		if (!bad) {
			links.push({ label: labelRaw as LinkLabel, to: toRaw as CardId });
		}
	}

	if (issues.length > 0) {
		return { ok: false, issues };
	}

	return { ok: true, value: makeRelations(parentRaw as CardId | '', links) };
}

/**
 * 判断一个值**形状上**像不像 `Relations`。
 *
 * ⚠ **它不能证明"已校验"** —— brand 只在类型层，运行时查不到。本函数只是形状粗筛，
 * 用途仅限于"要不要继续往下走"这种廉价分支。**任何写入都必须走 `validateRelations`。**
 */
export function looksLikeRelations(value: unknown): value is { parent: string; links: unknown[] } {
	return isPlainObject(value) && typeof value['parent'] === 'string' && Array.isArray(value['links']);
}
