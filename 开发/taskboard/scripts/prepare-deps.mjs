/**
 * 准备运行时依赖（开发环境用）。
 *
 * 跑法：
 *
 *   node scripts/prepare-deps.mjs
 *
 * ## 为什么需要这个脚本
 *
 * 这个插件的宿主侧代码会 import 这些包：
 *
 *   @deepseek-ai/dsh-tools        defineTool，注册模型工具用
 *   @deepseek-ai/schemastery      Config schema
 *   @deepseek-ai/cordis           Service 基类
 *   …以及它们的一串传递依赖
 *
 * 这些包**由 DSH 提供**，正常安装的插件不自己带。但开发目录是个独立包，
 * 靠 Node 向上查找会落到哪一份完全取决于机器上装了什么，实测踩过两次：
 *
 *   ① B: 那套 dsh 安装里 schemastery 是 3.18.5、cosmokit 却是 1.8.2，
 *      而 3.18.5 的 ESM 入口第一行就 `import { createVolatile }`，
 *      1.8.2 没有 → 直接 SyntaxError。表现是「工具插件异常」。
 *
 *   ② `@deepseek-ai/dsh-tools` 曾经是指向 B: 的 junction。
 *      往 junction 路径写文件 = 写进链接目标，**污染了 DSH 的安装目录**。
 *
 * 所以这个脚本做两件事：
 *
 *   · 从 **app.asar**（DSH 实际运行的唯一权威来源）抽取依赖到包内 node_modules
 *   · 把同一批放进 profile 的 node_modules，让 DSH 加载插件时也不会落到别处
 *
 * asar 里的组合一定是自洽的（DSH 自己就跑在那上面）。
 *
 * ## 抽取哪些
 *
 * 不是硬编码清单，而是从 dsh-tools + cordis 出发算**依赖闭包**。
 * 这样 DSH 升级、依赖变化时不用改脚本。
 */
import { existsSync, mkdirSync, openSync, readFileSync, readSync, closeSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGIN_DIR = join(HERE, '..');
const ASAR = process.env.DSH_ASAR || 'B:\\DeepSeek Harness\\resources\\app.asar';
const ASAR_DSH = '/dsh/node_modules/@deepseek-ai/';

/* 抽到这两个地方：包内（给 node 解析）+ profile（给 DSH 加载插件时用）。 */
const TARGETS = [
	join(PLUGIN_DIR, 'node_modules', '@deepseek-ai'),
	join(process.env.DSH_HOME ?? join(process.env.USERPROFILE ?? '', '.dsh'), 'profiles', process.env.DSH_PROFILE ?? 'desktop', 'node_modules', '@deepseek-ai'),
];

/* 起点：我们的代码直接 import 的就是这两个。 */
const ROOTS = ['dsh-tools', 'cordis'];

if (!existsSync(ASAR)) {
	console.error(`找不到 ${ASAR}`);
	console.error('DSH 装在其它的地方就设 DSH_ASAR 指向 app.asar。');
	process.exit(1);
}

/* ── 打开 asar：16 字节头 + 变长 JSON 索引 + 数据段 ───────────────────── */

closeSync(openSync(ASAR, 'r'));

const fd = openSync(ASAR, 'r');
const head = Buffer.alloc(16);
readSync(fd, head, 0, 16, 0);
const headerSize = head.readUInt32LE(12);
const headerBuf = Buffer.alloc(headerSize);
readSync(fd, headerBuf, 0, headerSize, 16);
const index = JSON.parse(headerBuf.toString('utf8'));
const dataStart = 16 + headerSize;

/** 摊平索引成 [{path, size, offset}]。 */
function flatten(node, prefix, out) {
	for (const [name, child] of Object.entries(node.files ?? {})) {
		const path = `${prefix}/${name}`;
		if (child.files) flatten(child, path, out);
		else out.push({ path, size: child.size, offset: child.offset });
	}
}
const entries = [];
flatten(index, '', entries);

/** 读 asar 里的一个文件（文本）。 */
function readAsarText(path) {
	const hit = entries.find((entry) => entry.path === path);
	if (hit === undefined) return undefined;
	const buf = Buffer.alloc(hit.size);
	readSync(fd, buf, 0, hit.size, dataStart + Number(hit.offset));
	return buf.toString('utf8');
}

/** 写 asar 里的一整个包到目标目录。 */
function extract(pkg, targetRoot) {
	const prefix = `${ASAR_DSH}${pkg}/`;
	const files = entries.filter((entry) => entry.path.startsWith(prefix));
	if (files.length === 0) return 0;
	for (const file of files) {
		const rel = file.path.slice(prefix.length);
		const dest = join(targetRoot, pkg, rel);
		mkdirSync(dirname(dest), { recursive: true });
		const buf = Buffer.alloc(file.size);
		readSync(fd, buf, 0, file.size, dataStart + Number(file.offset));
		writeFileSync(dest, buf);
	}
	return files.length;
}

/* ── 算依赖闭包 ───────────────────────────────────────────────────────── */

const available = new Set();
for (const entry of entries) {
	if (!entry.path.startsWith(ASAR_DSH)) continue;
	available.add(entry.path.slice(ASAR_DSH.length).split('/')[0]);
}

const needed = new Set();
const queue = [...ROOTS];
while (queue.length > 0) {
	const pkg = queue.shift();
	if (needed.has(pkg) || !available.has(pkg)) continue;
	needed.add(pkg);
	const text = readAsarText(`${ASAR_DSH}${pkg}/package.json`);
	if (text === undefined) continue;
	const manifest = JSON.parse(text);
	for (const dep of Object.keys({ ...manifest.dependencies, ...manifest.peerDependencies })) {
		if (!dep.startsWith('@deepseek-ai/')) continue;
		const short = dep.slice('@deepseek-ai/'.length);
		if (!needed.has(short)) queue.push(short);
	}
}

/* ui / templates 有客户端半身，它们自己也要 schemastery。 */
for (const extra of ['schemastery', 'cosmokit']) needed.add(extra);

/* ── 抽取 ─────────────────────────────────────────────────────────────── */

console.log(`从 ${ASAR} 抽取 ${needed.size} 个包`);
let total = 0;
for (const targetRoot of TARGETS) {
	if (!existsSync(dirname(targetRoot))) {
		console.log(`  跳过（目录不存在）：${targetRoot}`);
		continue;
	}
	let count = 0;
	for (const pkg of [...needed].sort()) count += extract(pkg, targetRoot);
	console.log(`  ✅ ${targetRoot}  ${count} 个文件`);
	total += count;
}
closeSync(fd);

/* ── 自检：能不能真的 import ─────────────────────────────────────────── */

const require = createRequire(join(PLUGIN_DIR, 'package.json'));
let ok = 0;
const bad = [];
for (const name of [
	'@deepseek-ai/dsh-tools',
	'@deepseek-ai/schemastery',
	'@deepseek-ai/cordis',
	'@deepseek-ai/cosmokit',
]) {
	try {
		require.resolve(name);
		ok += 1;
	} catch (failure) {
		bad.push(`${name}: ${failure.code}`);
	}
}

console.log('');
console.log(`自检：${ok}/4 可解析，共 ${total} 个文件`);
for (const entry of bad) console.log(`  ❌ ${entry}`);
if (bad.length > 0) process.exitCode = 1;
