function renderBody(task) {
  const body = task.body;
  /* 旧格式字符串：整段按 Markdown 纯文本显示 */
  if (typeof body === 'string') {
    const d = el('div', {class:'prose'});
    d.innerHTML = md(body);
    return d;
  }
  /* 新格式 object：按章节渲染 */
  const out = [];
  for (const [key, section] of Object.entries(body || {})) {
    const action = section.action;
    if (action === 'markdown' || action === 'textarea') {
      {
        const d = el('div', {class:'prose'});
        d.innerHTML = md(section.value || '');
        out.push(el('div', {class:'sec'}, el('div', {class:'sec-title'}, key), d));
      }
    } else if (action === 'choose') {
      out.push(renderChoose(key, section));
    } else if (action === 'rank') {
      out.push(renderRank(key, section));
    } else if (action === 'derive') {
      out.push(renderDerive(key, section));
    } else {
      out.push(el('div', {class:'sec'},
        el('div', {class:'sec-title'}, key),
        el('div', {class:'unknown'}, '未注册的交互类型「' + action + '」',
          el('pre', null, JSON.stringify(section, null, 2)))));
    }
  }
  return out.length ? el('div', null, out) : null;
}

function renderChoose(key, section) {
  const options = Array.isArray(section.options) ? section.options : [];
  const picked = section.picked || '';
  return el('div', {class:'sec'},
    el('div', {class:'sec-title'}, key),
    el('div', {class:'inter'},
      el('div', {class:'inter-cap'}, '需要你选', el('span', {class:'src'}, '来自正文')),
      ...options.map((text) => el('button', {
        class:'choice' + (text === picked ? ' on' : ''),
        type:'button',
        onclick() { this.classList.toggle('on'); }
      }, el('span', {class:'radio'}), el('span', null, text)))));
}

function renderRank(key, section) {
  const items = Array.isArray(section.items) ? section.items : [];
  return el('div', {class:'sec'},
    el('div', {class:'sec-title'}, key),
    el('div', {class:'inter'},
      el('div', {class:'inter-cap'}, '排一下顺序', el('span', {class:'src'}, '来自正文')),
      ...items.map((text, i) => el('div', {class:'rank-row'},
        el('span', {class:'no'}, String(i + 1)),
        el('span', {class:'txt'}, text)))));
}

function renderDerive(key, section) {
  const tpls = Array.isArray(section.templates) ? section.templates : [];
  const mode = section.mode || 'ask';
  const modeLabel = mode === 'auto' ? '直接建' : mode === 'manual' ? '只能你建' : '问你';
  return el('div', {class:'sec'},
    el('div', {class:'sec-title'}, key),
    el('div', {class:'inter'},
      el('div', {class:'inter-cap'}, '拆成子任务', el('span', {class:'src'}, '模板默认 · union 槽位 derive')),
      ...tpls.map((t) => el('button', {class:'quick-task', type:'button'},
        el('span', {class:'code'}, t), '派生任务',
        el('span', {style:{fontSize:'9.5px',color:'var(--text-3)',marginLeft:'5px'}}, modeLabel)))));
}

/* ══════════════════════════════════════════════════════════════
   工具
   ══════════════════════════════════════════════════════════════ */
function el(tag, props, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (k === 'class') node.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined && v !== false) node.setAttribute(k, v);
  }
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    node.appendChild(typeof child === 'object' ? child : document.createTextNode(String(child)));
  }
  return node;
}

/* ══════════════════════════════════════════════════════════════
   状态
   ══════════════════════════════════════════════════════════════ */
const state = {
  view: 'tree',
  group: 'g-2',
  filter: '全部',
  search: '',
  selected: '',
  menuOpen: false,
  relOpen: false,
  /* 本地改的状态（不写盘，只是让界面能点） */
  overrides: {}
};
const taskOf = (id) => DB.find((x) => x.id === id);
const statusOf = (t) => t.status;

/* ══════════════════════════════════════════════════════════════
   渲染列表
   ══════════════════════════════════════════════════════════════ */
