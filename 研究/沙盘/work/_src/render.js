/* ══════════════════════════════════════════════════════════════
   建 DOM 的小工具

   整个沙盘不用框架，就靠这一个函数。
   class / style / onclick / 其它属性 / 子节点，一次搞定。
   ══════════════════════════════════════════════════════════════ */

function el(tag, props, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2), value);
    } else if (key === 'hidden') {
      if (value) node.hidden = true;
    } else if (key === 'value') {
      node.value = value;
    } else {
      node.setAttribute(key, value);
    }
  }
  const append = (child) => {
    if (child === null || child === undefined || child === false) return;
    if (Array.isArray(child)) { child.forEach(append); return; }
    node.appendChild(typeof child === 'object' ? child : document.createTextNode(String(child)));
  };
  children.forEach(append);
  return node;
}

/* ══════════════════════════════════════════════════════════════
   正文渲染 —— 按行动分发

   ## 架构

   每个行动带五个公共字段（和 packages/actions 一致）：

     placeholder   灰字（输入框里 / 选项下方）
     label         这一章上方的标题（可缺省，缺省就用章节 id）
     row           高度；1 = 单行
     description   控件下方的详细说明
     required      必填（画星号）

   外加各自的业务字段：

     text      value
     markdown  value
     ask       options[{label, description, recommended}] / max_picks
     rank      items[{title, placeholder}] / keep
     derive    templates[] / mode

   ## 为什么五个行动就够了

   用户原话：

     > 你的一个架构，就要描述掉一个渲染里的所有可能。

   所以渲染器只认得行动名，所有可见位置都从 schema 里读，
   不在渲染器里硬编码任何文案。
   ══════════════════════════════════════════════════════════════ */

/** 行动 → 渲染函数。别名（textarea / input / choose）也指向这里。 */


/**
 * 渲染正文 —— 走管道。
 *
 *   参数（json）
 *      ↓  compileBody()      （compiler.js）
 *   mdx 字符串
 *      ↓  renderMdx()        （mdx-runtime.js）
 *   界面
 *
 * 用户原话：
 *
 *   > 参数就是 .cs。然后渲染器给 mdx 就是 IL。
 *   > 最后外部渲染器渲染 mdx，就是 .net。
 *
 * @param {object} task
 * @returns {HTMLElement|null}
 */
function renderBody(task) {
  const mdx = compileBody(task);
  if (mdx === '') return null;
  return renderMdx(mdx, { taskId: task.id, keys: sectionKeys(task) });
}

/**
 * 按 compileBody 的顺序列出章节 id。
 *
 * 因为 renderMdx 是按标签顺序走的，得让两边顺序对上，
 * 否则改值会改错章。
 *
 * @param {object} task
 * @returns {string[]}
 */
function sectionKeys(task) {
  const body = task.body;
  if (body === null || typeof body !== 'object') return [];

  const sections = sectionsOf(task.type);
  const keys = [];
  for (const s of sections) {
    if (body[s.id] !== undefined) keys.push(s.id);
  }
  for (const key of Object.keys(body)) {
    if (!sections.some((s) => s.id === key)) keys.push(key);
  }
  return keys;
}

/**
 * 把一条事项的正文编成 mdx（调试用；页面上有个按钮可以看）。
 *
 * @param {object} task
 * @returns {string}
 */
function bodyAsMdx(task) {
  return compileBody(task);
}

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

/**
 * 按当前筛选条件过滤。
 *
 * 三个维度可以同时生效：
 *   status  组 / 具体状态（「搁置」→ 需要补充 / 需要授权）
 *   kinds   类别（目标 / 设计 / 记录 / 工作）
 *   domains 领域（代码 / 写作 / 绘画 / 通用）
 *
 * 每个维度里选多个是「或」，不同维度之间是「与」。
 *
 * @returns {Array}
 */
