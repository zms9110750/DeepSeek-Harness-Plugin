/**
 * ⑥ 工作空间 —— 容器本身。
 *
 * 工作空间是**集合**，持有成员；**卡不知道空间**（卡上没有空间字段），
 * 归属由存储边界表达 —— 一个空间 = 一个 `.db`。
 *
 * ## 边界
 *
 * 做：
 *   · 建 / 列 / 归档 / 取消归档
 *   · 当前空间指针（**会话级**，存 `_global.db`）
 *   · 空间元信息（名字、子工作区 / 额外工作区）
 *
 * 不做：
 *   · 空间层级 —— **不存在**（用户原话「这没有层级结构」）
 *   · 删除入口 —— **刻意不提供**；只能归档，物理删除由用户自己在文件系统做
 *   · 卡的管理 —— 卡归 ⑦/⑧；⑥ 只提供「哪个空间」这个边界
 *   · 子工作区 / 额外工作区的**执法** —— 只存不执法：不检查越界、不限制路径、
 *     不做权限判断、无行为（那是二期另一个 mod）
 *   · 报错策略 —— ⑥ 只返回状态，文案归 ⑧ core
 *   · 直接碰 SQLite —— 全部经 ① store
 */

import {
	clearCurrent,
	resolveCurrent,
	setCurrent,
} from './current.js';
import type { CurrentStorePort } from './current.js';
import {
	readDisplayName,
	readGrants,
	writeGrants,
} from './meta.js';
import type { MetaStorePort } from './meta.js';
import type { CurrentStatus, Workspace } from './types.js';
import {
	archiveWorkspace as archiveOne,
	createWorkspace as createOne,
	findWorkspace,
	listWorkspaces as listAll,
	unarchiveWorkspace as unarchiveOne,
} from './workspaces.js';
import type { WorkspaceStorePort } from './workspaces.js';

export const name = 'taskboard2-workgroup';

/**
 * ① store 提供持久化。
 *
 * ⚠ **不 inject `taskboard2Types`**：⑥ 的实现一次都没用它，而 Cordis 的
 * `_refresh()` 要求 `inject` 里每一项都已被 `provide`，否则 fiber 永远停在
 * `PENDING`（`cordis/src/fiber.ts:611-623`）。**空挂一个 inject 项 = 永不激活。**
 *
 * 将来若空间需要 `g-N` 编号（归 ③），**那时再加回 `taskboard2Types`**。
 */
export const inject = ['taskboard2Store'];

/** ① store 的能力形状（只声明 ⑥ 用到的部分）。 */
type StoreLike = WorkspaceStorePort & CurrentStorePort & MetaStorePort;

/** ⑥ 对外提供的服务。 */
export interface WorkgroupService {
	/** 建空间：清洗 + 重名消歧义 + 建库。 */
	createWorkspace(rawName: string): Workspace;
	/** 列空间；`includeArchived` 为 `true` 时含归档。 */
	listWorkspaces(includeArchived?: boolean): Workspace[];
	/** 归档（物理移动进 `archive/`）。幂等。 */
	archiveWorkspace(wsId: string): void;
	/** 取消归档（物理移回根目录）。幂等。 */
	unarchiveWorkspace(wsId: string): void;
	/** 当前空间三态。⑥ 不出文案、不抛业务错。 */
	resolveCurrent(sessionId: string): CurrentStatus;
	/** 设置某会话的当前空间。不校验存在性。 */
	setCurrent(sessionId: string, workspaceId: string): void;
	/** 清掉某会话的当前指针。幂等。 */
	clearCurrent(sessionId: string): void;

	/** 读空间元信息（原始键值，含 `name` / `nameRaw` / `grants`）。 */
	readWorkspaceMeta(wsId: string): Record<string, unknown>;
	/** 写一个元信息键；`value === undefined` 表示删除该键。 */
	writeWorkspaceMeta(wsId: string, key: string, value: unknown): void;
	/** 读显示名；缺失回落到 id。 */
	readDisplayName(wsId: string): string;
	/** 读子工作区 / 额外工作区元数据；没有则 `undefined`。 */
	readGrants(wsId: string): Record<string, unknown> | undefined;
	/** 写子工作区 / 额外工作区元数据。**不做任何校验**（只存不执法）。 */
	writeGrants(wsId: string, grants: unknown): void;
	/** 查一个空间是否存在；存在返回投影。 */
	findWorkspace(wsId: string): Workspace | undefined;
}

export function apply(ctx: any): void {
	/** 惰性取 ① —— 插件加载顺序不保证 apply 时依赖已就绪。 */
	function store(): StoreLike {
		const service = ctx?.taskboard2Store;
		if (service === undefined || service === null) {
			throw new Error('taskboard2Workgroup requires the taskboard2Store service');
		}
		return service as StoreLike;
	}

	const service: WorkgroupService = {
		createWorkspace(rawName: string): Workspace {
			return createOne(store(), rawName);
		},
		listWorkspaces(includeArchived = false): Workspace[] {
			return listAll(store(), includeArchived);
		},
		archiveWorkspace(wsId: string): void {
			archiveOne(store(), wsId);
		},
		unarchiveWorkspace(wsId: string): void {
			unarchiveOne(store(), wsId);
		},

		resolveCurrent(sessionId: string): CurrentStatus {
			return resolveCurrent(store(), sessionId);
		},
		setCurrent(sessionId: string, workspaceId: string): void {
			setCurrent(store(), sessionId, workspaceId);
		},
		clearCurrent(sessionId: string): void {
			clearCurrent(store(), sessionId);
		},

		readWorkspaceMeta(wsId: string): Record<string, unknown> {
			return store().readMeta(wsId);
		},
		writeWorkspaceMeta(wsId: string, key: string, value: unknown): void {
			store().writeMetaKey(wsId, key, value);
		},
		readDisplayName(wsId: string): string {
			return readDisplayName(store(), wsId);
		},
		readGrants(wsId: string): Record<string, unknown> | undefined {
			return readGrants(store(), wsId);
		},
		writeGrants(wsId: string, grants: unknown): void {
			writeGrants(store(), wsId, grants);
		},
		findWorkspace(wsId: string): Workspace | undefined {
			return findWorkspace(store(), wsId);
		},
	};

	ctx.provide('taskboard2Workgroup', service);
}
