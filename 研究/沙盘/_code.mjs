
/* ══════════════════════════════════════════════════════════════
   写死的数据 —— 9 条真实样本
   ══════════════════════════════════════════════════════════════ */
const TASKS = [
  {
    id:'GU-01', title:'用户任务：剩下没做完的 5 条', type:'GU', kind:'goal', status:'提交',
    parent:'', links:'', tags:[],
    body:'## 这是什么\n\n这是 T-054 / T-056 的下一次重写。旧的都已取消，但**它们里面真正没做完的部分还在**，所以重新立一张。\n\n12 条要求里 7 条已做完，2 条半成品，3 条没动。这一张只装没做完的那些。\n\n## 没做完的 5 条\n\n① 失败必须有理由\n② dispatch 字段要有消费者\n③ 详情层派发按钮\n④ behavior 要影响界面\n⑤ 日志',
    note:''
  },
  {
    id:'GU-02', title:'用户任务5', type:'GU', kind:'goal', status:'提交',
    parent:'', links:'', tags:[],
    body:'1. GU01 仍然有领取、直接完成、取消、拒绝。说明「目标」大类现在还不是根据状态自动算的。\n\n2. 一个包里面可以有多个插件。以下内容放在一个包里，分插件：箭头面板、计划面板、「按计划」的权限状态、「子工作空间」、额外工作空间。\n\n3. 归档、分组。这个需要设计。否则之前用户任务提出来的任务，占据了太多竖向高度。\n\n4. 考虑给关联新增更多内容。例如一期、二期意味着他们是一件事情，那么是否除了兄弟节点的联系以外，还需要「相关」的关系？然后还要有「约束」「参考」之类的关系。',
    note:''
  },
  {
    id:'WI-01', title:'失败必须有理由', type:'WI', kind:'work', status:'完成',
    parent:'GU-01', links:'', tags:[],
    body:'## 要做什么\n\n转「失败」时强制填理由，不填不让改。\n\n## 用户原话\n\n> 进行失败状态一定要回报原因的。但是点击失败只是点击了，没有说明处。\n\n## 具体做什么\n\n1. `setState` 里加一条检查\n2. 报错文案要写出出路\n3. 允许理由里引用别的事项 id',
    note:'已完成，按你的备注改成「失败 → 派一条阻碍」，不是「填一段 note」。'
  },
  {
    id:'WI-02', title:'dispatch 字段要有消费者', type:'WI', kind:'work', status:'完成',
    parent:'GU-01', links:'', tags:['dispatch','模板系统'],
    body:'## 要做什么\n\n模板 YAML 里的 `dispatch` 字段现在没人读，等于装饰。要让界面真的按它收窄可派发范围。',
    note:''
  },
  {
    id:'WI-03', title:'详情层派发按钮', type:'WI', kind:'work', status:'完成',
    parent:'GU-01', links:'', tags:[],
    body:'## 要做什么\n\n详情页要有「派发」区，按钮列表来自宿主的 `task_dispatch`。\n\n判定三层（大类规则 / 父模板 dispatch / 子模板 default_kind）全在宿主做，面板只管显示。',
    note:''
  },
  {
    id:'DP-04', title:'归档与分组：老任务占了太多竖向高度', type:'DP', kind:'design', status:'完成',
    parent:'GU-02', links:'', tags:[],
    body:'## 问题\n\n老任务太多，列表一屏装不下。\n\n## 方案\n\n归档直接对分组归档。归档以后界面不显示，但索引还在，可以「显示已归档」。',
    note:''
  },
  {
    id:'DB-01', title:'record 的状态集要不要按 kind 收窄', type:'DB', kind:'design', status:'未指定',
    parent:'', links:'', tags:[],
    body:'## 说不清的地方\n\n九态是为拟合 A2A 硬套的。记录类说「搁置」不成立 —— 写出来就完了，没有搁置这回事。\n\n## 用户原话\n\n> 只有任务会派发出去。记录、决策、去问，是不是搁置了。这不成立。\n> 所以这 4 个类别应该有他们的状态。比如阻碍只有绕过、解决。成功和失败是什么含义呢？不知道。',
    note:''
  },
  {
    id:'DC-01', title:'【验证】不同前缀独立编号', type:'DC', kind:'design', status:'取消',
    parent:'', links:'', tags:[],
    body:'## 要定什么\n\n不同模板前缀是否各自独立流水。\n\n## 选项\n\n- WF-01 和 GU-01 各自从 01 开始\n- 全部共用一个流水号',
    note:''
  },
  {
    id:'WF-01', title:'【验证】编号应带模板前缀', type:'WF', kind:'work', status:'取消',
    parent:'', links:'', tags:[],
    body:'## 验证点\n\n编号形式应为 `前缀-流水`，例如 WF-01。',
    note:''
  }
];

/* ══════════════════════════════════════════════════════════════
   收件箱的 store —— 用户写，落盘给 AI 读

   ## 和另一个页面的区别

   这一份是「用户 → AI」的通道。用户在这里派活，写的内容**必须落盘**，
   否则 AI 读不到。所以走服务端 API 写文件，不用 localStorage。

   另一份（工作区）完全独立：那是 AI 改版的地方，数据格式随时会变，
   两边不共用一份数据。用户原话：

     > 这两个是隔离的。他们不共用数据。因为连数据格式都要在后者里面
     > 进行决定。会有破坏性更新，等会可能读不出来。

   ## 两种东西分开存

     items   待办条目（列表里那些卡片）       → 收件箱.json
     draft   自由文本（底部的计划区）         → 收件箱-草稿.md

   为什么分开：条目是结构化的（id/标题/状态），自由文本是给 AI 读的散文。
   混在一起反而两边都不好用。
   ══════════════════════════════════════════════════════════════ */

let DB = [];
let saveTimer = null;
let dirty = false;

/** 从服务端读。 */
async function loadFromServer() {
  try {
    const response = await fetch('/api/inbox');
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const payload = await response.json();
    DB = Array.isArray(payload.items) ? payload.items : [];
    if (DB.length === 0) DB = JSON.parse(JSON.stringify(TASKS));
    return true;
  } catch (failure) {
    /* 服务没起（比如直接双击 HTML）：退回内置样本，并提示 */
    DB = JSON.parse(JSON.stringify(TASKS));
    setSyncState('本地模式（服务未连接，改动只在这个页面里）', true);
    return false;
  }
}

/** 写回服务端（防抖 600ms，避免每敲一个字都发请求）。 */
function scheduleSave() {
  dirty = true;
  setSyncState('有未保存的改动…', false);
  if (saveTimer !== null) clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 600);
}

async function flushSave() {
  saveTimer = null;
  if (!dirty) return;
  dirty = false;
  try {
    const response = await fetch('/api/inbox', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ items: DB })
    });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    setSyncState('已保存 · ' + new Date().toLocaleTimeString('zh-CN'), false);
  } catch (failure) {
    setSyncState('保存失败：' + failure.message, true);
  }
}

function setSyncState(text, isError) {
  const box = document.getElementById('syncState');
  if (!box) return;
  box.textContent = text;
  box.style.color = isError ? 'var(--danger)' : 'var(--work)';
}

/* ── 条目编辑 ── */

/* 编号规则（和宿主一致）：
     有模板 → 用模板编号（GU / WI / DP…）
     空模板 → 用类别字母（G / D / R / W） */
const KIND_PREFIX = { goal: 'G', design: 'D', record: 'R', work: 'W' };

function nextId(type, kind) {
  const t = String(type || '').toUpperCase();
  const prefix = t !== '' ? t : (KIND_PREFIX[kind] || 'X');
  const pattern = new RegExp('^' + prefix + '-(\\d+)$');
  let max = 0;
  for (const item of DB) {
    const m = pattern.exec(item.id);
    if (m !== null) max = Math.max(max, Number(m[1]));
  }
  return prefix + '-' + String(max + 1).padStart(2, '0');
}

function patchTask(id, patch) {
  const i = DB.findIndex((t) => t.id === id);
  if (i < 0) return;
  DB[i] = Object.assign({}, DB[i], patch);
  scheduleSave();
  renderAll();
}

function createTask(init) {
  const type = init.type || 'GU';
  const task = {
    id: nextId(type, init.kind || 'goal'),
    title: init.title || '未命名',
    type,
    kind: init.kind || 'goal',
    status: '未指定',
    parent: init.parent || '',
    links: '',
    tags: [],
    body: init.body || '',
    note: ''
  };
  DB.push(task);
  scheduleSave();
  state.selected = task.id;
  renderAll();
  return task.id;
}

