/**
 * tree-store · 树形上下文的存储层。
 *
 * 一棵树一个 sqlite 文件，躺在根会话目录里，和原版的 `会话.jsonl.zst` 并排。
 * **只写自己的文件**：原版的任何字节都不碰。
 *
 * 两张表各管一件事：
 *   sessions(id, parent, at_seq, plan_id, created_at)  一行 = 树上一个节点
 *   events(session_id, seq, line)                     一行 = 一条事件（原始 JSONL 那一行）
 *
 * `at_seq` = 这一层**从父那里继承了多少条**。裁剪规则：某层自己的事件只取到
 * 它子节点的 at_seq 为止——子后来分叉出去之后，父再长出来的事件不进子的上下文。
 *
 * 库**不做拼接**：它只回答"这条链有哪几段、每段截到第几条"。拼接在运行时按清单流式做。
 *
 * @module @local/plan-tree/tree-store
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const name = 'tree-store';

export const inject = [];

/** 库的格式版本；结构变了就加一，迁移时先读它。 */
export const FORMAT_VERSION = 1;

/** 文件身份：任意 sqlite 工具 `PRAGMA application_id` 一敲就知道这是谁的库。 */
export const APPLICATION_ID = 0x54524545; // "TREE"

const ABOUT =
	'plan-tree 的树形上下文存储。sessions 一行一个树节点（parent + at_seq 说明从父的第几条接上）；' +
	'events 一行一条原始 JSONL 事件。根会话的内容不在这里，由原版日志提供。';

/**
 * 一棵树一个库：`~/.dsh/plan-tree/trees/<根会话 id>.db`。
 *
 * 按根会话分文件，是为了**人能搬**：删、拷、打包、归档，都以"一棵树"为单位，
 * 不会把别人的会话混进来。不放进原版会话目录，免得去猜它的 bucket 名。
 */
export function treeStorePath(rootId) {
	const safe = String(rootId ?? '').trim();
	if (safe === '') throw new Error('tree-store: 根会话 id 不能为空');
	return join(homedir(), '.dsh', 'plan-tree', 'trees', `${safe.replace(/[^\w.-]+/gu, '_')}.db`);
}

