/**
 * 空间元信息的读写 —— 全部经 ① store。
 *
 * ⚠ ⑥ **不直接碰 SQLite**。元信息存在**该空间自己的 `.db`** 的 `meta` 表里，
 * 这样拖走一个 `.db` 就带走该空间的全部信息（名字、工作区授权）。
 */

/** 空间显示名的键。 */
export const META_KEY_NAME = 'name';

/** 用户最初输入的键（仅溯源，**不参与显示**）。 */
export const META_KEY_NAME_RAW = 'nameRaw';

/** 子工作区 / 额外工作区元数据的键。 */
export const META_KEY_GRANTS = 'grants';

/** ⑥ 需要的 ① 能力子集（只声明用到的，避免依赖整个服务形状）。 */
export interface MetaStorePort {
	readMeta(wsId: string): Record<string, unknown>;
	writeMetaKey(wsId: string, key: string, value: unknown): void;
}

/** 读空间显示名；缺失时回落到 id。 */
export function readDisplayName(store: MetaStorePort, wsId: string): string {
	const meta = store.readMeta(wsId);
	const name = meta[META_KEY_NAME];
	if (typeof name === 'string' && name.length > 0) return name;
	return wsId;
}

/** 写空间显示名（与用户最初输入）。 */
export function writeDisplayName(
	store: MetaStorePort,
	wsId: string,
	displayName: string,
	rawName: string,
): void {
	store.writeMetaKey(wsId, META_KEY_NAME, displayName);
	store.writeMetaKey(wsId, META_KEY_NAME_RAW, rawName);
}

/** 读子工作区 / 额外工作区元数据；没有则返回 `undefined`。 */
export function readGrants(store: MetaStorePort, wsId: string): Record<string, unknown> | undefined {
	const meta = store.readMeta(wsId);
	const grants = meta[META_KEY_GRANTS];
	if (typeof grants !== 'object' || grants === null || Array.isArray(grants)) return undefined;
	return grants as Record<string, unknown>;
}

/**
 * 写子工作区 / 额外工作区元数据。
 *
 * ⚠ **不做任何校验**（「只存不执法」）：不检查键、不检查路径是否存在、
 * 不检查绝对路径、不检查子路径关系。
 *
 * `undefined` ⇒ 删除该键（用户清空这组数据）。
 */
export function writeGrants(store: MetaStorePort, wsId: string, grants: unknown): void {
	store.writeMetaKey(wsId, META_KEY_GRANTS, grants);
}