function deleteTask(id) {
  const ids = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const t of DB) {
      if (t.parent && ids.has(t.parent) && !ids.has(t.id)) { ids.add(t.id); grew = true; }
    }
  }
  DB = DB.filter((t) => !ids.has(t.id));
  scheduleSave();
  if (ids.has(state.selected)) state.selected = DB[0] ? DB[0].id : '';
  renderAll();
}

function resetDB() {
  DB = JSON.parse(JSON.stringify(TASKS));
  scheduleSave();
  state.selected = DB[0] ? DB[0].id : '';
  renderAll();
}

/* ══════════════════════════════════════════════════════════════
   科技树 —— 把事项铺成分层有向图

   ## 为什么不用 dagre

   真实插件用 dagre（Sugiyama：分层 → 交叉最小化 → 紧凑排列）。
   但这两份 HTML 要能独立打开，不引外部依赖。所以写一个简化版：

     ① 按依赖深度分层（列）
     ② 每层内按父节点聚拢，减少交叉
     ③ 行高均匀排开

   代价是没有 dagre 那么紧凑，但 10~30 个节点看不出差别。

   ## 边的方向

   一律归一成「先决 → 依赖方」：

     父 → 子
     依赖（我依赖它）  →  它 → 我
     派生（我派生它）  →  我 → 它
     来源（我来自它）  →  它 → 我
     其余            →  它 → 我

   并按无向对去重 —— 同一段关系常常两边各写一次。
   ══════════════════════════════════════════════════════════════ */
const TREE_NODE_W = 150;
const TREE_NODE_H = 50;
const TREE_GAP_X = 62;
const TREE_GAP_Y = 16;

/**
 * 算分层布局。
 *
 * @param {Array} tasks
 * @returns {{nodes: Array, edges: Array, width: number, height: number}}
 */
function buildTree(tasks) {
  const byId = {};
  for (const t of tasks) byId[t.id] = t;

  /* ── ① 收集边（归一方向 + 去重）── */
  const edges = [];
  const seen = new Set();
  const addEdge = (src, dst, kind, label) => {
    if (src === dst) return;
    if (!byId[src] || !byId[dst]) return;
    const key = src < dst ? src + '\u0000' + dst : dst + '\u0000' + src;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push({ src, dst, kind, label });
  };

  for (const t of tasks) {
    if (t.parent) addEdge(t.parent, t.id, 'parent', '');
    for (const link of parseLinks(t.links)) {
      if (link.label === '派生') addEdge(t.id, link.to, 'link', link.label);
      else addEdge(link.to, t.id, 'link', link.label);
    }
  }

  /* ── ② 分层：最长路径深度（无环假设，环就退化成同层）── */
  const depth = {};
  for (const t of tasks) depth[t.id] = 0;

  /* 迭代松弛，最多 N 轮（防环死循环） */
  for (let round = 0; round < tasks.length; round++) {
    let changed = false;
    for (const e of edges) {
      const want = depth[e.src] + 1;
      if (depth[e.dst] < want) { depth[e.dst] = want; changed = true; }
    }
    if (!changed) break;
  }

  /* ── ③ 按层分组；层内按父节点的 y 排序，减少交叉 ── */
  const layers = [];
  for (const t of tasks) {
    const d = depth[t.id];
    if (!layers[d]) layers[d] = [];
    layers[d].push(t);
  }
  /* 去掉空层（可能有跳号） */
  const live = layers.filter((l) => Array.isArray(l) && l.length > 0);

  const placed = {};
  const nodes = [];
  let maxRows = 0;

  live.forEach((layer, col) => {
    /* 层内排序键：父节点的行号（没有父就用 id 兜底） */
    layer.sort((a, b) => {
      const pa = a.parent && placed[a.parent] ? placed[a.parent].row : 999;
      const pb = b.parent && placed[b.parent] ? placed[b.parent].row : 999;
      if (pa !== pb) return pa - pb;
      return a.id < b.id ? -1 : 1;
    });
    layer.forEach((t, row) => {
      const x = col * (TREE_NODE_W + TREE_GAP_X);
      const y = row * (TREE_NODE_H + TREE_GAP_Y);
      placed[t.id] = { node: t, x, y, row, col };
      nodes.push(placed[t.id]);
    });
    maxRows = Math.max(maxRows, layer.length);
  });

  return {
    nodes,
    edges: edges.filter((e) => placed[e.src] && placed[e.dst]),
    placed,
    width: live.length === 0 ? 0 : live.length * (TREE_NODE_W + TREE_GAP_X) - TREE_GAP_X,
    height: maxRows === 0 ? 0 : maxRows * (TREE_NODE_H + TREE_GAP_Y) - TREE_GAP_Y
  };
}

/**
 * 解析 links 字符串成 [{label, to}]。
 *
 * 格式：`依赖:WI-01, 派生:DP-02`（逗号分隔，冒号分标签和目标）
 *
 * @param {string} raw
 * @returns {Array<{label: string, to: string}>}
 */
function parseLinks(raw) {
  const text = String(raw || '').trim();
  if (text === '') return [];
  const out = [];
  for (const part of text.split(',')) {
    const piece = part.trim();
    if (piece === '') continue;
    const cut = piece.indexOf(':');
    if (cut < 0) {
      out.push({ label: '相关', to: piece });
    } else {
      out.push({ label: piece.slice(0, cut).trim() || '相关', to: piece.slice(cut + 1).trim() });
    }
  }
  return out.filter((link) => link.to !== '');
}

/**
 * 渲染科技树。
 *
 * @param {HTMLElement} box
 * @param {Array} tasks
 */
function renderTree(box, tasks) {
  box.innerHTML = '';
  if (tasks.length === 0) {
    box.appendChild(el('div', {class:'tree-empty'}, '这个筛选下没有事项。'));
    return;
  }

  const tree = buildTree(tasks);
  const canvas = el('div', {class:'tree-canvas', style:{
    width: (tree.width + 20) + 'px',
    height: (tree.height + 20) + 'px'
  }});

  /* ── 连线（SVG）── */
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('width', String(tree.width + 20));
  svg.setAttribute('height', String(tree.height + 20));
  svg.style.position = 'absolute';
  svg.style.left = '0';
  svg.style.top = '0';
  svg.style.pointerEvents = 'none';

  /* 箭头标记 */
  const defs = document.createElementNS(ns, 'defs');
  const marker = document.createElementNS(ns, 'marker');
  marker.setAttribute('id', 'tree-arrow');
  marker.setAttribute('viewBox', '0 0 8 8');
  marker.setAttribute('refX', '7');
  marker.setAttribute('refY', '4');
  marker.setAttribute('markerWidth', '7');
  marker.setAttribute('markerHeight', '7');
  marker.setAttribute('orient', 'auto');
  const arrowPath = document.createElementNS(ns, 'path');
  arrowPath.setAttribute('d', 'M0 0 L8 4 L0 8 Z');
  arrowPath.setAttribute('fill', 'var(--border-2)');
  marker.appendChild(arrowPath);
  defs.appendChild(marker);
  svg.appendChild(defs);

  for (const edge of tree.edges) {
    const from = tree.placed[edge.src];
    const to = tree.placed[edge.dst];
    const x1 = from.x + TREE_NODE_W;
    const y1 = from.y + TREE_NODE_H / 2;
    const x2 = to.x - 6;
    const y2 = to.y + TREE_NODE_H / 2;
    const dx = Math.max(24, Math.abs(x2 - x1) / 2);
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', 'M' + x1 + ' ' + y1 + ' C' + (x1 + dx) + ' ' + y1 + ' ' + (x2 - dx) + ' ' + y2 + ' ' + x2 + ' ' + y2);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', edge.kind === 'link' ? 'var(--brand)' : 'var(--border-2)');
    path.setAttribute('stroke-width', edge.kind === 'link' ? '1.4' : '1.2');
    if (edge.kind === 'link') path.setAttribute('stroke-dasharray', '4 3');
    path.setAttribute('marker-end', 'url(#tree-arrow)');
    path.setAttribute('opacity', '0.55');
    svg.appendChild(path);
  }
  canvas.appendChild(svg);

  /* ── 节点 ── */
  for (const placed of tree.nodes) {
    const t = placed.node;
    const color = KIND_COLOR[t.kind] || 'var(--text-3)';
    canvas.appendChild(el('div', {
      class: 'tree-node' + (t.id === state.selected ? ' on' : ''),
      style: { left: (placed.x + 10) + 'px', top: (placed.y + 10) + 'px' },
      onclick() {
        state.selected = t.id;
        state.menuOpen = false;
        state.relOpen = false;
        renderAll();
      }
    },
      el('div', {class:'top'},
        el('span', {class:'tid', style:{color}}, t.id),
        el('span', {class:'tk', style:{color}}, KIND_LABEL[t.kind] || t.kind),
        el('span', {style:{marginLeft:'auto', color:toneOf(t.status), fontSize:'8px'}}, '●')),
      el('div', {class:'tt'}, t.title)));
  }

  /* 画布比容器窄时居中；宽了就让它从左边开始，靠滚动看右边 */
  box.appendChild(canvas);
}