function renderGroups() {
  const box = document.getElementById('groups');
  box.innerHTML = '';
  const groups = [
    { id:'g-2', name:'开发任务板', members:DB.map((t) => t.id) },
    { id:'g-3', name:'测试任务板', members:[] }
  ];
  for (const g of groups) {
    const live = g.members.filter((id) => taskOf(id));
    box.appendChild(el('button', {
      class:'group' + (g.id === state.group ? ' on' : ''),
      type:'button',
      onclick() { state.group = g.id; renderAll(); }
    }, g.name, el('span', {class:'n'}, String(live.length))));
  }
  box.appendChild(el('button', {class:'group', type:'button', title:'新建分组'}, '＋'));
  box.appendChild(el('span', {class:'grow'}));
  box.appendChild(el('button', {class:'btn', type:'button', style:{fontSize:'11.5px',padding:'3px 9px'}}, '设为当前'));
  box.appendChild(el('button', {class:'btn', type:'button', style:{fontSize:'11.5px',padding:'3px 9px'}}, '显示已归档'));
}

function visibleTasks() {
  let list = DB.slice();
  if (state.filter !== '全部') {
    if (state.filter === '草稿') list = list.filter((t) => t.status === '未指定');
    else list = list.filter((t) => groupOf(t.status) === state.filter);
  }
  if (state.search.trim() !== '') {
    const q = state.search.trim().toLowerCase();
    list = list.filter((t) => (t.id + ' ' + t.title).toLowerCase().includes(q));
  }
  return list;
}

function renderRows() {
  const box = document.getElementById('rows');
  const list = visibleTasks();
  box.innerHTML = '';
  document.getElementById('count').textContent = '共 ' + list.length + ' 条';

  if (list.length === 0) {
    box.appendChild(el('div', {style:{padding:'30px 14px',textAlign:'center',color:'var(--text-3)',fontSize:'12px'}},
      '这一个筛选下没有事项。'));
    return;
  }
  for (const t of list) {
    const color = KIND_COLOR[t.kind] || 'var(--text-3)';
    box.appendChild(el('button', {
      class:'row' + (t.id === state.selected ? ' on' : ''),
      type:'button',
      onclick() { state.selected = t.id; state.menuOpen = false; state.relOpen = false; renderAll(); }
    },
      el('span', {class:'id', style:{color}}, t.id),
      el('span', {class:'kind', style:{color, background:KIND_COLOR[t.kind] ? 'rgba(0,0,0,.05)' : 'transparent'}}, KIND_LABEL[t.kind] || t.kind),
      el('span', {class:'title'}, t.title),
      el('span', {class:'dot', style:{color:toneOf(t.status)}}, '●')
    ));
  }
}

/* ══════════════════════════════════════════════════════════════
   渲染详情
   ══════════════════════════════════════════════════════════════ */
