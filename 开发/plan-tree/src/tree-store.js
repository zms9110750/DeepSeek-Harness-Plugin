/**
 * tree-store · 树形上下文的存储层。
 *
 * 一棵树一个 sqlite 文件，躺在 `~/.dsh/plan-tree/trees/` 里。
 * **只写自己的文件**：原版的任何字节都不碰。
 *
 * 三类表，各管一件事：
 *   sessions(id, parent, at_seq, plan_id, created_at)  一行 = 树上一个节点（关系）
 *   records(session_id, seq, line)                     一行 = 一条**提案记录**（plan/adopt/dispatch/file…）
 *   plans / nodes / template_failures                  **九态物化**：状态与模板失败计数的可查落地
 *
 * **真值与缓存**：`records` 是唯一真相（日志里发生过的每一条提案记录都在），
 * `plans` / `nodes` / `template_failures` 是由它派生出来的**缓存**——写入时同一条记录
 * 顺手更新，任何时候都可以 `rebuild()` 从 records 全量重放重建。所以：
 *   · 能查：界面、闸门、复盘判断直接 SELECT，不必先打开会话日志；
 *   · 能重建：缓存删掉、库拷走、崩溃后重启，重放一遍就回来；
 *   · 不丢：迁移只加表、不动 records，旧库原地升级。
 *
 * 状态码来自 plan-state（九态唯一词汇表）；这里只做落盘，不做语义发明。
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
import {
	STATUS,
	REVIEW_EVERY,
	REVIEW_TYPE,
	nodeStatusAfter,
	planPatchAfter,
	statusOf,
	templateKey,
	templateLabel,
} from './state.js';

export const name = 'tree-store';

export const inject = [];

/** 库的格式版本；结构变了就加一，迁移时先读它。3 = 九态物化（plans/nodes/template_failures）。 */
export const FORMAT_VERSION = 3;

/** 文件身份：任意 sqlite 工具 `PRAGMA application_id` 一敲就知道这是谁的库。 */
export const APPLICATION_ID = 0x54524545; // "TREE"

const ABOUT =
	'plan-tree 的树形存储。sessions 一行一个树节点（parent + at_seq 说明从父的第几条接上）；' +
	'records 一行一条提案记录——提案的标题、状态、正文，以及每个节点的派发理由与结算都在这里。' +
	'plans/nodes/template_failures 是九态与模板失败计数的物化缓存，可从 records 全量重放重建。' +
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
	// ---- v3：九态物化 ----
	// 一行 = 一份计划（草案也是计划，状态 null）。template 是归一化的模板键；
	// 模板是失败计数的单位（不是层、不是全局）。
	`CREATE TABLE IF NOT EXISTS plans(
		id TEXT PRIMARY KEY,
		status TEXT,
		type TEXT,
		layer TEXT,
		template TEXT,
		template_label TEXT,
		title TEXT,
		adopted INTEGER NOT NULL DEFAULT 0,
		rejected INTEGER NOT NULL DEFAULT 0,
		shelved INTEGER NOT NULL DEFAULT 0,
		status_seq INTEGER NOT NULL DEFAULT -1,
		updated_at INTEGER
	)`,
	// 一行 = 一个派发节点（九态）。parent_session 是父会话 id，child_id 是子会话 id。
	`CREATE TABLE IF NOT EXISTS nodes(
		id TEXT PRIMARY KEY,
		parent_session TEXT,
		child_id TEXT,
		plan_id TEXT,
		type TEXT,
		layer TEXT,
		template TEXT,
		topic TEXT,
		status TEXT NOT NULL DEFAULT 'working',
		status_seq INTEGER NOT NULL DEFAULT -1,
		updated_at INTEGER
	)`,
	// 一行 = 一份模板的累计失败与上次建复盘的刻度。累计，不要求连续。
	`CREATE TABLE IF NOT EXISTS template_failures(
		template TEXT PRIMARY KEY,
		template_label TEXT,
		failed INTEGER NOT NULL DEFAULT 0,
		last_reviewed_at INTEGER NOT NULL DEFAULT 0,
		updated_at INTEGER
	)`,
	`CREATE INDEX IF NOT EXISTS nodes_parent ON nodes(parent_session)`,
	`CREATE INDEX IF NOT EXISTS nodes_plan ON nodes(plan_id)`,
	`CREATE INDEX IF NOT EXISTS plans_template ON plans(template)`,
];

