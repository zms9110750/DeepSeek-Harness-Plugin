/**
 * plan-gate · 派发闸门：层序、类型、计数。
 *
 * 闸门只回答三个问题：目标层在不在、是不是比当前层更深、这一层还剩多少次机会。
 * 它不认"四层"也不认层名——层名来自模板，闸门只比较序数。
 *
 * 研究任务没有层坐标，所以层规则对它不适用，而不是给它开例外；反过来，
 * 研究只能派研究，堵住"被卡住的层绕一圈又去派计划"的后门（B-01 的后门那一条）。
 *
 * @module @local/plan-tree/gate
 */

export const name = 'plan-gate';

export const inject = [];

/** 同一层连续被否决几次之后，这一层只接受研究任务。 */
export const MAX_REJECTIONS = 3;

/** 允许自派同层的层名。空表 = 全禁（等深必须由模板显式声明）。 */
export const RECURSIVE = [];

/**
 * 这个会话在树里对应的那个节点（它自己就是被派发出来的话）。
 * @param nodes - `nodes` 投影里的全部节点。
 * @param sessionId - 当前会话 id。
 */
export function selfNode(nodes, sessionId) {
	for (const node of Object.values(nodes ?? {})) {
		if (node.childId === sessionId) return node;
	}
	return undefined;
}

/**
 * 派发前的三项检查。纯函数：不写日志、不抛业务错误，返回判决。
 * @param plan - 要派发的计划记录。
 * @param self - 当前会话在树里的节点（顶层会话没有）。
 * @param counts - 每层自上次成功以来的否决数。
 * @param recursive - 允许自派同层的层名。
 * @returns `{ ok: true, layer, layerIndex }` 或者 `{ ok: false, reason }`。
 */
export function check({ plan, self, counts = {}, recursive = RECURSIVE }) {
	const type = plan.type === 'research' ? 'research' : 'plan';

	if (self && self.type === 'research' && type === 'plan') {
		return { ok: false, reason: 'a research node can only dispatch research — plans must be dispatched by a plan node' };
	}

	// 研究没有层坐标：层规则不适用，不是开例外。
	if (type === 'research') return { ok: true, type, layer: null, layerIndex: null };

	const layer = plan.layer ?? null;
	const to = plan.layerIndex;
	if (typeof to !== 'number') {
		return { ok: false, reason: 'plan_dispatch: this plan has no layer index — write it against a template' };
	}

	const from = self?.layerIndex;
	if (typeof from === 'number') {
		const allowed = recursive.includes(self.layer) && to === from;
		if (!allowed && to <= from) {
			return {
				ok: false,
				reason: `plan_dispatch: ${layer} is not deeper than ${self.layer}; a plan may only dispatch a deeper layer`,
			};
		}
	}

	const used = counts[layer] ?? 0;
	if (used >= MAX_REJECTIONS) {
		return {
			ok: false,
			reason:
				`plan_dispatch: layer ${layer} already has ${used} consecutive rejections; ` +
				'dispatch a research node first, and let it settle before dispatching plans here again',
		};
	}

	return { ok: true, type: 'plan', layer, layerIndex: to };
}

export function apply(ctx) {
	ctx.provide('planGate', { MAX_REJECTIONS, RECURSIVE, check, selfNode });
}