/* ══════════════════════════════════════════════════════════════
   正文渲染 —— 按 action 分发（演示渲染器机制）
   ══════════════════════════════════════════════════════════════ */

/* 极简 Markdown → HTML。只处理快照里用得到的几种语法：
   标题、无序/有序列表、粗体、行内代码、引用、分割线、表格。 */
function md(source) {
  const text = String(source || '');
  const lines = text.split(/\r?\n/);
  const out = [];
  let inList = null;
  const inline = (s) => s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
  const flushList = () => { if (inList) { out.push('</' + inList + '>'); inList = null; } };
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    const line = raw.trimEnd();
    /* 代码块：```lang ... ``` —— 内容原样保留，不解析 */
    if (/^```/.test(line.trim())) {
      flushList();
      const fence = line.trim();
      const lang = fence.slice(3).trim();
      const codeLines = [];
      i += 1;
      while (i < lines.length && !/^```/.test(lines[i].trim())) {
        codeLines.push(lines[i]);
        i += 1;
      }
      out.push('<pre class="code"><code' + (lang ? ' data-lang="' + lang + '"' : '') + '>'
        + codeLines.join('\n').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        + '</code></pre>');
      continue;
    }
    if (line.trim() === '') { flushList(); continue; }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) { flushList(); const lv = h[1].length + 2; out.push('<h' + lv + '>' + inline(h[2]) + '</h' + lv + '>'); continue; }
    /* 表格：表头行 + 分隔行（|---|）后紧跟数据行 */
    if (/^\|.*\|$/.test(line.trim())) {
      flushList();
      if (i + 1 < lines.length && /^\|[\s:|-]+\|?$/.test(lines[i + 1].trim())) {
        const cells = (row) => row.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
        const head = cells(line);
        out.push('<table><thead><tr>' + head.map((c) => '<th>' + inline(c) + '</th>').join('') + '</tr></thead><tbody>');
        i += 2;
        while (i < lines.length && /^\|.*\|$/.test(lines[i].trim())) {
          out.push('<tr>' + cells(lines[i]).map((c) => '<td>' + inline(c) + '</td>').join('') + '</tr>');
          i += 1;
        }
        out.push('</tbody></table>');
        i -= 1;
        continue;
      }
    }
    if (/^---+$/.test(line.trim())) { flushList(); out.push('<hr>'); continue; }
    const q = /^>\s?(.*)$/.exec(line);
    if (q) { flushList(); out.push('<blockquote>' + inline(q[1]) + '</blockquote>'); continue; }
    const ul = /^\s*[-*]\s+(.*)$/.exec(line);
    if (ul) { if (inList !== 'ul') { flushList(); out.push('<ul>'); inList = 'ul'; } out.push('<li>' + inline(ul[1]) + '</li>'); continue; }
    const ol = /^\s*\d+\.\s+(.*)$/.exec(line);
    if (ol) { if (inList !== 'ol') { flushList(); out.push('<ol>'); inList = 'ol'; } out.push('<li>' + inline(ol[1]) + '</li>'); continue; }
    flushList();
    out.push('<p>' + inline(line) + '</p>');
  }
  flushList();
  return out.join('');
}


/* ══════════════════════════════════════════════════════════════
   模板章节表 —— 只为了显示章节标题

   正文存成 { want: {...}, done: {...} }，键是 id。
   但界面上要显示「要什么」「什么算做到了」—— 那是模板里的 label。
   所以这里放一份精简的章节表（id → label + 顺序）。

   沙盘不需要完整模板，只要能对上标题就行。
   ══════════════════════════════════════════════════════════════ */
const SECTION_LABELS = {
  GU: [['want','要什么'],['done','什么算做到了'],['bounds','边界'],['split','怎么拆'],['other','其他']],
  GA: [['want','要什么'],['done','什么算做到了'],['risk','风险'],['split','怎么拆'],['other','其他']],
  GO: [['symptom','现象'],['measure','怎么衡量'],['enough','什么算够'],['split','怎么拆'],['other','其他']],
  GV: [['want','要什么'],['done','什么算做到了'],['bounds','边界'],['split','怎么拆'],['other','其他']],
  DP: [['problem','问题'],['plan','方案'],['cost','代价'],['alternative','别的选择'],['risk','风险'],['other','其他']],
  DB: [['pain','痛点'],['scenario','场景'],['fitness','合不合适'],['precedent','先例'],['other','其他']],
  DC: [['question','要定什么'],['options','选项'],['unknown','我还不知道什么'],['recommend','我的建议'],['other','其他']],
  DI: [['goal','目标'],['contract','接口'],['errors','错误'],['breaking','破坏性'],['other','其他']],
  DQ: [['ask','问什么'],['why','为什么要问'],['guess','我的猜测'],['other','其他']],
  DT: [['setup','前置'],['persp','视角'],['style','风格'],['check','检查点'],['cost','代价'],['other','其他']],
  RR: [['conclusion','结论'],['evidence','依据'],['limits','局限'],['deliver','交付'],['other','其他']],
  RD: [['what','是什么'],['repro','复现'],['expect','预期'],['actual','实际'],['scope','范围'],['accept','验收'],['deliver','交付'],['other','其他']],
  RE: [['want','要什么'],['kind','类型'],['why','为什么'],['enough','什么算够'],['not','不要什么'],['precedent','先例'],['deliver','交付'],['other','其他']],
  RF: [['outcome','结果'],['root','根因'],['lesson','教训'],['apply','怎么用'],['deliver','交付'],['other','其他']],
  RS: [['people','人'],['places','地'],['story','发生了什么'],['conflicts','冲突'],['deliver','交付'],['other','其他']],
  RB: [['where','卡在哪'],['why','为什么'],['next','下一步'],['bypass','绕过'],['reason','原因'],['deliver','交付'],['other','其他']],
  WI: [['goal','目标'],['change','改什么'],['verify','怎么验'],['magic','魔法数字'],['other','其他']],
  WF: [['repro','复现'],['expect','预期'],['root','根因'],['fix','修法'],['regression','回归'],['other','其他']],
  WX: [['reader','读者'],['path','读法'],['must','必须有'],['skip','可以跳过'],['verify','校验'],['deliver','交付'],['other','其他']]
};

/** 取某模板的章节表；没有就返回空（渲染时回退成键名）。 */
function sectionsOf(type) {
  const rows = SECTION_LABELS[String(type || '').toUpperCase()] || [];
  return rows.map(function (row) {
    return { id: row[0], label: row[1], type: ['textarea'], required: false };
  });
}

