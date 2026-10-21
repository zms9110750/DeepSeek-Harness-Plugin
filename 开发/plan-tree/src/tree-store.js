/**
 * tree-store · 树形上下文的存储层。
 *
 * 一棵树一个 sqlite 文件，躺在 `~/.dsh/plan-tree/trees/` 里。
 * **只写自己的文件**：原版的任何字节都不碰。
 *
 * 两张表各管一件事：
 *   sessions(id, parent, at_seq, plan_id, created_at)  一行 = 树上一个节点（关系）
 *   records(session_id, seq, line)                     一行 = 一条**提案记录**（plan/adopt/dispatch/file…）
 *
 * **树管提案，不管消息**。会话消息留在原版日志里，这里一条都不存；
 * `at_seq` 只说明"这一层从父的第几条之后接上"，是个边界数字，不是消息副本。
 *
 * 库**不做拼接**：要拼上下文就去原版日志按边界取，这不是树的职责。
 *
 * @module @local/plan-tree/tree-store
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const name = 'tree-store';

export const inject = [];

/** 库的格式版本；结构变了就加一，迁移时先读它。2 = events 改名 records。 */
export const FORMAT_VERSION = 2;

/** 文件身份：任意 sqlite 工具 `PRAGMA application_id` 一敲就知道这是谁的库。 */
export const APPLICATION_ID = 0x54524545; // "TREE"

const ABOUT =
	'plan-tree 的树形存储。sessions 一行一个树节点（parent + at_seq 说明从父的第几条接上）；' +
	'records 一行一条提案记录——提案的标题、状态、正文，以及每个节点的派发理由与结算都在这里。' +
	'树管提案，不管消息：会话消息在原版日志里，这里一条都不存。工具与界面只是这棵树的两个视图。';

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
	`CREATE TABLE IF NOT EXISTS records(
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

	// 1 → 2：这张表以前叫 events，存的是"会话事件"，读起来像在管消息；
	// 它其实只放提案记录，所以改名。旧库就地搬过去，行一条不丢。
	const legacy = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='events'").get();
	if (legacy !== undefined) {
		db.exec('INSERT OR IGNORE INTO records(session_id, seq, line) SELECT session_id, seq, line FROM events');
		db.exec('DROP TABLE events');
		// 说明与版本跟着改：旧库的 about 说的还是"原始 JSONL 事件"。
		db.prepare('UPDATE meta SET value = ? WHERE key = ?').run(ABOUT, 'about');
		db.prepare('UPDATE meta SET value = ? WHERE key = ?').run(String(FORMAT_VERSION), 'format_version');
	}

	const insertSession = db.prepare('INSERT OR IGNORE INTO sessions(id, parent, at_seq, plan_id, created_at) VALUES (?, ?, ?, ?, ?)');
	const insertRecord = db.prepare('INSERT OR IGNORE INTO records(session_id, seq, line) VALUES (?, ?, ?)');
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
	const selectAllRecords = db.prepare('SELECT session_id, seq, line FROM records ORDER BY session_id, seq');

	return {
		path,
		db,

		/** 登记一个树节点。重复登记不覆盖已有的行。 */
		registerSession(id, { parent = null, atSeq = 0, planId = null } = {}) {
			insertSession.run(String(id), parent, Number(atSeq) || 0, planId, Date.now());
		},

		/** 追加一条提案记录。同一 (session, seq) 重复写会被忽略，重放不会翻倍。 */
		appendRecord(sessionId, seq, line) {
			insertRecord.run(String(sessionId), Number(seq), String(line));
		},

		/**
		 * 从叶子往上取链，根在最前。这是关系，不含内容。
		 * @returns `[{ id, at_seq, depth }]`，`depth` 0 = 叶子。
		 */
		chain(leafId) {
			return selectChain.all(String(leafId));
		},

		/**
		 * 取几个会话的提案记录，按写入顺序。
		 *
		 * 视图该传什么由调用方定：一个会话的视图传它自己的祖先链（`chain()` 的 id），
		 * 于是"往下继承、往上不聚合"这条边界由传参决定，而不是由库里存了什么决定。
		 * @param sessionIds - 要读的会话 id。
		 * @returns `[{ session_id, seq, line }]`。
		 */
		records(sessionIds) {
			const wanted = new Set((sessionIds ?? []).map(String));
			if (wanted.size === 0) return [];
			return selectAllRecords.all().filter((row) => wanted.has(String(row.session_id)));
		},

		close() {
			db.close();
		},
	};
}

export function apply(ctx) {
	/** 按路径缓存打开的库，卸载时全部关掉。 */
	const open = new Map();
	/** 会话 → 它所属那棵树的根。派发时登记，进程重启后靠扫库补回来。 */
	const roots = new Map();
	ctx.effect(() => () => {
		for (const store of open.values()) {
			try {
				store.close();
			} catch {
				/* 已经关了 */
			}
		}
		open.clear();
		roots.clear();
	});

	const atPath = (path) => {
		const key = String(path);
		let store = open.get(key);
		if (store === undefined) {
			store = openTreeStore(key);
			open.set(key, store);
		}
		return store;
	};

	const treeSessions = {
		/** 拿到（或打开）某个路径的库。 */
		at: atPath,

		/**
		 * 一棵树一个库，按根会话 id 命名。
		 * 根 id 由调用方给（派发时 `header.treeRoot ?? 自己的 id`），本模块不猜。
		 */
		atRoot(rootId) {
			return atPath(treeStorePath(rootId));
		},

		/** 记下"这个会话属于哪棵树"。派发时由派发方登记，子会话自己写记录时才知道该落哪个库。 */
		note(sessionId, rootId) {
			roots.set(String(sessionId), String(rootId));
		},

		/**
		 * 这个会话属于哪棵树。
		 *
		 * 先查登记表；查不到就扫一遍已有的库，看哪个库把这个会话登记成了节点——
		 * 进程重启之后内存表是空的，靠这一步还能找回自己的根。都没有就是自己独立成树。
		 */
		rootOf(sessionId) {
			const id = String(sessionId);
			const known = roots.get(id);
			if (known !== undefined) return known;
			try {
				const dir = join(homedir(), '.dsh', 'plan-tree', 'trees');
				for (const name of readdirSync(dir)) {
					if (!name.endsWith('.db')) continue;
					const probe = new DatabaseSync(join(dir, name), { readOnly: true });
					try {
						const row = probe.prepare('SELECT parent FROM sessions WHERE id = ?').get(id);
						if (row?.parent) {
							roots.set(id, String(row.parent));
							return String(row.parent);
						}
					} finally {
						probe.close();
					}
				}
			} catch {
				/* 目录还不存在，或者库正被别处锁着；退回自己成树 */
			}
			roots.set(id, id);
			return id;
		},

		/** 这个会话该读写的库。 */
		atSession(session) {
			const id = typeof session === 'string' ? session : session?.id;
			if (id === undefined || String(id).length === 0) throw new Error('tree-store: 会话没有 id');
			return this.atRoot(this.rootOf(id));
		},

		openTreeStore,
		FORMAT_VERSION,
		APPLICATION_ID,
	};
	ctx.provide('treeSessions', treeSessions);
}
