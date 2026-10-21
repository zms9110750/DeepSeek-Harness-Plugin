/**
 * tree-store 的测试：建库、登记节点、存提案记录、取链、按会话取内容、旧库迁移。
 * 用的是真 sqlite（node:sqlite），落在临时目录，跑完就删。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';

const URL_ = pathToFileURL('X:/temp/dsh/开发/plan-tree/src/tree-store.js').href;

const makeDir = () => mkdtempSync(join(tmpdir(), 'tree-store-'));

const record = (tag) => JSON.stringify({ op: 'plan', tag });

/** 每个测试都自己建库、自己关，绝不让句柄活到删目录之后。 */
async function withStore(run) {
	const { openTreeStore } = await import(URL_);
	const dir = makeDir();
	const store = openTreeStore(join(dir, 'treeSession.db'));
	try {
		return await run(store, dir);
	} finally {
		try {
			store.close();
		} catch {
			/* 已经关了 */
		}
		rmSync(dir, { recursive: true, force: true });
	}
}

test('建库：表、身份、版本都写进去，说明里写明树管提案不管消息', async () => {
	const { openTreeStore, APPLICATION_ID, FORMAT_VERSION } = await import(URL_);
	await withStore((store) => {
		const tables = store.db
			.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
			.all()
			.map((row) => row.name);
		assert.deepEqual(tables, ['meta', 'records', 'sessions']);

		const meta = Object.fromEntries(store.db.prepare('SELECT key, value FROM meta').all().map((row) => [row.key, row.value]));
		assert.equal(meta.format_version, String(FORMAT_VERSION));
		assert.match(meta.about, /树管提案，不管消息/);

		assert.equal(store.db.prepare('PRAGMA application_id').get().application_id, APPLICATION_ID);
		assert.equal(store.db.prepare('PRAGMA user_version').get().user_version, FORMAT_VERSION);
	});
});

test('链条：从叶子往上，根在最前，at_seq 是各层自己的继承条数', async () => {
	await withStore((store) => {
		// A 从根继承 4821 条；A-1 从 A 继承 2 条
		store.registerSession('A', { atSeq: 4821, planId: 'p13' });
		store.registerSession('A-1', { parent: 'A', atSeq: 2, planId: 'p14' });

		const chain = store.chain('A-1');
		assert.deepEqual(
			chain.map((row) => [row.id, row.at_seq]),
			[
				['A', 4821],
				['A-1', 2],
			],
		);
	});
});

test('内容按会话取：传自己的链才看得见祖先，多传一个会话就多看见一层', async () => {
	await withStore((store) => {
		store.registerSession('A', { atSeq: 4821 });
		store.registerSession('A-1', { parent: 'A', atSeq: 2 });
		store.appendRecord('A', 0, record('A 的提案'));
		store.appendRecord('A-1', 0, record('A-1 的提案'));

		// 这一层只看自己：祖先的记录不在，孙的也不在。
		assert.deepEqual(store.records(['A-1']).map((row) => JSON.parse(row.line).tag), ['A-1 的提案']);
		// 往下继承：把链一起传进来，就看见整条祖先链。
		const chain = store.chain('A-1').map((row) => row.id);
		assert.deepEqual(store.records(chain).map((row) => JSON.parse(row.line).tag), ['A 的提案', 'A-1 的提案']);
		// 什么都不要时不做全表扫描。
		assert.deepEqual(store.records([]), []);
	});
});

test('迁移：旧库的 events 就地搬到 records，行一条不丢', async () => {
	const { openTreeStore, FORMAT_VERSION } = await import(URL_);
	const dir = mkdtempSync(join(tmpdir(), 'tree-store-legacy-'));
	const file = join(dir, 'treeSession.db');
	try {
		// 造一个 v1 的库：有 events、没有 records，meta 还是旧口径。
		const legacy = new DatabaseSync(file);
		legacy.exec("CREATE TABLE events(session_id TEXT NOT NULL, seq INTEGER NOT NULL, line TEXT NOT NULL, PRIMARY KEY(session_id, seq))");
		legacy.exec("CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT NOT NULL)");
		legacy.exec("CREATE TABLE sessions(id TEXT PRIMARY KEY, parent TEXT, at_seq INTEGER, plan_id TEXT, created_at INTEGER)");
		legacy.prepare('INSERT INTO events(session_id, seq, line) VALUES (?, ?, ?)').run('A', 0, record('旧记录'));
		legacy.prepare('INSERT INTO meta(key, value) VALUES (?, ?)').run('about', 'old');
		legacy.prepare('INSERT INTO meta(key, value) VALUES (?, ?)').run('format_version', '1');
		legacy.close();

		const store = openTreeStore(file);
		try {
			const tables = store.db
				.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
				.all()
				.map((row) => row.name);
			assert.deepEqual(tables, ['meta', 'records', 'sessions'], 'events 表应当已经消失');
			assert.deepEqual(store.records(['A']).map((row) => JSON.parse(row.line).tag), ['旧记录']);
			const meta = Object.fromEntries(store.db.prepare('SELECT key, value FROM meta').all().map((row) => [row.key, row.value]));
			assert.equal(meta.format_version, String(FORMAT_VERSION), '版本要跟着搬过来');
			assert.match(meta.about, /树管提案，不管消息/, '旧说明要换成新口径');
		} finally {
			store.close();
		}
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('幂等：重复登记与重复追加都不翻倍', async () => {
	await withStore((store) => {
		store.registerSession('A-1', { parent: 'A', atSeq: 2 });
		store.registerSession('A-1', { parent: 'A', atSeq: 2 });
		store.appendRecord('A-1', 0, record('once'));
		store.appendRecord('A-1', 0, record('once'));

		const rows = store.db.prepare('SELECT count(*) AS n FROM records WHERE session_id = ?').get('A-1');
		assert.equal(rows.n, 1);
		assert.equal(store.chain('A-1').length, 1, '没有 A 这一行时链就到 A-1 为止');
	});
});
