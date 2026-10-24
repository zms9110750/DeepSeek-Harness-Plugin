#!/usr/bin/env node
/**
 * 树上下文库 · 探针（一张表存日志 + 视图拼日志）
 *
 *   node store.cjs init
 *   node store.cjs import <session-id|jsonl 路径> [--task ID] [--plan ID] [--limit N]
 *   node store.cjs import-current [--limit N]
 *   node store.cjs tree                 # 结构视图 v_tree
 *   node store.cjs log <task-id>        # 拼好的日志视图 v_log
 *   node store.cjs verify <task-id>     # 拼好的日志 vs 原始 jsonl 逐行比对
 *   node store.cjs stats
 */
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = path.join(__dirname, 'tasks.db');
const SCHEMA = path.join(__dirname, 'schema.sql');
const SESSIONS_ROOT = path.join(process.env.DSH_HOME ?? 'C:/Users/16229/.dsh', 'sessions');
const ZSTD_MAGIC = [0x28, 0xb5, 0x2f, 0xfd];

function args(argv) {
	const [command, ...rest] = argv.slice(2);
	const positional = [];
	const flags = {};
	for (let i = 0; i < rest.length; i++) {
		if (rest[i].startsWith('--')) flags[rest[i].slice(2)] = rest[++i] ?? true;
		else positional.push(rest[i]);
	}
	return { command, positional, flags };
}

const open = () => new DatabaseSync(DB_PATH);

/** 视图名：s_<任务 id>，非字母数字换成 _（缩进标识符时也会加引号）。 */
function viewName(taskId) {
	return `s_${String(taskId).replace(/[^A-Za-z0-9]/g, '_')}`;
}

/** 给一个任务建视图：它看到的完整日志（自己的行 + 沿父链补的前缀）。 */
function createSessionView(db, taskId) {
	const name = viewName(taskId);
	const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
	const origin =
		task.parent === null
			? `根会话 ${task.session_id}，没有从别处继承`
			: `会话 ${task.session_id}，从任务 ${task.parent} 的第 ${task.fork_at} 条之后接上（前 ${task.fork_at} 行在父任务里）`;
	db.exec(`DROP VIEW IF EXISTS "${name}"`);
	db.exec(`CREATE VIEW "${name}" AS
		-- ${origin}
		WITH RECURSIVE up(node, from_seq, until_seq) AS (
		  SELECT id, fork_at, 9223372036854775807 FROM tasks WHERE id = '${String(taskId).replace(/'/g, "''")}'
		  UNION ALL
		  SELECT p.id, p.fork_at, up.from_seq
		    FROM up JOIN tasks c ON c.id = up.node JOIN tasks p ON p.id = c.parent
		)
		SELECT e.seq AS seq, e.line AS line
		  FROM up JOIN events e ON e.session_id = (SELECT session_id FROM tasks WHERE id = up.node)
		 WHERE e.seq >= up.from_seq AND e.seq < up.until_seq
		 ORDER BY e.seq`);
	return name;
}

function init() {
	const db = open();
	db.exec(fs.readFileSync(SCHEMA, 'utf8').split('\n').filter((line) => !line.trim().startsWith('--')).join('\n'));
	const objects = db.prepare("SELECT type, name FROM sqlite_master WHERE type IN ('table','view') ORDER BY type DESC, name").all();
	db.close();
	console.log(`created ${DB_PATH}`);
	for (const object of objects) console.log(`  ${object.type.padEnd(5)} ${object.name}`);
}

function decompress(file) {
	const buffer = fs.readFileSync(file);
	const starts = [];
	for (let i = 0; i + 3 < buffer.length; i++) {
		if (buffer[i] === ZSTD_MAGIC[0] && buffer[i + 1] === ZSTD_MAGIC[1] && buffer[i + 2] === ZSTD_MAGIC[2] && buffer[i + 3] === ZSTD_MAGIC[3]) starts.push(i);
	}
	const chunks = [];
	for (let i = 0; i < starts.length; i++) chunks.push(zlib.zstdDecompressSync(buffer.subarray(starts[i], i + 1 < starts.length ? starts[i + 1] : buffer.length)));
	return Buffer.concat(chunks).toString('utf8');
}

