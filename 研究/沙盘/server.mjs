/**
 * 沙盘服务 —— 两份 HTML 的落盘层。
 *
 * ## 为什么不是纯 localStorage
 *
 * 用户要的是「我写，你读」：他往收件箱里写，我要能读到。
 * localStorage 只活在浏览器里，我读不到；下载文件又要他多点几次。
 * 所以起一个极小的 HTTP 服务，页面直接 POST，服务端写文件。
 *
 * ## 两个页面，两份数据
 *
 *   收件箱（用户 → 我）  POST /api/inbox      → 收件箱.json
 *   工作区（我改版）      POST /api/work       → 工作区.json
 *
 * 收件箱每次保存还会往 `收件箱-提交记录.jsonl` 追加一条带时间戳的快照，
 * 这样我能看出"哪次是新提交的"，而不是每次都重读同一份。
 *
 * ## 不开监听在 0.0.0.0
 *
 * 只绑 127.0.0.1 —— 这是本机沙盘，没有理由暴露到局域网。
 *
 * 用法：node server.mjs [port]
 */
import { createServer } from 'node:http';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.argv[2] ?? 52310);

/* ── 静态文件 ── */
const STATIC = {
	'/': { file: '收件箱.html', type: 'text/html; charset=utf-8' },
	'/inbox': { file: '收件箱.html', type: 'text/html; charset=utf-8' },
	'/work': { file: '工作区.html', type: 'text/html; charset=utf-8' },
};

/* ── 数据文件 ── */
const INBOX = join(HERE, '收件箱.json');
const WORK = join(HERE, '工作区.json');
const INBOX_LOG = join(HERE, '收件箱-提交记录.jsonl');
const INBOX_DRAFT = join(HERE, '收件箱-草稿.md');
const WORK_DRAFT = join(HERE, '工作区-笔记.md');

/** 空数据（第一次打开时用）。 */
const EMPTY = [];

/**
 * 读一个 JSON 数据文件；不存在或坏了就返回兜底值。
 *
 * @param {string} path
 * @param {unknown} fallback
 * @returns {Promise<unknown>}
 */
async function readJson(path, fallback) {
	try {
		const text = await readFile(path, 'utf8');
		if (text.trim() === '') return fallback;
		return JSON.parse(text);
	} catch {
		return fallback;
	}
}

/**
 * 读请求体。
 *
 * @param {import('node:http').IncomingMessage} request
 * @returns {Promise<unknown>}
 */
async function readBody(request) {
	const chunks = [];
	for await (const chunk of request) chunks.push(chunk);
	const text = Buffer.concat(chunks).toString('utf8');
	if (text.trim() === '') return null;
	return JSON.parse(text);
}

/**
 * 统一回 JSON。
 *
 * @param {import('node:http').ServerResponse} response
 * @param {number} status
 * @param {unknown} payload
 */
function sendJson(response, status, payload) {
	const text = JSON.stringify(payload);
	response.writeHead(status, {
		'content-type': 'application/json; charset=utf-8',
		'content-length': Buffer.byteLength(text),
		'cache-control': 'no-store',
	});
	response.end(text);
}

const server = createServer(async (request, response) => {
	const url = new URL(request.url ?? '/', `http://127.0.0.1:${PORT}`);
	const path = url.pathname;

	try {
		/* ── 静态页 ── */
		if (request.method === 'GET' && STATIC[path] !== undefined) {
			const entry = STATIC[path];
			const body = await readFile(join(HERE, entry.file), 'utf8');
			response.writeHead(200, {
				'content-type': entry.type,
				'content-length': Buffer.byteLength(body),
				'cache-control': 'no-store',
			});
			response.end(body);
			return;
		}

		/* ── 收件箱 ── */
		if (path === '/api/inbox') {
			if (request.method === 'GET') {
				sendJson(response, 200, { items: await readJson(INBOX, EMPTY), savedAt: await mtime(INBOX) });
				return;
			}
			if (request.method === 'POST') {
				const payload = await readBody(request);
				const items = Array.isArray(payload) ? payload : payload?.items;
				if (!Array.isArray(items)) {
					sendJson(response, 400, { error: '需要数组（items）' });
					return;
				}
				await writeFile(INBOX, JSON.stringify(items, null, 1), 'utf8');
				/* 每次保存追加一条，我据此判断"这次是不是新提交"。 */
				await appendFile(
					INBOX_LOG,
					JSON.stringify({ at: new Date().toISOString(), count: items.length, items }) + '\n',
					'utf8',
				);
				sendJson(response, 200, { ok: true, count: items.length });
				return;
			}
		}

		/* ── 收件箱的自由文本草稿（纯文本，直接写成 .md） ── */
		if (path === '/api/inbox/draft') {
			if (request.method === 'GET') {
				let text = '';
				try { text = await readFile(INBOX_DRAFT, 'utf8'); } catch { text = ''; }
				sendJson(response, 200, { text });
				return;
			}
			if (request.method === 'POST') {
				const payload = await readBody(request);
				const text = String(payload?.text ?? '');
				await writeFile(INBOX_DRAFT, text, 'utf8');
				sendJson(response, 200, { ok: true, length: text.length });
				return;
			}
		}

		/* ── 工作区 ── */
		if (path === '/api/work') {
			if (request.method === 'GET') {
				sendJson(response, 200, { items: await readJson(WORK, EMPTY), savedAt: await mtime(WORK) });
				return;
			}
			if (request.method === 'POST') {
				const payload = await readBody(request);
				const items = Array.isArray(payload) ? payload : payload?.items;
				if (!Array.isArray(items)) {
					sendJson(response, 400, { error: '需要数组（items）' });
					return;
				}
				await writeFile(WORK, JSON.stringify(items, null, 1), 'utf8');
				sendJson(response, 200, { ok: true, count: items.length });
				return;
			}
		}

		/* ── 工作区的自由文本（我记改版笔记用） ── */
		if (path === '/api/work/draft') {
			if (request.method === 'GET') {
				let text = '';
				try { text = await readFile(WORK_DRAFT, 'utf8'); } catch { text = ''; }
				sendJson(response, 200, { text });
				return;
			}
			if (request.method === 'POST') {
				const payload = await readBody(request);
				const text = String(payload?.text ?? '');
				await writeFile(WORK_DRAFT, text, 'utf8');
				sendJson(response, 200, { ok: true, length: text.length });
				return;
			}
		}

		/* ── 健康检查（我用来确认服务活着） ── */
		if (path === '/api/ping') {
			sendJson(response, 200, { ok: true, inbox: await mtime(INBOX), work: await mtime(WORK) });
			return;
		}

		response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
		response.end('没有这个地址：' + path);
	} catch (error) {
		sendJson(response, 500, { error: String((error && error.message) || error) });
	}
});

/**
 * 文件最后修改时间（毫秒）；不存在返回 0。
 *
 * @param {string} path
 * @returns {Promise<number>}
 */
async function mtime(path) {
	try {
		const { stat } = await import('node:fs/promises');
		return (await stat(path)).mtimeMs;
	} catch {
		return 0;
	}
}

await mkdir(HERE, { recursive: true });
server.listen(PORT, '127.0.0.1', () => {
	process.stdout.write(`沙盘服务已就绪\n`);
	process.stdout.write(`  收件箱  http://127.0.0.1:${PORT}/\n`);
	process.stdout.write(`  工作区  http://127.0.0.1:${PORT}/work\n`);
	process.stdout.write(`  收件箱数据  ${INBOX}\n`);
	process.stdout.write(`  工作区数据  ${WORK}\n`);
});
