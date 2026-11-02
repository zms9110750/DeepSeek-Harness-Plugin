/**
 * ① store —— 持久化。
 *
 * 一个工作空间 = 一个 SQLite 库；库里只有 `id` 一列，整卡是 `data` 里的
 * 一个 JSON 对象。**业务字段一个都不做列**（用户原话「不做列…按照 json 进行存储…
 * 但编号还是作为主键的」）。
 *
 * ## 值无关的精确边界
 *
 *   store 知道「哪些东西是查询维度」，不知道「这些维度是什么意思」。
 *   · 知道 `id` 是主键 —— 不知道编号规则、不生成编号
 *   · 知道 `data` 是合法 JSON —— 不知道里面有什么键
 *   · **不认 `history`、不认 `deleted`、不认 `parent`、不认任何业务字段名**
 *
 * ## 全同步
 *
 * `node:sqlite` 的 `DatabaseSync` 是同步 API，所以整条链路同步。
 * 下游四个包（search / relation / workgroup / core）按同步方式调用。
 */

import z from '@deepseek-ai/schemastery';
import { existsSync } from 'node:fs';

import { purgePhysical, read, readAll, write } from './cards.js';
import type { Card } from './cards.js';
import { hasSqlite } from './db.js';
import { createGlobalKv } from './global.js';
import type { GlobalKv } from './global.js';
import { HandleTable } from './handles.js';
import { readMeta, writeMetaKey } from './meta.js';
import type { Meta } from './meta.js';
import { dshSessionsDir, taskboardDir, workspaceFile } from './paths.js';
import { allocateWorkspaceId, sanitizeName } from './sanitize.js';
import { runTransaction } from './transaction.js';
import type { Tx } from './transaction.js';
import { TransactionGuard } from './transaction.js';
import { archiveWorkspace, listWorkspaces, unarchiveWorkspace } from './workspaces.js';
import type { WorkspaceEntry } from './workspaces.js';

export const name = 'taskboard2-store';

/** ① 是最底层，不 inject 任何东西。 */
export const inject = [];

export const Config = z.object({
	/*
	 * 显式覆盖 dsh home。省略时按 dsh 自己的规则解析：
	 * `$DSH_HOME` > `~/.dsh`。volatile：换值不必重启进程。
	 */
	dshHome: z.string().default('').volatile(),
});

/** 配置里本包用到的字段。 */
interface StoreConfig {
	dshHome?: string;
}

/**
 * 对外提供的 store 服务。
 *
 * 全同步。`wsId` 始终是不透明字符串（来自 ⑥ 的名字清洗），store 不解析它。
 */
export interface StoreService {
	/** 数据根目录的绝对路径（运行时推导）。 */
	readonly dir: string;
	/** dsh 会话目录；仅用于展示与推导校验，不读写它。 */
	readonly sessionsDir: string;

	/** 全部卡：**含墓碑、不过滤**、每次新对象。 */
	readAll(wsId: string): Card[];
	/** 单卡；不存在返回 `undefined`。 */
	read(wsId: string, id: string): Card | undefined;
	/** 按 id 整卡覆写（唯一业务写入口，没有字段 patch）。 */
	write(wsId: string, cards: readonly Card[]): void;
	/** 物理删除，绕过墓碑机制 —— 业务删除**不要**用它。 */
	purgePhysical(wsId: string, ids: readonly string[]): void;
	/** 在一个事务里执行同步回调；`fn` 只拿 `tx.*`。 */
	transaction<T>(wsId: string, fn: (tx: Tx) => T): T;

	/** 枚举工作空间；归档的需 `includeArchived` 才列出。 */
	listWorkspaces(includeArchived?: boolean): WorkspaceEntry[];
	/** 某个工作空间的库文件路径。 */
	dbPath(wsId: string, archived: boolean): string;
	/** 把空间移进 `archive/`（关句柄 → rename）。 */
	archiveDb(wsId: string): void;
	/** 把空间从 `archive/` 移回根目录。 */
	unarchiveDb(wsId: string): void;

	/** 读空间元信息（存在该空间自己的库里）。 */
	readMeta(wsId: string): Meta;
	/** 写一个元信息键；`value === undefined` 表示删除该键。 */
	writeMetaKey(wsId: string, key: string, value: unknown): void;

