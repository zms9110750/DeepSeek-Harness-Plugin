/**
 * dsh 目录的运行时推导 —— 不出现任何字面量用户名或绝对路径。
 *
 * dsh 自己的解析规则（`@deepseek-ai/dsh-home-paths` 的 `resolveDshHome`）是：
 *
 *   显式配置 > `$DSH_HOME`（空白视为未设置）> `~/.dsh`
 *
 * 任务板目录不写死，而是从 **sessions 目录**推出来：
 *
 *   sessions   = <dshHome>/sessions
 *   taskboard  = dirname(sessions) + "/taskboard"
 */

import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

/** 覆盖 harness home 的环境变量；与 dsh 同名。 */
export const DSH_HOME_ENV = 'DSH_HOME';

/** 全局库文件名（当前空间指针等不按空间分的键值）。 */
export const GLOBAL_DB_NAME = '_global.db';

/** 归档子目录名。 */
export const ARCHIVE_DIR_NAME = 'archive';

/** 模板目录名：若它出现在数据根下，扫描空间时必须排除。 */
export const TEMPLATES_DIR_NAME = 'templates';

const DSH_HOME_DIR_NAME = '.dsh';
const SESSIONS_DIR_NAME = 'sessions';
const TASKBOARD_DIR_NAME = 'taskboard';
const DB_SUFFIX = '.db';

/** 环境映射（只用到字符串取值，故不依赖 `NodeJS.ProcessEnv` 的声明）。 */
export type Env = Readonly<Record<string, string | undefined>>;

/** 展开 `~`、`~/`、`~\` 前缀；其它形式原样返回。 */
export function expandHomePath(path: string): string {
	if (path === '~') return homedir();
	if (path.startsWith('~/') || path.startsWith('~\\')) return join(homedir(), path.slice(2));
	return path;
}

/**
 * 解析 dsh home：显式配置 > `$DSH_HOME` > `~/.dsh`。
 * 空或全空白的 `$DSH_HOME` 视为未设置（与 dsh 一致，避免解析到当前目录）。
 */
export function resolveDshHome(configured?: string, env: Env = process.env): string {
	const fromEnv = env[DSH_HOME_ENV];
	const base =
		configured !== undefined && configured.length > 0
			? configured
			: typeof fromEnv === 'string' && fromEnv.trim().length > 0
				? fromEnv
				: join(homedir(), DSH_HOME_DIR_NAME);
	return resolve(expandHomePath(base));
}

/** dsh 的会话目录（`<dshHome>/sessions`）。只用于推导，不读写它。 */
export function dshSessionsDir(configured?: string, env: Env = process.env): string {
	return join(resolveDshHome(configured, env), SESSIONS_DIR_NAME);
}

/**
 * 任务板持久化根目录：sessions 目录的兄弟目录。
 *
 * 写成 `dirname(sessions)` 而不是 `join(dshHome, ...)`，是为了让「与 sessions
 * 相对」这层关系在代码里显式可见。
 */
export function taskboardDir(configured?: string, env: Env = process.env): string {
	return join(dirname(dshSessionsDir(configured, env)), TASKBOARD_DIR_NAME);
}

/** 归档子目录（`<root>/archive`）。 */
export function archiveDir(root: string): string {
	return join(root, ARCHIVE_DIR_NAME);
}

/** 全局库文件（`<root>/_global.db`）。 */
export function globalDbFile(root: string): string {
	return join(root, GLOBAL_DB_NAME);
}

/** 某个工作空间的库文件。`archived` 决定它在根目录还是 `archive/` 之下。 */
export function workspaceFile(root: string, workspaceId: string, archived: boolean): string {
	return join(archived ? archiveDir(root) : root, `${workspaceId}${DB_SUFFIX}`);
}

/** 从文件名还原工作空间 id；不是 `.db` 文件则返回 `undefined`。 */
export function workspaceIdOf(fileName: string): string | undefined {
	if (!fileName.endsWith(DB_SUFFIX)) return undefined;
	const id = fileName.slice(0, -DB_SUFFIX.length);
	if (id.length === 0) return undefined;
	return id;
}
