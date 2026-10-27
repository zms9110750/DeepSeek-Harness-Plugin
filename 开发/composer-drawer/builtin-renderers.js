/**
 * 内置渲染器 —— 六个行动各自的组件。
 *
 * ## 接口
 *
 * 每个渲染器签名为：
 *
 * ```js
 * render({ value, onChange, readOnly, h, renderMarkdown })
 * ```
 *
 *   value          这个章节的值（字段见对应行动 schema）
 *   onChange(next) 改值时调用，传**新的完整 value**
 *   readOnly       已采纳后为 true：声明冻结，只有用户字段能改
 *   h              React.createElement
 *   renderMarkdown 现成的 Markdown 渲染器（markdown 行动要用）
 *
 * ## 为什么渲染器不自己 import React
 *
 * 这个文件被内联进 client.js，和宿主共用同一份 React 实例。
 * 自己 import 会拿到另一份，hooks 直接报错。所以 `h` 由调用方传进来。
 *
 * @module taskboard-interact/builtin-renderers
 */

import { registerRenderer, hasRenderer } from './renderers.js';

/**
 * 注册六个内置渲染器。
 *
 * @param {object} deps
 * @param {Function} deps.h              React.createElement
 * @param {Function} deps.renderMarkdown 现成的 Markdown 渲染器
 * @param {object} deps.theme            颜色 token
 */
