/**
 * ⑦ 任务卡 —— 整组状态转移（纯转移，不含额外语义）。
 *
 * ## 定位
 *
 * `【用户指令，2026-11-02 13:50】`
 * > **状态转移，是一个函数。参数是目标状态，调用者。**
 * > **调用者可能是用户，ai，系统（后端）**
 * > **用户和ai调用，就检查当前情况和权限。**
 * > **系统调用，就不读取那个目标状态的参数，自己按着转移规则数一下。切过去，或者不切**
 *
 * ## 边界
 *
 * · **只服务 `user` / `ai` 两种权限类别**（`Actor`）。
 *   系统（后端）那一支不在这里 —— 它不读 `to`、自己按规则算，是 ⑧ 的 `recompute`。
 * · **两个"主体"参数并列、互不映射**（`【用户指令，2026-11-02 14:05】`
 *   「除非把这两个语义进行了绑定或者就是一个语义。否则各用各的不要映射。」
 *   「领取是消息循环级别的。权限是 ai 这个类别的。」）：
 *   `principal`（身份，写历史）与 `actor`（权限类别，问 ③ / 判闸）。
 * · **只管纯转移**：产出 `setStatus` + 一个事件。
 *   `planAdopt`（触发取代）/ `planClaim`（设 `claimedBy`）/ `planRelease`（清占用）/
 *   `planDelete`（置墓碑）**各有额外语义，不从这条路走**。
 * · **⭐ 不处理 `to === WORKING`**：`提交 → 处理中` 是**领取**，`planClaim` 是它的唯一入口。
 *   理由：领取要同时写 `claimedBy` / `claimedAt`，并查「一个 actor 只能占一张」的跨卡配额 ——
 *   那是**领取的语义**，不是纯转移。若这里也放行，就会有两个入口写同一件事。
 * · **不写状态字面量**？—— 这里**故意例外**：出现 `'work'` / `'delivery'` / `'blocker'`。
 *   依据 `【用户指令，2026-11-02 13:30】`「直接在 ts 里面写字面量。因为核心的含义就是随包分发
 *   不可关闭的。就是预设这个东西一直在工作。改模板名字就把这里一起改了就是。」
 *
 * ## agent 的两道复核闸（只在 `kind === 'work'`、目标为成功 / 失败时）
 *
 * 矩阵 154 / 165 行：
 * ```
 * ai调用`成功`，且具有一个`成功`的`交付`，且所有的子任务都处于`完成`，且依赖的对象都为`完成`，变成`成功`
 * ```
 * 矩阵 155 / 166 行：
 * ```
 * ai调用`失败`，且具有一个`失败`的`交付`或`失败`的`阻碍`，变成`失败`
 * ```
 *
 * `【用户指令，2026-11-02 13:50】`
 * > **是的。就是判断模板是这个额而且状态是这个。**
 * > **报错。作为工具返回值。说为什么，哪一个子任务导致的。**
 * > **直接，不包含间接后代。**
 *
 * ## 同值 ⇒ 成功 + 空计划（不是拒绝）
 *
 * `【用户指令，2026-11-02 12:35】`
 * > **不切是必要的。因为状态转移会在"历史"里面留下一个记录。**
 *
 * ⇒ `to === card.status` ⇒ `{ ok: true, items: [], events: [] }`。
 * **不是 `ok: false`** —— "点了一个已经是的状态"不是错误；若返回拒绝，⑧ / tool 会把它当失败
 * 报给用户。形状与 `planDelete` 的幂等早退一致。
 */

import type {
	Actor,
	Card,
	ChildSnapshot,
	HistoryEntry,
	Plan,
	PlanItem,
	PlanResult,
	Ports,
	Principal,
	TaskState,
} from './types.js';
import { describePrincipal } from './claim.js';

/**
 * 纯转移写进历史的动作名。
 *
 * **所有转移共用一个动作名**：历史里记的是"状态变了"，具体从哪到哪由 `detail` 的
 * `{ from, to }` 表达（`【用户指令，2026-11-02 12:35】`「触发通知的是状态转移本身」）。
 * 不按"哪个按钮"分动作名 —— 按钮是 UI 概念，同一目标状态可能来自多个按钮。
 */
export const TRANSITION_ACTION = 'transition';

/**
 * 工作卡的分类 id —— **字面量，随包分发、不可关闭**
 * （`【用户指令，2026-11-02 13:30】`「直接在 ts 里面写字面量……改模板名字就把这里一起改了就是」）。
 */
