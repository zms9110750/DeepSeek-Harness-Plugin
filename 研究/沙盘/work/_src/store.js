/* ══════════════════════════════════════════════════════════════
   数据层 —— 走服务端 API，落盘到文件

   ## 为什么不用 localStorage

   收件箱是「用户写，AI 读」的通道。localStorage 只活在浏览器里，
   AI 读不到；下载文件又要用户多点几次。

   所以起一个极小的本机服务（server.mjs），页面直接 POST，服务端写文件。

   ## 两个页面两份数据

     收件箱 → /api/inbox → 收件箱.json
     工作区 → /api/work  → 工作区.json

   完全隔离：工作区那边格式随时会变，不能牵连收件箱。
   ══════════════════════════════════════════════════════════════ */

/** 服务端路径前缀，由 build 脚本按页面替换。 */
const API = '/api/work';

let DB = [];
let saveTimer = null;
let dirty = false;

/** 从服务端读。 */
async function loadFromServer() {
  try {
    const response = await fetch(API);
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
    const response = await fetch(API, {
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

/* ── 编号规则（和宿主一致）──
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

/* ── 条目编辑 ── */

function patchTask(id, patch) {
  const i = DB.findIndex((t) => t.id === id);
  if (i < 0) return;
  DB[i] = Object.assign({}, DB[i], patch);
  scheduleSave();
  renderAll();
}

function createTask(init) {
  const type = init.type || '';
  const kind = init.kind || 'goal';
  const task = {
    id: nextId(type, kind),
    title: init.title || '未命名',
    type,
    kind,
    status: '未指定',
    parent: init.parent || '',
    links: '',
    tags: [],
    body: init.body || '',
    note: '',
    workspace: init.workspace || '',
    workspaces: init.workspaces || '',
    tmpWorkspace: init.tmpWorkspace || '',
    permission: init.permission || '',
    deny: init.deny || '',
    tags: init.tags ? String(init.tags).split(',').map((x) => x.trim()).filter(Boolean) : []
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

/* ── 底部自由文本 ── */

let draftTimer = null;

async function loadDraft() {
  const ta = document.getElementById('draft');
  if (!ta) return;
  try {
    const response = await fetch(API + '/draft');
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
  if (!ta) return;
  try {
    await fetch(API + '/draft', {
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
  if (!ta || !box) return;
  box.textContent = ta.value.trim() === ''
    ? '空'
    : (ta.value.length + ' 字 · ' + new Date().toLocaleTimeString('zh-CN'));
  box.className = ta.value.trim() === '' ? '' : 'saved';
}
