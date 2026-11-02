/**
 * 空间元信息的读写。
 *
 * 存在**该空间自己的 `.db`** 的 `meta` 表里 —— 这样拖走一个 `.db`
 * 就带走该空间的全部信息（名字、工作区授权）。见 `docs/01-store.md` 3.3。
 *
 * store 不解释键与值的语义：`meta` 是通用键值表。
 */

import type { DbHandle } from './db.js';
import type { Row } from './db.js';

/** 空间元信息：键 → 任意 JSON 值。 */
export type Meta = Record<string, unknown>;

/** 读全部元信息。空表返回 `{}`。 */
export function readMeta(handle: DbHandle): Meta {
	const rows = handle.stmt('SELECT k, v FROM meta ORDER BY k').all() as Row[];
	const out: Meta = {};
	for (const row of rows) {
		const key = row['k'];
		const value = row['v'];
		if (typeof key !== 'string' || typeof value !== 'string') continue;
		try {
			out[key] = JSON.parse(value);
		} catch {
			/* 单个损坏的元信息条目跳过，不让整个空间打不开。 */
		}
	}
	return out;
}

/**
 * 写一个元信息键；`value === undefined` 表示**删除该键**。
 *
 * 「空值」与「键不存在」不同，所以删除必须显式表达（`undefined`），
 * 而不是写一个空值。
 */
export function writeMetaKey(handle: DbHandle, key: string, value: unknown): void {
	if (value === undefined) {
		handle.stmt('DELETE FROM meta WHERE k = ?').run(key);
		return;
	}
	const text = JSON.stringify(value);
	if (text === undefined) {
		throw new TypeError(`meta value for "${key}" is not JSON-serializable`);
	}
	handle.stmt('INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').run(
		key,
		text,
	);
}