const WORK_KIND = 'work';
/** 「交付」模板名（字面量，同上）。 */
const DELIVERY_TEMPLATE = 'delivery';
/** 「阻碍」模板名（字面量，同上）。 */
const BLOCKER_TEMPLATE = 'blocker';

/** `planTransition` 的入参。 */
export interface TransitionInput {
	/** 目标状态。**用户 / agent 调用时必填**；系统调用不走这条（它不读 `to`）。 */
	readonly to: TaskState;
	/**
	 * **身份**：谁在操作（写历史用）。`{type:'user'}` 或 `{type:'agentMessageLoop', id}`。
	 *
	 * 与 `actor` 是两个不同语义（`【用户指令，2026-11-02 14:05】`「各用各的不要映射」）。
	 */
	readonly principal: Principal;
	/** **权限类别**：问 ③ 用的 `'user' | 'ai' | 'host'`。⑧ 自己知道它，⑦ 不推断。 */
	readonly actor: Actor;
	/**
	 * 该卡的**依赖对象是否全部进入「完成」组**（跨卡聚合，由 ⑧ 算好传入；无依赖传 `true`）。
	 *
	 * 矩阵 154/165 行的"依赖的对象都为`完成`"。**只有 agent 置成功时才读它**，
	 * 且由 **⑦ 自己判（闸 3）** —— ③ 的 `DEPENDS_ON_GATE` 只覆盖「提交 → 处理中」。
	 *
	 * ⚠ **该传却没传 ⇒ 拒**（fail-closed：不知道 ≠ 满足），不默认 `true`。
	 *
	 * ⚠ **不需要 `actorHasActiveWork`**：本函数不处理 `to === WORKING`，
	 * 配额那条事实只有 `planClaim` 用得上。
	 */
	readonly depsAllEnded?: boolean;
	/** 由 ⑧ 在事务内盖；⑦ 不取时钟。省略则不写历史。 */
	readonly at?: number;
}

/**
 * 把 `Card` 投影成 ③ 的 `ChildSnapshot`（**纯字段搬运，零策略**）。
 *
 * 「滤墓碑 + 滤草稿」的策略**只在 ③ 一处**（`kind.ts` 的 `liveChildren`）；
 * ⑦ 只负责把字段名摆对 —— 摆错就编译报错，不会出现第二版口径。
 */
export function toChildSnapshot(card: Card): ChildSnapshot {
	return {
		id: card.id,
		kind: card.template.kind,
		template: card.template.ref,
		status: card.status,
		deleted: card.deleted,
	};
}