function resolveLog(target) {
	if (fs.existsSync(target)) return target;
	const candidates = [path.join(SESSIONS_ROOT, target)];
	for (const group of fs.readdirSync(SESSIONS_ROOT, { withFileTypes: true })) if (group.isDirectory()) candidates.push(path.join(SESSIONS_ROOT, group.name, target));
	for (const dir of candidates) {
		if (!fs.existsSync(dir)) continue;
		const file = fs.readdirSync(dir).find((name) => name.startsWith('session') && name.includes('.jsonl'));
		if (file) return path.join(dir, file);
	}
	throw new Error(`找不到会话日志：${target}`);
}

function readLog(target) {
	const file = resolveLog(target);
	const lines = decompress(file).split('\n').filter((line) => line.trim().length > 0);
	return { file, header: JSON.parse(lines[0]), events: lines.slice(1) };
}

function inheritedCut(events) {
	let cut = 0;
	for (const line of events) {
		const event = JSON.parse(line);
		if (event.type === 'session/end-seed' && event.data?.inherited === true) cut = Number(event.seq);
	}
	return cut;
}

function titleOf(events) {
	for (const line of events) {
		const event = JSON.parse(line);
		if (event.type === 'session/title' && typeof event.data?.title === 'string') return event.data.title;
	}
	return null;
}

function importLog(target, flags) {
	const { file, header, events: allEvents } = readLog(target);
	const sessionId = String(header.id);
	const taskId = String(flags.task ?? sessionId);
	const limit = flags.limit === undefined ? undefined : Number(flags.limit);
	const events = limit === undefined ? allEvents : allEvents.slice(0, limit);

	let cut = inheritedCut(allEvents);
	// 引用前提：cut 之前每一行必须逐行等于父会话同一 seq。
	if (cut > 0 && header.parentSession !== undefined) {
		let parentEvents;
		try {
			parentEvents = readLog(header.parentSession).events;
		} catch {
			parentEvents = undefined;
		}
		if (parentEvents !== undefined) {
			for (let i = 0; i < cut; i++) {
				if (allEvents[i] !== parentEvents[i]) {
					console.log(`! 不能按引用：前缀第 ${i} 行与父不一致（子 ${JSON.parse(allEvents[i]).type} / 父 ${parentEvents[i] === undefined ? '(没有)' : JSON.parse(parentEvents[i]).type}）`);
					console.log(`  改为整份存（fork_at=0，前缀 ${cut} 行复制一份）`);
					cut = 0;
					break;
				}
			}
		}
	}

	let parentTask = header.parentSession ?? null;
	if (parentTask !== null) {
		const known = open().prepare('SELECT id FROM tasks WHERE session_id = ?').get(parentTask);
		if (known !== undefined) parentTask = known.id;
	}

	const db = open();
	db.exec('BEGIN');
	db.prepare(
		`INSERT INTO tasks (id, title, body, plan_id, parent, fork_at, session_id, view_name, created_at)
		 VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT(id) DO UPDATE SET title = excluded.title, plan_id = excluded.plan_id, parent = excluded.parent,
		   fork_at = excluded.fork_at, session_id = excluded.session_id, view_name = excluded.view_name`,
	).run(taskId, titleOf(allEvents), flags.plan ?? null, parentTask, cut, sessionId, viewName(taskId), Number(header.createdAt ?? 0));
	db.prepare('DELETE FROM events WHERE session_id = ?').run(sessionId);
	const insert = db.prepare('INSERT INTO events (session_id, seq, line) VALUES (?, ?, ?)');
	let stored = 0;
	for (const line of events) {
		const seq = Number(JSON.parse(line).seq);
		if (seq < cut) continue;
		insert.run(sessionId, seq, line);
		stored++;
	}
	db.exec('COMMIT');
	const createdView = createSessionView(db, taskId);
	db.close();

	console.log(`file     ${file}`);
	console.log(`task     ${taskId}   session ${sessionId}`);
	console.log(`parent   ${parentTask ?? '(根)'}   fork_at=${cut}`);
	console.log(`stored   ${stored} 行${cut > 0 ? `（前 ${cut} 行引用父任务）` : ''}`);
	console.log(`view     ${createdView}`);
}

