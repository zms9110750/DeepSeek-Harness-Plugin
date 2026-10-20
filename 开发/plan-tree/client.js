/**
 * plan-tree · 客户端半边：右侧工具栏的「计划」页签。
 *
 * 数据只从投影来（`useProjection('plans')` + `useProjection('nodes')`），不轮询、不发命令：
 * 命令在宿主侧会写 command/run + command/done 两条事件，读一次树就在对话里
 * 留一个节点，用命令当读通道会把记录淹掉。读正文例外——文件内容不在投影里，
 * 只能走 `remote.workspaceFiles.read`（只读 RPC，不写日志）。
 *
 * 三个动作（采纳 / 否决 / 搁置）和「新建计划」走命令：这是用户对计划做的
 * 决定，留在对话里是对的。宿主侧命令和模型用的工具写的是同一条记录。
 */
window.__ModuleLoader__.load({
	id: '@local/plan-tree2',
	factory(require) {
		const React = require('react');
		const h = React.createElement;

		const TYPE_ID = '@local/plan-tree2';
		const KIND = 'plantree';

		/** apply 时拿到的客户端 ctx；页面用它发命令、读文件。 */
		let runtime;

		/** 投影里还没有计划时，下拉框至少给出去重后的模板层。 */
		const CANONICAL_LAYERS = ['A系列-问题', 'B系列-设计', 'C系列-接口', 'D系列-实现'];

		const STATUS_COLOR = {
			草案: 'var(--dsw-alias-label-tertiary, #9ca3af)',
			计划: '#3b82f6',
			进行中: '#f59e0b',
			完成计划: '#10b981',
			失败计划: '#ef4444',
			搁置的计划: '#6b7280',
			搁置草案: '#b91c1c',
		};

		/**
		 * 计划的状态从记录字段与派发节点推出来（B-03 的七态）。
		 * 不另存一份：宿主侧的 plan-state 插件算同一个东西，这里只是复述。
		 */
		function statusOf(plan, nodes) {
			const own = nodes.filter((node) => node.planId === plan.id);
			if (own.some((node) => node.status === 'open')) return '进行中';
			if (own.some((node) => node.verdict === 'success')) return '完成计划';
			if (own.some((node) => node.verdict === 'reject')) return '失败计划';
			if (own.some((node) => node.verdict === 'shelved')) return '搁置的计划';
			if (plan.rejected === true || plan.shelved === true) return '搁置草案';
			if (plan.adopted === true) return '计划';
			return '草案';
		}

		/** 读不到正文时给一句人话；最常见的是文件被删/改名（计划记录还在）。 */
		function describeReadFailure(message, path) {
			const text = String(message ?? '');
			if (/no entry|ENOENT|not exist|不存在/i.test(text)) {
				return `文件不在了：${path}\n（计划记录还在，磁盘上这份没了——可能被删或改名）`;
			}
			return `读不到正文：${text === '' ? '未知原因' : text}\n${path}`;
		}

		function stamp(at) {
			if (typeof at !== 'number' || at <= 0) return '';
			const date = new Date(at);
			const pad = (value) => String(value).padStart(2, '0');
			return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
		}

		function planNumber(id) {
			const match = /^p(\d+)$/.exec(String(id ?? ''));
			return match === null ? Number.MAX_SAFE_INTEGER : Number(match[1]);
		}

		const styles = {
			root: {
				display: 'flex',
				flexDirection: 'column',
				gap: 8,
				height: '100%',
				minHeight: 0,
				padding: 10,
				boxSizing: 'border-box',
				color: 'var(--dsw-alias-label-primary)',
				fontSize: 14,
			},
			row: { display: 'flex', alignItems: 'center', gap: 6 },
			button: {
				height: 26,
				padding: '0 9px',
				borderRadius: 7,
				border: '1px solid var(--dsw-alias-border-l1)',
				background: 'transparent',
				color: 'var(--dsw-alias-label-secondary)',
				font: 'inherit',
				fontSize: 13,
				cursor: 'pointer',
				whiteSpace: 'nowrap',
			},
			primary: {
				height: 28,
				padding: '0 11px',
				borderRadius: 7,
				border: '1px solid var(--dsw-alias-border-l1)',
				background: 'var(--dsw-alias-bg-layer-1)',
				color: 'var(--dsw-alias-label-primary)',
				font: 'inherit',
				fontSize: 13,
				cursor: 'pointer',
			},
			input: {
				boxSizing: 'border-box',
				width: '100%',
				height: 28,
				padding: '0 8px',
				borderRadius: 7,
				border: '0.5px solid var(--dsw-alias-border-l2)',
				background: 'var(--dsw-alias-bg-layer-1)',
				color: 'var(--dsw-alias-label-primary)',
				font: 'inherit',
				fontSize: 13,
			},
			muted: { fontSize: 11.5, color: 'var(--dsw-alias-label-tertiary)' },
			group: {
				fontSize: 12,
				fontWeight: 600,
				letterSpacing: 0.3,
				color: 'var(--dsw-alias-label-secondary)',
			},
			mono: { fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace' },
		};

		/**
		 * 一层：标题 + 计划行。只读投影对象——投影里的 plan 可能是冻结的，
		 * 往上面挂字段会直接抛错，所以分支在渲染时现查。
		 */
		function layerGroups(plans, layerOf) {
			const groups = new Map();
			for (const plan of [...plans].sort((a, b) => planNumber(a.id) - planNumber(b.id))) {
				const key = layerOf(plan);
				if (!groups.has(key)) {
					groups.set(key, {
						layer: key,
						rank: typeof plan.layerIndex === 'number' ? plan.layerIndex : 90,
						plans: [],
					});
				}
				const group = groups.get(key);
				group.rank = Math.min(group.rank, typeof plan.layerIndex === 'number' ? plan.layerIndex : 90);
				group.plans.push(plan);
			}
			return [...groups.values()].sort((a, b) => a.rank - b.rank || a.layer.localeCompare(b.layer));
		}

		function PlanTreePage(props) {
			const sessionId = props.sessionId ?? props.tab?.sessionId;
			const useProjection = props.useProjection;
			// 两个投影，各由一个宿主插件负责：`plans` 是计划记录，`nodes` 是派发节点。
			const planState = typeof useProjection === 'function' ? useProjection('plans') : undefined;
			const nodeState = typeof useProjection === 'function' ? useProjection('nodes') : undefined;

			const [selectedId, setSelectedId] = React.useState(null);
			const [reading, setReading] = React.useState(undefined);
			const [tick, setTick] = React.useState(0);
			const [notice, setNotice] = React.useState('');
			const [failed, setFailed] = React.useState(false);
			const [busy, setBusy] = React.useState(false);
			const [layerOnly, setLayerOnly] = React.useState('');
			const [showShelved, setShowShelved] = React.useState(false);
			const [creating, setCreating] = React.useState(false);
			const [form, setForm] = React.useState({ title: '', layer: '', body: '' });

			const plans = planState === undefined ? [] : Object.values(planState.plans ?? {});
			const nodes = nodeState === undefined ? [] : Object.values(nodeState.nodes ?? {});
			const selected = selectedId === null ? undefined : plans.find((plan) => plan.id === selectedId);
			const selectedPath = selected === undefined ? undefined : selected.path;
			/** 新计划：正文就在记录里（投影带过来），不用读文件。 */
			const selectedBody = selected === undefined || typeof selected.body !== 'string' || selected.body === ''
				? undefined
				: selected.body;

			// 老计划（0.15.1 之前）只登记了文件路径：正文还得去磁盘上读。
			React.useEffect(() => {
				if (selectedBody !== undefined) {
					setReading({ text: selectedBody });
					return undefined;
				}
				if (selectedPath === undefined) {
					setReading(selected === undefined ? undefined : { error: '这份记录没有正文（也没有文件路径）' });
					return undefined;
				}
				let gone = false;
				setReading({ loading: true });
				const remote = runtime?.remote;
				const reader = remote?.workspaceFiles;
				if (reader === undefined || typeof reader.read !== 'function') {
					setReading({ error: `没有 remote.workspaceFiles，读不到正文。文件：${selectedPath}` });
					return undefined;
				}
				Promise.resolve(reader.read(sessionId, selectedPath, { limit: 500 }))
					.then((result) => {
						if (gone) return;
						if (result?.ok === true) setReading({ text: result.value.text, lines: result.value.lines, eof: result.value.eof });
						else setReading({ error: describeReadFailure(result?.error?.message, selectedPath) });
					})
					.catch((error) => {
						if (!gone) setReading({ error: String(error?.message ?? error) });
					});
				return () => {
					gone = true;
				};
			}, [selectedId, selectedBody, selectedPath, tick]);

			/**
			 * 老记录里层名存的是短名（A/B/C/D），模板里是全名（A系列-问题…）。
			 * 不归一化，同一层会被拆成两组，下拉框里也会冒出两个入口。
			 */
			const canonicalLayer = (raw) => {
				const text = String(raw ?? '').trim();
				if (text === '') return '未分层';
				const exact = CANONICAL_LAYERS.find((name) => name === text);
				if (exact !== undefined) return exact;
				if (text.length <= 2) {
					const byLetter = CANONICAL_LAYERS.find((name) => name.startsWith(text.slice(0, 1).toUpperCase()));
					if (byLetter !== undefined) return byLetter;
				}
				return text;
			};

			/** 树上的分组键：研究节点单独一组，其余按归一层名。 */
			const layerOf = (plan) => (plan.type === 'research' ? '研究' : canonicalLayer(plan.layer));

			const layerOptions = (() => {
				const merged = [];
				const add = (raw) => {
					const name = canonicalLayer(raw);
					if (name !== '未分层' && !merged.includes(name)) merged.push(name);
				};
				for (const layer of CANONICAL_LAYERS) add(layer);
				for (const plan of plans) add(plan.layer);
				const rank = (layer) => {
					const found = plans.find((plan) => layerOf(plan) === layer && typeof plan.layerIndex === 'number');
					if (found !== undefined) return found.layerIndex;
					const fallback = CANONICAL_LAYERS.indexOf(layer);
					return fallback < 0 ? 90 : fallback;
				};
				return merged.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
			})();

			/** 发一条命令；命令在对话里留一条记录，这正是我们要的痕迹。 */
			const run = async (line) => {
				setBusy(true);
				setFailed(false);
				setNotice('');
				try {
					const remote = runtime?.remote;
					if (remote?.commands === undefined) throw new Error('没有 remote.commands，发不出命令');
					const result = await remote.commands.execute(sessionId, line, []);
					if (result?.ok !== true) throw new Error(`${result?.error?.code ?? 'error'}: ${result?.error?.message ?? '执行失败'}`);
					if (result.value === undefined) throw new Error(`未知命令：${String(line).split(/\s+/u)[0]}`);
					const outcome = result.value.result ?? {};
					const text = String(outcome.text ?? '');
					setNotice(text);
					setFailed(outcome.kind === 'error');
					try {
						await runtime?.sessions?.refreshProjections?.(sessionId);
					} catch {
						/* 投影会自己到；这里只是催一下 */
					}
					setTick((value) => value + 1);
					return { text, ok: outcome.kind !== 'error' };
				} catch (error) {
					const text = String(error?.message ?? error);
					setNotice(text);
					setFailed(true);
					return { text, ok: false };
				} finally {
					setBusy(false);
				}
			};

			const quiet = (text) => {
				setNotice(text);
				setFailed(false);
			};

			const submitForm = async () => {
				const title = form.title.trim();
				if (title === '') {
					setFailed(true);
					setNotice('先写个标题');
					return;
				}
				const layer = form.layer.trim() === '' ? layerOptions[0] ?? 'A' : form.layer.trim();
				const line = `/plan-new ${JSON.stringify({ title, layer, body: form.body })}`;
				const outcome = await run(line);
				if (outcome.ok) {
					const match = /已(?:写入|登记)\s+(p\d+)/.exec(outcome.text);
					setForm({ title: '', layer: form.layer, body: '' });
					setCreating(false);
					if (match !== null) setSelectedId(match[1]);
				}
			};

			const groups = layerGroups(plans, layerOf);
			const visible = groups
				.map((group) => ({
					...group,
					plans: group.plans.filter((plan) => {
						const status = statusOf(plan, nodes);
						if (layerOnly !== '' && group.layer !== layerOnly) return false;
						if (!showShelved && status === '搁置') return false;
						return true;
					}),
				}))
				.filter((group) => group.plans.length > 0);

			const renderPlanRow = (plan) => {
				const status = statusOf(plan, nodes);
				const branches = nodes.filter((node) => node.planId === plan.id);
				const active = plan.id === selectedId;
				return h(
					'div',
					{ key: plan.id },
					h(
						'div',
						{
							onClick: () => {
								setSelectedId(active ? null : plan.id);
								setCreating(false);
							},
							title: plan.path,
							style: {
								...styles.row,
								padding: '4px 6px',
								borderRadius: 7,
								cursor: 'pointer',
								background: active ? 'var(--dsw-alias-interactive-bg-hover)' : 'transparent',
							},
						},
						h('span', {
							style: {
								width: 6,
								height: 6,
								borderRadius: 3,
								flex: 'none',
								background: STATUS_COLOR[status] ?? STATUS_COLOR.草案,
							},
						}),
						h(
							'span',
							{
								style: {
									flex: 1,
									minWidth: 0,
									overflow: 'hidden',
									textOverflow: 'ellipsis',
									whiteSpace: 'nowrap',
									fontSize: 12,
								},
							},
							plan.title,
						),
						h('span', { style: { ...styles.muted, flex: 'none' } }, status),
						plan.author === 'user' ? h('span', { style: { ...styles.muted, flex: 'none' } }, '我') : null,
					),
					branches.map((node) =>
						h(
							'div',
							{
								key: `${plan.id}:${node.id}`,
								style: {
									...styles.row,
									marginLeft: 18,
									padding: '2px 6px',
									opacity: 0.85,
								},
								title: node.reason,
							},
							h('span', { style: { ...styles.muted, flex: 'none', ...styles.mono } }, node.id),
							h(
								'span',
								{
									style: {
										flex: 1,
										minWidth: 0,
										overflow: 'hidden',
										textOverflow: 'ellipsis',
										whiteSpace: 'nowrap',
										fontSize: 11,
									},
								},
								node.topic ?? node.reason ?? '',
							),
							h('span', { style: { ...styles.muted, flex: 'none' } }, node.verdict ?? node.status),
						),
					),
				);
			};

			const renderDetail = () => {
				if (creating) {
					return h(
						'div',
						{ style: { ...styles.root, padding: 0, gap: 6 } },
						h('div', { style: { ...styles.muted, fontSize: 11 } }, '新建计划：写文件并登记，和模型写的走同一条记录'),
						h('input', {
							style: styles.input,
							placeholder: '标题',
							value: form.title,
							onChange: (event) => setForm({ ...form, title: event.target.value }),
						}),
						h(
							'select',
							{
								style: styles.input,
								value: form.layer === '' ? layerOptions[0] ?? 'A' : form.layer,
								onChange: (event) => setForm({ ...form, layer: event.target.value }),
							},
							layerOptions.map((layer) => h('option', { key: layer, value: layer }, layer)),
						),
						h('textarea', {
							style: { ...styles.input, height: 'auto', flex: 1, minHeight: 90, padding: 6, resize: 'none', lineHeight: 1.5 },
							placeholder: '正文（markdown）。骨架已经按模板生成，这里写的是内容。',
							value: form.body,
							onChange: (event) => setForm({ ...form, body: event.target.value }),
						}),
						h(
							'div',
							{ style: { ...styles.row, justifyContent: 'flex-end' } },
							h('button', { type: 'button', style: styles.button, onClick: () => setCreating(false) }, '取消'),
							h('button', { type: 'button', style: styles.primary, disabled: busy, onClick: submitForm }, busy ? '写入中…' : '写入'),
						),
					);
				}

				if (selected === undefined) {
					return h(
						'div',
						{ style: { ...styles.muted, padding: '10px 2px', lineHeight: 1.6 } },
						plans.length === 0
							? '还没有计划。让模型用 plan_write 写一份，或点「新建计划」自己写。'
							: '选一份计划，在这个面板里读完、就地决定。',
					);
				}

				const status = statusOf(selected, nodes);
				const body = reading === undefined || reading.loading === true
					? h('div', { style: { ...styles.muted, padding: 8 } }, '读取中…')
					: reading.error !== undefined
						? h('div', { style: { ...styles.muted, padding: 8, lineHeight: 1.6 } }, reading.error)
						: h(
								'pre',
								{
									style: {
										margin: 0,
										flex: 1,
										minHeight: 0,
										overflow: 'auto',
										whiteSpace: 'pre-wrap',
										wordBreak: 'break-word',
										fontSize: 13.5,
										lineHeight: 1.6,
										...styles.mono,
										background: 'var(--dsw-alias-bg-layer-1)',
										borderRadius: 7,
										padding: 8,
									},
								},
								reading.text,
								reading.eof === false ? '\n\n…（只读了前 500 行）' : '',
							);

				const canAdopt = selected.adopted !== true && selected.rejected !== true && selected.shelved !== true;
				const canReject = selected.rejected !== true;
				const canShelve = selected.adopted !== true && selected.rejected !== true;
				const line = (name, extra) => `/plan-${name} ${selected.id}${extra ?? ''}`;

				return h(
					'div',
					{ style: { ...styles.root, padding: 0, gap: 6 } },
					h(
						'div',
						{ style: { ...styles.row, flexWrap: 'wrap' } },
						h('span', { style: { fontSize: 12, fontWeight: 500, flex: 1, minWidth: 0 } }, selected.title),
						h('span', { style: { ...styles.muted, flex: 'none', color: STATUS_COLOR[status] } }, status),
					),
					h(
						'div',
						{ style: { ...styles.muted, ...styles.mono, wordBreak: 'break-all', lineHeight: 1.5 } },
						`${selected.id} · ${selected.layer ?? '研究'}${selected.path ? ` · ${selected.path}` : ' · 日志记录（不落盘）'}`,
					),
					h(
						'div',
						{ style: { ...styles.row, flexWrap: 'wrap' } },
						h(
							'button',
							{
								type: 'button',
								style: styles.primary,
								disabled: busy || !canAdopt,
								onClick: () => run(line('adopt')),
							},
							selected.adopted === true ? '已采纳' : '采纳',
						),
						h(
							'button',
							{
								type: 'button',
								style: { ...styles.button, color: canReject ? '#b91c1c' : undefined },
								disabled: busy || !canReject,
								onClick: () => run(line('reject')),
							},
							selected.rejected === true ? '已否决' : '否决',
						),
						h(
							'button',
							{
								type: 'button',
								style: styles.button,
								disabled: busy || !canShelve,
								onClick: () => run(line('shelve')),
							},
							selected.shelved === true ? '取消搁置' : '搁置',
						),
						h('span', { style: { flex: 1 } }),
						h(
							'button',
							{
								type: 'button',
								style: styles.button,
								onClick: () => setTick((value) => value + 1),
							},
							'重读',
						),
					),
					body,
				);
			};

			return h(
				'div',
				{ style: styles.root },
				h(
					'div',
					{ style: styles.row },
					h('span', { style: { fontSize: 12, fontWeight: 500 } }, '计划'),
					h('span', { style: styles.muted }, `${plans.length} 份`),
					h('span', { style: { flex: 1 } }),
					h(
						'button',
						{
							type: 'button',
							style: styles.button,
							onClick: () => {
								setCreating(true);
								setSelectedId(null);
							},
						},
						creating ? '取消新建' : '+ 新建',
					),
				),
				h(
					'div',
					{ style: { ...styles.row, gap: 4 } },
					h(
						'select',
						{
							style: { ...styles.input, height: 24, width: 'auto', flex: 1, minWidth: 0 },
							value: layerOnly,
							onChange: (event) => setLayerOnly(event.target.value),
						},
						h('option', { value: '' }, '所有层'),
						layerOptions.map((layer) => h('option', { key: layer, value: layer }, layer)),
					),
					h(
						'label',
						{ style: { ...styles.muted, display: 'flex', alignItems: 'center', gap: 3, flex: 'none', cursor: 'pointer' } },
						h('input', {
							type: 'checkbox',
							checked: showShelved,
							onChange: (event) => setShowShelved(event.target.checked),
						}),
						'搁置',
					),
				),
				notice === ''
					? null
					: h(
							'div',
							{ style: { fontSize: 10, lineHeight: 1.5, color: failed ? '#b91c1c' : 'var(--dsw-alias-label-tertiary)' } },
							notice,
						),
				planState === undefined
					? h('div', { style: { ...styles.muted, padding: 8, lineHeight: 1.6 } }, '等待宿主投影 plans…（plan-record 没装或还没就绪）')
					: h(
							'div',
							{ style: { flex: '0 1 auto', maxHeight: '45%', minHeight: 0, overflowY: 'auto' } },
							visible.length === 0
								? h('div', { style: { ...styles.muted, padding: 8 } }, plans.length === 0 ? '（空）' : '筛选之后没有计划')
								: visible.map((group) =>
										h(
											'div',
											{ key: group.layer, style: { marginBottom: 4 } },
											h(
												'div',
												{ style: { ...styles.group, padding: '4px 6px 2px' } },
												`${group.layer} · ${group.plans.length}`,
											),
											group.plans.map(renderPlanRow),
										),
									),
						),
				h('div', { style: { borderTop: '0.5px solid var(--dsw-alias-border-l2)' } }),
				h('div', { style: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' } }, renderDetail()),
			);
		}

		return {
			inject: ['slots', 'sidebarRightTabs', 'remote', 'remote.commands', 'remote.workspaceFiles'],
			apply(ctx) {
				runtime = ctx;
				// 卸载时断开创建引用：页面若还挂着，宁可报"没有 remote"也不要对死掉的 ctx 操作。
				ctx.effect(() => () => {
					if (runtime === ctx) runtime = undefined;
				});
				ctx.effect(() =>
					ctx.sidebarRightTabs.register({
						id: TYPE_ID,
						kind: KIND,
						title: () => '计划',
						guide: [
							{
								id: 'plan-tree',
								order: 45,
								title: () => '计划',
								description: () => '计划树：读正文、就地采纳或否决',
							},
						],
					}),
				);
				ctx.slots.inject('sidebar.right.pane.tab', () =>
					ctx.slots.register({ name: 'sidebar.right.pane.tab', key: TYPE_ID }, PlanTreePage),
				);
			},
		};
	},
});

