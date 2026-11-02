/**
 * ② action —— Issue 与投影。
 *
 * `diagnostic` 只给 ⑨ 转述给模型；`toIssueForUI` 把它**真正删除**，⑩ 拿不到。
 */

import type { Issue, IssueForUI } from './types.js';

/**
 * 把 `Issue` 投影成 `IssueForUI` —— **丢弃 `diagnostic`**。
 *
 * 这是"中文文案不出 ②"四层隔离里的第四层（运行时也读不到）。
 * 前三层是：命名自证、lint、分类型导出。
 */
export function toIssueForUI(source: Issue): IssueForUI {
	return {
		level: source.level,
		code: source.code,
		sectionId: source.sectionId,
		...(source.field === undefined ? {} : { field: source.field }),
		...(source.path === undefined ? {} : { path: source.path }),
	};
}

/** 批量投影。 */
export function toIssuesForUI(sources: readonly Issue[]): IssueForUI[] {
	return sources.map(toIssueForUI);
}
