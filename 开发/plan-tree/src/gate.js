/**
 * plan-gate · 派发闸门：层序、类型、模板失败提示。
 *
 * 闸门只回答三件事：目标层在不在、是不是比当前层更深、这个模板失败了几次。
 * 它不认"四层"也不认层名——层名来自模板，闸门只比较序数。
 *
 * **不再有"连否三次就禁派"**。用户改了这个规则：同一模板累计 3 次失败 →
 * 宿主自动建一份复盘任务（F 系列），闸门只**提示**，不拦截。禁模板是被明确否掉的。
 * 计数的单位是模板（不是层、不是全局），累计（不要求连续）。
 *
 * 研究任务没有层坐标，所以层规则对它不适用，而不是给它开例外；反过来，
 * 研究/复盘只能派研究/复盘，堵住"被卡住的层绕一圈又去派计划"的后门（B-01 的后门那一条）。
 *
 * @module @local/plan-tree/gate
 */

export const name = 'plan-gate';

export const inject = [];

/** 同一模板累计失败几次后提示先复盘。数字与 plan-state 的 REVIEW_EVERY 一致。 */
export const MAX_FAILURES = 3;

/** 允许自派同层的层名。空表 = 全禁（等深必须由模板显式声明）。 */
export const RECURSIVE = [];

const RESEARCH_LIKE = new Set(['research', 'review']);

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
 * 派发前的检查。纯函数：不写日志、不抛业务错误，返回判决。
 *
 * @param plan - 要派发的计划记录。
 * @param self - 当前会话在树里的节点（顶层会话没有）。
 * @param failures - 该模板累计失败次数（events/tree-store 给）。默认 0。
 * @param recursive - 允许自派同层的层名。
 * @returns `{ ok: true, type, layer, layerIndex, hint? }` 或者 `{ ok: false, reason }`。
 */
export function check({ plan, self, failures = 0, recursive = RECURSIVE, every = MAX_FAILURES }) {
	const type = plan.type === 'research' || plan.type === 'review' ? plan.type : 'plan';

	// 研究/复盘节点只能派研究/复盘，不能转头去派计划。
	if (self && RESEARCH_LIKE.has(self.type) && type === 'plan') {
		return { ok: false, reason: 'a research or review node can only dispatch research — plans must be dispatched by a plan node' };
	}

	// 研究/复盘没有层坐标：层规则不适用，不是开例外。
	if (RESEARCH_LIKE.has(type)) {
		return { ok: true, type, layer: null, layerIndex: null, ...(type === 'review' ? { review: true } : {}) };
	}

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

	// 累计失败到阈值只提示，不拦：先复盘，再回来改这份计划。
	const used = Number(failures) || 0;
	const hint = used >= every
		? `这个模板已累计 ${used} 次失败（每 ${every} 次一份复盘）。先采纳并派发复盘任务（plan_tree 里的 F 系列），` +
			'把坑落到"下一份计划具体改哪一条"，再派这份计划；本次仍可派发。'
		: undefined;

	return { ok: true, type: 'plan', layer, layerIndex: to, ...(hint === undefined ? {} : { hint }) };
}

export function apply(ctx) {
	ctx.provide('planGate', { MAX_FAILURES, RECURSIVE, check, selfNode });
}
