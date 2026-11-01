/**
 * 值无关的 jsonl.zstd 读写 —— 存进去什么，读出来还是什么。
 *
 * 这里**没有**任何领域类型：不认识 Task / Plan / Group，也不做校验。
 * 每个记录就是一个 JSON 值（对象、数组、字符串、数字……由调用方决定），
 * 单条记录序列化成一行 JSON，装入带校验和的 zstd 帧。
 *
 * 与 dsh 的行为对齐（依据 `dsh-session-persistence-jsonl/lib/index.js`）：
 *   · 一个文件 = 多个独立 zstd 帧首尾相接；
 *   · 帧内是整行 JSONL，行尾 `\n`，不跨帧切断记录；
 *   · 追加：`open(path, "a")` 写一个新帧再 fsync，从不重写历史；
 *   · 撕裂尾：末尾不完整的帧不算记录，写入前截掉；
 *   · 首帧/后续帧的差别在 dsh 里是 header 与事件批次之分，本模块不设 header，
 *     每帧都只是「一批记录」。
 */

import { mkdir, open, readFile, rename, rm, truncate } from 'node:fs/promises';
import { dirname } from 'node:path';

import {
	compressZstdFrame,
	decompressZstdFrame,
	hasZstd,
	scanZstdFrames,
} from './zstd-frames.js';

/** 一次写入的记录：任意可 JSON 化的值。 */
export type StoredValue = unknown;

export interface JsonlZstdStoreOptions {
	/** 目标文件绝对路径；目录会自动创建。 */
	readonly file: string;
	/** 只读打开：读操作可用，写入抛错。 */
	readonly readOnly?: boolean;
}

/** 打开状态与累计计数，便于调用方自检。 */
export interface JsonlZstdStoreStats {
	readonly file: string;
	readonly frames: number;
	readonly values: number;
	readonly bytes: number;
}

export interface JsonlZstdStore {
	/** 该存储的文件路径。 */
	readonly file: string;
	/** 追加一条记录。 */
	append(value: StoredValue): Promise<void>;
	/** 追加一批记录：同一帧，因此一次写入只产生一个帧。 */
	appendMany(values: readonly StoredValue[]): Promise<void>;
	/** 按写入顺序读出全部记录。文件不存在时返回空数组。 */
	readAll(): Promise<StoredValue[]>;
	/** 原子地整体替换（临时文件 + rename），不产生撕裂尾。 */
	replaceAll(values: readonly StoredValue[]): Promise<void>;
	/** 只做结构扫描，不解压，用于快速自检。 */
	stats(): Promise<JsonlZstdStoreStats>;
}

/**
 * 把一个值序列化成一行（不含 `\n`）。
 *
 * 只有确实无法表达的值才拒绝（顶层 `undefined` / 函数 / symbol）；
 * `NaN`、`Infinity` 按 JSON 规则变 `null`，与本模块无关。
 */
function encodeValue(value: StoredValue): string {
	const text = JSON.stringify(value);
	if (text === undefined) {
		throw new TypeError(
			`value is not JSON-serializable: ${typeof value} (only JSON-representable values can be stored)`,
		);
	}
	return text;
}

/** 把一批值编码成一帧的明文：每行一条，尾部带 `\n`。 */
function encodeBatch(values: readonly StoredValue[]): Buffer {
	if (values.length === 0) return Buffer.alloc(0);
	return Buffer.from(`${values.map(encodeValue).join('\n')}\n`, 'utf8');
}

/** 把拼接后的帧明文按行还原成值；末尾空行忽略。 */
function decodeLines(plaintext: Buffer): StoredValue[] {
	const text = plaintext.toString('utf8');
	const values: StoredValue[] = [];
	for (const line of text.split('\n')) {
		if (line.length === 0) continue;
		values.push(JSON.parse(line) as StoredValue);
	}
	return values;
}

/** 读整个文件并切帧；文件不存在等价于空。 */
async function readFrames(file: string): Promise<Buffer | undefined> {
	try {
		return await readFile(file);
	} catch (error) {
		if ((error as { code?: string }).code === 'ENOENT') return undefined;
		throw error;
	}
}