/** 本插件认识的 op；不认识的记录照样进 records，只是不物化。 */
const MATERIALIZED = new Set([
	'plan',
	'adopt',
	'reject-draft',
	'shelve-draft',
	'status',
	'dispatch',
	'link',
	'file',
	'cancel-dependents',
]);

const num = (value, fallback = 0) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
const str = (value) => (value === undefined || value === null ? null : String(value));

/**
 * 打开（必要时创建）一棵树的库，并把旧库迁到当前格式。
 *
 * 迁移策略（v2 → v3）：只加表；records 一条不动；物化表由记录重放灌满。
 * 所以是"原地升级 + 回填"，不是"导出再导入"。
 *
 * @param path - `treeSession.db` 的完整路径。
 * @returns 库句柄与读写方法。
 */
export function openTreeStore(path) {
	mkdirSync(dirname(path), { recursive: true });
	const db = new DatabaseSync(path);
	db.exec('PRAGMA journal_mode = WAL');
	db.exec('PRAGMA busy_timeout = 5000');
	for (const statement of SCHEMA) db.exec(statement);

	// 身份与版本：只有第一次写，之后由迁移更新。
	const seedMeta = db.prepare('INSERT OR IGNORE INTO meta(key, value) VALUES (?, ?)');
	seedMeta.run('about', ABOUT);
	seedMeta.run('format_version', String(FORMAT_VERSION));
	const currentApplicationId = db.prepare('PRAGMA application_id').get();
	if (currentApplicationId?.application_id !== APPLICATION_ID) {
		db.exec(`PRAGMA application_id = ${APPLICATION_ID}`);
	}

	// 1 → 2：这张表以前叫 events，存的是"会话事件"，读起来像在管消息；
	// 它其实只放提案记录，所以改名。旧库就地搬过去，行一条不丢。
	// 说明与版本也一起换成本版口径——旧库的 about 说的还是"原始 JSONL 事件"。
	const legacy = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='events'").get();
	if (legacy !== undefined) {
		db.exec('INSERT OR IGNORE INTO records(session_id, seq, line) SELECT session_id, seq, line FROM events');
		db.exec('DROP TABLE events');
		db.prepare('UPDATE meta SET value = ? WHERE key = ?').run(ABOUT, 'about');
		db.prepare('UPDATE meta SET value = ? WHERE key = ?').run(String(FORMAT_VERSION), 'format_version');
	}

	// ---- 物化写入口（prepare 一次，热路径不再解析 SQL）----
	const upsertPlanRow = db.prepare(`
		INSERT INTO plans(id, status, type, layer, template, template_label, title, adopted, rejected, shelved, status_seq, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			status=COALESCE(excluded.status, plans.status),
			type=COALESCE(excluded.type, plans.type),
			layer=COALESCE(excluded.layer, plans.layer),
			template=COALESCE(excluded.template, plans.template),
			template_label=COALESCE(excluded.template_label, plans.template_label),
			title=COALESCE(excluded.title, plans.title),
			adopted=excluded.adopted, rejected=excluded.rejected, shelved=excluded.shelved,
			status_seq=excluded.status_seq, updated_at=excluded.updated_at
	`);
	const upsertNodeRow = db.prepare(`
		INSERT INTO nodes(id, parent_session, child_id, plan_id, type, layer, template, topic, status, status_seq, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			parent_session=COALESCE(excluded.parent_session, nodes.parent_session),
			child_id=COALESCE(excluded.child_id, nodes.child_id),
			plan_id=COALESCE(excluded.plan_id, nodes.plan_id),
			type=COALESCE(excluded.type, nodes.type),
			layer=COALESCE(excluded.layer, nodes.layer),
			template=COALESCE(excluded.template, nodes.template),
			topic=COALESCE(excluded.topic, nodes.topic),
			status=excluded.status, status_seq=excluded.status_seq, updated_at=excluded.updated_at
	`);
	const updatePlanStatus = db.prepare('UPDATE plans SET status = ?, updated_at = ? WHERE id = ?');
	const selectPlan = db.prepare('SELECT * FROM plans WHERE id = ?');
	const selectPlansByTemplate = db.prepare('SELECT * FROM plans WHERE template = ?');
	const selectNode = db.prepare('SELECT * FROM nodes WHERE id = ?');
	const selectNodesOfPlan = db.prepare('SELECT * FROM nodes WHERE plan_id = ? ORDER BY id');
	const selectNodesOfParent = db.prepare('SELECT * FROM nodes WHERE parent_session = ? ORDER BY id');
	const selectAllNodes = db.prepare('SELECT * FROM nodes ORDER BY id');
	const selectAllPlans = db.prepare('SELECT * FROM plans ORDER BY id');
	const selectSuspendedChildren = db.prepare(
		"SELECT * FROM nodes WHERE parent_session = ? AND status IN ('input-required', 'auth-required') ORDER BY id",
	);
	const selectPlansOfTemplate = db.prepare('SELECT * FROM plans WHERE template = ? ORDER BY id');
	const selectFailedNodesOfTemplate = db.prepare(
		"SELECT n.* FROM nodes n JOIN plans p ON p.id = n.plan_id WHERE p.template = ? AND n.status = 'failed' ORDER BY n.id",
	);
	const selectFailure = db.prepare('SELECT * FROM template_failures WHERE template = ?');
	const upsertFailure = db.prepare(`
		INSERT INTO template_failures(template, template_label, failed, last_reviewed_at, updated_at)
		VALUES (?, ?, ?, ?, ?)
		ON CONFLICT(template) DO UPDATE SET
			template_label=COALESCE(excluded.template_label, template_failures.template_label),
			failed=excluded.failed, last_reviewed_at=excluded.last_reviewed_at, updated_at=excluded.updated_at
	`);
	const selectAllRecords = db.prepare('SELECT session_id, seq, line FROM records ORDER BY rowid');
	const selectRecordsOf = db.prepare('SELECT session_id, seq, line FROM records ORDER BY session_id, seq');
	const countRecords = db.prepare('SELECT COUNT(*) AS n FROM records');
	const countMaterialized = db.prepare('SELECT COUNT(*) AS n FROM nodes');

	const now = () => Date.now();

	const writePlan = (row) => {
		upsertPlanRow.run(
			String(row.id),
			str(row.status),
			str(row.type ?? 'plan'),
			str(row.layer ?? null),
			str(row.template ?? null),
			str(row.template_label ?? null),
			str(row.title ?? null),
			row.adopted === true || row.adopted === 1 ? 1 : 0,
			row.rejected === true || row.rejected === 1 ? 1 : 0,
			row.shelved === true || row.shelved === 1 ? 1 : 0,
			num(row.status_seq, -1),
			num(row.updated_at, now()),
		);
	};

	const writeNode = (row) => {
		upsertNodeRow.run(
			String(row.id),
			str(row.parent_session),
			str(row.child_id),
			str(row.plan_id),
			str(row.type),
			str(row.layer ?? null),
			str(row.template ?? null),
			str(row.topic ?? null),
			String(row.status),
			num(row.status_seq, -1),
			num(row.updated_at, now()),
		);
	};

	/** 按计划 id 重新推导计划状态（节点事实优先），并写回物化表。 */
	const recomputePlan = (planId) => {
		if (planId === undefined || planId === null) return undefined;
		const row = selectPlan.get(String(planId));
		if (row === undefined) return undefined;
		const nodes = selectNodesOfPlan.all(String(planId));
		const derived = statusOf(row, nodes);
		if (derived !== row.status) updatePlanStatus.run(str(derived), now(), row.id);
		return derived;
	};

	/**
	 * 把一条记录物化进 plans / nodes / template_failures。幂等：同一条记录重放两次结果一样。
	 *
	 * @param sessionId - 记录所属会话（写日志的那一方）。
	 * @param seq - 记录在会话日志里的序号。
	 * @param record - `{op, ...data}`。
	 * @returns 与失败计数有关的信息（供上层决定要不要建复盘任务）。
	 */
	const applyRecord = (sessionId, seq, record) => {
		if (record === null || typeof record !== 'object') return undefined;
		const op = record.op;
		if (!MATERIALIZED.has(op)) return undefined;
		const data = record;
		// 没有 id 的记录（老测试与被截断的行）不物化：宁可少一行缓存，也不能造出 id 为
		// "undefined" 的假节点。cancel-dependents 例外：它按 canceled[] 批量改。
		if (op !== 'cancel-dependents' && (typeof data.id !== 'string' || data.id === '')) return { op };

		if (op === 'plan') {
			const template = templateKey(data);
			writePlan({
				id: data.id,
				status: null,
				type: data.type ?? 'plan',
				layer: data.layer ?? null,
				template,
				template_label: templateLabel(data),
				title: data.title ?? null,
				status_seq: seq,
			});
			// 复盘任务自带刻度：建它的那一刻，该模板的失败数记为"已复盘"。
			if (data.type === REVIEW_TYPE && template !== '(default)') {
				const current = selectFailure.get(template);
				const at = num(data.reviewAt, num(current?.failed, 0));
				upsertFailure.run(template, current?.template_label ?? templateLabel(data), num(current?.failed, 0), at, now());
			}
			return { op, planId: data.id, template };
		}

		if (op === 'adopt' || op === 'reject-draft' || op === 'shelve-draft' || op === 'status') {
			const plan = selectPlan.get(String(data.id));
			const node = selectNode.get(String(data.id));
			const patch = planPatchAfter(op, data);
			// status op 可能指向节点（子任务），也可能指向计划：先看节点在不在。
			if (node !== undefined && (op === 'status' || patch === undefined)) {
				const to = nodeStatusAfter(op, data, node.status);
				if (to !== undefined) {
					writeNode({ ...node, status: to, status_seq: seq });
					recomputePlan(node.plan_id);
				}
				return { op, nodeId: node.id, planId: node.plan_id };
			}
			if (plan !== undefined && patch !== undefined) {
				writePlan({ ...plan, ...patch, status_seq: seq });
				return { op, planId: plan.id, template: plan.template };
			}
			return { op };
		}

		if (op === 'dispatch') {
			const plan = selectPlan.get(String(data.planId ?? ''));
			writeNode({
				id: data.id,
				parent_session: data.parentSession ?? sessionId,
				child_id: data.childId ?? null,
				plan_id: data.planId ?? null,
				type: data.type ?? plan?.type ?? 'plan',
				layer: data.layer ?? plan?.layer ?? null,
				template: plan?.template ?? null,
				topic: data.topic ?? null,
				status: STATUS.WORKING,
				status_seq: seq,
			});
			recomputePlan(data.planId);
			return { op, nodeId: data.id, planId: data.planId };
		}

		if (op === 'link') {
			const node = selectNode.get(String(data.id));
			if (node === undefined || typeof data.childId !== 'string') return { op };
			writeNode({ ...node, child_id: data.childId });
			return { op, nodeId: node.id, planId: node.plan_id };
		}

		if (op === 'file') {
			const node = selectNode.get(String(data.id));
			if (node === undefined) return { op };
			const to = nodeStatusAfter('file', data, node.status) ?? node.status;
			writeNode({ ...node, status: to, status_seq: seq });
			let failure;
			// 只有"模板造出来的计划节点"才进模板失败计数；研究/复盘节点没有模板。
			if (to === STATUS.FAILED && node.type === 'plan' && node.template) {
				const current = selectFailure.get(node.template);
				const failed = num(current?.failed, 0) + 1;
				upsertFailure.run(
					node.template,
					current?.template_label ?? null,
					failed,
					num(current?.last_reviewed_at, 0),
					now(),
				);
				failure = {
					template: node.template,
					label: current?.template_label ?? null,
					failed,
					lastReviewedAt: num(current?.last_reviewed_at, 0),
					every: REVIEW_EVERY,
				};
			}
			recomputePlan(node.plan_id);
			return { op, nodeId: node.id, planId: node.plan_id, status: to, failure };
		}

		if (op === 'cancel-dependents') {
			const canceled = Array.isArray(data.canceled) ? data.canceled.map(String) : [];
			const affected = new Set();
			for (const id of canceled) {
				const node = selectNode.get(id);
				if (node === undefined) continue;
				if (nodeStatusAfter('cancel-dependents', data, node.status) === undefined) continue;
				writeNode({ ...node, status: STATUS.CANCELED, status_seq: seq });
				if (node.plan_id) affected.add(node.plan_id);
			}
			for (const planId of affected) recomputePlan(planId);
			return { op, canceled, planIds: [...affected] };
		}

		return { op };
	};

	/** 从 records 全量重放，重建三张物化表。幂等，任何时刻都能跑。 */
	const rebuild = () => {
		db.exec('DELETE FROM plans');
		db.exec('DELETE FROM nodes');
		db.exec('DELETE FROM template_failures');
		let replayed = 0;
		for (const row of selectAllRecords.all()) {
			let parsed;
			try {
				parsed = JSON.parse(row.line);
			} catch {
				continue; // 坏的记录行不阻塞整棵树；日志本身仍是权威。
			}
			try {
				applyRecord(row.session_id, row.seq, parsed);
				replayed += 1;
			} catch {
				// 单条记录物化失败（老形状/缺字段）不该让整棵树打不开：跳过它，其余照建。
				continue;
			}
		}
		return replayed;
	};

	// ---- 迁移与启动自检 ----
	const readMeta = (key) => db.prepare('SELECT value FROM meta WHERE key = ?').get(key)?.value;
	const formatVersion = num(readMeta('format_version'), 1);
	const recordCount = num(countRecords.get()?.n, 0);
	const materialized = num(countMaterialized.get()?.n, 0);
	// v2 → v3：只加表，records 一条不动；物化表由记录重放灌满。
	// 同时覆盖"缓存被删 / 库从别处拷来只有 records"：空缓存 + 有记录 → 重建。
	if (formatVersion < FORMAT_VERSION || (materialized === 0 && recordCount > 0)) {
		rebuild();
		db.prepare('INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)').run('format_version', String(FORMAT_VERSION));
		// 迁移过的库，说明也换成当前版：旧 about 讲的是上一版的口径（v2 讲的是"两张表"）。
		db.prepare('UPDATE meta SET value = ? WHERE key = ?').run(ABOUT, 'about');
	}
	db.exec(`PRAGMA user_version = ${FORMAT_VERSION}`);

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
	const selectReviewIds = db.prepare("SELECT id FROM plans WHERE type = 'review'");

	return {
		path,
		db,
		FORMAT_VERSION,

		/** 登记一个树节点。重复登记不覆盖已有的行。 */
		registerSession(id, { parent = null, atSeq = 0, planId = null } = {}) {
			insertSession.run(String(id), parent, Number(atSeq) || 0, planId, Date.now());
		},

		/** 追加一条提案记录（只要 records，不物化——重建与旧调用方用）。 */
		appendRecord(sessionId, seq, line) {
			insertRecord.run(String(sessionId), Number(seq), String(line));
		},

		/**
		 * 一条记录的全部落盘：进 records + 物化九态。events.append 调它。
		 * @returns applyRecord 的结果（失败计数等），给复盘触发用。
		 */
		record(sessionId, seq, rawLine) {
			insertRecord.run(String(sessionId), Number(seq), String(rawLine));
			let parsed;
			try {
				parsed = JSON.parse(rawLine);
			} catch {
				return undefined;
			}
			return applyRecord(sessionId, seq, parsed);
		},

		/** 物化一条已解析的记录（rebuild 与 record 共用）。 */
		apply: applyRecord,

		/** 从 records 全量重放重建物化表。 */
		rebuild,

		/** 九态查询：节点一行。 */
		node(id) {
			return selectNode.get(String(id));
		},

		/** 九态查询：计划 + 它派过的节点（节点状态已是最新）。 */
		plan(id) {
			const row = selectPlan.get(String(id));
			if (row === undefined) return undefined;
			return { ...row, nodes: selectNodesOfPlan.all(String(id)) };
		},

		/** 某个父会话下所有节点（含已结算的）。 */
		childrenOf(parentSessionId) {
			return selectNodesOfParent.all(String(parentSessionId));
		},

		/** 整棵树的所有节点（plan_tree 的"树库优先"读路径用）。 */
		allNodes() {
			return selectAllNodes.all();
		},

		/** 整棵树的所有计划（计划段也树库优先：plan_status 显式写的完成/失败立刻可见）。 */
		allPlans() {
			return selectAllPlans.all();
		},

		/** 父交付时要自动取消的那批：挂起中的直接子任务（input-required / auth-required）。 */
		suspendedChildren(parentSessionId) {
			return selectSuspendedChildren.all(String(parentSessionId));
		},

		/** 一份模板的累计失败与复盘刻度。 */
		failures(template) {
			const key = String(template ?? '');
			const row = selectFailure.get(key);
			return row === undefined
				? { template: key, template_label: null, failed: 0, last_reviewed_at: 0 }
				: row;
		},

		/** 某模板的复盘任务（F 系列）。 */
		reviewsOf(template) {
			return selectPlansByTemplate.all(String(template ?? '')).filter((row) => row.type === REVIEW_TYPE);
		},

		/** 某模板造出来的全部计划（含已结算的），用来汇总失败节点的坑。 */
		plansOfTemplate(template) {
			return selectPlansOfTemplate.all(String(template ?? ''));
		},

		/** 某模板下已失败的节点（复盘正文用）。 */
		failedNodesOfTemplate(template) {
			return selectFailedNodesOfTemplate.all(String(template ?? ''));
		},

		/** 下一个复盘任务 id：F1、F2…（与 p 系列互不占用）。 */
		nextReviewId() {
			let max = 0;
			for (const row of selectReviewIds.all()) {
				const match = /^F(\d+)$/u.exec(String(row.id));
				if (match !== null) max = Math.max(max, Number(match[1]));
			}
			return `F${max + 1}`;
		},

		/**
		 * 从叶子往上取链，根在最前。这是关系，不含内容。
		 * @returns `[{ id, at_seq, depth }]`，`depth` 0 = 叶子。
		 */
		chain(leafId) {
			return selectChain.all(String(leafId));
		},

		/**
		 * 取几个会话的提案记录，按会话与序号排。
		 *
		 * 视图该传什么由调用方定：一个会话的视图传它自己的祖先链（`chain()` 的 id），
		 * 于是"往下继承、往上不聚合"这条边界由传参决定，而不是由库里存了什么决定。
		 * @param sessionIds - 要读的会话 id。
		 * @returns `[{ session_id, seq, line }]`。
		 */
		records(sessionIds) {
			const wanted = new Set((sessionIds ?? []).map(String));
			if (wanted.size === 0) return [];
			return selectRecordsOf.all().filter((row) => wanted.has(String(row.session_id)));
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
