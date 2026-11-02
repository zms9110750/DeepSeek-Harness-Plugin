/**
 * 全局键值（不按空间分）。
 *
 * 用途：⑥ workgroup 存「当前空间指针」（`current:<sessionId>` → workspaceId）。
 *
 * 值无关：**key 是不透明字符串**，本模块不解释前缀、不做命名空间隔离。
 * 谁用、怎么约定 key，是调用方的事。
 *
 * 存 `<root>/_global.db` 的 `kv` 表。这个库**可丢弃**：里面的东西都能从
 * 使用过程重建，丢了只是当前指针重置，不影响任何卡数据。
 */

import type { DbHandle } from './db.js';
import type { Row } from './db.js';

/** 一张 kv 表。 */
export type GlobalKv = {
	get(key: string): unknown;
	set(key: string, value: unknown): void;
	delete(key: string): void;
};

/** 建 `kv` 表（全局库专用；工作空间库不需要）。 */
export function ensureGlobalSchema(handle: DbHandle): void {
	handle.db.exec(`
    CREATE TABLE IF NOT EXISTS kv (
      k TEXT PRIMARY KEY,
      v TEXT NOT NULL
    ) STRICT
  `);
}

/** 在全局库上构造 `GlobalKv`。 */
export function createGlobalKv(handle: DbHandle): GlobalKv {
	ensureGlobalSchema(handle);
	return {
		get(key: string): unknown {
			const row = handle.stmt('SELECT v FROM kv WHERE k = ?').get(key) as Row | undefined;
			if (row === undefined) return undefined;
			const text = row['v'];
			if (typeof text !== 'string') return undefined;
			try {
				return JSON.parse(text);
			} catch {
				return undefined;
			}
		},
		set(key: string, value: unknown): void {
			const text = JSON.stringify(value);
			if (text === undefined) {
				throw new TypeError(`global kv value for "${key}" is not JSON-serializable`);
			}
			handle
				.stmt('INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v')
				.run(key, text);
		},
		delete(key: string): void {
			handle.stmt('DELETE FROM kv WHERE k = ?').run(key);
		},
	};
}