function tree() {
	const db = open();
	const rows = db.prepare('SELECT * FROM v_archive ORDER BY session').all();
	db.close();
	const byParent = new Map();
	for (const row of rows) {
		const key = row.parent ?? '';
		if (!byParent.has(key)) byParent.set(key, []);
		byParent.get(key).push(row);
	}
	const print = (row, depth) => {
		const indent = '  '.repeat(depth);
		console.log(`${indent}${row.task}${row.title === null ? '' : `  ·  ${row.title}`}`);
		console.log(`${indent}   视图 ${row.view_name}   session=${row.session}  fork_at=${row.fork_at}  自己 ${row.own_rows} 行 / 拼起来 ${row.total_rows} 行`);
		for (const child of byParent.get(row.task) ?? []) print(child, depth + 1);
	};
	for (const root of byParent.get('') ?? []) print(root, 0);
}

/** 目录：一行一个会话，带人话描述——不知情的人看这个就够了。 */
function archive() {
	const db = open();
	const rows = db.prepare('SELECT * FROM v_archive ORDER BY session').all();
	db.close();
	console.log('task | 视图 | 自己存的 / 拼起来 | 说明');
	for (const row of rows) {
		console.log(`${row.task} | ${row.view_name} | ${row.own_rows} / ${row.total_rows} | ${row.description}`);
	}
}

function expanded(taskId) {
	const db = open();
	const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
	if (task === undefined) throw new Error(`没有这个任务：${taskId}`);
	const rows = db.prepare(`SELECT seq, line FROM "${task.view_name}" ORDER BY seq`).all();
	db.close();
	return rows;
}

function verify(taskId) {
	const db = open();
	const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
	db.close();
	if (task === undefined) throw new Error(`没有这个任务：${taskId}`);
	const original = readLog(task.session_id).events;
	const rows = expanded(taskId).map((row) => row.line);
	let mismatches = 0;
	for (let i = 0; i < Math.max(original.length, rows.length); i++) {
		if (original[i] !== rows[i]) {
			mismatches++;
			if (mismatches <= 3) console.log(`!! 第 ${i} 条不一致\n   jsonl : ${String(original[i]).slice(0, 140)}\n   视图  : ${String(rows[i]).slice(0, 140)}`);
		}
	}
	console.log(`compare  ${taskId}`);
	console.log(`  jsonl ${original.length} 条 / v_log ${rows.length} 条`);
	console.log(`  逐行一致: ${mismatches === 0 && original.length === rows.length ? '是' : `否（${mismatches} 处）`}`);
}

const { command, positional, flags } = args(process.argv);
switch (command) {
	case 'init':
		init();
		break;
	case 'import':
		importLog(positional[0], flags);
		break;
	case 'import-current':
		importLog(process.env.DSH_SESSION_ID, flags);
		break;
	case 'tree':
		tree();
		break;
	case 'archive':
		archive();
		break;
	case 'log': {
		const rows = expanded(positional[0]);
		for (const row of rows) {
			const event = JSON.parse(row.line);
			console.log(`${String(row.seq).padStart(5)}  ${String(event.type).padEnd(26)} ${JSON.stringify(event.data ?? {}).slice(0, 120)}`);
		}
		console.log(`共 ${rows.length} 条`);
		break;
	}
	case 'verify':
		verify(positional[0]);
		break;
	case 'stats': {
		const db = open();
		const tasks = db.prepare('SELECT COUNT(*) AS n FROM tasks').get().n;
		const events = db.prepare('SELECT COUNT(*) AS n FROM events').get().n;
		console.log(`db      ${DB_PATH}`);
		console.log(`tasks   ${tasks}`);
		console.log(`events  ${events}`);
		db.close();
		break;
	}
	default:
		console.log('commands: init | import <id|path> [--task ID] [--plan ID] [--limit N] | import-current | tree | log <task> | verify <task> | stats');
}
