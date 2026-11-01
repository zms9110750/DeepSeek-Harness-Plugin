/**
 * ① 持久化与提供者 —— 内存 ↔ 外界。
 *
 * 这一层只做一件事：把内存里的值变成外界的字节，再变回来。
 * 它不知道「状态能不能转」、不知道「哪个模板合法」、不知道「谁在写」。
 *
 * ## 值无关
 *
 * 后面的形状都还没考虑，所以这里**不定义**任何领域类型。读写接受任意
 * JSON 可表达的值，原样存、原样取（见 `jsonl-zstd-store.ts`）。
 *
 * ## 落盘位置
 *
 * 不硬编码：目录由 dsh home 的运行时解析推出，且与 dsh 的 `sessions`
 * 目录保持兄弟关系（见 `paths.ts`）。
 *
 *   <dshHome>/sessions   ← dsh 自己的会话日志，只读参考，本包从不写它
 *   <dshHome>/taskboard  ← 本包的数据目录
 */

import { join } from 'node:path';

import z from '@deepseek-ai/schemastery';

import { createJsonlZstdStore, type JsonlZstdStore, type StoredValue } from './jsonl-zstd-store.js';
import { dshSessionsDir, resolveDshHome, taskboardDir } from './paths.js';

export const name = 'taskboard2-store';

/* 不依赖任何前置服务。 */
export const inject = [];

export const Config = z.object({
	/*
	 * 显式覆盖 dsh home。省略时按 dsh 自己的规则解析：
	 * `$DSH_HOME` > `~/.dsh`。volatile：换值不必重启进程。
	 */
	dshHome: z.string().default('').volatile(),
	/* 记录文件名，位于 <dshHome>/taskboard/ 下。 */
	filename: z.string().default('records.jsonl.zstd').volatile(),
	/* 只读打开：能读不能写，给「看历史」的场合用。 */
	readOnly: z.boolean().default(false).volatile(),
});

/** 对外提供的 store 服务形状（值无关）。 */
export interface StoreService {
	/** 数据目录的绝对路径（运行时推导）。 */
	readonly dir: string;
	/** 记录文件的绝对路径（运行时推导）。 */
	readonly file: string;
	/** dsh 会话目录；仅用于展示与推导校验，本服务不读写它。 */
	readonly sessionsDir: string;
	/** 追加一条任意记录。 */
	append(value: StoredValue): Promise<void>;
	/** 追加一批任意记录（一批 = 一个帧）。 */
	appendMany(values: readonly StoredValue[]): Promise<void>;
	/** 按写入顺序读出全部记录。 */
	readAll(): Promise<StoredValue[]>;
	/** 原子地整体替换全部记录。 */
	replaceAll(values: readonly StoredValue[]): Promise<void>;
	/** 只做结构扫描的自检信息（帧数 / 记录数 / 字节数）。 */
	stats(): Promise<{ file: string; frames: number; values: number; bytes: number }>;
}

interface StoreConfig {
	dshHome?: string;
	filename?: string;
	readOnly?: boolean;
}

export function apply(ctx: any, config: StoreConfig): void {
	/*
	 * 配置是 volatile 的，换值不重跑 apply —— 所以这里惰性读，
	 * 不能把解析结果拷进闭包。每次取用时按当前配置重新推导。
	 */
	function homeOf(): string {
		const configured =
			typeof config.dshHome === 'string' && config.dshHome.length > 0
				? config.dshHome
				: undefined;
		return resolveDshHome(configured);
	}

	function fileOf(): string {
		const filename =
			typeof config.filename === 'string' && config.filename.length > 0
				? config.filename
				: 'records.jsonl.zstd';
		return join(taskboardDir(homeOf()), filename);
	}

	/* 同一个文件复用一个实例，避免每次调用都重建。 */
	let cachedFile: string | undefined;
	let cachedStore: JsonlZstdStore | undefined;

	function store(): JsonlZstdStore {
		const file = fileOf();
		if (cachedStore === undefined || cachedFile !== file) {
			cachedFile = file;
			cachedStore = createJsonlZstdStore({ file, readOnly: config.readOnly === true });
		}
		return cachedStore;
	}

	const service: StoreService = {
		get dir(): string {
			return taskboardDir(homeOf());
		},
		get file(): string {
			return fileOf();
		},
		get sessionsDir(): string {
			return dshSessionsDir(homeOf());
		},
		append: (value) => store().append(value),
		appendMany: (values) => store().appendMany(values),
		readAll: () => store().readAll(),
		replaceAll: (values) => store().replaceAll(values),
		stats: () => store().stats(),
	};

	ctx.provide('taskboard2Store', service);

	/* 配置就地更新后，下一次取用自动按新解析结果重建实例。 */
	ctx.on('loader/volatile-update', () => {
		cachedFile = undefined;
		cachedStore = undefined;
	});
}
