/**
 * `node:sqlite` 的薄封装：打开数据库、建表、PRAGMA、语句缓存。
 *
 * dsh 自己的 SQLite 先例（`dsh-session-query-sqlite/lib/index.js:50`）就是
 * `await import("node:sqlite")` + `new DatabaseSync(path)`。但本包**全同步**，
 * 所以这里用 `createRequire` 同步加载，避免把整个包变成异步 API。
 *
 * 建库习惯照抄 dsh：
 *   · `PRAGMA application_id` —— 防止误开别人的库
 *   · `PRAGMA user_version`  —— schema 版本
 *   · `STRICT` 表
 *   · 目录/文件权限 0o700 / 0o600
 */

import { createRequire } from 'node:module';
import { chmodSync, mkdirSync, openSync, closeSync } from 'node:fs';
import { dirname } from 'node:path';

/** 任务板数据库的应用标识（防止误开别的 SQLite 库）。 */
export const APPLICATION_ID = 1146308690;

/** 当前 schema 版本。 */
export const SCHEMA_VERSION = 1;

/** 一条查询结果行（SQLite 返回的普通对象）。 */
export type Row = Record<string, unknown>;

/**
 * `node:sqlite` 的最小类型面。
 *
 * 自己声明而不是依赖 `@types/node`：`node:sqlite` 较新，本仓库可能装着
 * 不含该模块声明的类型定义，直接 `import` 会编译失败。
 */
export interface StatementLike {
	run(...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
	get(...params: unknown[]): Row | undefined;
	all(...params: unknown[]): Row[];
}

export interface DatabaseLike {
	prepare(sql: string): StatementLike;
	exec(sql: string): void;
	close(): void;
	readonly isOpen?: boolean;
}

interface SqliteModule {
	DatabaseSync: new (path: string) => DatabaseLike;
}

/** 同步取得 `node:sqlite` 模块（全同步 API，不能 await）。 */
export function loadSqlite(): SqliteModule {
	const require = createRequire(import.meta.url);
	let mod: unknown;
	try {
		mod = require('node:sqlite');
	} catch (error) {
		throw new Error(
			`node:sqlite is unavailable in Node.js ${process.version}; Node.js >= 22.5 is required`,
			{ cause: error },
		);
	}
	const candidate = mod as { DatabaseSync?: unknown };
	if (typeof candidate.DatabaseSync !== 'function') {
		throw new Error('node:sqlite exposes no DatabaseSync constructor');
	}
	return candidate as SqliteModule;
}

/** 本进程是否具备 SQLite 能力。 */
export function hasSqlite(): boolean {
	try {
		loadSqlite();
		return true;
	} catch {
		return false;
	}
}

/**
 * 打开一个任务板数据库并确保 schema 就绪。
 *
 * 文件不存在时以 `0o600` 新建；目录以 `0o700` 递归创建。
 * 若目标库的 `application_id` 属于别的应用，直接拒绝（照 dsh 做法）。
 *
 * @param file - 绝对路径。
 * @returns 已就绪的数据库句柄。
 */
export function openDatabase(file: string): DatabaseLike {
	const { DatabaseSync } = loadSqlite();
	mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
	ensureFile(file);

	const db = new DatabaseSync(file);
	try {
		const { application_id: applicationId } = (db.prepare('PRAGMA application_id').get() ??
			{}) as { application_id?: number };
		if (typeof applicationId === 'number' && applicationId !== 0 && applicationId !== APPLICATION_ID) {
			throw new Error(`database at "${file}" belongs to another application`);
		}
		db.exec(`PRAGMA application_id = ${APPLICATION_ID}`);
		db.exec('PRAGMA journal_mode = WAL');
		db.exec('PRAGMA busy_timeout = 5000');
		db.exec('PRAGMA foreign_keys = ON');
		ensureSchema(db);
		return db;
	} catch (error) {
		db.close();
		throw error;
	}
}

/** 以排他方式创建库文件并收紧权限；已存在则只收紧权限。 */
function ensureFile(file: string): void {
	let created = false;
	try {
		closeSync(openSync(file, 'wx', 0o600));
		created = true;
	} catch (error) {
		if ((error as { code?: string }).code !== 'EEXIST') throw error;
	}
	if (!created) {
		try {
			chmodSync(file, 0o600);
		} catch {
			/* 权限收紧失败不阻塞打开：某些文件系统不支持。 */
		}
	}
}

/**
 * 建表。只有 `id` 是列，整卡是 `data` 里的一个 JSON 对象。
 *
 * 业务字段一个都不做 —— 用户原话「不做列…按照 json 进行存储…但编号还是作为主键的」。
 */
function ensureSchema(db: DatabaseLike): void {
	db.exec(`
    CREATE TABLE IF NOT EXISTS cards (
      id   TEXT PRIMARY KEY,
      data TEXT NOT NULL CHECK (json_valid(data))
    ) STRICT
  `);
	db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      k TEXT PRIMARY KEY,
      v TEXT NOT NULL
    ) STRICT
  `);
	db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
}

/**
 * 一个打开的数据库 + 语句缓存。
 *
 * 语句缓存是必要的：`prepare` 有解析开销，而本包每次读写都要走同几条语句。
 */
export class DbHandle {
	readonly db: DatabaseLike;
	private readonly statements = new Map<string, StatementLike>();

	constructor(db: DatabaseLike) {
		this.db = db;
	}

	/** 取（并缓存）一条预编译语句。 */
	stmt(sql: string): StatementLike {
		const cached = this.statements.get(sql);
		if (cached !== undefined) return cached;
		const prepared = this.db.prepare(sql);
		this.statements.set(sql, prepared);
		return prepared;
	}

	/** 在一个事务里执行；抛错则回滚。**回调必须同步。** */
	runInTransaction<T>(fn: () => T): T {
		this.db.exec('BEGIN');
		try {
			const result = fn();
			this.db.exec('COMMIT');
			return result;
		} catch (error) {
			try {
				this.db.exec('ROLLBACK');
			} catch {
				/* 回滚失败不掩盖原始错误。 */
			}
			throw error;
		}
	}

	/** 关闭句柄。幂等。 */
	close(): void {
		this.statements.clear();
		try {
			this.db.close();
		} catch {
			/* 已关闭。 */
		}
	}
}
