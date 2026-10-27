/* ══════════════════════════════════════════════════════════════
   过滤栏 —— 二级菜单

   用户原话：

     > 过滤栏，应该做二级菜单。点击展开以后才有过滤选项。
     > 一级菜单是"状态"，"类别"，"领域"。
     > 当二级点进去的时候，他还会从旁边展开三级菜单（占文档流）。
     > 例如"搁置"->"需要信息，需要权限"。"完成"-》"成功"，"失败"，"取消"。
     > 而类别，就是这个类别下面的模板。

   ## 结构

     一级（横排）：[状态 ▾] [类别 ▾] [领域 ▾]
     二级（点开后，横向）：组 / 类别 / 领域
     三级（点二级某一项后，**占文档流**展开）：该组下的具体状态 / 该类别下的模板

   「占文档流」很重要：三级不是浮层，是往下推开内容。
   因为选完就得看结果，浮层会挡住。
   ══════════════════════════════════════════════════════════════ */

/**
 * 渲染过滤栏。
 *
 * 状态存在 state 里：
 *   filterOpen   打开的是哪一级（'' / 'status' / 'kind' / 'domain'）
 *   filterStatus 选中的状态（组名或具体状态）
 *   filterKinds  选中的类别
 *   filterDomains 选中的领域
 *   filterSub    二级里展开的那一项
 */
function renderFilters() {
  const box = document.getElementById('filters');
  if (!box) return;
  box.innerHTML = '';

  const groups = [
    { key: 'status', label: '状态', picked: state.filterStatus },
    { key: 'kind', label: '类别', picked: state.filterKinds },
    { key: 'domain', label: '领域', picked: state.filterDomains }
  ];

  /* 一级 */
  const bar = el('div', {class:'filter-bar'});
  for (const g of groups) {
    const open = state.filterOpen === g.key;
    const n = g.picked.length;
    bar.appendChild(el('button', {
      class: 'filter-btn' + (open ? ' on' : '') + (n > 0 ? ' has' : ''),
      type: 'button',
      onclick() {
        state.filterOpen = open ? '' : g.key;
        state.filterSub = '';
        renderFilters();
        renderAll();
      }
    },
      g.label,
      n > 0 ? el('span', {class:'n'}, String(n)) : null,
      el('span', {class:'chev'}, '▾')));
  }

  /* 全部 / 清空 */
  if (state.filterStatus.length + state.filterKinds.length + state.filterDomains.length > 0) {
    bar.appendChild(el('button', {
      class:'filter-clear', type:'button',
      onclick() {
        state.filterStatus = [];
        state.filterKinds = [];
        state.filterDomains = [];
        state.filterOpen = '';
        state.filterSub = '';
        renderFilters();
        renderAll();
      }
    }, '清空筛选'));
  }

  /* 搜索框放右边 */
  bar.appendChild(el('input', {
    class:'search', type:'search', placeholder:'搜编号或标题…', id:'search',
    value: state.search,
    oninput(e) { state.search = e.target.value; renderAll(); }
  }));
  box.appendChild(bar);

  /* 二级：占文档流，往下推开 */
  if (state.filterOpen !== '') {
    box.appendChild(renderFilterPanel(state.filterOpen));
  }
}

/**
 * 二级 + 三级面板。
 *
 * @param {string} which 'status' / 'kind' / 'domain'
 * @returns {HTMLElement}
 */
