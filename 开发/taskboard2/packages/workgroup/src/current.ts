/**
 * 当前空间指针 —— **会话级**，存 `_global.db` 的 `globalKv`。
 *
 * 用户原话（`docs/06-workgroup.md` 1.8）：
 *   「当前工作空间是会话。多个会话有分别的工作空间。」
 *   「不同的会话可以设置同一个空间为当前空间。」
 *   「任务板的所有工作空间，是全会话可见的。」
 *
 * ⇒ 「当前」只是「这个会话正看着哪个」，**不是权限、不是数据隔离**。
 *
 * ## 边界
 *
 *   · ⑥ **只返回状态，不抛业务错、不出文案** —— 报错策略归 ⑧ core
 *   · key 格式：`current:${sessionId}`，`sessionId` 对 ⑥ **不透明**
 */

import type { CurrentStatus } from './types.js';

/** ⑥ 需要的 ① 能力子集。 */
export interface CurrentStorePort {
	readonly globalKv: {
		get(key: string): unknown;
		set(key: string, value: unknown): void;
		delete(key: string): void;
	};
	listWorkspaces(includeArchived?: boolean): { id: string; archived: boolean }[];
}

/** 当前指针在全局库里的键。 */
export function currentKey(sessionId: string): string {
	return `current:${sessionId}`;
}

/** 某个 id 是否存在（根目录或归档目录都算存在）。 */
function workspaceExists(store: CurrentStorePort, wsId: string): boolean {
	for (const entry of store.listWorkspaces(true)) {
		if (entry.id === wsId) return true;
	}
	return false;
}

/**
 * 解析某会话的当前空间。
 *
 * 三态：
 *   · `none`  —— 从未设过
 *   · `ok`    —— 指向的空间存在
 *   · `stale` —— 指向的空间已不存在（用户可能物理删了库文件）
 *
 * **读时顺手幂等清理**：发现悬空就删掉该键，**不管删成功与否都返回 `stale`**
 * （不假装成功）。所以 **`stale` 可能重复出现** —— 上层的文案要能重复展示。
 *
 * @param store - ① 的能力。
 * @param sessionId - 会话 id（不透明字符串）。
 * @returns 三态之一。
 */
export function resolveCurrent(store: CurrentStorePort, sessionId: string): CurrentStatus {
	const key = currentKey(sessionId);
	const value = store.globalKv.get(key);

	if (typeof value !== 'string' || value.length === 0) return { status: 'none' };
	if (workspaceExists(store, value)) return { status: 'ok', workspaceId: value };

	try {
		store.globalKv.delete(key);
	} catch {
		/* 清理失败不假装成功：仍返回 stale，键保留，下次还会看到 stale。 */
	}
	return { status: 'stale', lastWorkspaceId: value };
}

/**
 * 把某会话的当前空间设为 `workspaceId`。
 *
 * ⚠ **不校验空间是否存在** —— 这是 ⑥ 的边界：⑥ 不抛业务错、不做策略。
 *   若写入一个不存在的 id，下次 `resolveCurrent` 会返回 `stale`。
 */
export function setCurrent(store: CurrentStorePort, sessionId: string, workspaceId: string): void {
	store.globalKv.set(currentKey(sessionId), workspaceId);
}

/** 清掉某会话的当前空间指针。幂等。 */
export function clearCurrent(store: CurrentStorePort, sessionId: string): void {
	store.globalKv.delete(currentKey(sessionId));
}