function renderDetail() {
  const box = document.getElementById('detail');
  box.innerHTML = '';
  const t = taskOf(state.selected);
  if (!t) { box.appendChild(el('div', {style:{padding:'40px',color:'var(--text-3)',textAlign:'center'}}, '选一条看详情')); return; }

  const color = KIND_COLOR[t.kind] || 'var(--text-3)';

  /* ── 头部 ── */
  const head = el('div', {class:'d-head'},
    el('div', {class:'d-top'},
      el('span', {class:'id', style:{color}}, t.id),
      el('span', {class:'kind', style:{color, background:'rgba(0,0,0,.05)'}}, KIND_LABEL[t.kind] || t.kind),
      el('span', {class:'tpl'}, t.type),
      el('span', {class:'grow', style:{flex:'1'}}),
      el('button', {class:'icon-btn', type:'button', title:'编辑标题与正文',
        onclick(){ openEditor(t); }}, '✎'),
      el('button', {class:'icon-btn', type:'button', title:'删除（连子事项）',
        onclick(){
          if (confirm('删除 ' + t.id + ' 和它下面所有子事项？')) deleteTask(t.id);
        }}, '🗑'),
      el('button', {class:'icon-btn', type:'button', title:'关闭',
        onclick(){ state.selected = ''; renderAll(); }}, '✕')
    ),
    el('h3', null, t.title)
  );

  /* 状态标签 + 二级菜单 */
  const meta = el('div', {class:'d-meta'});
  const pill = el('button', {
    class:'status-pill', type:'button',
    style:{color:toneOf(t.status), borderColor: state.menuOpen ? toneOf(t.status) : 'transparent'},
    onclick(){ state.menuOpen = !state.menuOpen; renderAll(); }
  },
    el('span', {style:{fontSize:'8px'}}, '●'),
    t.status + ' · ' + groupOf(t.status),
    el('span', {style:{fontSize:'8px',opacity:'.7'}}, '▾'));
  meta.appendChild(pill);
  if (t.kind === 'goal') {
    meta.appendChild(el('span', {style:{padding:'1px 7px',borderRadius:'6px',
      border:'1px dashed var(--border-2)'}}, '推导：' + deriveGoalStatus(t)));
  }
  meta.appendChild(el('span', {style:{opacity:'.85'}}, '状态由用户或 AI 显式设置'));
  head.appendChild(meta);

  /* 菜单 */
  if (state.menuOpen) {
    const menu = el('div', {class:'status-menu'},
      el('div', {class:'menu-cap'}, '变更状态'));
    const actions = t.kind === 'goal' && t.status !== '未指定'
      ? [{to:'取消',label:'取消',bad:true},{to:'拒绝',label:'放弃目标',bad:true}]
      : (TRANSITIONS[t.status] || []);
    for (const a of actions) {
      menu.appendChild(el('button', {
        class:'menu-item' + (a.primary ? ' primary' : '') + (a.bad ? ' bad' : ''),
        type:'button',
        onclick(){
          patchTask(t.id, { status: a.to });
          state.menuOpen = false;
          renderAll();
        }
      }, el('span', {class:'ic'}, a.primary ? '▶' : a.bad ? '✕' : '·'), a.label));
    }
    menu.appendChild(el('div', {class:'menu-note'},
      '状态变更会影响 AI 能否继续这张单，所以都收在这里。'));
    head.appendChild(menu);
  }
  box.appendChild(head);

  /* ── 父任务栏 ── */
  const children = DB.filter((x) => x.parent === t.id).map((x) => x.id);
  const outLinks = [];
  const inLinks = DB.filter((x) => x.links && x.links.includes(t.id)).map((x) => x.id);
  const relCount = children.length + outLinks.length + inLinks.length + (t.parent ? 1 : 0);

  const parentRow = el('div', {class:'parent-row'},
    el('button', {
      class:'rel-toggle', type:'button', 'aria-expanded': state.relOpen ? 'true' : 'false',
      onclick(){ state.relOpen = !state.relOpen; renderAll(); }
    },
      el('span', {class:'chev'}, '▶'), '展开关系', el('span', {class:'n'}, String(relCount))));

  if (t.parent) {
    parentRow.appendChild(el('span', {class:'vsep'}));
    parentRow.appendChild(el('span', {class:'pcap'}, '父任务'));
    parentRow.appendChild(el('button', {
      class:'pbtn', type:'button',
      onclick(){ state.selected = t.parent; renderAll(); }
    }, t.parent));
  }
  parentRow.appendChild(el('button', {
    class:'derive-btn', type:'button',
    onclick(){ openCreator({ parent: t.id }); }
  }, el('span', {style:{color:'var(--text-3)'}}, '＋'), '派生子任务'));
  box.appendChild(parentRow);

  /* ── 关系网 ── */
  if (state.relOpen) {
    const relBody = el('div', {class:'rel-body'});
    if (relCount === 0) {
      relBody.appendChild(el('div', {style:{fontSize:'11.5px',color:'var(--text-3)',padding:'10px 0'}},
        '这一条还没有任何关系。'));
    } else {
      relBody.appendChild(el('div', {class:'rel-headrow'},
        el('div', {class:'rel-head active'}, '进行'),
        el('div', {class:'rel-head held'}, '搁置'),
        el('div', {class:'rel-head done'}, '完成')));

      const blockOf = (title, ids, color) => {
        const entries = ids.map((id) => taskOf(id)).filter(Boolean);
        if (entries.length === 0) return null;
        const cols = [[], [], []];
        for (const e of entries) {
          const g = groupOf(e.status);
          cols[g === '搁置' ? 1 : g === '完成' ? 2 : 0].push(e);
        }
        return el('div', {class:'rel-block'},
          el('div', {class:'rel-banner', style:{borderLeftColor:color}}, title,
            el('span', {style:{opacity:'.75'}}, String(entries.length))),
          el('div', {class:'rel-cells'},
            ...cols.map((bucket) => el('div', {class:'rel-cell' + (bucket.length === 0 ? ' void' : '')},
              ...bucket.map((e) => el('button', {
                class:'rel-item', type:'button',
                onclick(){ state.selected = e.id; renderAll(); }
              }, el('span', {style:{color:toneOf(e.status),fontSize:'8px'}}, '●'), e.id))))) );
      };

      const b1 = blockOf('子任务', children, 'var(--brand)');
      const b2 = blockOf('被依赖', inLinks, 'var(--warn)');
      if (b1) relBody.appendChild(b1);
      if (b2) relBody.appendChild(b2);
    }
    box.appendChild(relBody);
  }

  /* ── 正文（滚动区）── */
  const body = el('div', {class:'d-body'});
  body.appendChild(el('div', {class:'sec'},
    el('div', {class:'sec-title'}, '正文'),
    renderBody(t) || el('div', {class:'prose', style:{color:'var(--text-3)'}}, '（没有正文）')));
  if (t.note) {
    body.appendChild(el('div', {class:'sec'},
      el('div', {class:'sec-title'}, '备注'),
      el('div', {class:'prose', style:{color:'var(--text-2)'}}, t.note)));
  }
  /* 演示：一章 object 形态的交互 */
  if (t.id === 'GU-01') {
    body.appendChild(el('div', {class:'sec'},
      el('div', {class:'sec-title'}, '交互演示', el('span', {class:'n'}, 'action 分发')),
      el('div', {class:'inter'},
        el('div', {class:'inter-cap'}, '需要你选', el('span', {class:'src'}, 'choice · 三个互斥方案')),
        ...['先做分组，因为它是其它四项的容器','先做详情页，因为用户最常看','五个一起做，反正都不大']
          .map((text) => el('button', {class:'choice', type:'button', onclick(){ this.classList.toggle('on'); }},
            el('span', {class:'radio'}), el('span', null, text)))),
      el('div', {class:'inter'},
        el('div', {class:'inter-cap'}, '拆成子任务', el('span', {class:'src'}, 'derive · union 槽位')),
        el('button', {class:'quick-task', type:'button'},
          el('span', {class:'code'}, 'WR'), '派生调研任务'),
        el('button', {class:'quick-task', type:'button'},
          el('span', {class:'code'}, 'DP'), '派生设计任务'))));
  }
  box.appendChild(body);

  /* ── 固定底部备注 ── */
  box.appendChild(el('div', {class:'d-foot'},
    el('textarea', {
      class:'ta',
      placeholder:'备注 / 搁置理由（随时写，不跟着内容滚）',
      value: t.note || '',
      onchange(e){ patchTask(t.id, { note: e.target.value }); }
    })));
}

