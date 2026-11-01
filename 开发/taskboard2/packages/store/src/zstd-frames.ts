/**
 * jsonl.zstd 的物理格式 —— 与 dsh 的 `dsh-session-persistence-jsonl` 一致。
 *
 * 依据（都读自 dsh 的实际实现）：
 *   B:\DeepSeek Harness\resources\app.asar
 *     dsh/node_modules/@deepseek-ai/dsh-session-persistence-jsonl/lib/index.js
 *
 * 结论（`zstd.js` 段 + `generation.js` 段 + `appendLines`/`encodeMaterialization`）：
 *
 *   · 整个文件 = **若干独立 zstd 帧首尾拼接**（concatenated-frame container），
 *     不是「整文件一个帧」。
 *   · 每个帧由 `node:zlib` 的 `zstdCompress(input, { params: { ZSTD_c_checksumFlag: 1 } })`
 *     一次性压出：**带校验和的完整帧**，压缩级别不设置（用库默认）。
 *   · 帧的明文是**整数行 JSONL**（每行一个 JSON 对象，行尾 `\n`）。
 *     dsh 写批次时是 `eventLines(events) + "\n"`，故帧内永远整行，不跨帧切断记录。
 *   · 首帧单独装 header 行；后续每次 append 追加一个新帧（`open(path, "a")`）。
 *     **追加，不重写**；写坏时按追加前尺寸截回。
 *   · 读取时先做**结构扫描**（魔数 → 帧头 → 块 → 校验和）切出帧边界，
 *     再逐帧解压，最后拼起来按 `\n` 切行。末尾不完整的帧=撕裂尾，丢弃。
 */

import * as zlib from 'node:zlib';

/** zstd 帧魔数，小端 0xFD2FB528。 */
const ZSTD_MAGIC = 4247762216;

/** 帧边界（字节区间，左闭右开）。 */
export interface ZstdFrame {
	readonly start: number;
	readonly end: number;
}

/** 结构扫描结果：完整帧列表，以及末尾不完整帧的起点（如果有）。 */
export interface ZstdFrameScan {
	readonly frames: readonly ZstdFrame[];
	readonly tornStart?: number;
}

interface ZstdCompressOptions {
	readonly params: Record<number, number>;
}

/**
 * `node:zlib` 的 zstd 子集。
 *
 * 自己声明而不是直接依赖 `@types/node` 里的声明：zstd API 较新，
 * 本项目可能装着旧版类型定义，编译会因缺声明而失败。
 */
interface ZstdBinding {
	zstdCompress(
		input: Buffer,
		options: ZstdCompressOptions,
		callback: (error: Error | null, output: Buffer) => void,
	): void;
	zstdDecompress(input: Buffer, callback: (error: Error | null, output: Buffer) => void): void;
	constants: { ZSTD_c_checksumFlag?: number };
}

const zstd = zlib as unknown as ZstdBinding;

/** 本进程是否具备 zstd 能力（Node >= 22.15 才有 `node:zlib` 的 zstd）。 */
export function hasZstd(): boolean {
	return typeof zstd.zstdCompress === 'function' && typeof zstd.zstdDecompress === 'function';
}

function checksumOptions(): ZstdCompressOptions {
	if (!hasZstd()) {
		throw new Error(`zstd is unavailable in Node.js ${process.version}; Node.js >= 22.15 is required`);
	}
	const flag = zstd.constants.ZSTD_c_checksumFlag;
	if (typeof flag !== 'number') {
		throw new Error('node:zlib exposes no ZSTD_c_checksumFlag constant');
	}
	return { params: { [flag]: 1 } };
}

/**
 * 把一段 JSONL 明文压成**一个**带校验和的完整 zstd 帧。
 * 与 dsh 的 `compressZstdFrame` 同参数、同语义。
 */
export function compressZstdFrame(input: Buffer): Promise<Buffer> {
	const options = checksumOptions();
	return new Promise<Buffer>((resolvePromise, rejectPromise) => {
		zstd.zstdCompress(input, options, (error, output) => {
			if (error) rejectPromise(error);
			else resolvePromise(output);
		});
	});
}

/** 解压一个完整帧（校验和不符会拒绝）。 */
export function decompressZstdFrame(input: Buffer): Promise<Buffer> {
	if (!hasZstd()) {
		throw new Error(`zstd is unavailable in Node.js ${process.version}; Node.js >= 22.15 is required`);
	}
	return new Promise<Buffer>((resolvePromise, rejectPromise) => {
		zstd.zstdDecompress(input, (error, output) => {
			if (error) rejectPromise(error);
			else resolvePromise(output);
		});
	});
}

/**
 * 只按结构切帧，不解压。
 *
 * 末尾不足一个完整帧时返回 `tornStart`（= 该帧起点），调用方据此截断或忽略。
 * 结构与 dsh 的 `scanZstdFrames` 逐条对应：帧头保留位、内容长度、字典、块头、校验和。
 */
export function scanZstdFrames(buffer: Buffer): ZstdFrameScan {
	const frames: ZstdFrame[] = [];
	let offset = 0;

	while (offset < buffer.length) {
		const start = offset;

		/* 帧头至少要 4 字节魔数。 */
		if (buffer.length - offset < 4) return { frames, tornStart: start };
		if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) {
			throw new Error(`corrupt Zstandard log: invalid frame magic at byte ${offset}`);
		}
		offset += 4;

		/* 帧描述符。 */
		if (offset === buffer.length) return { frames, tornStart: start };
		const descriptor = buffer.readUInt8(offset);
		offset += 1;
		if ((descriptor & 24) !== 0) {
			throw new Error(`corrupt Zstandard log: reserved frame-header bit at byte ${offset - 1}`);
		}
		const contentSizeFlag = descriptor >>> 6;
		const singleSegment = (descriptor & 32) !== 0;
		const checksum = (descriptor & 4) !== 0;
		const dictionaryFlag = descriptor & 3;
		const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag;
		const contentSizeBytes =
			contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag;
		const remainingHeaderBytes =
			(singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes;
		if (buffer.length - offset < remainingHeaderBytes) return { frames, tornStart: start };
		offset += remainingHeaderBytes;

		/* 块循环。 */
		for (;;) {
			if (buffer.length - offset < 3) return { frames, tornStart: start };
			const blockHeader = buffer.readUIntLE(offset, 3);
			offset += 3;
			const lastBlock = (blockHeader & 1) !== 0;
			const blockType = (blockHeader >>> 1) & 3;
			const blockSize = blockHeader >>> 3;
			if (blockType === 3) {
				throw new Error(`corrupt Zstandard log: reserved block type at byte ${offset - 3}`);
			}
			/* RLE 块表面大小恒为 1，实际载荷 1 字节。 */
			const payloadBytes = blockType === 1 ? 1 : blockSize;
			if (buffer.length - offset < payloadBytes) return { frames, tornStart: start };
			offset += payloadBytes;
			if (lastBlock) break;
		}

		/* 校验和尾。 */
		if (checksum) {
			if (buffer.length - offset < 4) return { frames, tornStart: start };
			offset += 4;
		}

		frames.push({ start, end: offset });
	}

	return { frames };
}