export function registerBuiltinRenderers(deps) {
	const h = deps.h;
	const md = deps.renderMarkdown;
	const theme = deps.theme ?? {};
	const label = theme.label ?? 'var(--dsw-alias-label-primary)';
	const muted = theme.muted ?? 'var(--dsw-alias-label-secondary)';
	const border = theme.border ?? 'var(--dsw-alias-border-l1)';
	const brand = theme.brand ?? 'var(--dsw-alias-brand-primary)';

	/* ── markdown：只读的一段说明 ── */
	registerRenderer('Markdown', function ({ value }) {
		const text = String(value?.value ?? '');
		if (text.trim() === '') return null;
		return h('div', { style: { fontSize: 13, lineHeight: 1.7, color: label } }, md(text));
	});

	/* ── textarea：多行文本 ── */
	registerRenderer('Textarea', function ({ value, onChange, readOnly }) {
		const text = String(value?.value ?? '');
		if (readOnly === true) {
			/* 只看模式下不画输入框 —— 一块灰底文字比只读的 textarea 好读 */
			return h(
				'div',
				{ style: { fontSize: 13, lineHeight: 1.7, color: label, whiteSpace: 'pre-wrap' } },
				text === '' ? h('span', { style: { color: muted, fontStyle: 'italic' } }, '（空）') : text,
			);
		}
		return h('textarea', {
			value: text,
			rows: Number(value?.rows ?? 3),
			placeholder: String(value?.placeholder ?? ''),
			onChange: (event) => onChange({ ...value, value: event.target.value }),
			style: {
				width: '100%',
				padding: '8px 10px',
				font: 'inherit',
				fontSize: 13,
				lineHeight: 1.6,
				color: label,
				background: 'var(--dsw-alias-bg-layer-1)',
				border: `1px solid ${border}`,
				borderRadius: 6,
				outline: 'none',
				resize: 'vertical',
				boxSizing: 'border-box',
			},
		});
	});

	/* ── input：单行文本 ── */
	registerRenderer('Input', function ({ value, onChange, readOnly }) {
		const text = String(value?.value ?? '');
		if (readOnly === true) {
			return h('div', { style: { fontSize: 13, color: label } }, text === '' ? '（空）' : text);
		}
		return h('input', {
			value: text,
			placeholder: String(value?.placeholder ?? ''),
			onChange: (event) => onChange({ ...value, value: event.target.value }),
			style: {
				width: '100%',
				padding: '7px 10px',
				font: 'inherit',
				fontSize: 13,
				color: label,
				background: 'var(--dsw-alias-bg-layer-1)',
				border: `1px solid ${border}`,
				borderRadius: 6,
				outline: 'none',
				boxSizing: 'border-box',
			},
		});
	});

	/* ── choose：从几个互斥选项里挑一个 ── */
	registerRenderer('Choose', function ({ value, onChange, readOnly }) {
		const options = Array.isArray(value?.options) ? value.options.map(String) : [];
		const picked = String(value?.picked ?? '');

		const row = (text, active, onClick) =>
			h(
				'button',
				{
					type: 'button',
					onClick: readOnly === true ? undefined : onClick,
					disabled: readOnly === true,
					style: {
						display: 'flex',
						alignItems: 'center',
						gap: 8,
						width: '100%',
						padding: '8px 11px',
						marginBottom: 6,
						font: 'inherit',
						fontSize: 12.5,
						textAlign: 'left',
						color: active ? brand : label,
						background: active ? 'rgba(59,125,216,.08)' : 'var(--dsw-alias-bg-layer-1)',
						border: `1px solid ${active ? brand : border}`,
						borderRadius: 7,
						cursor: readOnly === true ? 'default' : 'pointer',
					},
				},
				h('span', {
					style: {
						flex: 'none',
						width: 13,
						height: 13,
						borderRadius: '50%',
						border: `1.5px solid ${active ? brand : border}`,
						display: 'grid',
						placeItems: 'center',
					},
				}, active ? h('span', { style: { width: 6, height: 6, borderRadius: '50%', background: brand } }) : null),
				h('span', { style: { flex: 1 } }, text),
			);

		const nodes = options.map((text) => row(text, text === picked, () => onChange({ ...value, picked: text })));

		/* 允许"都不是，我自己写一句" */
		if (value?.allow_custom === true && readOnly !== true) {
			nodes.push(
				h('input', {
					key: 'custom',
					value: options.includes(picked) ? '' : picked,
					placeholder: '都不是，我自己写一句',
					onChange: (event) => onChange({ ...value, picked: event.target.value }),
					style: {
						width: '100%',
						padding: '7px 10px',
						font: 'inherit',
						fontSize: 12.5,
						color: label,
						background: 'var(--dsw-alias-bg-layer-1)',
						border: `1px dashed ${border}`,
						borderRadius: 6,
						outline: 'none',
						boxSizing: 'border-box',
					},
				}),
			);
		}

		/* 允许"先不选" */
		if (value?.allow_defer === true && readOnly !== true && picked !== '') {
			nodes.push(
				h(
					'button',
					{
						key: 'defer',
						type: 'button',
						onClick: () => onChange({ ...value, picked: '' }),
						style: {
							marginTop: 4,
							padding: '4px 10px',
							font: 'inherit',
							fontSize: 11.5,
							color: muted,
							background: 'transparent',
							border: 'none',
							cursor: 'pointer',
						},
					},
					'先不选，要更多信息',
				),
			);
		}

		return h('div', null, nodes);
	});

	/* ── rank：排先后顺序 ── */
	registerRenderer('Rank', function ({ value, onChange, readOnly }) {
		const items = Array.isArray(value?.items) ? value.items.map(String) : [];
		const keep = Array.isArray(value?.keep) ? value.keep.map(String) : items;

		const move = (index, delta) => {
			const next = items.slice();
			const target = index + delta;
			if (target < 0 || target >= next.length) return;
			const [moved] = next.splice(index, 1);
			next.splice(target, 0, moved);
			onChange({ ...value, items: next });
		};

		return h(
			'div',
			null,
			items.map((text, index) =>
				h(
					'div',
					{
						key: 'rank-' + index,
						style: {
							display: 'flex',
							alignItems: 'center',
							gap: 8,
							padding: '6px 9px',
							marginBottom: 4,
							background: 'var(--dsw-alias-bg-layer-1)',
							border: `1px solid ${border}`,
							borderRadius: 6,
							fontSize: 12.5,
						},
					},
					h('span', { style: { flex: 'none', width: 16, color: muted, fontSize: 10 } }, String(index + 1)),
					h('span', { style: { flex: 1, color: label } }, text),
					readOnly === true
						? null
						: h(
								'span',
								{ style: { display: 'flex', gap: 2, flex: 'none' } },
								h(
									'button',
									{
										type: 'button',
										onClick: () => move(index, -1),
										disabled: index === 0,
										style: { border: 'none', background: 'transparent', cursor: 'pointer', color: muted, padding: '0 4px' },
									},
									'↑',
								),
								h(
									'button',
									{
										type: 'button',
										onClick: () => move(index, 1),
										disabled: index === items.length - 1,
										style: { border: 'none', background: 'transparent', cursor: 'pointer', color: muted, padding: '0 4px' },
									},
									'↓',
								),
							),
				),
			),
		);
	});

	/* ── derive：派生任务 ── */
	registerRenderer('Derive', function ({ value, onDerive, readOnly }) {
		const templates = Array.isArray(value?.templates) ? value.templates.map(String) : [];
		const mode = String(value?.mode ?? 'ask');
		if (templates.length === 0) return null;

		const modeLabel = mode === 'auto' ? '直接建' : mode === 'manual' ? '只能你建' : '问你';

		return h(
			'div',
			{ style: { display: 'flex', flexWrap: 'wrap', gap: 7 } },
			templates.map((type) =>
				h(
					'button',
					{
						key: 'derive-' + type,
						type: 'button',
						onClick: () => onDerive?.(type),
						style: {
							display: 'inline-flex',
							alignItems: 'center',
							gap: 6,
							padding: '6px 11px',
							font: 'inherit',
							fontSize: 12,
							color: label,
							background: 'var(--dsw-alias-bg-layer-1)',
							border: `1px dashed ${border}`,
							borderRadius: 6,
							cursor: 'pointer',
						},
					},
					h('span', { style: { fontSize: 10, color: muted, fontWeight: 700 } }, type),
					h('span', null, '派生任务'),
					mode === 'manual' ? h('span', { style: { fontSize: 9.5, color: '#a9701a' } }, modeLabel) : null,
				),
			),
		);
	});
}

/**
 * 注册器是否已经装过（避免热重载时重复注册）。
 *
 * @returns {boolean}
 */
export function builtinsReady() {
	return hasRenderer('Textarea') && hasRenderer('Choose');
}