function renderBody(task) {
  const body = task.body;
  /* 旧格式字符串：整段按 Markdown 纯文本显示 */
  if (typeof body === 'string') {
    const d = el('div', {class:'prose'});
    d.innerHTML = md(body);
    return d;
  }
  /* 新格式 object：按**模板章节顺序**渲染，标题用模板的 label */
  const out = [];
  const sections = sectionsOf(task.type);
  const ordered = sections.length > 0
    ? sections.filter(function (s) { return body[s.id] !== undefined; })
        .map(function (s) { return [s.id, body[s.id], s.label]; })
        .concat(Object.entries(body).filter(function (e) {
          return !sections.some(function (s) { return s.id === e[0]; });
        }).map(function (e) { return [e[0], e[1], e[0]]; }))
    : Object.entries(body || {}).map(function (e) { return [e[0], e[1], e[0]]; });
  for (const [key, section, label] of ordered) {
    const action = section.action;
    if (action === 'markdown' || action === 'textarea') {
      {
        const d = el('div', {class:'prose'});
        d.innerHTML = md(section.value || '');
        out.push(el('div', {class:'sec'}, el('div', {class:'sec-title'}, label), d));
      }
    } else if (action === 'choose') {
      out.push(renderChoose(key, section));
    } else if (action === 'rank') {
      out.push(renderRank(key, section));
    } else if (action === 'derive') {
      out.push(renderDerive(key, section));
    } else {
      out.push(el('div', {class:'sec'},
        el('div', {class:'sec-title'}, label),
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
    el('div', {class:'sec-title'}, label),
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
    el('div', {class:'sec-title'}, label),
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
    el('div', {class:'sec-title'}, label),
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
  selected: TASKS[0].id,
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
   底部自由文本 —— 落盘成 .md
   ══════════════════════════════════════════════════════════════ */
let draftTimer = null;

async function loadDraft() {
  const ta = document.getElementById('draft');
  try {
    const response = await fetch('/api/inbox/draft');
    if (response.ok) {
      const payload = await response.json();
      ta.value = payload.text || '';
    }
  } catch (failure) {
    /* 服务没起就留空 */
  }
  updateHint();
  ta.addEventListener('input', () => {
    updateHint();
    if (draftTimer !== null) clearTimeout(draftTimer);
    draftTimer = setTimeout(saveDraft, 700);
  });
}

async function saveDraft() {
  draftTimer = null;
  const ta = document.getElementById('draft');
  try {
    await fetch('/api/inbox/draft', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: ta.value })
    });
    updateHint();
  } catch (failure) {
    /* 静默失败：底部提示已经够多了 */
  }
}

function updateHint() {
  const ta = document.getElementById('draft');
  const box = document.getElementById('saveHint');
  box.textContent = ta.value.trim() === '' ? '空' : (ta.value.length + ' 字 · ' + new Date().toLocaleTimeString('zh-CN'));
  box.className = ta.value.trim() === '' ? '' : 'saved';
}

document.getElementById('exportBtn').addEventListener('click', () => { saveDraft(); });
document.getElementById('clearBtn').addEventListener('click', () => {
  if (!confirm('清空自由文本？')) return;
  document.getElementById('draft').value = '';
  saveDraft();
  updateHint();
});

/* ══════════════════════════════════════════════════════════════
   启动
   ══════════════════════════════════════════════════════════════ */
document.getElementById('newBtn').addEventListener('click', () => openCreator({}));
document.getElementById('resetBtn').addEventListener('click', () => {
  if (confirm('重置成最初的 9 条样本？当前改动会丢。')) resetDB();
});

/* 视图切换：科技树 / 列表 */
document.querySelectorAll('.vw').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.vw').forEach((b) => b.classList.remove('on'));
    btn.classList.add('on');
    state.view = btn.dataset.view;
    renderAll();
  });
});

document.getElementById('search').addEventListener('input', (e) => {
  state.search = e.target.value;
  renderRows();
});
document.querySelectorAll('.filters .chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('.filters .chip').forEach((c) => c.classList.remove('on'));
    chip.classList.add('on');
    state.filter = chip.textContent.trim();
    renderRows();
  });
});


/* ══════════════════════════════════════════════════════════════
   编辑 / 新建浮层
   ══════════════════════════════════════════════════════════════ */
function modal(title, fields, onSave, saveLabel) {
  closeModal();
  const mask = el('div', {class:'mask'});
  const body = el('div', {class:'modal-body'});
  const inputs = {};
  for (const f of fields) {
    const wrap = el('div', {class:'fld'}, el('label', null, f.label));
    let input;
    if (f.type === 'textarea') {
      input = el('textarea', {placeholder: f.placeholder || ''});
      input.value = f.value || '';
    } else if (f.type === 'select') {
      input = el('select');
      for (const opt of f.options) {
        const o = el('option', {value: opt.value}, opt.label);
        if (opt.value === f.value) o.selected = true;
        input.appendChild(o);
      }
    } else {
      input = el('input', {type:'text', placeholder: f.placeholder || ''});
      input.value = f.value || '';
    }
    inputs[f.key] = input;
    wrap.appendChild(input);
    if (f.hint) wrap.appendChild(el('div', {class:'hint'}, f.hint));
    body.appendChild(wrap);
  }
  const okBtn = el('button', {class:'btn primary', type:'button', onclick(){
    const values = {};
    for (const [k, node] of Object.entries(inputs)) values[k] = node.value;
    onSave(values);
    closeModal();
  }}, saveLabel || '保存');

  const box = el('div', {class:'modal'},
    el('div', {class:'modal-head'}, el('b', null, title),
      el('span', {class:'grow'}), el('button', {class:'icon-btn', type:'button', onclick: closeModal}, '✕')),
    body,
    el('div', {class:'modal-foot'},
      el('span', {class:'hint'}, '改动会立刻存到 localStorage'),
      el('span', {class:'grow'}),
      el('button', {class:'btn', type:'button', onclick: closeModal}, '取消'),
      okBtn));
  mask.appendChild(box);
  mask.addEventListener('click', (e) => { if (e.target === mask) closeModal(); });
  document.body.appendChild(mask);
  document.addEventListener('keydown', escClose);
}
function escClose(e) { if (e.key === 'Escape') closeModal(); }
function closeModal() {
  const old = document.querySelector('.mask');
  if (old) old.remove();
  document.removeEventListener('keydown', escClose);
}

/* ══════════════════════════════════════════════════════════════
   新建 / 编辑浮层 —— 照「新建计划-原型.html」的「建议版」

   ## 和原型的差异

   原型里演示了「现在」和「建议」两版。这里只做建议版：

     左栏：标题 * / 模板（弹出三列）/ 父任务 / 子工作空间 / 额外工作区 / 权限 / 关联
     右栏：正文
     底部：取消 | 提交（都在右下，原型批评了「提交在左下」）

   ## 模板选择器

   点「GU 用户任务 ▾」弹出面板，三列单选：

     领域        类别        模板
     代码        目标        空模板
     写作        设计        U 用户任务
     通用        记录        O 优化
                 工作        ...

   编号 = 类别字母 + 模板字母。空模板只有类别字母（G-01）。
   这个规则和宿主一致（core/index.js 的 nextId）。
   ══════════════════════════════════════════════════════════════ */

/* 模板清单（精简版，够沙盘演示）。letter 是模板侧那一半编号。 */
const TEMPLATES = [
  { code: 'GU', letter: 'U', kind: 'goal',   name: '用户任务', domain: 'general', desc: '用户甩过来的一堆要求或问题；AI 拆成下面的事项去做。' },
  { code: 'GO', letter: 'O', kind: 'goal',   name: '目标·优化', domain: 'general', desc: '觉得哪里不好但说不出怎么改；先立目标，再拆。' },
  { code: 'GA', letter: 'A', kind: 'goal',   name: '目标·澄清', domain: 'general', desc: '用户说得含糊，先把要什么问清。' },
  { code: 'GV', letter: 'V', kind: 'goal',   name: '目标·验证', domain: 'general', desc: '为了验证一个假设而立的临时目标。' },
  { code: 'DP', letter: 'P', kind: 'design', name: '方案', domain: 'general', desc: '给一个问题的可选解法，含代价与风险。' },
  { code: 'DB', letter: 'B', kind: 'design', name: '选型', domain: 'code', desc: '几个方案里挑一个，说清为什么。' },
  { code: 'DC', letter: 'C', kind: 'design', name: '决策', domain: 'general', desc: '要用户拍板的事，列选项给他选。' },
  { code: 'DI', letter: 'I', kind: 'design', name: '接口设计', domain: 'code', desc: '定下对外形状：函数签名、协议、数据结构。' },
  { code: 'DQ', letter: 'Q', kind: 'design', name: '提问', domain: 'general', desc: '一句话问用户；得到答复就完成。' },
  { code: 'DT', letter: 'T', kind: 'design', name: '探索', domain: 'art', desc: '不知道该往哪个方向走，先铺几种可能。' },
  { code: 'RR', letter: 'R', kind: 'record', name: '汇报', domain: 'general', desc: '把一段工作或调查的结果写下来。' },
  { code: 'RB', letter: 'B', kind: 'record', name: '阻碍', domain: 'general', desc: '卡住了，写清卡在哪、为什么、怎么绕。' },
  { code: 'RD', letter: 'D', kind: 'record', name: '缺陷', domain: 'code', desc: '东西坏了：复现、预期、实际。' },
  { code: 'RF', letter: 'F', kind: 'record', name: '复盘', domain: 'general', desc: '事情做完或失败之后，回看为什么。' },
  { code: 'WI', letter: 'I', kind: 'work',   name: '实现', domain: 'code', desc: '动手改代码：改什么、怎么验。' },
  { code: 'WF', letter: 'F', kind: 'work',   name: '修复', domain: 'code', desc: '专门修一个 bug：复现、根因、修法、回归。' },
  { code: 'WR', letter: 'R', kind: 'work',   name: '调研', domain: 'general', desc: '去查清一件事：结论、依据、局限。' },
  { code: 'WX', letter: 'X', kind: 'work',   name: '文档', domain: 'writing', desc: '写给人看的东西：读者是谁、怎么读。' },
  { code: 'WD', letter: 'D', kind: 'work',   name: '绘画', domain: 'art', desc: '画一张图：目标、手法、场景。' },
  { code: 'WC', letter: 'C', kind: 'work',   name: '写作', domain: 'writing', desc: '写一段文字：前置、顺序、检查点。' }
];

