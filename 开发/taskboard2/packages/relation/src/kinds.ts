/**
 * ④ relation —— 关系词汇表。
 *
 * 一份定义同时承载 **显示名 / 方向 / 是否有行为**，供运行时数据与编译期类型两种用途。
 * 依据见 `docs/04-relation.md` 2.2。
 *
 * ## 为什么是对象数组而不是字符串数组
 *
 * ⑤ 判方向、⑨ 判有无行为、⑩ 取显示名。若各自持有一份字符串列表，词汇会散成三份，
 * 而它们必须永远一致 —— 所以词汇只有一份，别处一律从本文件派生。
 *
 * 代价：取标识集合要 `map(k => k.id)`，**不要假设它是字符串数组**。
 *
 * ## `id` 用英文标识、`displayName` 用中文
 *
 * 用户 `2026-11-01 13:18`：「关系是有行为的。所以是英文和显示名。」
 *
 * `displayName` 是**名词**（词汇表的一项），不是终端组织的**句子**（软警告文字仍归 ⑨⑪）。
 * 两者不是一类东西：名词不随上下文变，句子会变。见 docs 2.2b。
 *
 * ## `hasBehavior` 只有 `dependsOn`
 *
 * 同上用户原话：「有行为的只有"依赖"。效果是所有依赖对象都进入了完成态，
 * 这个卡才能被领取（从提交转为处理中的那个状态转换的按钮）」
 *
 * ⚠ 别把这两件事当"行为"：
 *   - `supersedes` 曾有的「不可编辑」是编辑规则，且已被用户 `13:18` 推翻；
 *   - `related` 的「双向」是方向属性（`direction: 'both'`）。
 */

/** 一条关系词汇的定义形状。 */
export interface LinkKind {
	/** 稳定英文标识。存进卡里、参与逻辑判断的就是它。 */
	readonly id: string;
	/** 中文显示名。只给人看，不参与任何判断。 */
	readonly displayName: string;
	/** 方向：`forward` 有向；`both` 无向（只有 `related`）。 */
	readonly direction: 'forward' | 'both';
	/** 是否有状态转移行为。当前只有 `dependsOn` 为 `true`。 */
	readonly hasBehavior: boolean;
}

/**
 * 词汇表。**单源** —— 任何地方要写关系标识，一律从这里派生，不得写字面量。
 */
export const LINK_KINDS = [
	{ id: 'dependsOn', displayName: '依赖', direction: 'forward', hasBehavior: true },
	{ id: 'supersedes', displayName: '取代', direction: 'forward', hasBehavior: false },
	{ id: 'constrains', displayName: '约束', direction: 'forward', hasBehavior: false },
	{ id: 'related', displayName: '相关', direction: 'both', hasBehavior: false },
	{ id: 'references', displayName: '参考', direction: 'forward', hasBehavior: false },
] as const;

/** 五种 link 标签中的任一（`派生` 不在此列，它由 `parent` 字段承载）。 */
export type LinkLabel = (typeof LINK_KINDS)[number]['id'];

/** 有状态转移行为的边所对应的标识集合。 */
export type BehaviorLinkLabel = Extract<
	(typeof LINK_KINDS)[number],
	{ hasBehavior: true }
>['id'];

/** 无向边的标识集合（应当恰好一个成员：`related`）。 */
export type UndirectedLinkLabel = Extract<
	(typeof LINK_KINDS)[number],
	{ direction: 'both' }
>['id'];

/**
 * 唯一"有状态转移行为"的边（= `dependsOn`）。
 *
 * **别处要用这条边时一律引用本常量，不写字面量。**
 *
 * 这里写的是字面量，但**它被标注成从词汇表派生的类型** `BehaviorLinkLabel`：
 * 一旦词汇表里把 `hasBehavior` 从 `dependsOn` 挪走（或改 id），
 * **这行会直接编译失败**，而不是静默指向一条不再有行为的边。
 * 用运行时查找反而拿不到这个保证（查找结果是 `| undefined`，得靠兜底值掩盖）。
 */
export const BEHAVIOR_LINK: BehaviorLinkLabel = 'dependsOn';

/** 唯一"无向"的边（= `related`）。同样由类型保证与词汇表一致。 */
export const UNDIRECTED_LINK: UndirectedLinkLabel = 'related';

/** 某个标识是否是已知的关系。 */
export function isLinkLabel(value: unknown): value is LinkLabel {
	if (typeof value !== 'string') return false;
	return LINK_KINDS.some((kind) => kind.id === value);
}

/** 取某个标识的词汇定义；未知标识返回 `undefined`。 */
export function linkKindOf(label: string): LinkKind | undefined {
	return LINK_KINDS.find((kind) => kind.id === label);
}

/*
 * ── 编译期断言：词汇表自身必须自洽 ──────────────────────────────────
 *
 * 只存在于编译期，运行时零开销；任何一条不成立都会让**本包编译失败**。
 *
 * 为什么必须有：词汇表被改坏时（删光了、或"无向"变成了全集），
 * 下游只会静默走偏，**不会有任何报错**。所以把不变量钉在类型上。
 *
 * ⚠ 失败侧必须是 `false`，**不能是 `never`** —— `never` 满足任何约束，
 * 断言会静默通过。这是这类断言最常见的失效方式。
 */

/** 断言 `T` 恰好是 `true`；`T` 为 `false` 时编译失败。 */
type _AssertTrue<T extends true> = T;

/** 词汇表至少 2 条：少于 2 条时"有向 / 无向"的区分就退化了。 */
type _AtLeastTwo = (typeof LINK_KINDS)['length'] extends 0 | 1 ? false : true;

/** 无向边**非空**：零条 ⇒ 无向语义丢失。 */
type _SomeUndirected = [UndirectedLinkLabel] extends [never] ? false : true;

/** 无向边**非全集**：全都无向 ⇒ 「有向」失去意义。 */
type _SomeDirected = [Exclude<LinkLabel, UndirectedLinkLabel>] extends [never] ? false : true;

/** 有行为的边**非空**：级联"收依赖方"靠它，零条时那条路永远走不到。 */
type _SomeBehaviorLink = [BehaviorLinkLabel] extends [never] ? false : true;

/*
 * 上面几个别名是**惰性的**：不被引用就不会求值，也就不会报错。
 * 下面这行把它们真正接进编译：任何一条不成立 ⇒ 本包编译失败。
 */
export type _VOCABULARY_IS_CONSISTENT = _AssertTrue<
	[
		_AtLeastTwo,
		_SomeUndirected,
		_SomeDirected,
		_SomeBehaviorLink,
	] extends [true, true, true, true]
		? true
		: false
>;

/*
 * ⚠ 必须用 `export type`：`isolatedModules` 下把**类型**当值再导出会编译报错。
 */
export type {
	_AssertTrue as _LinkKindAssert,
	_AtLeastTwo as _LinkKindsAtLeastTwo,
	_SomeUndirected as _LinkKindsSomeUndirected,
	_SomeDirected as _LinkKindsSomeDirected,
	_SomeBehaviorLink as _LinkKindsSomeBehaviorLink,
};
