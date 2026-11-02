/**
 * 内置 action：`markdown` —— 富文本。
 *
 * 四态（YAML `renderer:` 里一一对应）：
 *   markdownCreate —— 源码框 + 「查看预览」按钮（**预览由 ⑩ 在点击后展开，② 不画**）
 *   markdownView   —— 只读渲染（`active` 与 `ended` 共用同一个函数，这是有意的）
 *   markdownPlain  —— 返回 md 源码原样
 *
 * **全项目唯一渲染 markdown 的地方**（由 ⑩ 的 Markdown 管线处理 md 节点）。
 */

import { element, fragment, md, readField, type Node } from '../nodes.js';
import type { ActionDefinition, ActionPayload, SchemaNode } from '../types.js';

const schema: SchemaNode = {
	type: 'object',
	required: ['$type'],
	properties: {
		$type: { const: 'markdown' },
		value: { type: 'string', description: 'md 源码' },
		placeholder: { type: 'string', description: '灰字。可省' },
	},
};

function asPayload(value: unknown): ActionPayload {
	return (value !== null && typeof value === 'object' ? value : {}) as ActionPayload;
}

/**
 * create：源码编辑框 + 「查看预览」按钮。
 *
 * **不在这里渲染 `md` 节点** —— 「展开与否」是 UI 状态，归 ⑩ 持有；
 * ② 只提供 `data-role: preview-toggle` 这个标记，让 ⑩ 知道哪个按钮负责展开。
 */
export function markdownCreate(payload: unknown, onChange: (next: ActionPayload) => void): Node {
	const p = asPayload(payload);

	const valueRead = readField<string>(p, 'value', 'string');
	if (!valueRead.ok) return valueRead.issue;
	const placeholderRead = readField<string>(p, 'placeholder', 'string');
	if (!placeholderRead.ok) return placeholderRead.issue;

	return element(
		'div',
		{ 'data-action': 'markdown', 'data-phase': 'create' },
		[
			element('textarea', {
				value: valueRead.value ?? '',
				placeholder: placeholderRead.value ?? '',
				'data-role': 'source',
				onInput: (raw: unknown) => {
					onChange({ ...p, $type: 'markdown', value: String(raw ?? '') });
				},
			}),
			element('button', { type: 'button', 'data-role': 'preview-toggle' }, []),
		],
	);
}

/** active / ended：只读渲染成富文本。 */
export function markdownView(payload: unknown): Node {
	const p = asPayload(payload);

	const valueRead = readField<string>(p, 'value', 'string');
	if (!valueRead.ok) return valueRead.issue;

	const source = valueRead.value ?? '';
	if (source.trim() === '') return fragment([]);
	return md(source);
}

/** plain：md 源码原样回报（不渲染）。 */
export function markdownPlain(payload: unknown): string {
	const p = asPayload(payload);
	const value = p.value;
	return typeof value === 'string' ? value : '';
}

export const markdownAction: ActionDefinition = {
	$type: 'markdown',
	summary: '富文本。创建时写源码并可预览，进行与终结时只读',
	schema,
	render: {
		create: markdownCreate,
		active: markdownView,
		ended: markdownView,
		plain: markdownPlain,
	},
};
