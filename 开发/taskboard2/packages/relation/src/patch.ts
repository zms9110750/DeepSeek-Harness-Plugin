/**
 * ④ relation —— 关系补丁：级联计划里"改边"那一步的最小操作。
 *
 * ## 为什么是"操作"而不是"整份 relations 的新值"
 *
 * 级联里要做的只是「把指向旧卡的依赖改成指向新卡」。
 * 若 ④ 产出整份 `links` 数组代替操作，④ 就必须先读出旧卡的全部条目、
 * 把不该动的那几条原样拼回去 —— 那等于 **④ 得知道"哪些条目要保留"**，
 * 而那是 ⑦ 的知识（存储态里还有别的写入者留下的条目）。见 docs 2.6。
 *
 * ## 语义（与 ⑦ 定稿的四条）
 *
 * 1. **匹配** = `label` 等于该值 **且** `to` 等于 `from` 的那一条；
 * 2. **改后** = `to` 变新值、`label` 不变；
 * 3. **匹配 0 条 ⇒ 跳过**（`ok`，无 issue）；**匹配 >1 条 ⇒ issue**（数据异常，不猜哪条对）；
 * 4. **多个 patch 按数组顺序应用**（顺序影响结果）。
 */

import type { LinkLabel } from './kinds.js';
import type { CardId, Issue, RelationEntry } from './relations.js';

/**
 * 一条关系补丁。
 *
 * 判别式联合：以后加新的 `op` 不会破坏调用方的签名。
 * 当前只有 `retargetLink` —— 级联只需要它：
 * 旧卡被置为终态时，指向它的依赖已经被转移走了，没转移走的依赖方本就该保持终态，
 * 因此**不需要"删边"**。
 */
export type RelationPatch = {
	readonly op: 'retargetLink';
	/** 被改的那条边的旧目标。 */
	readonly from: CardId;
	/** 改后的新目标。 */
	readonly to: CardId;
	/** 要改的关系类型（一般只有 `dependsOn`）。 */
	readonly label: LinkLabel;
};

/** 补丁应用结果。`links` 不可变，返回新数组。 */
export type PatchResult =
	| { readonly ok: true; readonly links: readonly RelationEntry[] }
	| { readonly ok: false; readonly issues: readonly Issue[] };

/**
 * 把一串补丁按顺序应用到 `links` 上。**纯函数。**
 *
 * 逐条应用、逐条检查 —— 因为**顺序影响结果**（先改 A 再改 B ≠ 先 B 后 A）。
 */
export function applyPatches(
	links: readonly RelationEntry[],
	patches: readonly RelationPatch[],
): PatchResult {
	let current: RelationEntry[] = links.map((entry) => ({ label: entry.label, to: entry.to }));
	const issues: Issue[] = [];

	for (const patch of patches) {
		/*
		 * 先取成宽类型再比较。
		 *
		 * 直接写 `patch.op !== 'retargetLink'` 在当前只有一个 `op` 时会得到
		 * "两类型无重叠"之类的编译告警/错误；而这条守卫是给**以后新增 op** 用的，
		 * 不该因为"现在只有一个成员"被删掉或被编译器判死。
		 */
		const op: string = patch.op;
		if (op !== 'retargetLink') {
			issues.push({ kind: 'patch', reason: 'unsupported-op', detail: op });
			continue;
		}

		const hits: number[] = [];
		for (let index = 0; index < current.length; index += 1) {
			const entry = current[index];
			if (entry === undefined) continue;
			if (entry.label === patch.label && entry.to === patch.from) hits.push(index);
		}

		if (hits.length > 1) {
			/* 数据异常：同一 label + 同一目标出现了多条。**不猜哪条对。** */
			issues.push({
				kind: 'patch',
				reason: 'ambiguous-match',
				detail: `${patch.label}:${patch.from} 命中 ${hits.length} 条`,
			});
			continue;
		}

		if (hits.length === 0) {
			/* 0 条 ⇒ 跳过。已经改过、或那条边本就不存在，都不是错误。 */
			continue;
		}

		const at = hits[0] as number;
		current = current.map((entry, index) =>
			index === at ? { label: entry.label, to: patch.to } : entry,
		);
	}

	if (issues.length > 0) return { ok: false, issues };
	return { ok: true, links: current };
}
