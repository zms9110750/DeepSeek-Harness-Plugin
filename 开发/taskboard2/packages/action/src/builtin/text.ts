/**
 * 内置 action：`text` —— 自由文本。
 *
 * 四态各有独立函数（YAML `renderer:` 里一一对应）：
 *   textCreate —— 只能编辑灰色字（placeholder），不画内容框
 *   textActive —— 内容可编辑，灰字只读
 *   textEnded  —— 只读，可刮取复制（选中能力由 CSS/组件负责）
 *   textPlain  —— 返回 value 字符串
 *
 * 没有 `row`：多行由渲染器自动增长，长到一定高度变滚动。
 * 没有 `readonly`：只读展示用 `markdown` action。
 */

import { element, readField, text, type Node } from '../nodes.js';
import type { ActionDefinition, ActionPayload, SchemaNode } from '../types.js';

const schema: SchemaNode = {
	type: 'object',
	required: ['$type'],
	properties: {
		$type: { const: 'text' },
		value: { type: 'string', description: '答案。可省（= 空）' },
		placeholder: { type: 'string', description: '灰字。可省' },
	},
};

function asPayload(value: unknown): ActionPayload {
	return (value !== null && typeof value === 'object' ? value : {}) as ActionPayload;
}

/** create：只有灰色字可编辑。内容若已存在（AI 传的），原样保留不展示控件。 */
export function textCreate(payload: unknown, onChange: (next: ActionPayload) => void): Node {
	const p = asPayload(payload);

	const placeholderRead = readField<string>(p, 'placeholder', 'string');
	if (!placeholderRead.ok) return placeholderRead.issue;

	return element(
		'div',
		{ 'data-action': 'text', 'data-phase': 'create' },
		[
			element('input', {
				type: 'text',
				value: placeholderRead.value ?? '',
				'data-role': 'placeholder',
				onInput: (raw: unknown) => {
					onChange({ ...p, $type: 'text', placeholder: String(raw ?? '') });
				},
			}),
		],
	);
}

/** active：内容可编辑，灰字只读展示。 */
export function textActive(payload: unknown, onChange: (next: ActionPayload) => void): Node {
	const p = asPayload(payload);

	const valueRead = readField<string>(p, 'value', 'string');
	if (!valueRead.ok) return valueRead.issue;
	const placeholderRead = readField<string>(p, 'placeholder', 'string');
	if (!placeholderRead.ok) return placeholderRead.issue;

	const rows: Node[] = [];
	const hint = placeholderRead.value ?? '';
	if (hint !== '') {
		rows.push(element('div', { 'data-role': 'placeholder-readonly' }, [text(hint)]));
	}

	rows.push(
		element('textarea', {
			value: valueRead.value ?? '',
			'data-role': 'value',
			onInput: (raw: unknown) => {
				onChange({ ...p, $type: 'text', value: String(raw ?? '') });
			},
		}),
	);

	return element('div', { 'data-action': 'text', 'data-phase': 'active' }, rows);
}

/** ended：只读，可刮取复制。 */
export function textEnded(payload: unknown): Node {
	const p = asPayload(payload);

	const valueRead = readField<string>(p, 'value', 'string');
	if (!valueRead.ok) return valueRead.issue;

	return element(
		'div',
		{
			'data-action': 'text',
			'data-phase': 'ended',
			'data-selectable': true,
			style: { whiteSpace: 'pre-wrap' },
		},
		[text(valueRead.value ?? '')],
	);
}

/** plain：给 AI tool / 指令调用，纯文本。 */
export function textPlain(payload: unknown): string {
	const p = asPayload(payload);
	const value = p.value;
	return typeof value === 'string' ? value : '';
}

export const textAction: ActionDefinition = {
	$type: 'text',
	summary: '自由文本。创建时填灰字提示，进行时填内容',
	schema,
	render: {
		create: textCreate,
		active: textActive,
		ended: textEnded,
		plain: textPlain,
	},
};
