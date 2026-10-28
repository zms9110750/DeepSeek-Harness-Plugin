/* ══════════════════════════════════════════════════════════════
   过滤栏 —— 横向展开

   用户原话（GU-06 第 2 条）：

     > 筛选的过滤器。我要的是横向的展开。不是竖的。行为是：
     > 按钮默认写着   >状态<
     > 点击以后变成   >状态|进行|搁置|完成
     > 再次点击"状态"，或者没有选中类别进行筛选就失去焦点，那么他就会收回。
     > 如果点击了筛选，他就会保持展开，同时，那个按钮还会进一步展开。
     > 状态|进行|搁置-需要信息/需要授权|完成

   ## 三态

     ① 收起         `>状态<`
     ② 展开一级     `>状态|进行|搁置|完成<`
     ③ 展开二级     `>状态|进行|搁置-需要信息/需要授权|完成<`

   ②→③ 的触发：点了某一项。
   ③ 里那一项变成 `搁置-需要信息/需要授权`（用 `-` 挂子项）。

   ## 什么时候收回

     · 再点「状态」那一格
     · 没选任何项就失焦

   选了项就**保持展开**（因为有筛选生效，得看得见）。
   ══════════════════════════════════════════════════════════════ */

/** 三个过滤维度的定义：key / 面包屑 / 组 / 组下的子项 */
const FILTER_DEFS = [
  {
    key: 'status',
    label: '状态',
    groups: [
      { key: '进行', children: ['提交', '处理中'] },
      { key: '搁置', children: ['需要补充', '需要授权'] },
      { key: '完成', children: ['完成', '失败', '取消'] },
      { key: '草稿', children: ['未指定'] }
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
 *   filterOpen   哪个维度是展开的（'' = 全收起）
 *   filterSub    哪个组展开了子项
 *   filterStatus / filterKinds / filterDomains  选中的值
 */
function renderFilters() {
  const box = document.getElementById('filters');
  if (box === null) return;
  box.innerHTML = '';

  const bar = el('div', {class:'fb'});

  for (const def of FILTER_DEFS) {
    const picked = pickedOf(def.key);
    const open = state.filterOpen === def.key;

    bar.appendChild(el('div', {class:'fb-group' + (open ? ' open' : '') + (picked.length ? ' has' : '')},
      /* 维度名那一格 —— 点它展开/收回 */
      el('button', {
        class:'fb-name', type:'button',
        onclick(event) {
          event.stopPropagation();
          if (state.filterOpen === def.key) {
            /* 再点一次：收回（前提是没选东西；选了就保留） */
            state.filterOpen = '';
            state.filterSub = '';
          } else {
            state.filterOpen = def.key;
            state.filterSub = '';
          }
          renderFilters();
          renderContent();
        }
      },
        el('span', {class:'fb-chev'}, open ? '▾' : '▸'),
        def.label),

      /* 展开后：每一项一格，横向排 */
      open ? def.groups.map(function (group) {
        const active = picked.includes(group.key);
        const hasSub = group.children.length > 0;
        const subOpen = state.filterSub === group.key;

        /* 这一格的文字：没展开子项就是组名，展开了就是 `组名-子项/子项` */
        const text = subOpen && hasSub
          ? group.key + '-' + group.children.join('/')
          : (group.label || group.key);

        return el('span', {class:'fb-item' + (active ? ' on' : ''), key: group.key},
          el('span', {
            class:'fb-item-name',
            onclick(event) {
              event.stopPropagation();
              /* 点这一项：选中/取消 + 展开它的子项 */
              togglePick(pickedOf(def.key), group.key);
              state.filterSub = (subOpen || !hasSub) ? '' : group.key;
              renderFilters();
              renderContent();
            }
          }, text),

          /* 子项不单独列 —— 用户要的就是
             「搁置-需要信息/需要授权」这一整格。
             点这一格 = 选中「搁置」组。 */);
      }) : null));
  }

  /* 清空 */
  const total = state.filterStatus.length + state.filterKinds.length + state.filterDomains.length;
  if (total > 0) {
    bar.appendChild(el('button', {
      class:'fb-clear', type:'button',
      onclick() {
        state.filterStatus = [];
        state.filterKinds = [];
        state.filterDomains = [];
        state.filterOpen = '';
        state.filterSub = '';
        renderFilters();
        renderContent();
      }
    }, '清空'));
  }

  /*
   * 搜索框。
   *
   * ## 为什么不能调 renderAll
   *
   * renderAll 第一步就是 renderFilters()，而那个函数开头是
   * box.innerHTML = '' —— 搜索框这个 DOM 节点会被销毁，焦点随之丢失。
   * 表现是「搜索框里只能打进去第一个字」。
   *
   * 所以渲染拆成两半：
   *   renderContent()  只重绘列表和详情
   *   renderAll()      两者都重绘
   */
  bar.appendChild(el('input', {
    class:'search', type:'search', placeholder:'搜编号或标题…',
    value: state.search,
    oninput(e) {
      state.search = e.target.value;
      renderContent();
    }
  }));

  box.appendChild(bar);

  /* 失焦收回：点空白处，如果没选东西就收起 */
  if (state.filterOpen !== '') {
    setTimeout(function () {
      const handler = function (event) {
        if (box.contains(event.target)) return;
        if (pickedOf(state.filterOpen).length === 0) {
          state.filterOpen = '';
          state.filterSub = '';
          renderFilters();
          renderContent();
        }
        document.removeEventListener('pointerdown', handler);
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

/** 在数组里加/删一项。 */
function togglePick(list, key) {
  const i = list.indexOf(key);
  if (i >= 0) list.splice(i, 1);
  else list.push(key);
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
    box.appendChild(el('span', {class:'lg', title: kind.label}, svg, kind.label));
  }
}
