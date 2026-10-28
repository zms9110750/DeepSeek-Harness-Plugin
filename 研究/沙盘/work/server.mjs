/**
 * 工作区的服务（独立进程、独立端口）。
 *
 * ## 和收件箱的服务完全无关
 *
 *   inbox/server.mjs   端口 52311，读 inbox/ 下的文件
 *   work/server.mjs    端口 52312，读 work/ 下的文件
 *
 * 两份代码不共享任何东西。我改这里不会影响收件箱；
 * 这里挂了收件箱照常跑。
 *
 * 用法：node server.mjs [port]
 */
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.argv[2] ?? 52312);

const PAGE = join(HERE, '工作区.html');
const ITEMS = join(HERE, '工作区.json');
const NOTE = join(HERE, '工作区-笔记.md');

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
				response.end('工作区.html 不存在。先跑 node build.mjs。');
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
		if (path === '/api/work') {
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
				sendJson(response, 200, { ok: true, count: items.length });
				return;
			}
		}

		/* ── 改版笔记 ── */
		if (path === '/api/work/draft') {
			if (request.method === 'GET') {
				let text = '';
				try { text = await readFile(NOTE, 'utf8'); } catch { text = ''; }
				sendJson(response, 200, { text });
				return;
			}
			if (request.method === 'POST') {
				const payload = await readBody(request);
				const text = String(payload?.text ?? '');
				await writeFile(NOTE, text, 'utf8');
				sendJson(response, 200, { ok: true, length: text.length });
				return;
			}
		}

		/* ── 健康检查 ── */
		if (path === '/api/ping') {
			/*
			 * page 是 工作区.html 的修改时间。
			 *
			 * 页面自己轮询这个值 —— 一旦发现服务端的 HTML 比自己新，
			 * 就提示「有新版本」并自动重载。
			 *
			 * 用户原话：
			 *   > 我关闭标签复制网址以后好了。ctrlf5并不成功。
			 *
			 * Ctrl+F5 对本地 127.0.0.1 页面不可靠（Edge 会跳过强制刷新
			 * 某些情况下）。与其让用户记着关标签，不如让页面自己发现。
			 */
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
	process.stdout.write('工作区服务已就绪\n');
	process.stdout.write(`  http://127.0.0.1:${PORT}/\n`);
	process.stdout.write(`  数据 ${ITEMS}\n`);
});
