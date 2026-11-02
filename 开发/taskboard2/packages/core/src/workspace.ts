/**
 * ⑧ core —— 空间解析与内存卡集。
 *
 * ## 两条边界
 *
 * 1. **机制在 ⑥，策略在 ⑧**：⑥ 只返回 `none` / `ok` / `stale` 三态，
 *    **不抛业务错、不出文案**；"没有当前空间就报错"是 ⑧ 决定的。
 * 2. **内存真值归 ⑧**：① 只做「字节 ↔ 值」，每次 `readAll` 返回新对象。
 *    ⇒ ⑧ 在**激活空间时读一次**并长期持有，**不在循环里重复调**。
 *
 * ## `stale` 可重复出现
 *
 * ⑥ 读时顺手幂等清理（清理失败也返回 `stale`）。所以 ⑧ 的文案必须**可重复展示**，
 * 不能写成一次性提示。
 */

import { coreError, type CoreError } from './errors.js';
import type { Card, CurrentWorkspace, StorePort, WorkgroupPort } from './ports.js';

/** 一个已激活的空间：库里那份内存副本 + 它的身份。 */
export interface ActiveWorkspace {
	readonly wsId: string;
	/** 当前空间全量卡：**含墓碑、含草稿、不过滤**（滤波是消费方的事）。 */
	readonly cards: readonly Card[];
}
/** 解析当前空间的结果。 */
export type ResolveWorkspaceResult =
	| { readonly ok: true; readonly workspaceId: string }
	| { readonly ok: false; readonly error: CoreError };

/**
 * 把 ⑥ 的三态翻译成 ⑧ 的结论。
 *
 * **纯函数**：不读存储、不产生副作用 —— 报错文案在这里定，但"要不要报错"由调用方用 `ok` 判。
 *
 * ⚠ 文案**可重复展示**：`stale` 可能反复出现（⑥ 清理失败时）。
 */
export function interpretCurrent(current: CurrentWorkspace): ResolveWorkspaceResult {
	switch (current.status) {
		case 'ok':
			return { ok: true, workspaceId: current.workspaceId };
		case 'none':
			return {
				ok: false,
				error: coreError(
					'NO_CURRENT_WORKSPACE',
					'当前没有激活的工作空间。先选一个工作空间再操作。',
				),
			};
		case 'stale':
			return {
				ok: false,
				error: coreError(
					'STALE_CURRENT_WORKSPACE',
					`你之前指向的工作空间「${current.lastWorkspaceId}」已不存在，请重新选择一个。`,
				),
			};
	}
}

/** 解析当前空间（⑥ → ⑧ 的结论）。 */
export function resolveCurrentWorkspace(
	workgroup: WorkgroupPort,
	sessionId: string,
): ResolveWorkspaceResult {
	return interpretCurrent(workgroup.resolveCurrent(sessionId));
}

/**
 * 从 ① 装载一个空间的**全量卡**到内存。
 *
 * - **不过滤**：含墓碑、含草稿。墓碑由出数据的那一层滤（见 `docs/08-core.md` 3.10）。
 * - **每次调用都是新对象**（① 的契约）⇒ 返回的数组可安全当"本轮快照"用。
 */
export function loadWorkspace(store: StorePort, wsId: string): ActiveWorkspace {
	return { wsId, cards: store.readAll(wsId) };
}

/**
 * 给 ④⑤ 的卡集：**全量非墓碑**。
 *
 * 为什么剔墓碑：墓碑 ⊂ 草稿（只有草稿能删）+ 草稿不能被指
 * ⇒ **墓碑不可能成为边目标** ⇒ 哑边类目不存在，剔掉是安全的（不会漏边）。
 * 为什么**保留草稿**：剔掉会让"依赖一张草稿"的领取检查静默放行。
 */
export function visibleCards(workspace: ActiveWorkspace): Card[] {
	return workspace.cards.filter((card) => card.deleted !== true);
}

/**
 * 按 id 找一张卡。
 *
 * **不过滤墓碑** —— 业务上"按 id 直查可见"（用户 03:32）。
 * 调用方要区分"不存在"与"已删除"，看返回值的 `deleted` 字段，**不要**在这里滤。
 */
export function findCard(workspace: ActiveWorkspace, id: string): Card | undefined {
	return workspace.cards.find((card) => card.id === id);
}

/**
 * 当前空间内已用的全部编号（**含墓碑**）。
 *
 * ③ 的 `nextId` 要求 `usedIds` 含墓碑，否则删掉最大号后会复用 → 撞主键。
 * ⇒ 这里**故意不滤**，与 `visibleCards` 的过滤是两件事。
 */
export function usedIdsOf(workspace: ActiveWorkspace): string[] {
	return workspace.cards.map((card) => card.id);
}