function visibleTasks() {
  let list = DB.slice();

  /* 状态：选了组就按组，选了具体状态就按状态 */
  /*
   * 用 groupsOf（复数）而不是 groupOf —— 一个状态可能同时属于
   * 多个组（需要补充 = 进行 + 搁置）。用单值判断的话，
   * 「搁置」这个筛选项永远匹配不到任何一条。
   */
  if (state.filterStatus.length > 0) {
    list = list.filter((t) => {
      const gs = groupsOf(t.status);
      for (const want of state.filterStatus) {
        if (want === t.status) return true;
        if (gs.includes(want)) return true;
      }
      return false;
    });
  }

  /* 类别 */
  if (state.filterKinds.length > 0) {
    list = list.filter((t) => state.filterKinds.includes(t.kind));
  }

  /* 领域 */
  if (state.filterDomains.length > 0) {
    list = list.filter((t) => state.filterDomains.includes(domainOf(t)));
  }

  /* 模板（从类别/领域的三级菜单里选的） */
  if (state.filterTypes.length > 0) {
    list = list.filter((t) => state.filterTypes.includes(t.type));
  }

  /* 搜索 */
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
  /* 头部：编号在左、标题占右边整块。
     GU-02   用户任务：剩下没做完的 5 条
     目标 通用                      ← 编号下面半行放两个标签
     右下角三个图标

     用户原话：
       > 让标题大一点。GU-02 小一点。让 GU-02 在标题的左边，他们在一行。
       > 然后 GU-02 只有半行高度，他的下面半行放「目标」「通用」这两个 label。
       > 沙盘详情页的 label 写错了。「GU-02」的右边是「目标」。
       > 再右边应该是「领域」。而他是「GU」。冗余信息。 */
  /*
   * 采纳之后 = 锁定。
   *
   * 草稿（未指定）和重开后的「提交」都能改；
   * 一旦用户采纳（提交之后的任何状态），声明就冻结了。
   */
  const locked = t.status !== '未指定';

  const head = el('div', {class:'d-head'},
    el('div', {class:'d-head-grid'},
      /* 左列：编号 + 两个标签（编号只占半行高） */
      el('div', {class:'d-head-left'},
        el('span', {class:'id', style:{color}}, t.id),
        el('div', {class:'d-head-tags'},
          el('span', {class:'kind', style:{color, background:'rgba(0,0,0,.05)'}}, KIND_LABEL[t.kind] || t.kind),
          el('span', {class:'domain'}, DOMAIN_LABEL[domainOf(t)] || domainOf(t)))),
      /* 右列：标题 + 图标 */
      el('div', {class:'d-head-right'},
        el('div', {class:'d-head-title'}, t.title),
        el('div', {class:'d-head-icons'},
          /*
           * 采纳之后不准编辑、不准删除。
           *
           * 用户原话（GU-06 第 5 条）：
           *   > 采纳以后不准编辑。不准删除。
           *
           * 这和「采纳后声明冻结」是同一条规则 —— 采纳意味着这份声明
           * 被用户认可了，此后只能填值，不能改结构。
           */
          el('button', {
            class:'icon-btn' + (locked ? ' off' : ''), type:'button',
            title: locked ? '已采纳，不能编辑（要改先重开）' : '编辑标题与正文',
            disabled: locked,
            onclick(){ if (!locked) openEditor(t); }
          }, '✎'),
          el('button', {
            class:'icon-btn' + (locked ? ' off' : ''), type:'button',
            title: locked ? '已采纳，不能删除（要删先重开）' : '删除（连子事项）',
            disabled: locked,
            onclick(){
              if (locked) return;
              if (confirm('删除 ' + t.id + ' 和它下面所有子事项？')) deleteTask(t.id);
            }
          }, '🗑'),
          el('button', {class:'icon-btn', type:'button', title:'关闭',
            onclick(){ state.selected = ''; renderAll(); }}, '✕'))))
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
    /*
     * 目标的状态不能改，菜单改成「说明」。
     *
     * 用户原话（GU-06 第 6 条）：
     *   > "目标"的状态不能更改。点开以后的菜单应该是描述这个的状态只读，
     *   > 和状态判别依据（当前激活中的那个状态要高亮选中）
     *
     * 所以目标点开看到的是：
     *   · 每个可能的状态 + 它的判别依据
     *   · 当前处于哪个 —— 高亮
     *   · 没有任何可点的按钮
     */
    if (t.kind === 'goal') {
      const menu = el('div', {class:'status-menu goal-menu'},
        el('div', {class:'menu-cap'}, '目标的推导状态（不是手动设的）'));

      const derived = deriveGoalStatus(t);
      for (const row of GOAL_STATES) {
        const on = row.key === derived;
        menu.appendChild(el('div', {class:'goal-row' + (on ? ' on' : '')},
          el('span', {class:'goal-mark'}, on ? '●' : '○'),
          el('span', {class:'goal-body'},
            el('span', {class:'goal-name'}, row.key),
            el('span', {class:'goal-why'}, row.why))));
      }

      menu.appendChild(el('div', {class:'menu-note'},
        '目标的状态由子事项推导。要推进它，去推进子事项 —— 这里不给按钮。'));
      head.appendChild(menu);
    } else {
      const menu = el('div', {class:'status-menu'},
        el('div', {class:'menu-cap'}, '变更状态'));
      const actions = TRANSITIONS[t.status] || [];
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
  }
  box.appendChild(head);

  /* ── 父任务栏 ── */
  const children = DB.filter((x) => x.parent === t.id).map((x) => x.id);
  const outLinks = [];
  const inLinks = DB.filter((x) => x.links && x.links.includes(t.id)).map((x) => x.id);
  /* 计数只算展开面板里真有的：子任务 + 出边 + 入边。
     父任务不算 —— 它在上面单独一格，面板里没有它。
     （之前 + (t.parent ? 1 : 0) 导致 WI-03 只有父节点却显示「关系 1」） */
  const relCount = children.length + outLinks.length + inLinks.length;

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

  /*
   * ── 元数据 ──
   *
   * 用户原话（GU-06 第 4 条）：
   *   > 子工作空间，临时工作目录，权限。这几个元数据还没显示。
   *
   * 放成一张小表，两列：名字 / 值。没设的显示「（未指定）」。
   */
  const str = function (v) { return v === undefined || v === null ? '' : String(v); };
  const metaRows = [
    ['子工作区', str(t.workspace)],
    ['临时工作区', str(t.tmpWorkspace)],
    ['额外可读', str(t.workspaces)],
    ['权限', str(t.permission)],
    ['再收窄', str(t.deny)],
    ['标记', Array.isArray(t.tags) && t.tags.length > 0 ? t.tags.join('、') : '']
  ];
  /*
   * 用户原话（GU-06 第 4 条）：
   *   > 子工作空间，临时工作目录，权限。这几个元数据还没显示。
   *
   * 注意是「没显示」——不是「没有」。所以没设也要画出来，
   * 值写「（未指定）」。全藏起来的话，用户根本不知道有这几个字段。
   */

  let metaBox = null;
  if (metaRows.length > 0) {
    metaBox = el('div', {class:'d-meta-block'});
    for (const [name, value] of metaRows) {
      metaBox.appendChild(el('div', {class:'d-meta-row'},
        el('span', {class:'d-meta-name'}, name),
        el('span', {class:'d-meta-value' + (String(value).trim() === '' ? ' none' : '')},
          String(value).trim() === '' ? '（未指定）' : String(value))));
    }
  }

  /* ── 正文（滚动区）──
   *
   * 用户原话：
   *   > 参数就是 .cs。然后渲染器给 mdx 就是 IL。
   *
   * 所以这里加一个「看 mdx」开关 —— 直接看到这条事项被编译成什么，
   * 不用开 devtools。 */
  const body = el('div', {class:'d-body'});
  if (metaBox !== null) body.appendChild(metaBox);
  body.appendChild(el('div', {class:'sec'},
    el('div', {class:'sec-title'},
      '正文',
      el('button', {
        class:'link-btn', type:'button', style:{marginLeft:'auto'},
        onclick() {
          state.showMdx = !state.showMdx;
          renderAll();
        }
      }, state.showMdx ? '看渲染' : '看 mdx')),
    state.showMdx
      ? (function () {
          const mdx = bodyAsMdx(t);
          const pre = el('pre', {class:'mdx-source'});
          pre.textContent = mdx === '' ? '（空）' : mdx;
          return pre;
        })()
      : (renderBody(t) || el('div', {class:'prose', style:{color:'var(--text-3)'}}, '（没有正文）'))));

  /* 备注只在有内容时作为只读文字显示。
     编辑用的是底部固定栏那个输入框，不在这里重复。 */
  if (String(t.note || '').trim() !== '') {
    body.appendChild(el('div', {class:'sec'},
      el('div', {class:'sec-title'}, '备注'),
      el('div', {class:'prose', style:{color:'var(--text-2)'}}, t.note)));
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

/**
 * 目标的四种推导态 + 判别依据。
 *
 * 用户原话：
 *   > 点开以后的菜单应该是描述这个的状态只读，和状态判别依据
 *   > （当前激活中的那个状态要高亮选中）
 */
const GOAL_STATES = [
  { key: '未开始', why: '还没有子事项，或者子事项全是草稿' },
  { key: '进行中', why: '有子事项在「进行」组（提交 / 处理中）' },
  { key: '停滞', why: '没有进行中的，但有子事项卡在等待（需要补充 / 需要授权）' },
  { key: '收尾', why: '所有子事项都在「完成」组' }
];

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

/* 按视图分发：科技树 or 列表。 */
function renderAll() {
  renderFilters();
  renderLegend();
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
