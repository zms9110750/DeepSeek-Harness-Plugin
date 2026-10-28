/* ══════════════════════════════════════════════════════════════
   过滤栏 —— 两级单选

   用户原话（GU-07）：

     > 搁置可以点，点了展开的"需要授权""需要信息"，应该是子按钮，
     > 可以继续点击的。并且，这个"进行""搁置""完成"，应该是单选。
     > 而点击以后里面展开的，里面也是单选，不是纯文本。

   ## 三态

     ① 收起         [状态 ▸]  [类别 ▸]  [领域 ▸]
     ② 展开一级     [状态 ▾] [进行] [搁置] [已结束] [草稿]
     ③ 展开二级     [状态 ▾] [进行] [搁置] [已结束] [草稿]
                              └─[需要补充] [需要授权]  ← 真按钮

   ## 两条规则

   ① 一级单选：四个组同时只能选一个
   ② 二级单选：子项是真按钮，也是同时只能选一个

   选了二级之后，一级显示 `搁置·需要补充`，一级也高亮 ——
   这样用户一眼看出「筛的是搁置里的需要补充」。
   ══════════════════════════════════════════════════════════════ */

/** 三个过滤维度的定义。 */
const FILTER_DEFS = [
	{
		key: 'status',
		label: '状态',
		groups: [
			{ key: '进行', children: ['提交', '处理中'] },
			{ key: '搁置', children: ['需要补充', '需要授权'] },
			{ key: '已结束', children: ['完成', '失败', '取消', '拒绝'] },
			{ key: '草稿', children: [] }
		]
	},
	{
		key: 'kind',
		label: '类别',
		groups: [
			{ key: 'goal', label: '目标', children: [] },
			{ key: 'design', label: '设计', children: [] },
			{ key: 'record', label: '记录', children: [] },
			{ key: 'work', label: '工作', children: [] }
		]
	},
	{
		key: 'domain',
		label: '领域',
		groups: [
			{ key: 'code', label: '代码', children: [] },
			{ key: 'writing', label: '写作', children: [] },
			{ key: 'art', label: '绘画', children: [] },
			{ key: 'general', label: '通用', children: [] }
		]
	}
];

/**
 * 渲染过滤栏。
 *
 * state 里用到：
 *   filterOpen    哪个维度在展开（'' = 全收起）
 *   filterSub     哪个组展开了子项
 *   filterStatus / filterKinds / filterDomains  选中的值（单选，最多一个）
 */