	/** 全局键值（不按空间分）：key 不透明，不做命名空间隔离。 */
	readonly globalKv: GlobalKv;

	/** 把用户填的名字清洗成 id 并占住库文件（⑥ 用）。 */
	allocateId(rawName: string): string;
	/** 只做清洗，不落盘（供 UI 预览/校验）。 */
	sanitize(rawName: string): string;

	/** 关闭所有打开的句柄。 */
	dispose(): void;
}

/** 判断某个 id 的库在哪：`true` = 归档目录，`false` = 根目录；不存在则抛错。 */
function archivedOf(root: string, wsId: string): boolean {
	if (existsSync(workspaceFile(root, wsId, false))) return false;
	if (existsSync(workspaceFile(root, wsId, true))) return true;
	throw new Error(`workspace "${wsId}" does not exist under "${root}"`);
}

export function apply(ctx: any, config: StoreConfig): void {
	if (!hasSqlite()) {
		throw new Error(
			`node:sqlite is unavailable in Node.js ${process.version}; Node.js >= 22.5 is required`,
		);
	}

	const handles = new HandleTable();
	const guard = new TransactionGuard();

	/*
	 * 配置是 volatile 的，换值不重跑 apply —— 所以这里惰性读，
	 * 不能把解析结果拷进闭包。
	 */
	function root(): string {
		const configured =
			typeof config.dshHome === 'string' && config.dshHome.length > 0
				? config.dshHome
				: undefined;
		return taskboardDir(configured);
	}

	function handleOf(wsId: string) {
		const base = root();
		return handles.acquireWorkspace(base, wsId, archivedOf(base, wsId));
	}

	const service: StoreService = {
		get dir(): string {
			return root();
		},
		get sessionsDir(): string {
			const configured =
				typeof config.dshHome === 'string' && config.dshHome.length > 0
					? config.dshHome
					: undefined;
			return dshSessionsDir(configured);
		},

		readAll(wsId: string): Card[] {
			guard.assertOutside('readAll');
			return readAll(handleOf(wsId));
		},
		read(wsId: string, id: string): Card | undefined {
			guard.assertOutside('read');
			return read(handleOf(wsId), id);
		},
		write(wsId: string, cards: readonly Card[]): void {
			guard.assertOutside('write');
			write(handleOf(wsId), cards);
		},
		purgePhysical(wsId: string, ids: readonly string[]): void {
			guard.assertOutside('purgePhysical');
			purgePhysical(handleOf(wsId), ids);
		},
		transaction<T>(wsId: string, fn: (tx: Tx) => T): T {
			return runTransaction(handleOf(wsId), guard, fn);
		},

		listWorkspaces(includeArchived = false): WorkspaceEntry[] {
			return listWorkspaces(root(), includeArchived);
		},
		dbPath(wsId: string, archived: boolean): string {
			return workspaceFile(root(), wsId, archived);
		},
		archiveDb(wsId: string): void {
			guard.assertOutside('archiveDb');
			archiveWorkspace(handles, root(), wsId);
		},
		unarchiveDb(wsId: string): void {
			guard.assertOutside('unarchiveDb');
			unarchiveWorkspace(handles, root(), wsId);
		},

		readMeta(wsId: string): Meta {
			guard.assertOutside('readMeta');
			return readMeta(handleOf(wsId));
		},
		writeMetaKey(wsId: string, key: string, value: unknown): void {
			guard.assertOutside('writeMetaKey');
			writeMetaKey(handleOf(wsId), key, value);
		},

		get globalKv(): GlobalKv {
			return createGlobalKv(handles.acquireGlobal(root()));
		},

		allocateId(rawName: string): string {
			return allocateWorkspaceId(root(), rawName);
		},
		sanitize(rawName: string): string {
			return sanitizeName(rawName);
		},

		dispose(): void {
			handles.closeAll();
		},
	};

	ctx.provide('taskboard2Store', service);

	/* 配置就地更新后，句柄全部作废（根目录可能变了）。 */
	ctx.on('loader/volatile-update', () => {
		handles.closeAll();
	});
}
