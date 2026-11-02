/**
 * ③ 的错误形状 —— **只服务于模板加载，不是通用错误体系**。
 *
 * ## 为什么不 import ⑧ 的 `CoreError`
 *
 * 会成环：⑧ 依赖 ③（`@local/taskboard2-core` → `@local/taskboard2-types`）。
 *
 * ## 为什么也不把 `CoreErrorCode` 搬进来
 *
 * `CoreErrorCode` 里有大量与 ③ 无关的码（`CARD_NOT_FOUND` / `WORK_SINGLE_CLAIM` /
 * `RECLAIMED_...`）。搬进来 = ③ 持有一堆它永远不产生的码 ⇒ **那是真重复**。
 *
 * ## 采用的方案：**同构但不共享**
 *
 * `TemplateIssue` 与 ⑧ 的 `CoreError` **形状一致**（`{ code, message, detail? }`，
 * ③ 多一个 `file`）⇒ ⑧ 在边界处**几乎零成本转换**：
 *
 * ```ts
 * // ⑧ 侧（示例，不是本包的代码）
 * const issues = loadTemplates().failures.map((issue) =>
 *   coreError(MAP[issue.code], issue.message, issue.detail),
 * );
 * ```
 *
 * **⚠ 两个 `code` 联合的名字各自独立**（`TemplateIssueCode` vs `CoreErrorCode`），
 * 边界处做一次显式映射 —— 这叫「各有各的词汇」，**不是「同一个类型写两遍」**。
 * 同名的码可以直通；不同名的必须在映射表里写清楚（见 `docs/03-types.md` §6.1）。
 */

/**
 * 模板加载 / 解析失败的机器可读码。
 *
 * **封闭联合，不是自由字符串** —— 新增码要改这里，消费方的 `switch` 才会提示补分支。
 */
export type TemplateIssueCode =
	/** 找不到模板目录，或目录里没有任何 `.yaml`。**这是最严重的**（一个模板都没有）。 */
	| 'TEMPLATES_DIR_MISSING'
	/** 读文件失败 / 不是合法 YAML / 字段缺失或类型不对 / 含已删除字段。 */
	| 'TEMPLATE_PARSE_FAILED'
	/** 注册被拒：同名撞车、`kind` 不是已注册分类、`codePrefix` 非字符串等。 */
	| 'TEMPLATE_REGISTER_REJECTED';

/** 一条模板加载问题。 */
export interface TemplateIssue {
	readonly code: TemplateIssueCode;
	/** 给人看的说明，**已含定位信息**（文件名 / 章名 / 字段名）。 */
	readonly message: string;
	/**
	 * 出问题的文件（相对模板根，如 `core/userNeed.yaml`）。
	 *
	 * **目录级错误（`TEMPLATES_DIR_MISSING`）没有这个字段。**
	 * 用相对路径而不是绝对路径：错误信息里 `core/userNeed.yaml` 比
	 * `X:\...\packages\types\templates\core\userNeed.yaml` 更易读，也更能贴进 issue。
	 */
	readonly file?: string;
	/** 结构化细节（索引、字段名等），不参与文案生成。 */
	readonly detail?: unknown;
}
