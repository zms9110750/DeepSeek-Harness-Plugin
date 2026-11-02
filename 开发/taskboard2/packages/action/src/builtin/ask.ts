/**
 * 内置 action：`ask` —— 选项选择，单选或多选。
 *
 * 四态：
 *   create —— 可点选项 + 自填框 + 「未选择」
 *   active —— 同上（可改）
 *   ended  —— 只读展示选择结果，可刮取
 *   plain  —— 问题 / 描述 / 选项 / 用户选择，纯文本
 *
 * **「未选择」和自填框恒存在**，不是参数开关（用户 02:35）。
 * `picked` 三态：键不存在（未选择）/ `[]`（看了但都不要）/ `["A"]`（选了）。
 *
 * schema 里保留 `custom` 字段：给未来开发者说明「渲染器要处理自填值」。
 * 模板的 default 不填它，AI 想填就填 —— 不校验语义。
 */

import { element, fragment, isPlainObject, readField, text, type Node } from '../nodes.js';
import type { ActionDefinition, ActionPayload, SchemaNode } from '../types.js';

const schema: SchemaNode = {
	type: 'object',
	required: ['$type', 'items'],
	properties: {
		$type: { const: 'ask' },
		items: {
			type: 'array',
			minItems: 1,
			items: {
				type: 'object',
				required: ['options'],
				properties: {
					header: { type: 'string', description: '副标题，灰小字' },
					question: { type: 'string', description: '主标题，大字' },
					options: {
						type: 'array',
						items: {
							type: 'object',
							required: ['label'],
							properties: {
								label: { type: 'string', description: '选项名' },
								description: { type: 'string', description: '选项小字' },
							},
						},
					},
					multi_select: {
						type: 'boolean',
						description: 'false = 单选（至多一项，可取消到一项都不选）；true = 多选（任意多项，含 0）',
					},
					picked: {
						type: 'array',
						items: { type: 'string' },
						description: '答案。键不存在 = 未选择；[] = 都不要；["A"] = 选了 A',
					},
					custom: {
						type: 'array',
						items: { type: 'string' },
						description:
							'自填的答案（不在 options 里的）。渲染器负责维护，模板不填。与 picked 分开放。',
					},
					placeholder: { type: 'string', description: '自填框的灰字' },
				},
			},
		},
	},
};

function asPayload(value: unknown): ActionPayload {
	return (value !== null && typeof value === 'object' ? value : {}) as ActionPayload;
}

interface Option {
	readonly label: string;
	readonly description?: string;
}

function readOptions(item: Record<string, unknown>): Option[] {
	const raw = item.options;
	if (!Array.isArray(raw)) return [];
	const out: Option[] = [];
	for (const entry of raw) {
		if (!isPlainObject(entry)) continue;
		const label = entry.label;
		if (typeof label !== 'string') continue;
		const description = typeof entry.description === 'string' ? entry.description : undefined;
		out.push(description === undefined ? { label } : { label, description });
	}
	return out;
}

function readStringArray(item: Record<string, unknown>, key: string): string[] {
	const raw = item[key];
	if (!Array.isArray(raw)) return [];
	return raw.filter((entry): entry is string => typeof entry === 'string');
}

/** ended：只读展示选择结果，可刮取。 */
function endedView(payload: unknown): Node {
	const p = asPayload(payload);

	const itemsRead = readField<unknown[]>(p, 'items', 'array', true);
	if (!itemsRead.ok) return itemsRead.issue;
	const items = (itemsRead.value ?? []).filter(isPlainObject);

	return element(
		'div',
		{ 'data-action': 'ask', 'data-phase': 'ended', 'data-selectable': true },
		items.map((item, index) => {
			const picked = readStringArray(item, 'picked');
			const custom = readStringArray(item, 'custom');
			const options = readOptions(item);

			const header = typeof item.header === 'string' ? item.header : '';
			const question = typeof item.question === 'string' ? item.question : '';

			const rows: Node[] = [];
			if (header !== '') rows.push(element('div', { 'data-role': 'header' }, [text(header)]));
			if (question !== '') rows.push(element('div', { 'data-role': 'question' }, [text(question)]));

			for (const option of options) {
				const active = picked.includes(option.label);
				rows.push(
					element('div', { 'data-role': 'option', 'data-picked': active }, [
						text(option.label),
						...(option.description === undefined
							? []
							: [element('span', { 'data-role': 'option-description' }, [text(option.description)])]),
					]),
				);
			}

			for (const value of custom) {
				rows.push(element('div', { 'data-role': 'custom', 'data-picked': true }, [text(value)]));
			}

			return element('div', { 'data-action': 'ask', 'data-index': index }, rows);
		}),
	);
}

