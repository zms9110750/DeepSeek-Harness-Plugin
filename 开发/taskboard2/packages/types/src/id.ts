/**
 * ③ id —— 编号：前缀 + 流水号，直接拼接，无分隔符。
 *
 * canonical：`/^[A-Z]+[0-9]+$/`（大写、无连字符）。例 `G01` / `GA01` / `GTT01`。
 * 展示形：`G-01` / `GU-02`（`toDisplay` 插一个连字符）。
 *
 * 规则要点（均有用户裁决依据）：
 *   - 前缀 = 分类字母 + 模板的 `codePrefix`；`codePrefix === ''` 时退化为「分类字母 + 流水」。
 *   - 递增**按前缀分桶**；每个 `(工作空间, 前缀)` 一套序列，互不影响。
 *   - 流水号补零 2 位，`≥100` 自然三位，不截断、不回绕。
 *   - 唯一性只在工作空间内；跨空间可重复。
 *   - 删除是标记删除 ⇒ 编号**永不复用**，跳号合法 ⇒ `usedIds` **必须含墓碑**（调用方义务）。
 *   - 外部注册不保证唯一 ⇒ 不得因编号冲突拒绝外部模板。
 *
 * 所有函数都是**纯函数**：不读存储、不碰文件系统、不认识工作空间。
 * 并发安全不在本模块（发号与写卡必须由调用方放进同一事务）。
 */

/** 编号的规范形：连续字母段 + 连续数字段。 */
const CANONICAL_RE = /^([A-Z]+)([0-9]+)$/;

/** 前缀的合法形式：至少一个大写字母（= 分类字母 + 可空的模板字母段）。 */
const PREFIX_RE = /^[A-Z]+$/;

/** 规范形解析结果。 */
export type ParsedId = {
	/** 连续字母段（分类段 + 模板段，不拆分）。 */
	readonly prefix: string;
	/** 数字段的数值。 */
	readonly serial: number;
};

/**
 * 解析编号。
 *
 * **只拆字母段与数字段，不解析分类、不解析模板、不解析工作空间。**
 * 原因：外部注册可同前缀、一模板多分类、前缀长度不定 ⇒ 反推分类必然出错。
 * 要分类请走 `resolve(name)`。
 *
 * 不合规范形 ⇒ `undefined`（不抛错：旧数据 / 外部编号都可能不合规）。
 */
export function parse(id: string): ParsedId | undefined {
	if (typeof id !== 'string') return undefined;
	const match = CANONICAL_RE.exec(normalize(id));
	if (match === null) return undefined;
	const prefix = match[1];
	const serialText = match[2];
	if (prefix === undefined || serialText === undefined) return undefined;
	const serial = Number.parseInt(serialText, 10);
	if (!Number.isFinite(serial)) return undefined;
	return { prefix, serial };
}

/**
 * 归一化成 canonical 形式：去空白、去连字符、转大写。
 *
 * 归一化只有这一份（`normalize` / `toDisplay` 都由本模块提供），消费者不得自带第二份。
 */
export function normalize(raw: string): string {
	if (typeof raw !== 'string') return '';
	return raw.replaceAll(/\s+/g, '').replaceAll('-', '').toUpperCase();
}

/**
 * 转成展示形：在字母段与数字段之间插一个连字符。
 *
 * `GU02` → `GU-02`；`G02` → `G-02`。
 * 不合规范形 ⇒ 原样返回（展示层不该因为数据坏了而崩）。
 */
export function toDisplay(id: string): string {
	const parsed = parse(id);
	if (parsed === undefined) return id;
	const raw = normalize(id);
	return `${parsed.prefix}-${raw.slice(parsed.prefix.length)}`;
}

/**
 * 算下一个编号。
 *
 * 纯函数：吃「前缀」+「该前缀空间内的已用编号集合」，吐下一个编号字符串。
 * **不读存储、不管并发**（事务归调用方）。
 *
 * `usedIds` 可以是**全量编号**（本函数内部按前缀过滤），调用方不必先分组。
 * `usedIds` **必须含墓碑**：删除是标记删除，墓碑仍占号，否则会复用已删号。
 *
 * 前缀非法（含非 `[A-Z]` 字符）⇒ 抛错（调用方违约）。
 */
export function nextId(prefix: string, usedIds: readonly string[]): string {
	if (typeof prefix !== 'string' || !PREFIX_RE.test(prefix)) {
		throw new Error(`taskboard2-types: 编号前缀非法（${String(prefix)}），只允许大写字母`);
	}
	let max = 0;
	for (const used of usedIds) {
		const parsed = parse(used);
		if (parsed === undefined) continue;
		if (parsed.prefix !== prefix) continue;
		if (parsed.serial > max) max = parsed.serial;
	}
	const next = max + 1;
	/* 补零 2 位；≥100 自然三位，不截断、不回绕。 */
	return `${prefix}${String(next).padStart(2, '0')}`;
}
