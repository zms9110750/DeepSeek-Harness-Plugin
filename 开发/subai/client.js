/**
 * subai · 客户端半边：会话顶栏的「N 个子 AI」下拉，位置在官方「N 个子智能体」右边。
 *
 * 只依赖 `react`（外部客户端模块能拿到的公共依赖只有它最稳），图标用内联 SVG，
 * 面板用 position:fixed 自己算坐标，不引 primitives / react-dom，避免加载失败。
 * 数据来自插槽标准属性 useSessions（state.byId），不轮询、不读写日志。
 */
window.__ModuleLoader__.load({
	id: '@local/subai',
	factory(require) {
		const React = require('react')
		const h = React.createElement

		const PANEL_WIDTH = 320
		const PANEL_MAX_HEIGHT = 480

		function UsersIcon(props) {
			const size = props?.size ?? 14
			return h(
				'svg',
				{ width: size, height: size, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true', style: { flex: '0 0 auto' } },
				h('circle', { cx: 6, cy: 5.2, r: 2.4, stroke: 'currentColor', strokeWidth: 1.2 }),
				h('path', {
					d: 'M1.8 13.2c0-2.2 1.9-3.6 4.2-3.6s4.2 1.4 4.2 3.6',
					stroke: 'currentColor',
					strokeWidth: 1.2,
					strokeLinecap: 'round',
				}),
				h('circle', { cx: 11.4, cy: 5.8, r: 1.9, stroke: 'currentColor', strokeWidth: 1.1, opacity: 0.7 }),
				h('path', {
					d: 'M10.6 9.7c1.9 0 3.6 1.1 3.6 3.1',
					stroke: 'currentColor',
					strokeWidth: 1.1,
					strokeLinecap: 'round',
					opacity: 0.7,
				}),
			)
		}

		function ChevronIcon(props) {
			const size = props?.size ?? 12
			return h(
				'svg',
				{
					width: size,
					height: size,
					viewBox: '0 0 16 16',
					fill: 'none',
					'aria-hidden': 'true',
					style: { flex: '0 0 auto', transition: 'transform .12s', transform: props?.open ? 'rotate(180deg)' : 'none' },
				},
				h('path', { d: 'M4 6.5 8 10.5 12 6.5', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round', strokeLinejoin: 'round' }),
			)
		}

		function shortId(id) {
			return String(id).startsWith('session-') ? String(id).slice(8, 16) : String(id)
		}

		/** 从 store 的 byId 里按 parentId 收出子 AI 树。 */
		function buildTree(byId) {
			const children = new Map()
			let total = 0
			for (const [id, summary] of Object.entries(byId ?? {})) {
				if (summary?.origin !== 'subagent') continue
				const parent = summary.parentId
				if (typeof parent !== 'string') continue
				if (!children.has(parent)) children.set(parent, [])
				children.get(parent).push({ id, summary })
				total += 1
			}
			return { children, total }
		}

		function Panel(props) {
			const { rect, tree, sessionId, collapsed, onToggle, onOpen, onClose } = props
			const rows = []
			const push = (node, depth) => {
				const kids = tree.children.get(node.id) ?? []
				const isCollapsed = collapsed[node.id] === true
				rows.push(
					h(
						'div',
						{
							key: `row:${node.id}`,
							style: {
								display: 'flex',
								alignItems: 'center',
								gap: 6,
								padding: `3px 8px 3px ${8 + depth * 14}px`,
								borderRadius: 4,
								cursor: 'pointer',
								fontSize: 12,
								lineHeight: '18px',
								overflow: 'hidden',
								whiteSpace: 'nowrap',
							},
							title: node.id,
							onClick: () => {
								onClose()
								onOpen(node.id)
							},
						},
						h(
							'span',
							{
								style: { width: 12, flex: '0 0 12px', textAlign: 'center', color: 'var(--dsw-alias-label-tertiary, #9ca3af)' },
								onClick: (event) => {
									event.stopPropagation()
									if (kids.length > 0) onToggle(node.id)
								},
							},
							kids.length > 0 ? (isCollapsed ? '▸' : '▾') : '',
						),
						h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis' } }, shortId(node.id)),
						kids.length > 0
							? h('span', { style: { marginLeft: 'auto', fontSize: 10, color: 'var(--dsw-alias-label-tertiary, #9ca3af)' } }, String(kids.length))
							: null,
					),
				)
				if (!isCollapsed) for (const kid of kids) push(kid, depth + 1)
			}
			for (const node of tree.children.get(sessionId) ?? []) push(node, 0)

			const left = rect === null ? 0 : Math.max(8, Math.min(rect.left, (globalThis.innerWidth ?? 1024) - PANEL_WIDTH - 8))
			const top = rect === null ? 0 : rect.bottom + 5
			return h(
				'div',
				{
					style: {
						position: 'fixed',
						left,
						top,
						zIndex: 1000,
						width: PANEL_WIDTH,
						maxHeight: PANEL_MAX_HEIGHT,
						overflow: 'auto',
						padding: 6,
						borderRadius: 'var(--dsw-radius-lg, 10px)',
						background: 'var(--dsw-specific-menu, #fff)',
						border: '0.5px solid var(--dsw-alias-border-l1, #e5e7eb)',
						boxShadow: 'var(--dsw-elevation-prominent, 0 8px 24px rgba(0,0,0,.16))',
					},
					role: 'dialog',
					'aria-label': '子 AI',
					onMouseDown: (event) => event.stopPropagation(),
				},
				h(
					'div',
					{ style: { padding: '4px 8px 6px', fontSize: 11, color: 'var(--dsw-alias-label-tertiary, #9ca3af)' } },
					`子 AI · ${tree.total}`,
				),
				rows.length === 0 ? h('div', { style: { padding: '8px', fontSize: 12, color: 'var(--dsw-alias-label-tertiary, #9ca3af)' } }, '还没有子 AI') : rows,
			)
		}

		function SubaiTreeAction(props) {
			const { sessionId, useSessions, openSession } = props
			const byId = useSessions((state) => state.byId)
			const [open, setOpen] = React.useState(false)
			const [rect, setRect] = React.useState(null)
			const [collapsed, setCollapsed] = React.useState({})
			const triggerRef = React.useRef(null)
			const rootRef = React.useRef(null)
			const tree = React.useMemo(() => buildTree(byId), [byId])
			const direct = (tree.children.get(sessionId) ?? []).length

			// 先始终渲染（没有子 AI 时显示 0）：这样"看不到"就能区分是模块没加载还是数据为空。

			React.useEffect(() => {
				if (!open) return undefined
				const onPointer = (event) => {
					if (rootRef.current !== null && rootRef.current.contains(event.target)) return
					if (event.target?.closest?.('[data-subai-panel]') !== null) return
					setOpen(false)
				}
				const onKey = (event) => {
					if (event.key === 'Escape') setOpen(false)
				}
				document.addEventListener('pointerdown', onPointer)
				document.addEventListener('keydown', onKey)
				return () => {
					document.removeEventListener('pointerdown', onPointer)
					document.removeEventListener('keydown', onKey)
				}
			}, [open])

			const toggleOpen = () => {
				const next = !open
				if (next && triggerRef.current !== null) setRect(triggerRef.current.getBoundingClientRect())
				setOpen(next)
			}

			return h(
				'div',
				{ ref: rootRef, style: { position: 'relative', display: 'inline-flex', alignItems: 'center' }, 'data-subai-root': 'true' },
				h(
					'button',
					{
						type: 'button',
						ref: triggerRef,
						'aria-haspopup': 'dialog',
						'aria-expanded': open,
						title: '本会话派出的子 AI（日志存在用户目录的 sqlite 里）',
						style: {
							display: 'inline-flex',
							alignItems: 'center',
							gap: 4,
							minHeight: 28,
							padding: '3px 2px',
							border: 0,
							background: 'transparent',
							color: 'var(--dsw-alias-label-tertiary, #6b7280)',
							font: 'inherit',
							fontSize: 12,
							lineHeight: '18px',
							cursor: 'pointer',
							borderRadius: 'var(--dsw-radius-sm, 4px)',
						},
						onClick: toggleOpen,
					},
					h(UsersIcon, { size: 14 }),
					h('span', null, `${direct} 个子 AI`),
					h(ChevronIcon, { size: 12, open }),
				),
				open
					? h(
							'div',
							{ 'data-subai-panel': 'true' },
							h(Panel, {
								rect,
								tree,
								sessionId,
								collapsed,
								onToggle: (id) => setCollapsed((prev) => ({ ...prev, [id]: prev[id] !== true })),
								onOpen: openSession,
								onClose: () => setOpen(false),
							}),
						)
					: null,
			)
		}

		return {
			inject: ['slots', 'uiWorkspace'],
			apply(ctx) {
				ctx.slots.inject('conversation.session.header.actions', () =>
					ctx.slots.register(
						{
							name: 'conversation.session.header.actions',
							id: 'subai-tree',
							order: 15,
							inject: () => ({ openSession: (id) => ctx.uiWorkspace.openSession(id) }),
						},
						SubaiTreeAction,
					),
				)
			},
		}
	},
})
