/**
 * 工作空间 id 清洗 —— 用户填的名字 → 落盘文件名。
 *
 * 用户原话（`docs/01-store.md` 1.10）：
 *   「空间是用户创建和命名的。用户手动填写的。经过清洗。就像我的世界。」
 *   「我的世界也是经过清洗的。他的清洗就是考虑重名的。」
 *
 * 所以清洗负责两件事：
 *   1. **规范化**：非法字符 / 保留名 / 长度 / 首尾
 *   2. **去重**：撞名时派生 `-2` / `-3`，**显示名也跟着变**（用户看到的就是最终名）
 *
 * 全程**幂等**（对结果再跑一次不变）、**确定**（不用哈希、不用随机、不依赖时间戳）。
 */

import { closeSync, openSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { ARCHIVE_DIR_NAME, GLOBAL_DB_NAME, workspaceIdOf } from './paths.js';

/** Windows 保留设备名：不能作为文件名主干。 */
const RESERVED_NAMES = new Set([
	'con',
	'prn',
	'aux',
	'nul',
	'clock$',
	'com1',
	'com2',
	'com3',
	'com4',
	'com5',
	'com6',
	'com7',
	'com8',
	'com9',
	'lpt1',
	'lpt2',
	'lpt3',
	'lpt4',
	'lpt5',
	'lpt6',
	'lpt7',
	'lpt8',
	'lpt9',
]);

/** 最长字符数（给 `.db`、`-wal`、`-shm` 与路径总长留余量）。 */
const MAX_CHARS = 120;

/** 最长 UTF-8 字节数。 */
const MAX_BYTES = 200;

/** 全被清空时使用的兜底名。 */
const FALLBACK_NAME = 'space';

/** 白名单：ASCII 字母数字、CJK、下划线、连字符。其余一律替换为 `_`。 */
const DISALLOWED = /[^A-Za-z0-9\u4e00-\u9fff_-]/gu;

/**
 * 规范化一个用户输入的名字。
 *
 * 8 步：NFKC → 白名单替换 → 折叠连续 `_` → 去首尾 `_` → 保留名前加 `_`
 * → 去结尾点与空格 → 截断 → 空则 `space`。
 *
 * @param rawName - 用户手填的名字（任意文本）。
 * @returns 可安全用作文件名的 id 主干。
 */
export function sanitizeName(rawName: string): string {
	let value = rawName.normalize('NFKC');
	value = value.replace(DISALLOWED, '_');
	value = value.replace(/_+/gu, '_');
	value = value.replace(/^_+/u, '').replace(/_+$/u, '');
	if (RESERVED_NAMES.has(value.toLowerCase())) value = `_${value}`;
	value = value.replace(/[. ]+$/gu, '');
	value = truncateToFit(value);
	if (value.length === 0) return FALLBACK_NAME;
	return value;
}

/** 按字符数与字节数双重截断（中日韩字符一字占 3 字节）。 */
function truncateToFit(value: string): string {
	let out = '';
	let bytes = 0;
	for (const char of value) {
		const size = Buffer.byteLength(char, 'utf8');
		if (bytes + size > MAX_BYTES) break;
		if ([...out].length + 1 > MAX_CHARS) break;
		out += char;
		bytes += size;
	}
	return out;
}

/** 给 `-N` 后缀留出位置后再截断。 */
function withSuffixRoom(base: string, suffix: string): string {
	const room = truncateToFit(base);
	if (room.length + suffix.length <= MAX_CHARS) return room;
	let out = room;
	while (out.length > 0 && [...out].length + suffix.length > MAX_CHARS) {
		out = [...out].slice(0, -1).join('');
	}
	return out.length > 0 ? out : FALLBACK_NAME;
}

/** 收集一个目录里已有的工作空间 id（小写，供不区分大小写的查重）。 */
function existingIds(dir: string, into: Set<string>): void {
	let entries;
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch {
		return;
	}
	for (const entry of entries) {
		if (!entry.isFile()) continue;
		if (entry.name === GLOBAL_DB_NAME) continue;
		const id = workspaceIdOf(entry.name);
		if (id === undefined) continue;
		into.add(id.toLowerCase());
	}
}

/** 用排他创建仲裁一次占位；已存在返回 `false`。 */
function tryReserve(file: string): boolean {
	try {
		const fd = openSync(file, 'wx', 0o600);
		closeSync(fd);
		return true;
	} catch (error) {
		if ((error as { code?: string }).code === 'EEXIST') return false;
		throw error;
	}
}

/**
 * 把用户填的名字分配成一个**唯一**的工作空间 id，并**占住**它的库文件。
 *
 * 撞名时派生 `base-2`、`base-3`……（用户原话：清洗就是考虑重名的）。
 * 查重**不区分大小写**（Windows 上会撞）；最终由 `O_EXCL` 排他创建仲裁，
 * 因此并发安全，不依赖内存锁。
 *
 * @param root - 数据根目录（`<dshHome>/taskboard`）。
 * @param rawName - 用户手填的名字。
 * @returns 已占住 `<root>/<id>.db` 的 id。
 */
export function allocateWorkspaceId(root: string, rawName: string): string {
	const base = sanitizeName(rawName);
	const taken = new Set<string>();
	existingIds(root, taken);
	existingIds(join(root, ARCHIVE_DIR_NAME), taken);

	for (let n = 1; n <= 100_000; n += 1) {
		const candidate = n === 1 ? base : `${withSuffixRoom(base, `-${n}`)}-${n}`;
		if (taken.has(candidate.toLowerCase())) continue;
		if (tryReserve(join(root, `${candidate}.db`))) return candidate;
		taken.add(candidate.toLowerCase());
	}
	throw new Error(`could not allocate a unique workspace id from name "${rawName}"`);
}

/** 某个 id 是否已被占用（根目录或归档目录）。 */
export function workspaceIdExists(root: string, workspaceId: string): boolean {
	const wanted = workspaceId.toLowerCase();
	const taken = new Set<string>();
	existingIds(root, taken);
	existingIds(join(root, ARCHIVE_DIR_NAME), taken);
	return taken.has(wanted);
}
