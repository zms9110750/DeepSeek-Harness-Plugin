function escClose(e) { if (e.key === 'Escape') closeModal(); }
function closeModal() {
  const old = document.querySelector('.mask');
  if (old) old.remove();
  document.removeEventListener('keydown', escClose);
}


/* ══════════════════════════════════════════════════════════════
   新建 / 编辑浮层 —— 照「新建计划-原型.html」的建议版

     左栏：标题 * / 模板（弹出三列）/ 父任务 / 子工作空间 / 额外工作区 / 权限 / 关联
     右栏：正文
     底部：取消 | 提交（都在右下 —— 原型批评了「提交在左下」）

   模板选择器点开是三列：领域 / 类别 / 模板。
   编号 = 类别字母 + 模板字母；空模板只有类别字母（G-01）。
   ══════════════════════════════════════════════════════════════ */

const TEMPLATES = [
  { code:'GU', letter:'U', kind:'goal',   name:'用户任务',   domain:'general', desc:'用户甩过来的一堆要求或问题；AI 拆成下面的事项去做。' },
  { code:'GO', letter:'O', kind:'goal',   name:'目标·优化',  domain:'general', desc:'觉得哪里不好但说不出怎么改；先立目标，再拆。' },
  { code:'GA', letter:'A', kind:'goal',   name:'目标·澄清',  domain:'general', desc:'用户说得含糊，先把要什么问清。' },
  { code:'GV', letter:'V', kind:'goal',   name:'目标·验证',  domain:'general', desc:'为了验证一个假设而立的临时目标。' },
  { code:'DP', letter:'P', kind:'design', name:'方案',       domain:'general', desc:'给一个问题的可选解法，含代价与风险。' },
  { code:'DB', letter:'B', kind:'design', name:'选型',       domain:'code',    desc:'几个方案里挑一个，说清为什么。' },
  { code:'DC', letter:'C', kind:'design', name:'决策',       domain:'general', desc:'要用户拍板的事，列选项给他选。' },
  { code:'DI', letter:'I', kind:'design', name:'接口设计',   domain:'code',    desc:'定下对外形状：函数签名、协议、数据结构。' },
  { code:'DQ', letter:'Q', kind:'design', name:'提问',       domain:'general', desc:'一句话问用户；得到答复就完成。' },
  { code:'DT', letter:'T', kind:'design', name:'探索',       domain:'art',     desc:'不知道该往哪个方向走，先铺几种可能。' },
  { code:'RR', letter:'R', kind:'record', name:'汇报',       domain:'general', desc:'把一段工作或调查的结果写下来。' },
  { code:'RB', letter:'B', kind:'record', name:'阻碍',       domain:'general', desc:'卡住了，写清卡在哪、为什么、怎么绕。' },
  { code:'RD', letter:'D', kind:'record', name:'缺陷',       domain:'code',    desc:'东西坏了：复现、预期、实际。' },
  { code:'RF', letter:'F', kind:'record', name:'复盘',       domain:'general', desc:'事情做完或失败之后，回看为什么。' },
  { code:'WI', letter:'I', kind:'work',   name:'实现',       domain:'code',    desc:'动手改东西：改什么、怎么验。' },
  { code:'WF', letter:'F', kind:'work',   name:'修复',       domain:'code',    desc:'专门修一个 bug：复现、根因、修法、回归。' },
  { code:'WR', letter:'R', kind:'work',   name:'调研',       domain:'general', desc:'去查清一件事：结论、依据、局限。' },
  { code:'WX', letter:'X', kind:'work',   name:'文档',       domain:'writing', desc:'写给人看的东西：读者是谁、怎么读。' },
  { code:'WD', letter:'D', kind:'work',   name:'绘画',       domain:'art',     desc:'画一张图：目标、手法、场景。' },
  { code:'WC', letter:'C', kind:'work',   name:'写作',       domain:'writing', desc:'写一段文字：前置、顺序、检查点。' }
];

const KIND_ROWS = [
  { key:'goal',   letter:'G', label:'目标' },
  { key:'design', letter:'D', label:'设计' },
  { key:'record', letter:'R', label:'记录' },
  { key:'work',   letter:'W', label:'工作' }
];

const DOMAIN_ROWS = [
  { key:'code',    label:'代码' },
  { key:'writing', label:'写作' },
  { key:'art',     label:'绘画' },
  { key:'general', label:'通用' }
];

/** 浮层里当前选中的三项。 */
const picker = { domain: 'general', kind: 'goal', tpl: 'GU' };