function renderFilters() {
	const box = document.getElementById('filters');
	if (box === null) return;
	box.innerHTML = '';

	const bar = el('div', { class: 'fb' });

	for (const def of FILTER_DEFS) {
		const picked = pickedOf(def.key);
		const open = state.filterOpen === def.key;

		const group = el('div', {
			class: 'fb-group' + (open ? ' open' : '') + (picked.length > 0 ? ' has' : '')
		});

		/* ── 维度名。点它展开 / 收回 ── */
		group.appendChild(el('button', {
			class: 'fb-name',
			type: 'button',
			onclick(event) {
				event.stopPropagation();
				state.filterOpen = open ? '' : def.key;
				state.filterSub = '';
				renderFilters();
				renderContent();
			}
		},
			el('span', { class: 'fb-chev' }, open ? '▾' : '▸'),
			def.label));

		if (!open) { bar.appendChild(group); continue; }

		/* ── 一级：组，单选 ── */
		for (const g of def.groups) {
			const label = g.label || g.key;
			const hasSub = g.children.length > 0;
			const subOpen = state.filterSub === g.key;

			/*
			 * 一级的选中态有三种：
			 *   组被选中、没展开子项         → on
			 *   组被选中、展开了子项         → on + 显示「搁置·需要补充」
			 *   组没选中                     → 不亮
			 */
			const subPicked = picked.find(function (v) { return g.children.includes(v); }) || '';
			const groupOn = picked.includes(g.key);
			const shownLabel = subPicked !== '' ? label + '·' + subPicked : label;

			const item = el('button', {
				class: 'fb-item-name' + (groupOn || subPicked !== '' ? ' on' : ''),
				type: 'button',
				onclick(event) {
					event.stopPropagation();
					/*
					 * 点一级：
					 *   · 还没选这个组   → 选中它，并展开子项
					 *   · 已经选了       → 取消选中，收起子项
					 *
					 * 一级是单选 —— 选新的就清掉旧的。
					 */
					if (groupOn || subPicked !== '') {
						pickedOf(def.key).length = 0;
						state.filterSub = '';
					} else {
						pickedOf(def.key).length = 0;
						pickedOf(def.key).push(g.key);
						state.filterSub = hasSub ? g.key : '';
					}
					renderFilters();
					renderContent();
				}
			}, shownLabel);

			/*
			 * 一级那一格 + 它的子项，装进同一个容器。
			 *
			 * 子项必须**在结构上**从属于这一格，不能只是排在后面 ——
			 * 否则看起来像「进行 / 搁置 / 需要补充 / 需要授权 / 已结束」
			 * 五个平级的东西。
			 */
			const cell = el('span', { class: 'fb-cell' + (subOpen && hasSub ? ' spread' : '') }, item);

			if (subOpen && hasSub) {
				for (const child of g.children) {
					const childOn = picked.includes(child);
					cell.appendChild(el('button', {
						class: 'fb-sub' + (childOn ? ' on' : ''),
						type: 'button',
						onclick(event) {
							event.stopPropagation();
							/*
							 * 点二级：只选中这个具体状态，一级那格跟着亮。
							 * 二级是单选 —— 选新的就清掉旧的。
							 */
							pickedOf(def.key).length = 0;
							if (!childOn) pickedOf(def.key).push(child);
							renderFilters();
							renderContent();
						}
					}, child));
				}
			}

			group.appendChild(cell);
		}

		bar.appendChild(group);
	}

	/* ── 清空。只说清的是这一维，避免误清搜索词 ── */
	const total = state.filterStatus.length + state.filterKinds.length + state.filterDomains.length;
	if (total > 0) {
		bar.appendChild(el('button', {
			class: 'fb-clear',
			type: 'button',
			onclick() {
				state.filterStatus.length = 0;
				state.filterKinds.length = 0;
				state.filterDomains.length = 0;
				state.filterOpen = '';
				state.filterSub = '';
				renderFilters();
				renderContent();
			}
		}, '清空筛选'));
	}

	/*
	 * 搜索框。
	 *
	 * 不能调 renderAll —— renderAll 第一步是 renderFilters()，
	 * 那会把这个 DOM 节点连同焦点一起销毁，表现为只能打进去第一个字。
	 */
	bar.appendChild(el('input', {
		class: 'search',
		type: 'search',
		placeholder: '搜编号或标题…',
		value: state.search,
		oninput(e) {
			state.search = e.target.value;
			renderContent();
		}
	}));

	box.appendChild(bar);

	/* 点空白处收回：只收起，不清空已选 */
	if (state.filterOpen !== '') {
		setTimeout(function () {
			const handler = function (event) {
				/* 先无条件摘掉，避免提前 return 时留下悬挂监听 */
				document.removeEventListener('pointerdown', handler);
				if (box.contains(event.target)) return;
				/* 选了东西就别收回 —— 用户要看得见自己筛了什么 */
				if (pickedOf(state.filterOpen).length > 0) return;
				state.filterOpen = '';
				state.filterSub = '';
				renderFilters();
			};
			document.addEventListener('pointerdown', handler);
		}, 0);
	}
}

/**
 * 某个维度已选的值。
 *
 * @param {string} key
 * @returns {string[]}
 */
function pickedOf(key) {
	if (key === 'status') return state.filterStatus;
	if (key === 'kind') return state.filterKinds;
	return state.filterDomains;
}

/* ══════════════════════════════════════════════════════════════
   图例 —— 每种关系一种颜色
   ══════════════════════════════════════════════════════════════ */
function renderLegend() {
	const box = document.getElementById('legend');
	if (box === null) return;
	box.innerHTML = '';
	for (const kind of LINK_KINDS) {
		const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
		svg.setAttribute('width', '16');
		svg.setAttribute('height', '8');
		const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
		line.setAttribute('x1', '0');
		line.setAttribute('y1', '4');
		line.setAttribute('x2', '16');
		line.setAttribute('y2', '4');
		line.setAttribute('stroke', kind.color);
		line.setAttribute('stroke-width', '1.6');
		if (kind.dashed) line.setAttribute('stroke-dasharray', '4 3');
		svg.appendChild(line);
		box.appendChild(el('span', { class: 'lg', title: kind.label }, svg, kind.label));
	}
}
