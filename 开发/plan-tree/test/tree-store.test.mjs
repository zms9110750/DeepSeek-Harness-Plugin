/**
 * tree-store 的测试：建库、登记节点、追加事件、取链、按分叉点裁剪。
 * 用的是真 sqlite（node:sqlite），落在临时目录，跑完就删。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const URL_ = pathToFileURL('X:/temp/dsh/开发/plan-tree/src/tree-store.js').href;

const makeDir = () => mkdtempSync(join(tmpdir(), 'tree-store-'));

const line = (tag) => JSON.stringify({ type: 'user/message', data: { tag } });

test('建库：表、身份、版本都写进去', async () => {
	const { openTreeStore, APPLICATION_ID, FORMAT_VERSION } = await import(URL_);
	const dir = makeDir();
	try {
		const store = openTreeStore(join(dir, 'treeSession.db'));
		const tables = store.db
			.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
			.all()
			.map((row) => row.name);
		assert.deepEqual(tables, ['events', 'meta', 'sessions']);

		const meta = Object.fromEntries(store.db.prepare('SELECT key, value FROM meta').all().map((row) => [row.key, row.value]));
		assert.equal(meta.format_version, String(FORMAT_VERSION));
		assert.match(meta.about, /树形上下文/);

		assert.equal(store.db.prepare('PRAGMA application_id').get().application_id, APPLICATION_ID);
		assert.equal(store.db.prepare('PRAGMA user_version').get().user_version, FORMAT_VERSION);
		store.close();
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('链条：从叶子往上，根在最前，at_seq 是各层自己的继承条数', async () => {
	const { openTreeStore } = await import(URL_);
	const dir = makeDir();
	try {
		const store = openTreeStore(join(dir, 'treeSession.db'));
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
		store.close();
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('裁剪：父在分叉之后产生的事件不进子的上下文', async () => {
	const { openTreeStore } = await import(URL_);
	const dir = makeDir();
	try {
		const store = openTreeStore(join(dir, 'treeSession.db'));
		store.registerSession('A', { atSeq: 4821 });
		store.registerSession('A-1', { parent: 'A', atSeq: 2 });

		store.appendEvent('A', 0, line('A.0'));
		store.appendEvent('A', 1, line('A.1'));
		store.appendEvent('A', 2, line('A.2 分叉之后'));
		store.appendEvent('A', 3, line('A.3 分叉之后'));
		store.appendEvent('A-1', 0, line('A-1.0'));
		store.appendEvent('A-1', 1, line('A-1.1'));

		const assembled = store.assemble('A-1');
		assert.deepEqual(
			assembled.map((row) => JSON.parse(row.line).data.tag),
			['A.0', 'A.1', 'A-1.0', 'A-1.1'],
			'A 只取前 2 条，A.2/A.3 必须消失',
		);

		// 根那一段由调用方从原版日志取来，接在最前面。
		const withRoot = store.assemble('A-1', [line('root.0')]);
		assert.deepEqual(withRoot.map((row) => JSON.parse(row.line).data.tag), ['root.0', 'A.0', 'A.1', 'A-1.0', 'A-1.1']);
		store.close();
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('幂等：重复登记与重复追加都不翻倍', async () => {
	const { openTreeStore } = await import(URL_);
	const dir = makeDir();
	try {
		const store = openTreeStore(join(dir, 'treeSession.db'));
		store.registerSession('A-1', { parent: 'A', atSeq: 2 });
		store.registerSession('A-1', { parent: 'A', atSeq: 2 });
		store.appendEvent('A-1', 0, line('once'));
		store.appendEvent('A-1', 0, line('once'));

		const rows = store.db.prepare('SELECT count(*) AS n FROM events WHERE session_id = ?').get('A-1');
		assert.equal(rows.n, 1);
		assert.equal(store.chain('A-1').length, 1, '没有 A 这一行时链就到 A-1 为止');
		store.close();
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
