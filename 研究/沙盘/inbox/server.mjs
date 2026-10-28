/**
 * 收件箱的服务（独立进程、独立端口）。
 *
 * ## 为什么单独一个服务
 *
 * 用户原话：
 *
 *   > 既然分区了那为什么还是同一个端口
 *
 * 一个端口 = 一个进程 = 一次改坏就两边都起不来。
 * 真正隔离要三个维度都分开：
 *
 *   目录   inbox/ vs work/
 *   进程   两个 node server.mjs
 *   端口   52311 vs 52312
 *
 * 这样我改 work 的服务代码，不会影响收件箱；收件箱服务挂了，
 * 工作区照常跑。
 *
 * ## 这个服务只管一件事
 *
 * 让用户派活，并把内容落盘给 AI 读。
 * 不生成页面（页面由 build.mjs 产出静态 HTML）。
 *
 * 用法：node server.mjs [port]
 */
import { createServer } from 'node:http';
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.argv[2] ?? 52311);

const PAGE = join(HERE, '收件箱.html');
const ITEMS = join(HERE, '收件箱.json');
const DRAFT = join(HERE, '收件箱-草稿.md');
const LOG = join(HERE, '收件箱-提交记录.jsonl');

/**
 * 读 JSON；不存在或坏了返回兜底值。
 *
 * @param {string} path
 * @param {unknown} fallback
 * @returns {Promise<unknown>}
 */
async function readJson(path, fallback) {
	try {
		const text = await readFile(path, 'utf8');
		return text.trim() === '' ? fallback : JSON.parse(text);
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
	return text.trim() === '' ? null : JSON.parse(text);
}

/**
 * 回 JSON。
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

const server = createServer(async (request, response) => {
	const url = new URL(request.url ?? '/', `http://127.0.0.1:${PORT}`);
	const path = url.pathname;

	try {
		/* ── 页面 ── */
		if (request.method === 'GET' && (path === '/' || path === '/index.html')) {
			let body;
			try {
				body = await readFile(PAGE, 'utf8');
			} catch {
				response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
				response.end('收件箱.html 不存在。先跑 node build.mjs。');
				return;
			}
			response.writeHead(200, {
				'content-type': 'text/html; charset=utf-8',
				'content-length': Buffer.byteLength(body),
				'cache-control': 'no-store',
			});
			response.end(body);
			return;
		}

		/* ── 条目 ── */
		if (path === '/api/inbox') {
			if (request.method === 'GET') {
				sendJson(response, 200, { items: await readJson(ITEMS, []), savedAt: await mtime(ITEMS) });
				return;
			}
			if (request.method === 'POST') {
				const payload = await readBody(request);
				const items = Array.isArray(payload) ? payload : payload?.items;
				if (!Array.isArray(items)) {
					sendJson(response, 400, { error: '需要数组（items）' });
					return;
				}
				await writeFile(ITEMS, JSON.stringify(items, null, 1), 'utf8');
				/* 每次保存追加一条，AI 据此判断「这次是不是新提交」 */
				await appendFile(
					LOG,
					JSON.stringify({ at: new Date().toISOString(), count: items.length }) + '\n',
					'utf8',
				);
				sendJson(response, 200, { ok: true, count: items.length });
				return;
			}
		}

		/* ── 自由文本 ── */
		if (path === '/api/inbox/draft') {
			if (request.method === 'GET') {
				let text = '';
				try { text = await readFile(DRAFT, 'utf8'); } catch { text = ''; }
				sendJson(response, 200, { text });
				return;
			}
			if (request.method === 'POST') {
				const payload = await readBody(request);
				const text = String(payload?.text ?? '');
				await writeFile(DRAFT, text, 'utf8');
				sendJson(response, 200, { ok: true, length: text.length });
				return;
			}
		}

		/* ── 健康检查 ── */
		if (path === '/api/ping') {
			/* page 用于页面自检版本 —— 服务端 HTML 变了就自动刷新 */
			sendJson(response, 200, {
				ok: true,
				port: PORT,
				items: await mtime(ITEMS),
				page: await mtime(PAGE)
			});
			return;
		}

		response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
		response.end('没有这个地址：' + path);
	} catch (error) {
		sendJson(response, 500, { error: String((error && error.message) || error) });
	}
});

server.listen(PORT, '127.0.0.1', () => {
	process.stdout.write('收件箱服务已就绪\n');
	process.stdout.write(`  http://127.0.0.1:${PORT}/\n`);
	process.stdout.write(`  数据 ${ITEMS}\n`);
});