/** 打开（或创建）一个 jsonl.zstd 存储。 */
export function createJsonlZstdStore(options: JsonlZstdStoreOptions): JsonlZstdStore {
	const file = options.file;
	const readOnly = options.readOnly === true;

	if (!hasZstd()) {
		throw new Error(
			`zstd is unavailable in Node.js ${process.version}; Node.js >= 22.15 provides node:zlib zstd support`,
		);
	}

	/** 写入串行化：同一文件的 append 之间不交错。 */
	let queue: Promise<unknown> = Promise.resolve();

	function serialize<T>(task: () => Promise<T>): Promise<T> {
		const run = queue.then(task, task);
		/* 队列本身不因单次失败而中断。 */
		queue = run.catch(() => undefined);
		return run;
	}

	function assertWritable(): void {
		if (readOnly) throw new Error(`store is read-only: "${file}"`);
	}

	async function doAppend(values: readonly StoredValue[]): Promise<void> {
		assertWritable();
		if (values.length === 0) return;
		const plaintext = encodeBatch(values);
		const frame = await compressZstdFrame(plaintext);

		await mkdir(dirname(file), { recursive: true });

		/* 追加前先确定安全落点：末帧完整就落在文件尾，否则落在撕裂帧起点。 */
		const existing = await readFrames(file);
		let appendAt = existing?.length ?? 0;
		if (existing !== undefined && existing.length > 0) {
			const scan = scanZstdFrames(existing);
			if (scan.tornStart !== undefined && scan.tornStart !== existing.length) {
				appendAt = scan.tornStart;
			}
		}

		const handle = await open(file, appendAt === 0 ? 'w' : 'r+');
		try {
			if (appendAt !== (existing?.length ?? 0)) await handle.truncate(appendAt);
			/* 逐段写满，避免短写留下半个帧。 */
			let written = 0;
			while (written < frame.length) {
				const { bytesWritten } = await handle.write(
					frame,
					written,
					frame.length - written,
					appendAt + written,
				);
				if (bytesWritten === 0) throw new Error(`short write to "${file}"`);
				written += bytesWritten;
			}
			await handle.sync();
		} catch (error) {
			/* 写失败时回退到追加前长度，避免半帧污染后续读取。 */
			try {
				await handle.truncate(appendAt);
			} catch {
				/* 回滚失败不掩盖原始错误。 */
			}
			throw error;
		} finally {
			await handle.close();
		}
	}

	async function readAllInternal(): Promise<StoredValue[]> {
		const buffer = await readFrames(file);
		if (buffer === undefined || buffer.length === 0) return [];
		const { frames } = scanZstdFrames(buffer);
		const values: StoredValue[] = [];
		for (const frame of frames) {
			const plaintext = await decompressZstdFrame(buffer.subarray(frame.start, frame.end));
			values.push(...decodeLines(plaintext));
		}
		return values;
	}

	return {
		file,

		append(value: StoredValue): Promise<void> {
			return serialize(() => doAppend([value]));
		},

		appendMany(values: readonly StoredValue[]): Promise<void> {
			const snapshot = [...values];
			return serialize(() => doAppend(snapshot));
		},

		readAll(): Promise<StoredValue[]> {
			return readAllInternal();
		},

		replaceAll(values: readonly StoredValue[]): Promise<void> {
			const snapshot = [...values];
			return serialize(async () => {
				assertWritable();
				const plaintext = encodeBatch(snapshot);
				const frame = plaintext.length === 0 ? undefined : await compressZstdFrame(plaintext);
				await mkdir(dirname(file), { recursive: true });
				const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
				const handle = await open(tmp, 'wx');
				try {
					if (frame !== undefined) await handle.writeFile(frame);
					await handle.sync();
				} finally {
					await handle.close();
				}
				try {
					await rename(tmp, file);
				} catch (error) {
					await rm(tmp, { force: true });
					throw error;
				}
			});
		},

		async stats(): Promise<JsonlZstdStoreStats> {
			const buffer = await readFrames(file);
			if (buffer === undefined || buffer.length === 0) {
				return { file, frames: 0, values: 0, bytes: 0 };
			}
			const { frames } = scanZstdFrames(buffer);
			let values = 0;
			for (const frame of frames) {
				const plaintext = await decompressZstdFrame(buffer.subarray(frame.start, frame.end));
				values += decodeLines(plaintext).length;
			}
			return { file, frames: frames.length, values, bytes: buffer.length };
		},
	};
}

/** 供测试与运维使用：把文件截到完整帧末尾（丢弃撕裂尾）。 */
export async function repairTornTail(file: string): Promise<void> {
	const buffer = await readFrames(file);
	if (buffer === undefined) return;
	const { tornStart } = scanZstdFrames(buffer);
	if (tornStart !== undefined) await truncate(file, tornStart);
}
