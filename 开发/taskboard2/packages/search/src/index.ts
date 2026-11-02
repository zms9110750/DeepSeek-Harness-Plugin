/**
 * ⑤ 搜索 —— Cordis 入口。
 *
 * 只读查询。纯函数，不取数据、不认空间、不建索引、无状态、无 IO。
 *
 * ## 为什么必须 `provide`
 *
 * 能力虽全是纯函数，但**仍然要 provide 服务**：
 *
 *   - Cordis 的 `inject` 机制是"**等对方 provide**"（`cordis/src/fiber.ts:611-623` 的 `_refresh`：
 *     `inject` 里有一项在 `_store` 里找不到 ⇒ `epoch = INACTIVE` ⇒ **永远 `PENDING`，`apply` 永不执行**）。
 *     **⑤ 不 provide ⇒ ⑧ 永远起不来** —— 不是"慢一点"，是停在原地。
 *   - README 硬规矩：**上层只通过服务调用下层，不 import 实现**。
 *     若 ⑧ 直接 import ⑤，⑤ 就不能被替换、不能热重载 —— 那等于取消了本包的开关。
 *
 * ⚠ 本文件此前写过"不提供 service，消费者直接 import"，**那条是错的**（已删）。
 * 当时依据的是**包依赖纪律**（值 / 纯函数走 `package.json` 依赖，不必写进 `inject`）——
 * 但那讲的是"**不必 inject**"，**不等于"可以不 provide"**。两件事，我混为一谈了。
 *
 * ## 零依赖
 *
 * `inject = []`，且**零 `@local/*` import** —— 包括**不 import ④ relation**。
 * ④ 与 ⑤ 是两个独立包，**并列、不互相调用**：④ 出边，⑤ 出筛选后的卡集，由 ⑧ 编排。
 *
 * 卡用的是**结构子集**（`SearchCard`），不是 ⑦ 的 `Card` ——
 * ⑦ 的卡只要满足这几个字段就能直接传进来，不需要适配层。
 *
 * 见 `docs/05-search.md`。
 */

import type { SearchCondition } from './condition.js';
import { filterCards, orderByAdoption, search, searchAll } from './search.js';
import type { SearchCard } from './search.js';

export const name = 'taskboard2-search';

/** 不依赖任何前置服务。 */
export const inject = [];

/**
 * ⑧ 消费的服务面。
 *
 * 四个成员与同名纯函数**逐字对应**，不做任何额外逻辑 ——
 * 一旦这里出现"服务面和纯函数不一样"的分叉，就说明有第二份实现，那是 bug。
 */
export interface SearchService {
	/** 筛选 + 按采纳顺序返回。**会丢掉"没有采纳记录"的卡** —— 要察觉异常用 `searchAll`。 */
	search(cards: readonly SearchCard[], condition: SearchCondition): SearchCard[];
	/** 筛选 + 排序，并**单列**无法确定顺序的卡。 */
	searchAll(
		cards: readonly SearchCard[],
		condition: SearchCondition,
	): {
		readonly matched: readonly SearchCard[];
		readonly missingAdoption: readonly SearchCard[];
	};
	/** 只筛选、不排序。 */
	filterCards(cards: readonly SearchCard[], condition: SearchCondition): readonly SearchCard[];
	/** 只排序（按采纳时间，同时间戳用 `id` 做确定性 tie-break）。 */
	orderByAdoption(cards: readonly SearchCard[]): {
		readonly ordered: readonly SearchCard[];
		readonly missingAdoption: readonly SearchCard[];
	};
}

/**
 * 提供 `taskboard2Search`。
 *
 * ⚠ **不包 try/catch**：静默跳过会让本包"看起来成功"，而 ⑧ 永远停在 `PENDING` ——
 * 报错被吞掉、症状出现在别人那里。**宁可在这里炸，也不要让下游挂起。**
 */
export function apply(ctx: any): void {
	const service: SearchService = {
		search: (cards, condition) => search(cards, condition),
		searchAll: (cards, condition) => searchAll(cards, condition),
		filterCards: (cards, condition) => filterCards(cards, condition),
		orderByAdoption: (cards) => orderByAdoption(cards),
	};

	ctx.provide('taskboard2Search', service);
}

/* ── 条件 ── */
export type { SearchCondition } from './condition.js';

/* ── 搜索 ── */
export {
	filterCards,
	orderByAdoption,
	search,
	searchAll,
	type SearchCard,
} from './search.js';
