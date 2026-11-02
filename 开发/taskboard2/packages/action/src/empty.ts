/**
 * ② action —— 空 payload 构造。
 *
 * ⑧ 用它补 fork 时的缺章。
 */

import { getAction, list } from './registry.js';
import type { ActionPayload, SchemaNode } from './types.js';

/** 没有候选时用最简单的控件。 */
const DEFAULT_TYPE = 'text';

/**
 * 造一份空 payload。
 *
 * **不接受 `accepts`**（模板不再限制组件）。core 要补某章时，直接问 ② 要一份默认 payload。
 *
 * @param preferredType 可选的偏好 `$type`；不可用时退到内置 `text`，再退到第一个已注册的
 * @returns 没有任何已注册 action 时返回 `undefined`
 */
export function emptyPayloadFor(preferredType?: string): ActionPayload | undefined {
	const chosen =
		(preferredType !== undefined && getAction(preferredType) !== undefined ? preferredType : undefined) ??
		(getAction(DEFAULT_TYPE) !== undefined ? DEFAULT_TYPE : list()[0]);

	if (chosen === undefined) return undefined;

	const action = getAction(chosen);
	if (action === undefined) return undefined;

	return emptyFor(chosen, action.schema);
}

/** 按 schema 造一份最小合法 payload（只填 `$type` 与 schema 的 `const` 字段）。 */
function emptyFor($type: string, schema: SchemaNode): ActionPayload {
	const base: Record<string, unknown> = { $type };

	const properties = schema.properties ?? {};
	for (const [key, child] of Object.entries(properties)) {
		if (child.const !== undefined) {
			base[key] = child.const;
		}
	}

	return base as ActionPayload;
}
