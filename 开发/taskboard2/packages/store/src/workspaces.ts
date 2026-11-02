/**
 * 工作空间的枚举与归档。
 *
 * 枚举**扫目录、零开库** —— 这是「永远不看归档 + 懒加载」的结构性保证：
 * 归档的库物理上不在根目录，默认扫描路径天然看不到它。
 *
 * 归档 = **关句柄 → rename**。不是数据库操作。
 */

import { existsSync, mkdirSync, readdirSync, renameSync } from 'node:fs';

import type { HandleTable } from './handles.js';
import {
	archiveDir,
	GLOBAL_DB_NAME,
	workspaceFile,
	workspaceIdOf,
} from './paths.js';

/** 一个工作空间的枚举结果。 */
export interface WorkspaceEntry {
	readonly id: string;
	readonly archived: boolean;
}

/**
 * 扫描一个目录里的 `.db` 文件，取出工作空间 id。
 *
 * 只认**普通文件**：`archive/` 与 `templates/` 是目录，天然被 `isFile()` 排除。
 * 另外显式跳过 `_global.db` —— 它也以 `.db` 结尾，但**不是工作空间**。
 */
function scan(dir: string, archived: boolean, into: WorkspaceEntry[]): void {
	let entries;
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch {
		/* 目录不存在 = 还没有任何空间。 */
		return;
	}
	for (const entry of entries) {
		if (!entry.isFile()) continue;
		if (entry.name === GLOBAL_DB_NAME) continue;
		const id = workspaceIdOf(entry.name);
		if (id === undefined) continue;
		into.push({ id, archived });
	}
}

/**
 * 列出工作空间。
 *
 * @param root - 数据根目录。
 * @param includeArchived - 为 `true` 时把 `archive/` 里的一并列出。
 * @returns 未归档的在前；同一组内按 id 排序（目录顺序不是稳定语义）。
 */
export function listWorkspaces(root: string, includeArchived: boolean): WorkspaceEntry[] {
	const out: WorkspaceEntry[] = [];
	scan(root, false, out);
	if (includeArchived) scan(archiveDir(root), true, out);
	out.sort((a, b) => {
		if (a.archived !== b.archived) return a.archived ? 1 : -1;
		return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
	});
	return out;
}

/**
 * 把空间移进 `archive/`。
 *
 * ⚠ **必须先关闭句柄再 rename**：WAL 的 `-wal` / `-shm` 边车文件在句柄
 *   未关闭时会留在原地，重命名后的库可能无法恢复。
 *
 * @returns `true` 表示发生了移动；`false` 表示源不存在（幂等）。
 */
export function archiveWorkspace(handles: HandleTable, root: string, workspaceId: string): boolean {
	const source = workspaceFile(root, workspaceId, false);
	if (!existsSync(source)) return false;
	const target = archiveDir(root);
	mkdirSync(target, { recursive: true, mode: 0o700 });
	handles.release(source);
	renameSync(source, workspaceFile(root, workspaceId, true));
	return true;
}

/**
 * 把空间从 `archive/` 移回根目录。
 *
 * @returns `true` 表示发生了移动；`false` 表示源不存在（幂等）。
 */
export function unarchiveWorkspace(
	handles: HandleTable,
	root: string,
	workspaceId: string,
): boolean {
	const source = workspaceFile(root, workspaceId, true);
	if (!existsSync(source)) return false;
	mkdirSync(root, { recursive: true, mode: 0o700 });
	handles.release(source);
	renameSync(source, workspaceFile(root, workspaceId, false));
	return true;
}
