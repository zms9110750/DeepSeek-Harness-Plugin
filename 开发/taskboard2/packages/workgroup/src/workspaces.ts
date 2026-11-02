/**
 * 建 / 列 / 归档 / 取消归档 —— 全部经 ① store。
 *
 * 核心事实（`docs/06-workgroup.md` 2.3 / 2.4）：
 *   · 一个工作空间 = 一个 `.db`（`<dshHome>/taskboard/<id>.db`）
 *   · 归档 = **物理移动**进 `archive/`，**不用 `meta` 布尔标记**
 *   · **无删除入口** —— 物理删除由用户自己在文件系统做
 */

import { readDisplayName, writeDisplayName } from './meta.js';
import type { MetaStorePort } from './meta.js';
import type { Workspace } from './types.js';

/** ⑥ 需要的 ① 能力子集（只声明用到的）。 */
export interface WorkspaceStorePort extends MetaStorePort {
	listWorkspaces(includeArchived?: boolean): { id: string; archived: boolean }[];
	allocateId(rawName: string): string;
	sanitize(rawName: string): string;
	archiveDb(wsId: string): void;
	unarchiveDb(wsId: string): void;
	dbPath(wsId: string, archived: boolean): string;
}

/** 一次 `listWorkspaces` 的投影结果（含显示名）。 */
export function listWorkspaces(store: WorkspaceStorePort, includeArchived: boolean): Workspace[] {
	const entries = store.listWorkspaces(includeArchived);
	return entries.map((entry) => ({
		id: entry.id,
		displayName: readDisplayName(store, entry.id),
		archived: entry.archived,
	}));
}

/**
 * 建一个工作空间。
 *
 * 三步：
 *   1. `allocateId` —— 清洗 + 重名消歧义（**由 ① 完成，它用 `O_EXCL` 仲裁，
 *      并已经占住了 `<id>.db` 文件**）
 *   2. 把显示名写进该空间自己的 `meta`（显示名 = 最终派生名，用户看到的就是它）
 *   3. 返回投影
 *
 * ⚠ **卡不能跨空间移动** ⇒ 成员关系创建时一次性写入，此后不可变更。
 *   所以建空间时**不需要**任何成员列表参数。
 *
 * @param store - ① 的能力。
 * @param rawName - 用户手填的名字（任意文本）。
 * @returns 新空间的投影。
 */
export function createWorkspace(store: WorkspaceStorePort, rawName: string): Workspace {
	const id = store.allocateId(rawName);
	/* 显示名就是最终派生名 —— 用户看到的就是它，不是「界面 A、磁盘 B」。 */
	writeDisplayName(store, id, id, rawName);
	return { id, displayName: readDisplayName(store, id), archived: false };
}

/** 归档一个空间（物理移动进 `archive/`）。幂等。 */
export function archiveWorkspace(store: WorkspaceStorePort, wsId: string): void {
	store.archiveDb(wsId);
}

/** 取消归档（物理移回根目录）。幂等。 */
export function unarchiveWorkspace(store: WorkspaceStorePort, wsId: string): void {
	store.unarchiveDb(wsId);
}

/** 某个 id 是否存在；存在则返回其投影，否则 `undefined`。 */
export function findWorkspace(store: WorkspaceStorePort, wsId: string): Workspace | undefined {
	for (const entry of store.listWorkspaces(true)) {
		if (entry.id !== wsId) continue;
		return {
			id: entry.id,
			displayName: readDisplayName(store, entry.id),
			archived: entry.archived,
		};
	}
	return undefined;
}