const KINDS = [
  { key: 'goal', letter: 'G', label: '目标' },
  { key: 'design', letter: 'D', label: '设计' },
  { key: 'record', letter: 'R', label: '记录' },
  { key: 'work', letter: 'W', label: '工作' }
];

const DOMAINS = [
  { key: 'code', label: '代码' },
  { key: 'writing', label: '写作' },
  { key: 'art', label: '绘画' },
  { key: 'general', label: '通用' }
];

/** 浮层里用户选的东西。 */
const picker = { domain: 'general', kind: 'goal', tpl: 'GU' };

/** 打开新建浮层。 */
function openCreator(init) {
  closeModal();
  const draft = {
    title: '',
    parent: (init && init.parent) || '',
    workspace: '',
    workspaces: '',
    permission: '',
    body: '',
    links: ''
  };
  picker.domain = 'general';
  picker.kind = 'goal';
  picker.tpl = 'GU';

  const mask = el('div', {class:'mask'});
  const box = el('div', {class:'modal', style:{width:'min(860px,100%)'}});

  /* ── 头部 ── */
  box.appendChild(el('div', {class:'modal-head'},
    el('b', null, '新建事项'),
    el('span', {class:'grow', style:{flex:'1'}}),
    el('button', {class:'icon-btn', type:'button', onclick: closeModal}, '✕')));

  /* ── 主体：左右两栏 ── */
  const bodyBox = el('div', {class:'modal-body two-col'});
  const left = el('div', {style:{display:'grid', gap:'11px', alignContent:'start'}});
  const right = el('div', {style:{display:'grid', gap:'8px', alignContent:'start'}});

  /* 标题 */
  left.appendChild(field('标题', el('input', {
    type: 'text', placeholder: '例如：修好任务板分组为空时的提示',
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

  /* 弹出面板：三列 */
  const refreshPop = () => {
    tplPop.innerHTML = '';
    const grid = el('div', {class:'tpl-grid'});

    /* 第 1 列：领域 */
    const col1 = el('div', {class:'tpl-col'}, el('div', {class:'tpl-col-head'}, '领域'));
    for (const d of DOMAINS) {
      col1.appendChild(el('button', {
        class: 'tpl-item' + (picker.domain === d.key ? ' on' : ''),
        type: 'button',
        onclick() { picker.domain = d.key; refreshPop(); }
      }, el('span', {class:'radio'}), d.label));
    }

    /* 第 2 列：类别 */
    const col2 = el('div', {class:'tpl-col'}, el('div', {class:'tpl-col-head'}, '类别'));
    for (const k of KINDS) {
      col2.appendChild(el('button', {
        class: 'tpl-item' + (picker.kind === k.key ? ' on' : ''),
        type: 'button',
        onclick() {
          picker.kind = k.key;
          /* 切类别时，如果当前模板不属于这个类别，退回空模板 */
          const cur = TEMPLATES.find((x) => x.code === picker.tpl);
          if (cur && cur.kind !== k.key) picker.tpl = '';
          refreshPop();
          refreshTplBtn();
        }
      }, el('span', {class:'radio'}),
         el('span', {class:'k-letter'}, k.letter), k.label));
    }

    /* 第 3 列：模板（空模板 + 该领域该类别下的） */
    const col3 = el('div', {class:'tpl-col'}, el('div', {class:'tpl-col-head'}, '模板'));
    col3.appendChild(el('button', {
      class: 'tpl-item' + (picker.tpl === '' ? ' on' : ''),
      type: 'button',
      onclick() { picker.tpl = ''; closePop(); }
    }, el('span', {class:'tpl-code'}, '—'), el('span', {class:'tpl-name'}, '空模板')));

    const list = TEMPLATES.filter((t) => t.kind === picker.kind
      && (t.domain === picker.domain || t.domain === 'general'));
    for (const t of list) {
      col3.appendChild(el('button', {
        class: 'tpl-item' + (picker.tpl === t.code ? ' on' : ''),
        type: 'button',
        title: t.desc,
        onclick() { picker.tpl = t.code; closePop(); }
      }, el('span', {class:'tpl-code'}, t.letter), el('span', {class:'tpl-name'}, t.name)));
    }

    grid.appendChild(col1);
    grid.appendChild(col2);
    grid.appendChild(col3);
    tplPop.appendChild(grid);

    /* 底下显示当前选中的编号预览 */
    const code = picker.tpl || '';
    const kindLetter = (KINDS.find((k) => k.key === picker.kind) || {}).letter || 'X';
    const prefix = code || kindLetter;
    tplPop.appendChild(el('div', {class:'tpl-preview'},
      '编号前缀 ',
      el('b', null, prefix),
      '　最终编号形如 ',
      el('b', null, prefix + '-01')));
  };

  const closePop = () => { tplPop.hidden = true; refreshTplBtn(); };
  tplBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    tplPop.hidden = !tplPop.hidden;
    if (!tplPop.hidden) refreshPop();
  });
  mask.addEventListener('click', () => { if (!tplPop.hidden) tplPop.hidden = true; });

  refreshTplBtn();
  const tplField = el('div', {class:'field tpl-field', style:{position:'relative'}},
    el('label', {class:'lbl'}, '模板'), tplBtn, tplPop);
  left.appendChild(tplField);

  /* 父任务 */
  left.appendChild(field('父任务', el('input', {
    type: 'text', placeholder: '（无，顶层）', value: draft.parent,
    oninput(e) { draft.parent = e.target.value; }
  })));

  /* 子工作空间 */
  left.appendChild(field('子工作空间', el('input', {
    type: 'text', placeholder: '绝对路径（空 = 会话目录）',
    oninput(e) { draft.workspace = e.target.value; }
  })));

  /* 额外工作区 */
  left.appendChild(field('额外工作区', el('input', {
    type: 'text', placeholder: '逗号分隔的绝对路径（可空）',
    oninput(e) { draft.workspaces = e.target.value; }
  })));

  /* 权限 */
  const permSel = el('select', {onchange(e) { draft.permission = e.target.value; }},
    el('option', {value:''}, '（不指定，按会话档位）'),
    el('option', {value:'仅可查看'}, '仅可查看'),
    el('option', {value:'工作区内修改'}, '工作区内修改'),
    el('option', {value:'完全权限'}, '完全权限'),
    el('option', {value:'工具全关'}, '工具全关'));
  left.appendChild(field('权限', permSel));

  /* 关联 */
  left.appendChild(field('关联', el('div', null,
    el('div', {class:'hint', style:{marginBottom:'5px'}}, '箭头从先决指向依赖方'),
    el('button', {class:'btn', type:'button', style:{padding:'4px 11px'}}, '＋ 添加关联'))));

  /* 右栏：正文 */
  right.appendChild(el('div', {class:'lbl'}, '正文'));
  right.appendChild(el('textarea', {
    class: 'ta', style:{minHeight:'330px', height:'330px'},
    placeholder: 'Markdown，或 JSON（对象形态）',
    oninput(e) { draft.body = e.target.value; }
  }));
  right.appendChild(el('div', {class:'hint'},
    '对象形态示例：{"want":{"type":"textarea","value":"…"}}'));

  bodyBox.appendChild(left);
  bodyBox.appendChild(right);
  box.appendChild(bodyBox);

  /* ── 底部 ── */
  box.appendChild(el('div', {class:'modal-foot'},
    el('span', {class:'grow', style:{flex:'1'}}),
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
  /* 标题框自动聚焦 */
  setTimeout(() => {
    const input = box.querySelector('input[type="text"]');
    if (input) input.focus();
  }, 30);
}

/**
 * 一个带 label 的字段。
 *
 * @param {string} label
 * @param {HTMLElement} control
 * @param {boolean} [required]
 */
function field(label, control, required) {
  return el('div', {class:'field'},
    el('label', {class:'lbl'}, label, required ? el('span', {class:'req'}, ' *') : null),
    control);
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
  const box = el('div', {class:'modal', style:{width:'min(820px,100%)'}});
  box.appendChild(el('div', {class:'modal-head'},
    el('b', null, '编辑 ' + t.id),
    el('span', {class:'grow', style:{flex:'1'}}),
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
    ...KINDS.map((k) => el('option', {value:k.key, selected: k.key === draft.kind ? true : null}, k.label)))));

  left.appendChild(el('div', {class:'hint'}, '改类别会影响编号前缀，但不会改已有编号'));

  right.appendChild(el('div', {class:'lbl'}, '正文'));
  right.appendChild(el('textarea', {
    class:'ta', style:{minHeight:'340px', height:'340px'}, value: draft.body,
    oninput(e) { draft.body = e.target.value; }
  }));

  bodyBox.appendChild(left);
  bodyBox.appendChild(right);
  box.appendChild(bodyBox);

  box.appendChild(el('div', {class:'modal-foot'},
    el('span', {class:'grow', style:{flex:'1'}}),
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

function renderAll() {
  renderGroups();
  // 按视图分发：科技树 or 列表
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

/* ══════════════════════════════════════════════════════════════
   状态模型
   ══════════════════════════════════════════════════════════════ */
const STATUS_GROUP = {
  '未指定':[], '提交':['进行'], '处理中':['进行'],
  '需要补充':['进行','搁置'], '需要授权':['进行','搁置'],
  '完成':['完成'], '失败':['完成'], '取消':['完成'], '拒绝':['完成']
};
const groupOf = (s) => (STATUS_GROUP[s] || [])[0] || '草稿';
const toneOf = (s) => {
  const g = groupOf(s);
  return g === '完成' ? 'var(--work)' : g === '搁置' ? 'var(--warn)' : g === '进行' ? 'var(--brand)' : 'var(--text-3)';
};
const KIND_COLOR = { goal:'var(--goal)', design:'var(--brand)', record:'var(--record)', work:'var(--work)' };
const KIND_LABEL = { goal:'目标', design:'设计', record:'记录', work:'工作' };

/* 状态转移表（和宿主 transitionBlocker 口径一致） */
const TRANSITIONS = {
  '未指定':[{to:'提交',label:'采纳',primary:true},{to:'拒绝',label:'拒绝',bad:true}],
  '提交':[{to:'处理中',label:'领取',primary:true},{to:'完成',label:'直接完成'},{to:'取消',label:'取消',bad:true},{to:'拒绝',label:'拒绝',bad:true}],
  '处理中':[{to:'完成',label:'完成',primary:true},{to:'失败',label:'失败',bad:true},{to:'取消',label:'取消',bad:true},{to:'需要补充',label:'搁置 · 需要补充'},{to:'需要授权',label:'搁置 · 需要授权'}],
  '需要补充':[{to:'处理中',label:'继续',primary:true},{to:'取消',label:'取消',bad:true},{to:'拒绝',label:'拒绝',bad:true}],
  '需要授权':[{to:'处理中',label:'继续',primary:true},{to:'取消',label:'取消',bad:true},{to:'拒绝',label:'拒绝',bad:true}],
  '完成':[{to:'提交',label:'重开',primary:true}],
  '失败':[{to:'提交',label:'重开',primary:true}],
  '取消':[{to:'提交',label:'重开',primary:true}],
  '拒绝':[{to:'提交',label:'重开',primary:true}]
};


function patchTask(id, patch) {
  const i = DB.findIndex((t) => t.id === id);
  if (i < 0) return;
  DB[i] = Object.assign({}, DB[i], patch);
  scheduleSave();
  renderAll();
}

function createTask(init) {
  const type = init.type || 'GU';
  const task = {
    id: nextId(type),
    title: init.title || '未命名',
    type,
    kind: init.kind || 'goal',
    status: '未指定',
    parent: init.parent || '',
    links: '',
    tags: [],
    body: init.body || '',
    note: ''
  };
  DB.push(task);
  scheduleSave();
  state.selected = task.id;
  renderAll();
  return task.id;
}

function deleteTask(id) {
  const ids = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const t of DB) {
      if (t.parent && ids.has(t.parent) && !ids.has(t.id)) { ids.add(t.id); grew = true; }
    }
  }
  DB = DB.filter((t) => !ids.has(t.id));
  scheduleSave();
  if (ids.has(state.selected)) state.selected = DB[0] ? DB[0].id : '';
  renderAll();
}

function resetDB() {
  DB = JSON.parse(JSON.stringify(TASKS));
  scheduleSave();
  state.selected = DB[0] ? DB[0].id : '';
  renderAll();
}

/* ══════════════════════════════════════════════════════════════
   科技树 —— 把事项铺成分层有向图

   ## 为什么不用 dagre

   真实插件用 dagre（Sugiyama：分层 → 交叉最小化 → 紧凑排列）。
   但这两份 HTML 要能独立打开，不引外部依赖。所以写一个简化版：

     ① 按依赖深度分层（列）
     ② 每层内按父节点聚拢，减少交叉
     ③ 行高均匀排开

   代价是没有 dagre 那么紧凑，但 10~30 个节点看不出差别。

   ## 边的方向

   一律归一成「先决 → 依赖方」：

     父 → 子
     依赖（我依赖它）  →  它 → 我
     派生（我派生它）  →  我 → 它
     来源（我来自它）  →  它 → 我
     其余            →  它 → 我

   并按无向对去重 —— 同一段关系常常两边各写一次。
   ══════════════════════════════════════════════════════════════ */
const TREE_NODE_W = 150;
const TREE_NODE_H = 50;
const TREE_GAP_X = 62;
const TREE_GAP_Y = 16;

/**
 * 算分层布局。
 *
 * @param {Array} tasks
 * @returns {{nodes: Array, edges: Array, width: number, height: number}}
 */
function buildTree(tasks) {
  const byId = {};
  for (const t of tasks) byId[t.id] = t;

  /* ── ① 收集边（归一方向 + 去重）── */
  const edges = [];
  const seen = new Set();
  const addEdge = (src, dst, kind, label) => {
    if (src === dst) return;
    if (!byId[src] || !byId[dst]) return;
    const key = src < dst ? src + '\u0000' + dst : dst + '\u0000' + src;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push({ src, dst, kind, label });
  };

  for (const t of tasks) {
    if (t.parent) addEdge(t.parent, t.id, 'parent', '');
    for (const link of parseLinks(t.links)) {
      if (link.label === '派生') addEdge(t.id, link.to, 'link', link.label);
      else addEdge(link.to, t.id, 'link', link.label);
    }
  }

  /* ── ② 分层：最长路径深度（无环假设，环就退化成同层）── */
  const depth = {};
  for (const t of tasks) depth[t.id] = 0;

  /* 迭代松弛，最多 N 轮（防环死循环） */
  for (let round = 0; round < tasks.length; round++) {
    let changed = false;
    for (const e of edges) {
      const want = depth[e.src] + 1;
      if (depth[e.dst] < want) { depth[e.dst] = want; changed = true; }
    }
    if (!changed) break;
  }

  /* ── ③ 按层分组；层内按父节点的 y 排序，减少交叉 ── */
  const layers = [];
  for (const t of tasks) {
    const d = depth[t.id];
    if (!layers[d]) layers[d] = [];
    layers[d].push(t);
  }
  /* 去掉空层（可能有跳号） */
  const live = layers.filter((l) => Array.isArray(l) && l.length > 0);

  const placed = {};
  const nodes = [];
  let maxRows = 0;

  live.forEach((layer, col) => {
    /* 层内排序键：父节点的行号（没有父就用 id 兜底） */
    layer.sort((a, b) => {
      const pa = a.parent && placed[a.parent] ? placed[a.parent].row : 999;
      const pb = b.parent && placed[b.parent] ? placed[b.parent].row : 999;
      if (pa !== pb) return pa - pb;
      return a.id < b.id ? -1 : 1;
    });
    layer.forEach((t, row) => {
      const x = col * (TREE_NODE_W + TREE_GAP_X);
      const y = row * (TREE_NODE_H + TREE_GAP_Y);
      placed[t.id] = { node: t, x, y, row, col };
      nodes.push(placed[t.id]);
    });
    maxRows = Math.max(maxRows, layer.length);
  });

  return {
    nodes,
    edges: edges.filter((e) => placed[e.src] && placed[e.dst]),
    placed,
    width: live.length === 0 ? 0 : live.length * (TREE_NODE_W + TREE_GAP_X) - TREE_GAP_X,
    height: maxRows === 0 ? 0 : maxRows * (TREE_NODE_H + TREE_GAP_Y) - TREE_GAP_Y
  };
}

/**
 * 解析 links 字符串成 [{label, to}]。
 *
 * 格式：`依赖:WI-01, 派生:DP-02`（逗号分隔，冒号分标签和目标）
 *
 * @param {string} raw
 * @returns {Array<{label: string, to: string}>}
 */
function parseLinks(raw) {
  const text = String(raw || '').trim();
  if (text === '') return [];
  const out = [];
  for (const part of text.split(',')) {
    const piece = part.trim();
    if (piece === '') continue;
    const cut = piece.indexOf(':');
    if (cut < 0) {
      out.push({ label: '相关', to: piece });
    } else {
      out.push({ label: piece.slice(0, cut).trim() || '相关', to: piece.slice(cut + 1).trim() });
    }
  }
  return out.filter((link) => link.to !== '');
}

/**
 * 渲染科技树。
 *
 * @param {HTMLElement} box
 * @param {Array} tasks
 */
function renderTree(box, tasks) {
  box.innerHTML = '';
  if (tasks.length === 0) {
    box.appendChild(el('div', {class:'tree-empty'}, '这个筛选下没有事项。'));
    return;
  }

  const tree = buildTree(tasks);
  const canvas = el('div', {class:'tree-canvas', style:{
    width: (tree.width + 20) + 'px',
    height: (tree.height + 20) + 'px'
  }});

  /* ── 连线（SVG）── */
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('width', String(tree.width + 20));
  svg.setAttribute('height', String(tree.height + 20));
  svg.style.position = 'absolute';
  svg.style.left = '0';
  svg.style.top = '0';
  svg.style.pointerEvents = 'none';

  /* 箭头标记 */
  const defs = document.createElementNS(ns, 'defs');
  const marker = document.createElementNS(ns, 'marker');
  marker.setAttribute('id', 'tree-arrow');
  marker.setAttribute('viewBox', '0 0 8 8');
  marker.setAttribute('refX', '7');
  marker.setAttribute('refY', '4');
  marker.setAttribute('markerWidth', '7');
  marker.setAttribute('markerHeight', '7');
  marker.setAttribute('orient', 'auto');
  const arrowPath = document.createElementNS(ns, 'path');
  arrowPath.setAttribute('d', 'M0 0 L8 4 L0 8 Z');
  arrowPath.setAttribute('fill', 'var(--border-2)');
  marker.appendChild(arrowPath);
  defs.appendChild(marker);
  svg.appendChild(defs);

  for (const edge of tree.edges) {
    const from = tree.placed[edge.src];
    const to = tree.placed[edge.dst];
    const x1 = from.x + TREE_NODE_W;
    const y1 = from.y + TREE_NODE_H / 2;
    const x2 = to.x - 6;
    const y2 = to.y + TREE_NODE_H / 2;
    const dx = Math.max(24, Math.abs(x2 - x1) / 2);
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', 'M' + x1 + ' ' + y1 + ' C' + (x1 + dx) + ' ' + y1 + ' ' + (x2 - dx) + ' ' + y2 + ' ' + x2 + ' ' + y2);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', edge.kind === 'link' ? 'var(--brand)' : 'var(--border-2)');
    path.setAttribute('stroke-width', edge.kind === 'link' ? '1.4' : '1.2');
    if (edge.kind === 'link') path.setAttribute('stroke-dasharray', '4 3');
    path.setAttribute('marker-end', 'url(#tree-arrow)');
    path.setAttribute('opacity', '0.55');
    svg.appendChild(path);
  }
  canvas.appendChild(svg);

  /* ── 节点 ── */
  for (const placed of tree.nodes) {
    const t = placed.node;
    const color = KIND_COLOR[t.kind] || 'var(--text-3)';
    canvas.appendChild(el('div', {
      class: 'tree-node' + (t.id === state.selected ? ' on' : ''),
      style: { left: (placed.x + 10) + 'px', top: (placed.y + 10) + 'px' },
      onclick() {
        state.selected = t.id;
        state.menuOpen = false;
        state.relOpen = false;
        renderAll();
      }
    },
      el('div', {class:'top'},
        el('span', {class:'tid', style:{color}}, t.id),
        el('span', {class:'tk', style:{color}}, KIND_LABEL[t.kind] || t.kind),
        el('span', {style:{marginLeft:'auto', color:toneOf(t.status), fontSize:'8px'}}, '●')),
      el('div', {class:'tt'}, t.title)));
  }

  /* 画布比容器窄时居中；宽了就让它从左边开始，靠滚动看右边 */
  box.appendChild(canvas);
}

/* ══════════════════════════════════════════════════════════════
   正文渲染 —— 按 action 分发（演示渲染器机制）
   ══════════════════════════════════════════════════════════════ */

/* 极简 Markdown → HTML。只处理快照里用得到的几种语法：
   标题、无序/有序列表、粗体、行内代码、引用、分割线、表格。 */
function md(source) {
  const text = String(source || '');
  const lines = text.split(/\r?\n/);
  const out = [];
  let inList = null;
  const inline = (s) => s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
  const flushList = () => { if (inList) { out.push('</' + inList + '>'); inList = null; } };
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    const line = raw.trimEnd();
    /* 代码块：```lang ... ``` —— 内容原样保留，不解析 */
    if (/^```/.test(line.trim())) {
      flushList();
      const fence = line.trim();
      const lang = fence.slice(3).trim();
      const codeLines = [];
      i += 1;
      while (i < lines.length && !/^```/.test(lines[i].trim())) {
        codeLines.push(lines[i]);
        i += 1;
      }
      out.push('<pre class="code"><code' + (lang ? ' data-lang="' + lang + '"' : '') + '>'
        + codeLines.join('\n').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        + '</code></pre>');
      continue;
    }
    if (line.trim() === '') { flushList(); continue; }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) { flushList(); const lv = h[1].length + 2; out.push('<h' + lv + '>' + inline(h[2]) + '</h' + lv + '>'); continue; }
    /* 表格：表头行 + 分隔行（|---|）后紧跟数据行 */
    if (/^\|.*\|$/.test(line.trim())) {
      flushList();
      if (i + 1 < lines.length && /^\|[\s:|-]+\|?$/.test(lines[i + 1].trim())) {
        const cells = (row) => row.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
        const head = cells(line);
        out.push('<table><thead><tr>' + head.map((c) => '<th>' + inline(c) + '</th>').join('') + '</tr></thead><tbody>');
        i += 2;
        while (i < lines.length && /^\|.*\|$/.test(lines[i].trim())) {
          out.push('<tr>' + cells(lines[i]).map((c) => '<td>' + inline(c) + '</td>').join('') + '</tr>');
          i += 1;
        }
        out.push('</tbody></table>');
        i -= 1;
        continue;
      }
    }
    if (/^---+$/.test(line.trim())) { flushList(); out.push('<hr>'); continue; }
    const q = /^>\s?(.*)$/.exec(line);
    if (q) { flushList(); out.push('<blockquote>' + inline(q[1]) + '</blockquote>'); continue; }
    const ul = /^\s*[-*]\s+(.*)$/.exec(line);
    if (ul) { if (inList !== 'ul') { flushList(); out.push('<ul>'); inList = 'ul'; } out.push('<li>' + inline(ul[1]) + '</li>'); continue; }
    const ol = /^\s*\d+\.\s+(.*)$/.exec(line);
    if (ol) { if (inList !== 'ol') { flushList(); out.push('<ol>'); inList = 'ol'; } out.push('<li>' + inline(ol[1]) + '</li>'); continue; }
    flushList();
    out.push('<p>' + inline(line) + '</p>');
  }
  flushList();
  return out.join('');
}


/* ══════════════════════════════════════════════════════════════
   模板章节表 —— 只为了显示章节标题

   正文存成 { want: {...}, done: {...} }，键是 id。
   但界面上要显示「要什么」「什么算做到了」—— 那是模板里的 label。
   所以这里放一份精简的章节表（id → label + 顺序）。

   沙盘不需要完整模板，只要能对上标题就行。
   ══════════════════════════════════════════════════════════════ */
const SECTION_LABELS = {
  GU: [['want','要什么'],['done','什么算做到了'],['bounds','边界'],['split','怎么拆'],['other','其他']],
  GA: [['want','要什么'],['done','什么算做到了'],['risk','风险'],['split','怎么拆'],['other','其他']],
  GO: [['symptom','现象'],['measure','怎么衡量'],['enough','什么算够'],['split','怎么拆'],['other','其他']],
  GV: [['want','要什么'],['done','什么算做到了'],['bounds','边界'],['split','怎么拆'],['other','其他']],
  DP: [['problem','问题'],['plan','方案'],['cost','代价'],['alternative','别的选择'],['risk','风险'],['other','其他']],
  DB: [['pain','痛点'],['scenario','场景'],['fitness','合不合适'],['precedent','先例'],['other','其他']],
  DC: [['question','要定什么'],['options','选项'],['unknown','我还不知道什么'],['recommend','我的建议'],['other','其他']],
  DI: [['goal','目标'],['contract','接口'],['errors','错误'],['breaking','破坏性'],['other','其他']],
  DQ: [['ask','问什么'],['why','为什么要问'],['guess','我的猜测'],['other','其他']],
  DT: [['setup','前置'],['persp','视角'],['style','风格'],['check','检查点'],['cost','代价'],['other','其他']],
  RR: [['conclusion','结论'],['evidence','依据'],['limits','局限'],['deliver','交付'],['other','其他']],
  RD: [['what','是什么'],['repro','复现'],['expect','预期'],['actual','实际'],['scope','范围'],['accept','验收'],['deliver','交付'],['other','其他']],
  RE: [['want','要什么'],['kind','类型'],['why','为什么'],['enough','什么算够'],['not','不要什么'],['precedent','先例'],['deliver','交付'],['other','其他']],
  RF: [['outcome','结果'],['root','根因'],['lesson','教训'],['apply','怎么用'],['deliver','交付'],['other','其他']],
  RS: [['people','人'],['places','地'],['story','发生了什么'],['conflicts','冲突'],['deliver','交付'],['other','其他']],
  RB: [['where','卡在哪'],['why','为什么'],['next','下一步'],['bypass','绕过'],['reason','原因'],['deliver','交付'],['other','其他']],
  WI: [['goal','目标'],['change','改什么'],['verify','怎么验'],['magic','魔法数字'],['other','其他']],
  WF: [['repro','复现'],['expect','预期'],['root','根因'],['fix','修法'],['regression','回归'],['other','其他']],
  WX: [['reader','读者'],['path','读法'],['must','必须有'],['skip','可以跳过'],['verify','校验'],['deliver','交付'],['other','其他']]
};

/** 取某模板的章节表；没有就返回空（渲染时回退成键名）。 */
function sectionsOf(type) {
  const rows = SECTION_LABELS[String(type || '').toUpperCase()] || [];
  return rows.map(function (row) {
    return { id: row[0], label: row[1], type: ['textarea'], required: false };
  });
}

function renderBody(task) {
  const body = task.body;
  /* 旧格式字符串：整段按 Markdown 纯文本显示 */
  if (typeof body === 'string') {
    const d = el('div', {class:'prose'});
    d.innerHTML = md(body);
    return d;
  }
  /* 新格式 object：按**模板章节顺序**渲染，标题用模板的 label */
  const out = [];
  const sections = sectionsOf(task.type);
  const ordered = sections.length > 0
    ? sections.filter(function (s) { return body[s.id] !== undefined; })
        .map(function (s) { return [s.id, body[s.id], s.label]; })
        .concat(Object.entries(body).filter(function (e) {
          return !sections.some(function (s) { return s.id === e[0]; });
        }).map(function (e) { return [e[0], e[1], e[0]]; }))
    : Object.entries(body || {}).map(function (e) { return [e[0], e[1], e[0]]; });
  for (const [key, section, label] of ordered) {
    const action = section.action;
    if (action === 'markdown' || action === 'textarea') {
      {
        const d = el('div', {class:'prose'});
        d.innerHTML = md(section.value || '');
        out.push(el('div', {class:'sec'}, el('div', {class:'sec-title'}, label), d));
      }
    } else if (action === 'choose') {
      out.push(renderChoose(key, section));
    } else if (action === 'rank') {
      out.push(renderRank(key, section));
    } else if (action === 'derive') {
      out.push(renderDerive(key, section));
    } else {
      out.push(el('div', {class:'sec'},
        el('div', {class:'sec-title'}, label),
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
    el('div', {class:'sec-title'}, label),
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
    el('div', {class:'sec-title'}, label),
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
    el('div', {class:'sec-title'}, label),
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
  selected: TASKS[0].id,
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
   底部自由文本 —— 落盘成 .md
   ══════════════════════════════════════════════════════════════ */
let draftTimer = null;

async function loadDraft() {
  const ta = document.getElementById('draft');
  try {
    const response = await fetch('/api/inbox/draft');
    if (response.ok) {
      const payload = await response.json();
      ta.value = payload.text || '';
    }
  } catch (failure) {
    /* 服务没起就留空 */
  }
  updateHint();
  ta.addEventListener('input', () => {
    updateHint();
    if (draftTimer !== null) clearTimeout(draftTimer);
    draftTimer = setTimeout(saveDraft, 700);
  });
}

async function saveDraft() {
  draftTimer = null;
  const ta = document.getElementById('draft');
  try {
    await fetch('/api/inbox/draft', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: ta.value })
    });
    updateHint();
  } catch (failure) {
    /* 静默失败：底部提示已经够多了 */
  }
}

function updateHint() {
  const ta = document.getElementById('draft');
  const box = document.getElementById('saveHint');
  box.textContent = ta.value.trim() === '' ? '空' : (ta.value.length + ' 字 · ' + new Date().toLocaleTimeString('zh-CN'));
  box.className = ta.value.trim() === '' ? '' : 'saved';
}

document.getElementById('exportBtn').addEventListener('click', () => { saveDraft(); });
document.getElementById('clearBtn').addEventListener('click', () => {
  if (!confirm('清空自由文本？')) return;
  document.getElementById('draft').value = '';
  saveDraft();
  updateHint();
});

/* ══════════════════════════════════════════════════════════════
   启动
   ══════════════════════════════════════════════════════════════ */
document.getElementById('newBtn').addEventListener('click', () => openCreator({}));
document.getElementById('resetBtn').addEventListener('click', () => {
  if (confirm('重置成最初的 9 条样本？当前改动会丢。')) resetDB();
});

/* 视图切换：科技树 / 列表 */
document.querySelectorAll('.vw').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.vw').forEach((b) => b.classList.remove('on'));
    btn.classList.add('on');
    state.view = btn.dataset.view;
    renderAll();
  });
});