function renderFilterPanel(which) {
  const panel = el('div', {class:'filter-panel'});

  /* ── 状态 ── */
  if (which === 'status') {
    const left = el('div', {class:'filter-col'});
    for (const row of STATUS_TREE) {
      const picked = state.filterStatus.includes(row.key);
      const active = state.filterSub === row.key;
      left.appendChild(el('button', {
        class: 'filter-item' + (active ? ' on' : '') + (picked ? ' picked' : ''),
        type: 'button',
        onclick() {
          /* 点组名 = 选/取消这个组；同时展开它的三级 */
          togglePick(state.filterStatus, row.key);
          state.filterSub = active ? '' : row.key;
          renderFilters();
          renderAll();
        }
      }, row.key, el('span', {class:'chev'}, '▸')));
    }

    /* 三级：该组下的具体状态 */
    const row = STATUS_TREE.find((x) => x.key === state.filterSub);
    if (row) {
      const right = el('div', {class:'filter-col sub'});
      right.appendChild(el('div', {class:'filter-sub-head'}, row.key + ' 里包含'));
      for (const child of row.children) {
        const picked = state.filterStatus.includes(child);
        right.appendChild(el('button', {
          class: 'filter-item' + (picked ? ' picked' : ''),
          type: 'button',
          onclick() {
            togglePick(state.filterStatus, child);
            renderFilters();
            renderAll();
          }
        }, child, picked ? el('span', {class:'tick'}, '✓') : null));
      }
      panel.appendChild(left);
      panel.appendChild(right);
      return panel;
    }
    panel.appendChild(left);
    return panel;
  }

  /* ── 类别 ── */
  if (which === 'kind') {
    const left = el('div', {class:'filter-col'});
    for (const row of KIND_TREE) {
      const picked = state.filterKinds.includes(row.key);
      const active = state.filterSub === row.key;
      left.appendChild(el('button', {
        class: 'filter-item' + (active ? ' on' : '') + (picked ? ' picked' : ''),
        type: 'button',
        onclick() {
          togglePick(state.filterKinds, row.key);
          state.filterSub = active ? '' : row.key;
          renderFilters();
          renderAll();
        }
      }, row.label, el('span', {class:'chev'}, '▸')));
    }

    /* 三级：该类别下的模板 */
    const row = KIND_TREE.find((x) => x.key === state.filterSub);
    if (row) {
      const right = el('div', {class:'filter-col sub'});
      right.appendChild(el('div', {class:'filter-sub-head'}, row.label + ' 的模板'));
      const list = TEMPLATES.filter((t) => t.kind === row.key);
      if (list.length === 0) {
        right.appendChild(el('div', {class:'filter-empty'}, '（这个类别下没有模板）'));
      }
      for (const tpl of list) {
        right.appendChild(el('button', {
          class:'filter-item', type:'button',
          onclick() {
            /* 点模板 = 按模板编号筛。用 filterTypes 单独存 */
            togglePick(state.filterTypes, tpl.code);
            renderFilters();
            renderAll();
          }
        },
          el('span', {class:'tpl-code'}, tpl.letter),
          tpl.name,
          state.filterTypes.includes(tpl.code) ? el('span', {class:'tick'}, '✓') : null));
      }
      panel.appendChild(left);
      panel.appendChild(right);
      return panel;
    }
    panel.appendChild(left);
    return panel;
  }

  /* ── 领域 ── */
  const left = el('div', {class:'filter-col'});
  for (const row of DOMAIN_TREE) {
    const picked = state.filterDomains.includes(row.key);
    const active = state.filterSub === row.key;
    left.appendChild(el('button', {
      class: 'filter-item' + (active ? ' on' : '') + (picked ? ' picked' : ''),
      type: 'button',
      onclick() {
        togglePick(state.filterDomains, row.key);
        state.filterSub = active ? '' : row.key;
        renderFilters();
        renderAll();
      }
    }, row.label, el('span', {class:'chev'}, '▸')));
  }

  /* 三级：该领域下的模板 */
  const row = DOMAIN_TREE.find((x) => x.key === state.filterSub);
  if (row) {
    const right = el('div', {class:'filter-col sub'});
    right.appendChild(el('div', {class:'filter-sub-head'}, row.label + ' 的模板'));
    const list = TEMPLATES.filter((t) => t.domain === row.key);
    if (list.length === 0) {
      right.appendChild(el('div', {class:'filter-empty'}, '（这个领域下没有模板）'));
    }
    for (const tpl of list) {
      right.appendChild(el('button', {
        class:'filter-item', type:'button',
        onclick() {
          togglePick(state.filterTypes, tpl.code);
          renderFilters();
          renderAll();
        }
      },
        el('span', {class:'tpl-code'}, tpl.code),
        tpl.name,
        state.filterTypes.includes(tpl.code) ? el('span', {class:'tick'}, '✓') : null));
    }
    panel.appendChild(left);
    panel.appendChild(right);
    return panel;
  }
  panel.appendChild(left);
  return panel;
}

/** 在数组里加/删一项。 */
function togglePick(list, key) {
  const i = list.indexOf(key);
  if (i >= 0) list.splice(i, 1);
  else list.push(key);
}

/* ══════════════════════════════════════════════════════════════
   图例 —— 每种关系一种颜色

   用户原话：
     > 这个图例只有父子和链接。但既然链接关系不多，
     > 那就可以给每个关系都做一种图例。

   只在科技树视图显示（列表里没有连线，图例没意义）。
   ══════════════════════════════════════════════════════════════ */
function renderLegend() {
  const box = document.getElementById('legend');
  if (!box) return;
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
