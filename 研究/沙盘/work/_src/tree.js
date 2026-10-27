
/* ══════════════════════════════════════════════════════════════
   科技树 —— 把事项铺成分层有向图

   真实插件用 dagre（Sugiyama）。这里写简化版：按依赖深度分列，
   层内按父节点行号排序。10~30 个节点看不出差别。

   边的方向一律归一成「先决 → 依赖方」：
     父 → 子 / 依赖:它 → 我 / 派生:我 → 它 / 来源:它 → 我
   ══════════════════════════════════════════════════════════════ */
const TREE_NODE_W = 150;
const TREE_NODE_H = 50;
const TREE_GAP_X = 62;
const TREE_GAP_Y = 16;

/** 解析 links 字符串：`依赖:WI-01, 派生:DP-02` */
function parseLinks(raw) {
  const text = String(raw || '').trim();
  if (text === '') return [];
  const out = [];
  for (const part of text.split(',')) {
    const piece = part.trim();
    if (piece === '') continue;
    const cut = piece.indexOf(':');
    if (cut < 0) out.push({ label: '相关', to: piece });
    else out.push({ label: piece.slice(0, cut).trim() || '相关', to: piece.slice(cut + 1).trim() });
  }
  return out.filter((link) => link.to !== '');
}

function buildTree(tasks) {
  const byId = {};
  for (const t of tasks) byId[t.id] = t;

  const edges = [];
  const seen = new Set();
  const addEdge = (src, dst, kind, label) => {
    if (src === dst || !byId[src] || !byId[dst]) return;
    /* 去重键带上 kind：父子边和「来源」边指向同一对节点但语义不同，
       以前只按 id 对去重，先加的父子边把来源边吞掉了。 */
    const pair = src < dst ? src + '\u0000' + dst : dst + '\u0000' + src;
    const key = pair + '\u0000' + kind + '\u0000' + (label || '');
    if (seen.has(key)) return;
    seen.add(key);
    edges.push({ src, dst, kind, label });
  };

  for (const t of tasks) {
    if (t.parent) addEdge(t.parent, t.id, 'parent', 'parent');
    for (const link of parseLinks(t.links)) {
      if (link.label === '派生') addEdge(t.id, link.to, 'link', link.label);
      else addEdge(link.to, t.id, 'link', link.label);
    }
  }

  /* 分层：最长路径深度，最多 N 轮（防环） */
  const depth = {};
  for (const t of tasks) depth[t.id] = 0;
  for (let round = 0; round < tasks.length; round++) {
    let changed = false;
    for (const edge of edges) {
      const want = depth[edge.src] + 1;
      if (depth[edge.dst] < want) { depth[edge.dst] = want; changed = true; }
    }
    if (!changed) break;
  }

  const layers = [];
  for (const t of tasks) {
    const d = depth[t.id];
    if (!layers[d]) layers[d] = [];
    layers[d].push(t);
  }
  const live = layers.filter((l) => Array.isArray(l) && l.length > 0);

  const placed = {};
  const nodes = [];
  let maxRows = 0;

  live.forEach((layer, col) => {
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
    edges: edges.filter((edge) => placed[edge.src] && placed[edge.dst]),
    placed,
    width: live.length === 0 ? 0 : live.length * (TREE_NODE_W + TREE_GAP_X) - TREE_GAP_X,
    height: maxRows === 0 ? 0 : maxRows * (TREE_NODE_H + TREE_GAP_Y) - TREE_GAP_Y
  };
}

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

  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('width', String(tree.width + 20));
  svg.setAttribute('height', String(tree.height + 20));
  svg.style.position = 'absolute';
  svg.style.left = '0';
  svg.style.top = '0';
  svg.style.pointerEvents = 'none';

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

  /* 同一对节点的多条边（父子 + 来源 + 派生）会画成完全重叠的曲线，
     看不出是几条。这里按同对出现的序号各自错开一点。 */
  const pairSeen = new Map();
  for (const edge of tree.edges) {
    const pairKey = edge.src < edge.dst ? edge.src + '|' + edge.dst : edge.dst + '|' + edge.src;
    const index = pairSeen.get(pairKey) ?? 0;
    pairSeen.set(pairKey, index + 1);

    const from = tree.placed[edge.src];
    const to = tree.placed[edge.dst];
    const x1 = from.x + TREE_NODE_W;
    const y1 = from.y + TREE_NODE_H / 2;
    const x2 = to.x - 6;
    const y2 = to.y + TREE_NODE_H / 2;
    const dx = Math.max(24, Math.abs(x2 - x1) / 2);
    /* 第 0 条走中间，第 1 条往上弯、第 2 条往下弯 */
    const bow = index === 0 ? 0 : (index % 2 === 1 ? -1 : 1) * (18 + Math.floor(index / 2) * 12);
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', 'M' + x1 + ' ' + y1
      + ' C' + (x1 + dx) + ' ' + (y1 + bow) + ' ' + (x2 - dx) + ' ' + (y2 + bow) + ' ' + x2 + ' ' + y2);
    path.setAttribute('fill', 'none');
    /*
     * 选中某条时，和它相连的箭头要突出显示。
     *
     * 用户原话：
     *   > 点击卡片选中卡片的时候。这个卡片的关联箭头没有突出显示。
     *
     * 所以：相连的加粗 + 不透明，不相连的压暗。
     */
    const linked = state.selected !== '' && (edge.src === state.selected || edge.dst === state.selected);
    const dimmed = state.selected !== '' && !linked;

    path.setAttribute('stroke', linkColor(edge.label || edge.kind));
    path.setAttribute('opacity', dimmed ? '0.12' : (linked ? '1' : '0.55'));
    path.setAttribute('stroke-width', linked ? '2.6' : (edge.kind === 'parent' ? '1.2' : '1.5'));
    {
      const spec = LINK_KINDS.find((x) => x.key === (edge.label || edge.kind));
      if (spec && spec.dashed) path.setAttribute('stroke-dasharray', '4 3');
    }
    path.setAttribute('marker-end', 'url(#tree-arrow)');
    svg.appendChild(path);
  }
  canvas.appendChild(svg);

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
        /* 领域：只写在类别后面。用户原话：
           > 科技树模式下，目标的 label 后面还要放领域的 label。 */
        el('span', {class:'tk', style:{color, opacity:'0.65'}}, DOMAIN_LABEL[domainOf(t)] || domainOf(t)),
        el('span', {style:{marginLeft:'auto', color:toneOf(t.status), fontSize:'8px'}}, '●')),
      el('div', {class:'tt'}, t.title)));
  }

  box.appendChild(canvas);
}