export function planTransition(
	ports: Ports,
	card: Card,
	all: readonly Card[],
	input: TransitionInput,
): PlanResult {
	// ── ① 墓碑不参与任何转移 ──
	if (card.deleted) {
		return { ok: false, reason: { kind: 'already-deleted' } };
	}

	// ── ② 同值 ⇒ 成功 + 空计划（不问状态机、不产历史） ──
	//
	// 提到问 ③ **之前**：同值是"无需发生"的事实，不该依赖 ③ 的 `from === to → ALLOW`。
	// 若将来 ③ 把同值改成 DENY，这条短路仍然有效。
	if (input.to === card.status) {
		const noop: Plan = { ok: true, items: [], events: [] };
		return noop;
	}

	// ── ③ 领取不走这条路：`提交 → 处理中` 的唯一入口是 `planClaim` ──
	//
	// 领取要写 `claimedBy` / `claimedAt`、还要查「一个 actor 只能占一张」的跨卡配额 ——
	// 那是领取的语义，不是纯转移。这里再放一个入口，就变成**两个入口写同一件事**。
	if (input.to === ports.types.states.WORKING) {
		return { ok: false, reason: { kind: 'transition-not-allowed' } };
	}

	// ── ④ 状态机判决：问 ③，⑦ 不自己判 ──
	//
	// ⚠ **不传 `ctx`**：③ 的两个事实（`depsAllEnded` / `actorHasActiveWork`）在本条路径上
	// **一个都用不到** ——
	//   · `depsAllEnded` 只被「工作：提交 → 处理中」用，而这里 **已排除 `to === WORKING`**；
	//     依赖闸由 ⑤ 的**闸 3 自己判**（矩阵 154/165 的"依赖的对象都为`完成`"不归 ③）。
	//   · `actorHasActiveWork` 是领取的配额，同样只对 `→ WORKING` 有意义。
	//
	// ⇒ 不传 = **不编造**。③ 走不到那两个分支，也就不会抛错（按需校验）。
	if (!ports.types.canTransition(card.template.kind, card.status, input.to, input.actor)) {
		return { ok: false, reason: { kind: 'transition-not-allowed' } };
	}

	// ── ⑤ agent 的两道复核闸（只对「工作」卡的成功 / 失败） ──
	//
	// ⚠ 这里看的是 **`actor`（权限类别）**，不是 `principal`（身份）：
	// 「谁能决定方向」是**权限**问题，与"哪个消息循环"无关
	// （`【用户指令，2026-11-02 13:30】`「ai 不能决定方向……」）。
	// 用户不设闸；系统不走这条路径。
	if (input.actor === 'ai' && card.template.kind === WORK_KIND) {
		const completed = ports.types.states.COMPLETED;
		const failed = ports.types.states.FAILED;

		if (input.to === completed) {
			const children = childrenOf(ports, card, all);

			// 闸 1：必须有一个「成功」的「交付」。
			const hasSuccessDelivery = children.some(
				(child) => child.template === DELIVERY_TEMPLATE && child.status === completed,
			);
			if (!hasSuccessDelivery) {
				return { ok: false, reason: { kind: 'no-success-delivery' } };
			}

			// 闸 2：**所有直接子任务**都处于「完成」组（不带间接后代）。
			const notDone = children.filter((child) => !ports.types.isCompletedGroup(child.status));
			if (notDone.length > 0) {
				return {
					ok: false,
					reason: {
						kind: 'children-not-completed',
						children: notDone.map((child) => ({ id: child.id, status: child.status })),
					},
				};
			}

			// 闸 3：**依赖对象都为「完成」**。
			//
			// ⚠ **必须在这里判，不能指望 ③**：③ 的 `DEPENDS_ON_GATE` 只覆盖
			// 「工作：提交 → 处理中」（`isClaim`）那一条路径；**置成功不在它的覆盖范围内**。
			// 矩阵 154/165 行明确要求 ai 成功要满足"依赖的对象都为`完成`"。
			//
			// `depsAllEnded` 由 ⑧ 算好传入；**没传 ⇒ 我们不知道依赖是否满足**，
			// 不能默认放行 ⇒ 拒（fail-closed），与 ③ 的 `requireFact` 同一立场。
			if (input.depsAllEnded !== true) {
				return { ok: false, reason: { kind: 'deps-not-ended' } };
			}
		}

		if (input.to === failed) {
			const children = childrenOf(ports, card, all);

			// 一道道闸：有「失败」的「交付」或「阻碍」。
			// ⚠ 矩阵 155/166 行**没有**"所有子任务完成"的要求 ⇒ **不加**。
			const hasFailedEvidence = children.some(
				(child) =>
					(child.template === DELIVERY_TEMPLATE || child.template === BLOCKER_TEMPLATE) &&
					child.status === failed,
			);
			if (!hasFailedEvidence) {
				return { ok: false, reason: { kind: 'no-failed-evidence' } };
			}
		}
	}

	// ── ⑥ 产出：一条状态变更 + 一条事件 ──
	const items: PlanItem[] = [{ op: 'setStatus', cardId: card.id, to: input.to }];

	const events: HistoryEntry[] = [];
	if (input.at !== undefined) {
		events.push({
			at: input.at,
			action: TRANSITION_ACTION,
			// 「触发通知的是状态转移本身」⇒ from / to 必须落进事件，否则历史读不出"变过什么"。
			// `principal` 一并落进 detail：知道"谁触发的这次转移"（身份，不是权限类别）。
			detail: { from: card.status, to: input.to, principal: describePrincipal(input.principal) },
		});
	}

	const plan: Plan = { ok: true, items, events };
	return plan;
}

/**
 * 取本卡的**直接子任务**并做「滤墓碑 / 滤草稿」。
 *
 * · **直接**：`relations.parent === card.id`（`【用户指令，2026-11-02 13:50】`「直接，不包含间接后代」）
 * · **过滤策略**：一律走 **③ 的 `liveChildren`**，⑦ 不复制（只做 `toChildSnapshot` 投影）。
 */
function childrenOf(ports: Ports, card: Card, all: readonly Card[]): readonly ChildSnapshot[] {
	const direct: Card[] = [];
	for (const candidate of all) {
		if (candidate.relations.parent !== card.id) continue;
		direct.push(candidate);
	}
	return ports.types.liveChildren(direct.map(toChildSnapshot));
}
