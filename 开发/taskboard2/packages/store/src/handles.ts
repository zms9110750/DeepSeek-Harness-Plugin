/**
 * 句柄表：每个工作空间一个打开的 `DatabaseSync`，按需打开、按需关闭。
 *
 * 为什么需要句柄缓存（而不是每次调用现开现关）：
 *   · 每次 `new DatabaseSync` 都要重新解析表结构与语句，成本高；
 *   · `transaction` 必须在同一个连接上 BEGIN/COMMIT；
 *   · 归档/取消归档**必须先关闭句柄再 rename** —— WAL 的 `-wal` / `-shm`
 *     边车文件在句柄未关闭时会留在原地，重命名后的库可能无法恢复。
 */

import { DbHandle, openDatabase } from './db.js';
import { globalDbFile, workspaceFile } from './paths.js';

/** 句柄表：`key → DbHandle`。key 由库文件绝对路径决定。 */
export class HandleTable {
	private readonly handles = new Map<string, DbHandle>();

	/** 取一个库的句柄，没有就打开。 */
	acquire(file: string): DbHandle {
		const existing = this.handles.get(file);
		if (existing !== undefined) return existing;
		const handle = new DbHandle(openDatabase(file));
		this.handles.set(file, handle);
		return handle;
	}

	/** 取某个工作空间的句柄。 */
	acquireWorkspace(root: string, workspaceId: string, archived: boolean): DbHandle {
		return this.acquire(workspaceFile(root, workspaceId, archived));
	}

	/** 取全局库的句柄。 */
	acquireGlobal(root: string): DbHandle {
		return this.acquire(globalDbFile(root));
	}

	/** 关闭并移除一个库的句柄；没有打开的句柄则无操作。 */
	release(file: string): void {
		const handle = this.handles.get(file);
		if (handle === undefined) return;
		handle.close();
		this.handles.delete(file);
	}

	/** 关闭并移除某个工作空间的句柄（归档/取消归档前必须调）。 */
	releaseWorkspace(root: string, workspaceId: string, archived: boolean): void {
		this.release(workspaceFile(root, workspaceId, archived));
	}

	/** 关闭全部句柄。 */
	closeAll(): void {
		for (const handle of this.handles.values()) handle.close();
		this.handles.clear();
	}
}