/** 一个带 label 的字段。 */
function field(label, control, required) {
  return el('div', {class:'field'},
    el('label', {class:'lbl'}, label, required ? el('span', {class:'req'}, ' *') : null),
    control);
}

/** 打开新建浮层。 */
function openCreator(init) {
  closeModal();
  const draft = {
    title: '',
    parent: (init && init.parent) || '',
    workspace: '',
    workspaces: '',
    permission: '',
    body: ''
  };
  picker.domain = 'general';
  picker.kind = 'goal';
  picker.tpl = init && init.type ? init.type : 'GU';
  const initial = TEMPLATES.find((t) => t.code === picker.tpl);
  if (initial) { picker.kind = initial.kind; picker.domain = initial.domain; }

  const mask = el('div', {class:'mask'});
  const box = el('div', {class:'modal', style:{width:'min(880px,100%)'}});

  box.appendChild(el('div', {class:'modal-head'},
    el('b', null, '新建事项'),
    el('span', {style:{flex:'1'}}),
    el('button', {class:'icon-btn', type:'button', onclick: closeModal}, '✕')));

  const bodyBox = el('div', {class:'modal-body two-col'});
  const left = el('div', {style:{display:'grid', gap:'11px', alignContent:'start'}});
  const right = el('div', {style:{display:'grid', gap:'8px', alignContent:'start'}});

  /* 标题 */
  left.appendChild(field('标题', el('input', {
    type:'text', placeholder:'例如：修好任务板分组为空时的提示',
    oninput(e) { draft.title = e.target.value; }
  }), true));

  /* 模板选择器 */
  const tplBtn = el('button', {class:'tpl-btn', type:'button', id:'tplBtn'});
  const tplPop = el('div', {class:'tpl-pop', id:'tplPop', hidden:true});

  const refreshTplBtn = () => {
    const t = TEMPLATES.find((x) => x.code === picker.tpl);
    tplBtn.innerHTML = '';
    tplBtn.appendChild(el('span', {class:'code'}, t ? t.code : '—'));
    tplBtn.appendChild(el('span', null, t ? t.name : '空模板'));
    tplBtn.appendChild(el('span', {class:'chev'}, '▾'));
  };

  const closePop = () => { tplPop.hidden = true; refreshTplBtn(); };

  const refreshPop = () => {
    tplPop.innerHTML = '';
    const grid = el('div', {class:'tpl-grid'});

    const col1 = el('div', {class:'tpl-col'}, el('div', {class:'tpl-col-head'}, '领域'));
    for (const d of DOMAIN_ROWS) {
      col1.appendChild(el('button', {
        class:'tpl-item' + (picker.domain === d.key ? ' on' : ''),
        type:'button',
        onclick() { picker.domain = d.key; refreshPop(); }
      }, el('span', {class:'radio'}), d.label));
    }

    const col2 = el('div', {class:'tpl-col'}, el('div', {class:'tpl-col-head'}, '类别'));
    for (const k of KIND_ROWS) {
      col2.appendChild(el('button', {
        class:'tpl-item' + (picker.kind === k.key ? ' on' : ''),
        type:'button',
        onclick() {
          picker.kind = k.key;
          const cur = TEMPLATES.find((x) => x.code === picker.tpl);
          if (cur && cur.kind !== k.key) picker.tpl = '';
          refreshPop();
          refreshTplBtn();
        }
      }, el('span', {class:'radio'}),
         el('span', {class:'k-letter'}, k.letter), k.label));
    }

    const col3 = el('div', {class:'tpl-col'}, el('div', {class:'tpl-col-head'}, '模板'));
    col3.appendChild(el('button', {
      class:'tpl-item' + (picker.tpl === '' ? ' on' : ''),
      type:'button',
      onclick() { picker.tpl = ''; closePop(); }
    }, el('span', {class:'tpl-code'}, '—'), el('span', {class:'tpl-name'}, '空模板')));

    const list = TEMPLATES.filter((t) => t.kind === picker.kind
      && (t.domain === picker.domain || t.domain === 'general'));
    for (const t of list) {
      col3.appendChild(el('button', {
        class:'tpl-item' + (picker.tpl === t.code ? ' on' : ''),
        type:'button', title: t.desc,
        onclick() { picker.tpl = t.code; closePop(); }
      }, el('span', {class:'tpl-code'}, t.letter), el('span', {class:'tpl-name'}, t.name)));
    }

    grid.appendChild(col1);
    grid.appendChild(col2);
    grid.appendChild(col3);
    tplPop.appendChild(grid);

    const kindLetter = (KIND_ROWS.find((k) => k.key === picker.kind) || {}).letter || 'X';
    const prefix = picker.tpl || kindLetter;
    tplPop.appendChild(el('div', {class:'tpl-preview'},
      '编号前缀 ', el('b', null, prefix),
      '　最终编号形如 ', el('b', null, prefix + '-01')));
  };

  tplBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    tplPop.hidden = !tplPop.hidden;
    if (!tplPop.hidden) refreshPop();
  });
  mask.addEventListener('click', () => { if (!tplPop.hidden) tplPop.hidden = true; });

  refreshTplBtn();
  left.appendChild(el('div', {class:'field', style:{position:'relative'}},
    el('label', {class:'lbl'}, '模板'), tplBtn, tplPop));

  left.appendChild(field('父任务', el('input', {
    type:'text', placeholder:'（无，顶层）', value: draft.parent,
    oninput(e) { draft.parent = e.target.value; }
  })));

  /* ── 两个可激活的选项卡 ──────────────────────────────────
   *
   * 用户原话：
   *   > 只有标题，模板，父任务是在外面的。关系，和更多，是收纳的。
   *
   * 所以首屏只有三件事。这两个都可以不激活 —— 都不点的时候，
   * 对话框就是「标题 / 模板 / 父任务 / 正文」，最干净。
   * 点已激活的那个可以取消；点另一个则切换过去（互斥）。
   */
  const tabRel = el('button', {class:'tab', type:'button', 'aria-pressed':'false'},
    '关系 ', el('span', {class:'cnt', id:'relCount'}, '0'));
  const tabAdv = el('button', {class:'tab', type:'button', 'aria-pressed':'false'}, '高级设置');
  const tabs = el('div', {class:'tabs'}, tabRel, tabAdv);

  /* 关系面板 */
  const relList = el('div', {class:'rel-list'});
  const panelRel = el('div', {class:'tab-panel', hidden:true},
    relList,
    el('button', {class:'btn', type:'button', style:{padding:'5px 11px'},
      onclick() { addRelRow(); }}, '＋ 添加关联'),
    el('div', {class:'hint'}, '箭头从先决指向依赖方。「依赖」= 它不做完，这件事不能开始'));

  /** 加一行关联。 */
  function addRelRow() {
    const row = el('div', {class:'rel-row'},
      el('select', {class:'select rel-kind'},
        el('option', null, '依赖'), el('option', null, '相关'),
        el('option', null, '约束'), el('option', null, '参考')),
      el('input', {class:'input rel-target', placeholder:'事项编号或标题，如 GU-01'}),
      el('span', {class:'rel-dir'}, '← 它先于这件事'),
      el('button', {class:'rel-del', type:'button', title:'删除',
        onclick() { row.remove(); syncRelCount(); }}, '✕'));
    relList.appendChild(row);
    syncRelCount();
  }
  function syncRelCount() {
    const n = relList.querySelectorAll('.rel-row').length;
    const box = tabs.querySelector('#relCount');
    if (box) box.textContent = String(n);
  }

  /* 高级设置面板 */
  const panelAdv = el('div', {class:'tab-panel', hidden:true},
    field('子工作空间', el('input', {type:'text', placeholder:'空 = 会话目录',
      oninput(e) { draft.workspace = e.target.value; }})),
    field('额外可读目录', el('input', {type:'text', placeholder:'逗号分隔的绝对路径，可空',
      oninput(e) { draft.workspaces = e.target.value; }})),
    field('权限', el('select', {onchange(e) { draft.permission = e.target.value; }},
      el('option', {value:''}, '（不指定，按会话档位）'),
      el('option', {value:'仅可查看'}, '仅可查看'),
      el('option', {value:'工作区内修改'}, '工作区内修改'),
      el('option', {value:'完全权限'}, '完全权限'),
      el('option', {value:'工具全关'}, '工具全关'))));

  /** 同步两个面板的显示。 */
  function syncTabs() {
    panelRel.hidden = tabRel.getAttribute('aria-pressed') !== 'true';
    panelAdv.hidden = tabAdv.getAttribute('aria-pressed') !== 'true';
  }

  /** 点选项卡：已激活则取消，未激活则激活并取消另一个。 */
  function press(tab, other) {
    const on = tab.getAttribute('aria-pressed') === 'true';
    if (on) {
      tab.setAttribute('aria-pressed', 'false');
    } else {
      tab.setAttribute('aria-pressed', 'true');
      other.setAttribute('aria-pressed', 'false');
    }
    syncTabs();
  }

  tabRel.addEventListener('click', () => press(tabRel, tabAdv));
  tabAdv.addEventListener('click', () => press(tabAdv, tabRel));

  left.appendChild(tabs);
  left.appendChild(panelRel);
  left.appendChild(panelAdv);

  right.appendChild(el('div', {class:'lbl'}, '正文'));
  right.appendChild(el('textarea', {
    class:'ta', style:{minHeight:'330px', height:'330px'},
    placeholder:'Markdown，或 JSON（对象形态）',
    oninput(e) { draft.body = e.target.value; }
  }));
  right.appendChild(el('div', {class:'hint'},
    '对象形态示例：{"want":{"type":"textarea","value":"…"}}'));

  bodyBox.appendChild(left);
  bodyBox.appendChild(right);
  box.appendChild(bodyBox);

  box.appendChild(el('div', {class:'modal-foot'},
    el('span', {style:{flex:'1'}}),
    el('button', {class:'btn', type:'button', onclick: closeModal}, '取消'),
    el('button', {class:'btn primary', type:'button', onclick() {
      if (String(draft.title).trim() === '') { alert('标题必填'); return; }
      let body = draft.body;
      const trimmed = String(body || '').trim();
      if (trimmed.startsWith('{')) { try { body = JSON.parse(trimmed); } catch (e) {} }
      createTask({
        title: draft.title,
        type: picker.tpl,
        kind: picker.kind,
        parent: draft.parent,
        body,
        workspace: draft.workspace,
        workspaces: draft.workspaces,
        permission: draft.permission
      });
      closeModal();
    }}, '提交')));

  mask.appendChild(box);
  document.body.appendChild(mask);
  document.addEventListener('keydown', escClose);
  setTimeout(() => {
    const input = box.querySelector('input[type="text"]');
    if (input) input.focus();
  }, 30);
}

