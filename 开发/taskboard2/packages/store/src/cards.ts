/**
 * 卡的读写。
 *
 * 值无关：store 只认 `id` 是主键、`data` 是合法 JSON。
 * **不认识任何业务字段** —— 不认 `deleted`、不认 `parent`、不认 `status`。
 *
 * 因此 `readAll` **返回全量、含墓碑、不过滤**（用户原话与四方对齐结论见
 * `docs/01-store.md` 2.3 / 6.1）。过滤是 core / ⑤ search 的事。
 */

import type { DbHandle } from './db.js';
import type { Row } from './db.js';

/** 一张卡：任意 JSON 对象，字段由 ⑦ taskcard 定义，store 不解释。 */
export type Card = Record<string, unknown>;

/** 值不是 JSON 对象时拒绝 —— 这是唯一的内容约束。 */
function assertCard(card: unknown): asserts card is Card {
	if (typeof card !== 'object' || card === null || Array.isArray(card)) {
		throw new TypeError('card must be a plain JSON object');
	}
	const id = (card as { id?: unknown }).id;
	if (typeof id !== 'string' || id.length === 0) {
		throw new TypeError('card must carry a non-empty string "id"');
	}
}

/** 从 `data` 字节还原一张卡；存储损坏时抛出而不是静默丢弃。 */
function decode(id: string, data: string): Card {
	let parsed: unknown;
	try {
		parsed = JSON.parse(data);
	} catch (error) {
		throw new Error(`corrupt card "${id}": data is not valid JSON`, { cause: error });
	}
	if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
		throw new Error(`corrupt card "${id}": data is not a JSON object`);
	}
	return parsed as Card;
}

/**
 * 读该空间的全部卡。
 *
 * **不过滤任何东西**：含墓碑、含草稿。
 * 每次调用都从 `data` 字节重新解析，**返回新对象**（store 不做对象缓存，
 * 内存真值归 core）。
 */
export function readAll(handle: DbHandle): Card[] {
	const rows = handle.stmt('SELECT id, data FROM cards ORDER BY rowid').all() as Row[];
	const cards: Card[] = [];
	for (const row of rows) {
		const id = row['id'];
		const data = row['data'];
		if (typeof id !== 'string' || typeof data !== 'string') {
			throw new Error('corrupt cards table: row does not carry string id/data');
		}
		cards.push(decode(id, data));
	}
	return cards;
}

/** 读一张卡；不存在返回 `undefined`。 */
export function read(handle: DbHandle, id: string): Card | undefined {
	const row = handle.stmt('SELECT data FROM cards WHERE id = ?').get(id) as Row | undefined;
	if (row === undefined) return undefined;
	const data = row['data'];
	if (typeof data !== 'string') throw new Error(`corrupt card "${id}": data is not text`);
	return decode(id, data);
}

/** 一批卡并集：按 id 覆写。整卡替换，**没有字段 patch**。 */
export function write(handle: DbHandle, cards: readonly Card[]): void {
	for (const card of cards) assertCard(card);
	const stmt = handle.stmt(
		'INSERT INTO cards (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data',
	);
	for (const card of cards) {
		const id = card.id as string;
		stmt.run(id, JSON.stringify(card));
	}
}

/**
 * 物理删除卡（绕过墓碑机制）。
 *
 * ⚠ 这会让编号可被复用 —— ③ 的专用编号集合含墓碑，物理删除后该编号
 *   从集合中消失，下次发号可能复用它，**导致主键冲突**。
 *
 * ⚠ 业务删除**不是**这个：业务删除 = 写一张 `data.deleted = true` 的卡
 *   （整卡覆写），墓碑继续占号。core 中不存在任何业务路径调用本方法。
 */
export function purgePhysical(handle: DbHandle, ids: readonly string[]): void {
	const stmt = handle.stmt('DELETE FROM cards WHERE id = ?');
	for (const id of ids) stmt.run(id);
}
