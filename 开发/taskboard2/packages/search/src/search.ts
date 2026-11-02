/**
 * ⑤ search —— 搜索。**宿主侧的纯函数。**
 *
 * ## 它是什么
 *
 * 吃「一批卡 + 一份条件」，吐筛选结果。不取数据、不认空间、不建索引、无状态、无 IO。
 *
 * ## 为什么存在
 *
 * 用户 `2026-11-01 05:39`：
 * 「搜索提供的是口径。是让 dsh 命令和 ai tool 有相同的文本。
 *   和 dsh 命令、ai tool、ui 搜索框，有相同的筛选结果。」
 *
 * ⇒ 价值在**一致性**，不在"多一个查询 API"。所以本文件是纯函数，
 * 谁都能 import，但谁都只有这一份实现。
 *
 * ## 为什么必须跑在宿主侧
 *
 * 因为 ⑤ 吃的是 core 内存里的卡集，而浏览器拿不到它。
 * ⇒ ⑩ 的搜索框把**条件序列化**发给宿主 → 宿主侧调 ⑤ → 结果回传。
 * **这也是"条件必须可序列化"的原始理由** —— 它要跨「浏览器 → 宿主」这条边界。
 *
 * ## ⚠ 本包不 import ④
 *
 * ④ 与 ⑤ 是两个独立包，**并列、不互相调用**：④ 出边，⑤ 出筛选后的卡集。
 * 见 `docs/05-search.md` 3.3。
 */

import type { SearchCondition } from './condition.js';

/**
 * ⑤ 看到的卡的最小面。
 *
 * ⚠ **这里没有 import ⑦ 的 `Card`**：⑦ 的 `Card` 定义在 `@local/taskboard2-taskcard`，
 * 而 ⑤ 不该依赖任务卡包（它只需要**结构子集**，不需要"卡是什么"的全部知识）。
 * 用结构类型的好处：⑦ 的 `Card` 只要满足这些字段，**无需任何适配**就能直接传进来。
 */
export interface SearchCard {
	/** 编号。参与关键词匹配（用户 13:18：搜索可搜标题、编号）。 */
	readonly id: string;
	/** 标题。参与关键词匹配。 */
	readonly title: string;
	/** 状态。参与 `status` / `group` 两个筛选（`group` 由调用方展开成状态列表）。 */
	readonly status: string;
	readonly template: {
		readonly ref: string;
		readonly kind: string;
		/**
		 * 领域。**存在卡上**（用户 `2026-11-02 00:23`「template 要有领域的」），
		 * 所以 ⑤ 按领域筛时不需要任何外部映射。
		 */
		readonly domain: string;
	};
	/** 历史事件。**只用于排序**，不参与关键词、不参与筛选。 */
	readonly history: readonly {
		readonly at: number;
		readonly action: string;
		readonly detail?: unknown;
	}[];
}

/**
 * 「采纳」在 `history` 里的 action 字符串。
 *
 * ⚠ **TODO: 与 ⑦ 对齐** —— ⑦ 尚未定这个字符串。改动只允许改这一处常量，
 * 逻辑里不得出现该字面量。
 */
const ADOPT_ACTION = 'adopt';

/** UTF-16 code unit 比较。**不用 `localeCompare`** —— 它依赖运行环境 locale，跨机器不稳定。 */
function compareCodeUnit(a: string, b: string): number {
	if (a < b) return -1;
	if (a > b) return 1;
	return 0;
}

/**
 * 取一张卡的**采纳时间**；没有采纳记录返回 `undefined`。
 *
 * `history` 是数组但**不保证有序** ⇒ 必须扫描全部，按 `at` 取最小（最早那次采纳）。
 */
function adoptedAt(card: SearchCard): number | undefined {
	let earliest: number | undefined;
	for (const entry of card.history) {
		if (entry.action !== ADOPT_ACTION) continue;
		if (earliest === undefined || entry.at < earliest) earliest = entry.at;
	}
	return earliest;
}