function deriveGoalStatus(t) {
  const kids = DB.filter((x) => x.parent === t.id);
  if (kids.length === 0) return '未开始';
  const groups = kids.map((k) => groupOf(k.status));
  /* 全部完成态 → 收尾；有进行 → 进行中；有搁置 → 停滞；否则未开始 */
  if (groups.every((g) => g === '完成')) return '收尾';
  if (groups.some((g) => g === '进行')) return '进行中';
  if (groups.some((g) => g === '搁置')) return '停滞';
  return '未开始';
}

/* ══════════════════════════════════════════════════════════════
   计划区
   ══════════════════════════════════════════════════════════════ */
const DRAFT_KEY = 'taskboard-draft';

/* 按视图分发：科技树 or 列表。 */
function renderAll() {
  renderGroups();
  const listBox = document.getElementById('rows');
  const treeBox = document.getElementById('treeview');
  const isTree = state.view === 'tree';
  listBox.hidden = isTree;
  treeBox.hidden = !isTree;
  const legend = document.getElementById('legend');
  if (legend) legend.hidden = !isTree;
  if (isTree) {
    document.getElementById('count').textContent = '共 ' + visibleTasks().length + ' 条';
    renderTree(treeBox, visibleTasks());
  } else {
    renderRows();
  }
  renderDetail();
}
