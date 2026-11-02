/**
 * ⑧ core —— 错误码与拒绝原因 → 文案的查表。
 *
 * ## 为什么文案在这里而不在核心里"写"
 *
 * ⑦ 的拒绝原因是**封闭枚举**（`RejectReason`），它不带文案。⑧ 要做的是
 * **查表映射**，不是 `if (reason.kind === …)` —— 后者会让业务规则漏进 core。
 *
 * 判据：这里每一行都是 `枚举值 → 字符串` 的**一对一搬运**，没有任何条件分支
 * 去判断"业务上该不该"。一旦某个 kind 需要按字段组合出不同文案，说明该文案
 * 应当由产出方（⑦ / ② / ③）给，而不是在这里拼。
 */

/** core 自己的错误码。用于"装配缺陷 / 环境问题"，不用于业务拒绝。 */
export type CoreErrorCode =
	/** 模板目录读不到（安装后 `templates/` 不存在）。 */
	| 'TEMPLATES_DIR_MISSING'
	/** 模板 YAML 解析失败。 */
	| 'TEMPLATE_PARSE_FAILED'
	/** 模板注册被 ③ 拒绝（重复 / kind 非法 / 预设目标缺失…）。 */
	| 'TEMPLATE_REGISTER_REJECTED'
	/** 模板注册表在本该就绪时仍未就绪（时序 bug）。 */
	| 'TEMPLATE_REGISTRY_NOT_READY'
	/** 当前空间解析为空（`none` / `stale` 分别有文案）。 */
	| 'NO_CURRENT_WORKSPACE'
	| 'STALE_CURRENT_WORKSPACE'
	/** ③ 解析不到模板（数据问题，fail-closed）。 */
	| 'TEMPLATE_MISSING'
	/** 建卡校验未通过（携带 ② 的 issues）。 */
	| 'CREATE_VALIDATION_FAILED'
	/** 编辑校验未通过（携带 ② 的 issues）。 */
	| 'EDIT_VALIDATION_FAILED'
	/**
	 * fork 补缺章时，模板没给该章 `default` ⇒ 没有任何合法初值可造。
	 *
	 * ⚠ `accepts` 移除后（用户 11:26），"从候选 action 里挑一个"的依据不存在了 ——
	 * `default` 是唯一依据。**没有它就不猜**（猜 `$type` = 替模板作者做决定）。
	 * 错误里必须带 `sectionId`，否则用户不知道要补哪一章。
	 */
	| 'EMPTY_PAYLOAD_UNAVAILABLE'
	/** 关系目标非法（不存在 / 草稿 / 跨空间）。 */
	| 'RELATION_TARGET_INVALID'
	/** 关系补丁应用失败（④ 拒绝）。 */
	| 'RELATIONS_CHANGE_REJECTED'
	/** 卡不存在（含已物理删除）。 */
	| 'CARD_NOT_FOUND'
	/** 拼不出合法的编号前缀（③ 未提供 `kindLetter`，或分类字母 + codePrefix 非法）。 */
	| 'ID_PREFIX_UNAVAILABLE'
	/** 同一 actor 已有一张「处理中」的工作卡（跨卡聚合，由 ⑧ 算）。 */
	| 'WORK_SINGLE_CLAIM'
	/** 依赖未全部进入「完成」组。 */
	| 'DEPENDS_ON_GATE'
	/** fork 时自动补空 payload 失败。 */
	| 'FORK_FILL_FAILED'
	/** 空间里没有这个工作空间对应的库。 */
	| 'WORKSPACE_NOT_FOUND'
	/** ③ 未提供 `deriveStatus` ⇒ 计算态重算整条监听链不可用。 */
	| 'RECOMPUTE_UNAVAILABLE'
	/** 单卡重算失败（`deriveStatus` 抛错，例如旧卡引用了已注销的分类）。 */
	| 'RECOMPUTE_FAILED';

/** 一条对外错误。`code` 是机器可读的，`message` 是给人看的。 */
export interface CoreError {
	readonly code: CoreErrorCode;
	readonly message: string;
	/** 结构化细节（issue 列表、sectionId 等），不参与文案生成。 */
	readonly detail?: unknown;
}

/** 造一条错误。 */
export function coreError(code: CoreErrorCode, message: string, detail?: unknown): CoreError {
	return detail === undefined ? { code, message } : { code, message, detail };
}

/* ─────────────────────────────────────────────────────────────
 * ⑦ 的拒绝原因 → 文案
 * ───────────────────────────────────────────────────────────── */

/**
 * ⑦ 的 `RejectReason.kind` 全集。
 *
 * ⚠ 这里**照抄**⑦ 的联合类型。若 ⑦ 新增 kind 而这里没跟上，`describeReject`
 * 的穷尽性检查会在编译期报错 —— 这是有意的：**文案缺口不能等运行时才发现**。
 */
type RejectKind =
	| 'frozen'
	| 'section-key-removed'
	| 'declaration-changed'
	| 'already-deleted'
	| 'not-draft'
	| 'is-draft'
	| 'not-claimable'
	| 'not-releasable'
	| 'template-missing'
	| 'template-registry-unavailable'
	| 'relations-invalid';

/** 拒绝原因的最小结构（⑦ 的 `RejectReason` 满足它）。 */
interface RejectLike {
	readonly kind: RejectKind;
	readonly [key: string]: unknown;
}

const REJECT_TEXT: Readonly<Record<RejectKind, string>> = Object.freeze({
	frozen: '这张卡已采纳，内容已冻结；要改只能 fork。',
	'section-key-removed': '草稿期不能删除已有章节；可以让章节内容为空，但不能去掉章节键。',
	'declaration-changed': '声明部分已冻结，只有答案可以改。',
	'already-deleted': '这张卡已删除。',
	'not-draft': '这个操作只能在草稿上做。',
	'is-draft': '草稿不能 fork，也不能直接采纳；草稿请直接编辑。',
	'not-claimable': '这张卡现在不能领取。',
	'not-releasable': '这张卡现在不能释放。',
	'template-missing': '找不到这张卡引用的模板。',
	'template-registry-unavailable': '模板注册表还没就绪（装配问题）。',
	'relations-invalid': '关系数据不合法。',
});

/**
 * 把 ⑦ 的拒绝原因映射成一句人话。
 *
 * **纯查表**：只按 `kind` 取一句话，不读其它字段拼文案。
 * 需要更细的信息时由调用方带上 `detail`（结构化），不要在这里拼。
 */
export function describeReject(reason: RejectLike): string {
	return REJECT_TEXT[reason.kind];
}