/**
 * 按**采纳顺序**排序，并单列"没有采纳记录"的卡。
 *
 * 用户 `2026-11-01 13:18`：「搜索不提供排序。按照卡的采纳顺序返回。」
 * 数据依据（`2026-11-02 00:26` 批）：「卡的『历史』这个字段存了他的状态转变时间。」
 *
 * - 同 `at` ⇒ 用 `id` 做确定性 tie-break（否则跨机器排序不稳定）；
 * - **没有采纳记录**的卡 **不猜**：不静默混进正常序里，而是**单独返回**，
 *   由调用方决定怎么处置（理论上不该出现，因为建卡即入库）。
 *   `search` 的调用者若只想拿结果，用 `search(...)`；要察觉异常，用本函数。
 */
export function orderByAdoption(cards: readonly SearchCard[]): {
	readonly ordered: readonly SearchCard[];
	readonly missingAdoption: readonly SearchCard[];
} {
	const withTime: { card: SearchCard; at: number }[] = [];
	const missingAdoption: SearchCard[] = [];

	for (const card of cards) {
		const at = adoptedAt(card);
		if (at === undefined) missingAdoption.push(card);
		else withTime.push({ card, at });
	}

	withTime.sort((left, right) => {
		if (left.at !== right.at) return left.at - right.at;
		return compareCodeUnit(left.card.id, right.card.id);
	});

	missingAdoption.sort((left, right) => compareCodeUnit(left.id, right.id));

	return { ordered: withTime.map((item) => item.card), missingAdoption };
}

/** 关键词匹配：**标题 + 编号**，子串匹配，不做大小写折叠、不 trim。 */
function matchesKeyword(card: SearchCard, keyword: string): boolean {
	if (keyword === '') return true;
	return card.title.includes(keyword) || card.id.includes(keyword);
}

function matchesAny(value: string, allowed: readonly string[] | undefined): boolean {
	if (allowed === undefined || allowed.length === 0) return true;
	return allowed.includes(value);
}

/**
 * 按条件筛选。**纯函数**，无副作用、无状态、不排序（顺序由 `orderByAdoption` 决定）。
 *
 * - 字段之间 **AND**；同字段数组内 **OR**；
 * - 空条件 `{}` ⇒ 返回全集；
 * - **`domain` 精确比较，不做归一化**（不 trim、不折叠大小写、不合并别名）。
 *
 * ⚠ **不返回**"没有采纳记录"的卡 —— 它们无法确定位置。要连它们一起拿，
 * 请用 `searchAll` 或自行调 `orderByAdoption`。见该函数的注释。
 */
export function filterCards(
	cards: readonly SearchCard[],
	condition: SearchCondition,
): readonly SearchCard[] {
	const keyword = condition.keyword;

	return cards.filter((card) => {
		if (keyword !== undefined && !matchesKeyword(card, keyword)) return false;
		if (!matchesAny(card.status, condition.status)) return false;
		/* `group` 是"状态组"，由调用方展开成状态列表后传进来 —— ⑤ 不解释组。 */
		if (!matchesAny(card.status, condition.group)) return false;
		if (!matchesAny(card.template.domain, condition.domain)) return false;
		return true;
	});
}

/**
 * 搜索：筛选 + 按采纳顺序返回。
 *
 * 用户的 UI 形态是「搜索框 + 三个按钮」，AI 工具形态是「一个方法，搜索的同时筛选」——
 * 两者都落到这一个函数：`condition` 里可以只有 `keyword`、只有筛选、或两者都有。
 */
export function search(cards: readonly SearchCard[], condition: SearchCondition): SearchCard[] {
	const matched = filterCards(cards, condition);
	return [...orderByAdoption(matched).ordered];
}

/**
 * 搜索并**同时**返回无法定位顺序的卡。
 *
 * `search` 只给结果，会把"没有采纳记录"的卡静默丢掉 —— 那对"看不见就不存在"的人来说是陷阱。
 * 需要察觉异常时用本函数：`missingAdoption` 非空即是数据问题。
 */
export function searchAll(
	cards: readonly SearchCard[],
	condition: SearchCondition,
): {
	readonly matched: readonly SearchCard[];
	readonly missingAdoption: readonly SearchCard[];
} {
	const matched = filterCards(cards, condition);
	const { ordered, missingAdoption } = orderByAdoption(matched);
	return { matched: ordered, missingAdoption };
}