/** 编辑浮层：只改标题、状态、类别、正文。 */
function openEditor(t) {
  closeModal();
  const draft = {
    title: t.title,
    status: t.status,
    kind: t.kind,
    body: typeof t.body === 'string' ? t.body : JSON.stringify(t.body, null, 2)
  };

  const mask = el('div', {class:'mask'});
  const box = el('div', {class:'modal', style:{width:'min(840px,100%)'}});
  box.appendChild(el('div', {class:'modal-head'},
    el('b', null, '编辑 ' + t.id),
    el('span', {style:{flex:'1'}}),
    el('button', {class:'icon-btn', type:'button', onclick: closeModal}, '✕')));

  const bodyBox = el('div', {class:'modal-body two-col'});
  const left = el('div', {style:{display:'grid', gap:'11px', alignContent:'start'}});
  const right = el('div', {style:{display:'grid', gap:'8px', alignContent:'start'}});

  left.appendChild(field('标题', el('input', {
    type:'text', value: draft.title,
    oninput(e) { draft.title = e.target.value; }
  }), true));

  left.appendChild(field('状态', el('select', {onchange(e) { draft.status = e.target.value; }},
    ...['未指定','提交','处理中','需要补充','需要授权','完成','失败','取消','拒绝']
      .map((s) => el('option', {value:s, selected: s === draft.status ? true : null}, s)))));

  left.appendChild(field('类别', el('select', {onchange(e) { draft.kind = e.target.value; }},
    ...KIND_ROWS.map((k) => el('option', {value:k.key, selected: k.key === draft.kind ? true : null}, k.label)))));

  left.appendChild(el('div', {class:'hint'}, '改类别不会改已有编号'));

  right.appendChild(el('div', {class:'lbl'}, '正文'));
  right.appendChild(el('textarea', {
    class:'ta', style:{minHeight:'340px', height:'340px'}, value: draft.body,
    oninput(e) { draft.body = e.target.value; }
  }));

  bodyBox.appendChild(left);
  bodyBox.appendChild(right);
  box.appendChild(bodyBox);

  box.appendChild(el('div', {class:'modal-foot'},
    el('span', {style:{flex:'1'}}),
    el('button', {class:'btn', type:'button', onclick: closeModal}, '取消'),
    el('button', {class:'btn primary', type:'button', onclick() {
      let body = draft.body;
      const trimmed = String(body || '').trim();
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try { body = JSON.parse(trimmed); } catch (e) {}
      }
      patchTask(t.id, { title: draft.title, status: draft.status, kind: draft.kind, body });
      closeModal();
    }}, '保存')));

  mask.appendChild(box);
  document.body.appendChild(mask);
  document.addEventListener('keydown', escClose);
}