document.getElementById('search').addEventListener('input', (e) => {
  state.search = e.target.value;
  renderRows();
});
document.querySelectorAll('.filters .chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('.filters .chip').forEach((c) => c.classList.remove('on'));
    chip.classList.add('on');
    state.filter = chip.textContent.trim();
    renderRows();
  });
});


function renderAll() {
  renderGroups();
  // 按视图分发：科技树 or 列表
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

/* ══════════════════════════════════════════════════════════════
   状态模型
   ══════════════════════════════════════════════════════════════ */
const STATUS_GROUP = {
  '未指定':[], '提交':['进行'], '处理中':['进行'],
  '需要补充':['进行','搁置'], '需要授权':['进行','搁置'],
  '完成':['完成'], '失败':['完成'], '取消':['完成'], '拒绝':['完成']
};
const groupOf = (s) => (STATUS_GROUP[s] || [])[0] || '草稿';
const toneOf = (s) => {
  const g = groupOf(s);
  return g === '完成' ? 'var(--work)' : g === '搁置' ? 'var(--warn)' : g === '进行' ? 'var(--brand)' : 'var(--text-3)';
};
const KIND_COLOR = { goal:'var(--goal)', design:'var(--brand)', record:'var(--record)', work:'var(--work)' };
const KIND_LABEL = { goal:'目标', design:'设计', record:'记录', work:'工作' };

/* 状态转移表（和宿主 transitionBlocker 口径一致） */
const TRANSITIONS = {
  '未指定':[{to:'提交',label:'采纳',primary:true},{to:'拒绝',label:'拒绝',bad:true}],
  '提交':[{to:'处理中',label:'领取',primary:true},{to:'完成',label:'直接完成'},{to:'取消',label:'取消',bad:true},{to:'拒绝',label:'拒绝',bad:true}],
  '处理中':[{to:'完成',label:'完成',primary:true},{to:'失败',label:'失败',bad:true},{to:'取消',label:'取消',bad:true},{to:'需要补充',label:'搁置 · 需要补充'},{to:'需要授权',label:'搁置 · 需要授权'}],
  '需要补充':[{to:'处理中',label:'继续',primary:true},{to:'取消',label:'取消',bad:true},{to:'拒绝',label:'拒绝',bad:true}],
  '需要授权':[{to:'处理中',label:'继续',primary:true},{to:'取消',label:'取消',bad:true},{to:'拒绝',label:'拒绝',bad:true}],
  '完成':[{to:'提交',label:'重开',primary:true}],
  '失败':[{to:'提交',label:'重开',primary:true}],
  '取消':[{to:'提交',label:'重开',primary:true}],
  '拒绝':[{to:'提交',label:'重开',primary:true}]
};


/* 启动：先向服务端要数据，拿到再渲染 */
(async function boot() {
  setSyncState('正在连接…', false);
  const ok = await loadFromServer();
  if (ok) setSyncState('已连上服务 · ' + DB.length + ' 条', false);
  if (!DB.some(function (t) { return t.id === state.selected; })) {
    state.selected = DB[0] ? DB[0].id : '';
  }
  renderAll();
  await loadDraft();
})();

/* 启动：先向服务端要数据，拿到再渲染 */
(async function boot() {
  setSyncState('正在连接…', false);
  const ok = await loadFromServer();
  if (ok) setSyncState('已连上服务 · ' + DB.length + ' 条', false);
  if (!DB.some(function (t) { return t.id === state.selected; })) {
    state.selected = DB[0] ? DB[0].id : '';
  }
  renderAll();
  await loadDraft();
})();