const SCHEMA = [
	`CREATE TABLE IF NOT EXISTS sessions(
		id TEXT PRIMARY KEY,
		parent TEXT,
		at_seq INTEGER,
		plan_id TEXT,
		created_at INTEGER
	)`,
	`CREATE TABLE IF NOT EXISTS events(
		session_id TEXT NOT NULL,
		seq INTEGER NOT NULL,
		line TEXT NOT NULL,
		PRIMARY KEY(session_id, seq)
	)`,
	`CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
];

/**
 * 打开（必要时创建）一棵树的库。
 * @param path - `treeSession.db` 的完整路径。
 * @returns 库句柄与读写方法。
 */
export function openTreeStore(path) {
	mkdirSync(dirname(path), { recursive: true });
	const db = new DatabaseSync(path);
	db.exec('PRAGMA journal_mode = WAL');
	db.exec('PRAGMA busy_timeout = 5000');
	for (const statement of SCHEMA) db.exec(statement);

	// 身份与版本：只有第一次写，之后不动。
	const seedMeta = db.prepare('INSERT OR IGNORE INTO meta(key, value) VALUES (?, ?)');
	seedMeta.run('about', ABOUT);
	seedMeta.run('format_version', String(FORMAT_VERSION));
	const currentApplicationId = db.prepare('PRAGMA application_id').get();
	if (currentApplicationId?.application_id !== APPLICATION_ID) {
		db.exec(`PRAGMA application_id = ${APPLICATION_ID}`);
		db.exec(`PRAGMA user_version = ${FORMAT_VERSION}`);
	}

	const insertSession = db.prepare('INSERT OR IGNORE INTO sessions(id, parent, at_seq, plan_id, created_at) VALUES (?, ?, ?, ?, ?)');
	const insertEvent = db.prepare('INSERT OR IGNORE INTO events(session_id, seq, line) VALUES (?, ?, ?)');
	const selectChain = db.prepare(`
		WITH RECURSIVE chain(id, at_seq, depth) AS (
			SELECT id, at_seq, 0 FROM sessions WHERE id = ?
			UNION ALL
			SELECT p.id, p.at_seq, c.depth + 1
			FROM chain c
			JOIN sessions s ON s.id = c.id
			JOIN sessions p ON p.id = s.parent
		)
		SELECT id, at_seq, depth FROM chain ORDER BY depth DESC
	`);
	const selectSegment = db.prepare('SELECT seq, line FROM events WHERE session_id = ? AND seq < ? ORDER BY seq');

	return {
		path,
		db,

		/** 登记一个树节点。重复登记不覆盖已有的行。 */
		registerSession(id, { parent = null, atSeq = 0, planId = null } = {}) {
			insertSession.run(String(id), parent, Number(atSeq) || 0, planId, Date.now());
		},

		/** 追加一条事件。同一 (session, seq) 重复写会被忽略，重放不会翻倍。 */
		appendEvent(sessionId, seq, line) {
			insertEvent.run(String(sessionId), Number(seq), String(line));
		},

		/**
		 * 从叶子往上取链，根在最前。
		 * @returns `[{ id, at_seq, depth }]`，`depth` 0 = 叶子。
		 */
		chain(leafId) {
			return selectChain.all(String(leafId));
		},

		/**
		 * 取某一层自己的事件，按裁剪点截断。
		 * @param id - 节点 id。
		 * @param inherits - 这一层被继承了这么多条（= 它子节点的 at_seq）；Infinity 表示不裁。
		 * @returns `[{ seq, line }]`。
		 */
		segment(id, inherits = Number.POSITIVE_INFINITY) {
			return selectSegment.all(String(id), Number.isFinite(inherits) ? inherits : Number.MAX_SAFE_INTEGER);
		},

		/**
		 * 把一条链拼成有序的事件行（**只给测试与人工核对用**；运行时按清单流式取，不落地成一个串）。
		 * @param leafId - 叶子节点 id。
		 * @param rootLines - 根会话那一段的行；由调用方从原版日志取来。
		 * @returns `[{ id, seq, line }]`，根在最前。
		 */
		assemble(leafId, rootLines = []) {
			const chain = selectChain.all(String(leafId));
			const out = rootLines.map((line, seq) => ({ id: 'root', seq, line }));
			for (let index = 0; index < chain.length; index += 1) {
				// 这一层被继承了多少条 = 它子节点的 at_seq（链里下一行）。
				const inherits = index + 1 < chain.length ? chain[index + 1].at_seq : Number.POSITIVE_INFINITY;
				for (const row of this.segment(chain[index].id, inherits)) {
					out.push({ id: chain[index].id, seq: row.seq, line: row.line });
				}
			}
			return out;
		},

		close() {
			db.close();
		},
	};
}

export function apply(ctx) {
	/** 按路径缓存打开的库，卸载时全部关掉。 */
	const open = new Map();
	ctx.effect(() => () => {
		for (const store of open.values()) {
			try {
				store.close();
			} catch {
				/* 已经关了 */
			}
		}
		open.clear();
	});

	ctx.provide('treeSessions', {
		/** 拿到（或打开）某个路径的库。 */
		at(path) {
			const key = String(path);
			let store = open.get(key);
			if (store === undefined) {
				store = openTreeStore(key);
				open.set(key, store);
			}
			return store;
		},

		/**
		 * 一棵树一个库，按根会话 id 命名。
		 * 根 id 由调用方给（派发时 `header.treeRoot ?? 自己的 id`），本模块不猜。
		 */
		atRoot(rootId) {
			return this.at(treeStorePath(rootId));
		},

		openTreeStore,
		FORMAT_VERSION,
		APPLICATION_ID,
	});
}