/** create / active：恒提供「未选择」按钮与自填框。 */
function editableView(
	payload: unknown,
	onChange: (next: ActionPayload) => void,
	phase: 'create' | 'active',
): Node {
	const p = asPayload(payload);

	const itemsRead = readField<unknown[]>(p, 'items', 'array', true);
	if (!itemsRead.ok) return itemsRead.issue;
	const items = (itemsRead.value ?? []).filter(isPlainObject);

	const update = (index: number, nextItem: Record<string, unknown>): void => {
		const rawItems: unknown[] = Array.isArray(p.items) ? [...p.items] : [];
		const current = items[index] ?? {};
		rawItems[index] = { ...current, ...nextItem };
		onChange({ ...p, $type: 'ask', items: rawItems });
	};

	return element(
		'div',
		{ 'data-action': 'ask', 'data-phase': phase },
		items.map((item, index) => {
			const picked = readStringArray(item, 'picked');
			const custom = readStringArray(item, 'custom');
			const options = readOptions(item);
			const multi = item.multi_select === true;
			const hasPickedKey = Object.prototype.hasOwnProperty.call(item, 'picked');
			const placeholder = typeof item.placeholder === 'string' ? item.placeholder : '';

			const header = typeof item.header === 'string' ? item.header : '';
			const question = typeof item.question === 'string' ? item.question : '';

			const rows: Node[] = [];
			if (header !== '') rows.push(element('div', { 'data-role': 'header' }, [text(header)]));
			if (question !== '') rows.push(element('div', { 'data-role': 'question' }, [text(question)]));

			for (const option of options) {
				const active = picked.includes(option.label);
				rows.push(
					element(
						'button',
						{
							type: 'button',
							'data-role': 'option',
							'data-picked': active,
							onClick: () => {
								const nextPicked = multi
									? active
										? picked.filter((value) => value !== option.label)
										: [...picked, option.label]
									: active
										? []
										: [option.label];
								update(index, { picked: nextPicked });
							},
						},
						[text(option.label)],
					),
				);
			}

			for (const value of custom) {
				rows.push(element('div', { 'data-role': 'custom', 'data-picked': true }, [text(value)]));
			}

			/* 「未选择」—— 恒存在（文案由 ⑩ 按 data-role 组织，② 不产中文） */
			rows.push(
				element(
					'button',
					{
						type: 'button',
						'data-role': 'clear',
						disabled: !hasPickedKey && custom.length === 0,
						onClick: () => {
							update(index, { picked: [], custom: [] });
						},
					},
					[],
				),
			);

			/* 自填框 —— 恒存在；填的值进 `custom`，不进 `picked` */
			rows.push(
				element('input', {
					type: 'text',
					value: '',
					placeholder,
					'data-role': 'custom-input',
					onInput: (raw: unknown) => {
						const value = String(raw ?? '');
						if (value === '') return;
						update(index, { custom: [...custom, value] });
					},
				}),
			);

			return element('div', { 'data-action': 'ask', 'data-index': index }, rows);
		}),
	);
}

/** plain：问题 / 描述 / 选项 / 用户选择。 */
function plain(payload: unknown): string {
	const p = asPayload(payload);
	const items: unknown[] = Array.isArray(p.items) ? p.items : [];

	const lines: string[] = [];
	for (const entry of items) {
		if (!isPlainObject(entry)) continue;

		const header = typeof entry.header === 'string' ? entry.header : '';
		const question = typeof entry.question === 'string' ? entry.question : '';
		const picked = readStringArray(entry, 'picked');
		const custom = readStringArray(entry, 'custom');

		if (header !== '') lines.push(header);
		if (question !== '') lines.push(question);

		for (const option of readOptions(entry)) {
			const active = picked.includes(option.label) ? ' [选中]' : '';
			const description = option.description === undefined ? '' : ` - ${option.description}`;
			lines.push(`  ${option.label}${description}${active}`);
		}

		const chosen = [...picked, ...custom];
		lines.push(chosen.length === 0 ? '  用户选择：（未选择）' : `  用户选择：${chosen.join('、')}`);
		lines.push('');
	}

	return lines.join('\n').trimEnd();
}

export const askAction: ActionDefinition = {
	$type: 'ask',
	summary: '选项选择，单选或多选，恒有「未选择」和自填框',
	schema,
	render: {
		create: (payload, onChange) => editableView(payload, onChange, 'create'),
		active: (payload, onChange) => editableView(payload, onChange, 'active'),
		ended: endedView,
		plain,
	},
};
