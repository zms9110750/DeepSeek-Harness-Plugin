#!/usr/bin/env node
/**
 * 把一个 sqlite 库导出成单文件 HTML，直接双击就能看。
 *
 *   node db-view.cjs <db 路径> [--limit 500]
 *
 * 会做的事：
 *   1. 列出所有表、列、行数；
 *   2. 每张表的行（可展开看原文）；
 *   3. 认得出两种形状时额外画出来：
 *      · tasks + t_*        → 任务树（fork_at 是切口，显示每张表存了哪一段）
 *      · sessions + events  → 会话链（parent / at_seq）
 */
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const dbPath = process.argv[2];
if (!dbPath) {
	console.error('用法：node db-view.cjs <db 路径> [--limit 500]');
	process.exit(1);
}
const limitArg = process.argv.indexOf('--limit');
const LIMIT = limitArg > 0 ? Number(process.argv[limitArg + 1]) : 500;

const db = new DatabaseSync(dbPath);
const objects = db.prepare("SELECT type, name, sql FROM sqlite_master WHERE type IN ('table','view','index') ORDER BY type = 'index', name").all();
const tables = objects.filter((object) => object.type === 'table');

function esc(value) {
	return String(value).replace(/[&<>"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[character]);
}

function tableInfo(name) {
	return db.prepare(`PRAGMA table_info("${name}")`).all();
}

function rowCount(name) {
	return db.prepare(`SELECT COUNT(*) AS n FROM "${name}"`).get().n;
}

function rows(name, limit = LIMIT) {
	return db.prepare(`SELECT * FROM "${name}" LIMIT ${limit}`).all();
}

/** 任务树：tasks + 一张 events 表；拼好的日志来自 v_log 视图。 */
function renderTasks() {
	const tasks = db.prepare('SELECT * FROM tasks ORDER BY created_at').all();
	if (tasks.length === 0) return '';
	const byParent = new Map();
	for (const task of tasks) {
		const key = task.parent ?? '';
		if (!byParent.has(key)) byParent.set(key, []);
		byParent.get(key).push(task);
	}
	const hasLogView = objects.some((object) => object.type === 'view' && object.name === 'v_log');
	const brief = (line) => {
		try {
			const event = JSON.parse(line);
			return `${event.type ?? '?'}  ${JSON.stringify(event.data ?? {}).slice(0, 160)}`;
		} catch {
			return line;
		}
	};
	const rowsHtml = (items, withSource) =>
		items
			.slice(0, 200)
			.map((row) => `<tr><td class="seq">${row.seq}</td>${withSource ? `<td class="src">${esc(row.src ?? '')}</td>` : ''}<td><code>${esc(brief(row.line))}</code></td></tr>`)
			.join('');
	const renderNode = (task, depth) => {
		const own = db.prepare('SELECT seq, line FROM events WHERE session_id = ? AND seq >= ? ORDER BY seq').all(task.session_id, task.fork_at);
		const merged = hasLogView ? db.prepare('SELECT seq, line FROM v_log WHERE task_id = ? ORDER BY seq').all(task.id) : [];
		const children = byParent.get(task.id) ?? [];
		return `
		<div class="node" style="margin-left:${depth * 28}px">
			<div class="card">
				<div class="title">${esc(task.title ?? task.id)}</div>
				<div class="meta">
					任务 <b>${esc(task.id)}</b> · 会话 ${esc(task.session_id)} · 计划 ${esc(task.plan_id ?? '—')}
				</div>
				<div class="meta">
					fork_at <b>${task.fork_at}</b> · 自己存了 <b>${own.length}</b> 行
					${task.view_name ? ` · 视图 <code>${esc(task.view_name)}</code>` : ''}
					${task.fork_at > 0 ? `<span class="badge">前 ${task.fork_at} 行引用父任务</span>` : ''}
					${merged.length > 0 ? `· 拼起来共 <b>${merged.length}</b> 行` : ''}
				</div>
				${own.length > 0 ? `<details><summary>自己存的 ${own.length} 行</summary><table class="rows"><thead><tr><th>seq</th><th>行内容</th></tr></thead><tbody>${rowsHtml(own)}</tbody></table></details>` : ''}
				${merged.length > 0 ? `<details><summary>拼好的完整日志 ${merged.length} 行（v_log）</summary><table class="rows"><thead><tr><th>seq</th><th>行内容</th></tr></thead><tbody>${rowsHtml(merged)}</tbody></table></details>` : ''}
			</div>
			${children.map((child) => renderNode(child, depth + 1)).join('')}
		</div>`;
	};
	const roots = byParent.get('') ?? [];
	return `<section><h2>任务树</h2><p class="hint">fork_at 是切口：这个值之前的行在父任务里，不在自己的行里；v_log 已经把两边拼好。</p>${roots.map((root) => renderNode(root, 0)).join('')}</section>`;
}

/** 会话链：sessions(id,parent,at_seq) + events(session_id,seq,line)。 */
function renderChain() {
	const sessions = db.prepare('SELECT * FROM sessions').all();
	if (sessions.length === 0) return '';
	const bytes = sessions.map((session) => {
		const count = db.prepare('SELECT COUNT(*) AS n FROM events WHERE session_id = ?').get(session.id).n;
		const first = db.prepare('SELECT MIN(seq) AS s FROM events WHERE session_id = ?').get(session.id).s;
		const last = db.prepare('SELECT MAX(seq) AS s FROM events WHERE session_id = ?').get(session.id).s;
		const sample = db.prepare('SELECT seq, line FROM events WHERE session_id = ? ORDER BY seq LIMIT 50').all(session.id);
		return { session, count, first, last, sample };
	});
	return `<section><h2>会话链</h2><p class="hint">at_seq = 从父会话的第几条接上。</p>
	<table class="grid"><thead><tr><th>会话</th><th>父</th><th>at_seq</th><th>计划</th><th>事件数</th><th>seq 范围</th></tr></thead><tbody>
	${bytes.map(({ session, count, first, last }) => `<tr><td>${esc(session.id)}</td><td>${esc(session.parent ?? '—')}</td><td>${session.at_seq ?? '—'}</td><td>${esc(session.plan_id ?? '—')}</td><td>${count}</td><td>${first ?? '—'}..${last ?? '—'}</td></tr>`).join('')}
	</tbody></table>
	${bytes.map(({ session, sample }) => `<details><summary>${esc(session.id)} 的前 ${sample.length} 条</summary><table class="rows"><thead><tr><th>seq</th><th>行内容</th></tr></thead><tbody>${sample.map((row) => `<tr><td class="seq">${row.seq}</td><td><code>${esc(row.line)}</code></td></tr>`).join('')}</tbody></table></details>`).join('')}
	</section>`;
}

const tableSections = tables
	.map((table) => {
		const info = tableInfo(table.name);
		const count = rowCount(table.name);
		const data = rows(table.name);
		const head = info.map((column) => `<th>${esc(column.name)}<span class="type">${esc(column.type)}</span></th>`).join('');
		const body = data
			.map((row) => {
				const cells = info
					.map((column) => {
						const value = row[column.name];
						const text = value === null || value === undefined ? '' : String(value);
						return `<td>${text.length > 220 ? `<details><summary>${esc(text.slice(0, 220))}…</summary><pre>${esc(text)}</pre></details>` : esc(text)}</td>`;
					})
					.join('');
				return `<tr>${cells}</tr>`;
			})
			.join('');
		return `<section><h2>${esc(table.name)} <span class="count">${count} 行</span></h2>
			<pre class="schema">${esc(table.sql ?? '')}</pre>
			<table class="grid"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
			${count > data.length ? `<p class="hint">只显示前 ${data.length} 行</p>` : ''}
		</section>`;
	})
	.join('');

const viewSections = objects
	.filter((object) => object.type === 'view')
	.map((view) => `<details class="view"><summary>视图 ${esc(view.name)}</summary><pre class="schema">${esc(view.sql ?? '')}</pre></details>`)
	.join('');

const hasTasks = tables.some((table) => table.name === 'tasks');
const hasChain = tables.some((table) => table.name === 'sessions') && tables.some((table) => table.name === 'events');

const html = `<!doctype html>
<html lang="zh"><head><meta charset="utf-8"><title>${esc(path.basename(dbPath))}</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 14px/1.55 system-ui, "Segoe UI", sans-serif; margin: 0; padding: 24px 32px 80px; background: #fafafa; color: #1b1b1b; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  h2 { font-size: 16px; margin: 32px 0 8px; border-bottom: 1px solid #ddd; padding-bottom: 4px; }
  .hint { color: #666; margin: 4px 0 12px; }
  .count { font-weight: normal; color: #888; font-size: 13px; margin-left: 6px; }
  .card { border: 1px solid #ddd; background: #fff; border-radius: 8px; padding: 12px 14px; margin: 10px 0; }
  .title { font-weight: 600; font-size: 15px; }
  .meta { color: #666; font-size: 13px; margin-top: 2px; }
  .badge { display: inline-block; background: #eef3ff; color: #2b5bd7; border-radius: 10px; padding: 1px 8px; font-size: 12px; margin-left: 6px; }
  table { border-collapse: collapse; width: 100%; background: #fff; }
  .grid th, .grid td, .rows th, .rows td { border: 1px solid #e2e2e2; padding: 4px 8px; vertical-align: top; text-align: left; }
  .grid th { background: #f1f3f5; font-size: 12px; }
  .type { display: block; font-weight: normal; color: #999; font-size: 11px; }
  .seq { width: 64px; color: #888; font-variant-numeric: tabular-nums; }
  code, pre { font-family: ui-monospace, Consolas, monospace; font-size: 12px; }
  pre.schema { background: #f5f5f5; padding: 10px; border-radius: 6px; overflow: auto; }
  details > summary { cursor: pointer; color: #2b5bd7; }
  .node { margin-top: 6px; }
  @media (prefers-color-scheme: dark) {
    body { background: #16181c; color: #e6e6e6; }
    .card, table { background: #1e2126; border-color: #333; }
    .grid th, .rows th { background: #252932; }
    .grid th, .grid td, .rows th, .rows td { border-color: #333; }
    pre.schema { background: #20242b; }
    .hint, .meta { color: #9aa0a6; }
    h2 { border-color: #333; }
    .badge { background: #1c2b4d; color: #9ec0ff; }
  }
</style></head>
<body>
  <h1>${esc(path.basename(dbPath))}</h1>
  <p class="hint">${esc(path.resolve(dbPath))} · ${tables.length} 张表 · 生成于 ${new Date().toLocaleString('zh-CN')}</p>
  ${hasTasks ? renderTasks() : ''}
  ${hasChain ? renderChain() : ''}
  ${tableSections}
  ${viewSections ? `<section><h2>视图</h2>${viewSections}</section>` : ''}
</body></html>`;

const out = path.join(path.dirname(path.resolve(dbPath)), `${path.basename(dbPath, path.extname(dbPath))}.html`);
fs.writeFileSync(out, html, 'utf8');
db.close();
console.log(out);
