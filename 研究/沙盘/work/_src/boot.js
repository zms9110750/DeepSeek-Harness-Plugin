/* ══════════════════════════════════════════════════════════════
   启动与事件绑定

   ## 为什么单独一段

   基线里是同步启动（`renderAll(); loadDraft();`），因为数据在 localStorage，
   当场就有。现在数据要**先从服务端取**，所以启动变成异步：

     连服务 → 拿到数据 → 选中第一项 → 渲染 → 读草稿

   如果中途服务没起，loadFromServer 会退回内置样本并提示「本地模式」。
   ══════════════════════════════════════════════════════════════ */

/* ── 顶部按钮 ── */
const newBtn = document.getElementById('newBtn');
if (newBtn) newBtn.addEventListener('click', () => openCreator({}));

const resetBtn = document.getElementById('resetBtn');
if (resetBtn) {
  resetBtn.addEventListener('click', () => {
    if (confirm('重置成最初的样本？当前改动会丢。')) resetDB();
  });
}

/* ── 视图切换：科技树 / 列表 ── */
document.querySelectorAll('.vw').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.vw').forEach((b) => b.classList.remove('on'));
    btn.classList.add('on');
    state.view = btn.dataset.view;
    renderAll();
  });
});

/* ── 底部自由文本 ── */
const exportBtn = document.getElementById('exportBtn');
if (exportBtn) exportBtn.addEventListener('click', () => { saveDraft(); });

const clearBtn = document.getElementById('clearBtn');
if (clearBtn) {
  clearBtn.addEventListener('click', () => {
    if (!confirm('清空这段自由文本？')) return;
    const ta = document.getElementById('draft');
    if (ta) ta.value = '';
    saveDraft();
    updateHint();
  });
}

/* ── 启动 ── */
(async function boot() {
  setSyncState('正在连接…', false);
  const ok = await loadFromServer();
  if (ok) setSyncState('已连上服务 · ' + DB.length + ' 条', false);
  if (!DB.some((t) => t.id === state.selected)) {
    state.selected = DB[0] ? DB[0].id : '';
  }
  renderAll();
  await loadDraft();
})();


/* ══════════════════════════════════════════════════════════════
   版本检测 —— 服务端页面比本页新就自动重载

   用户原话：

     > 我关闭标签复制网址以后好了。ctrlf5并不成功。

   Ctrl+F5 对 127.0.0.1 的页面不可靠：Edge 有时只重新验证主文档，
   内联 <style>/<script> 跟着主文档走，不刷新就没变化。

   与其让用户记着「关标签再打开」，不如让页面自己发现过期。

   ## 做法

     · 页面启动时记下服务端给的 page mtime
     · 每 3 秒轮询 /api/ping
     · 一旦 page mtime 变了 → 顶部弹一条「有新版本，正在刷新」
     · 600ms 后 location.reload()

   为什么给 600ms：改到一半的输入还在 debounce 里（600ms），
   先让 scheduleSave 落盘，再刷新，避免丢掉刚打的字。
   ══════════════════════════════════════════════════════════════ */

/** 本页对应的服务端页面版本号。0 表示拿不到（本地模式）。 */
let pageStamp = 0;

/**
 * 查一次服务端的页面版本。
 *
 * @returns {Promise<void>}
 */
async function checkPageVersion() {
  try {
    const response = await fetch(API.replace(/\/api\/.*$/u, '/api/ping'), { cache: 'no-store' });
    if (!response.ok) return;
    const data = await response.json();
    const next = Number(data.page || 0);
    if (next === 0) return;

    /* 第一次拿到：只记下来，不触发 */
    if (pageStamp === 0) { pageStamp = next; return; }

    if (next !== pageStamp) {
      pageStamp = next;
      showReloadBanner();
    }
  } catch {
    /* 服务没起就别管了 */
  }
}

/** 顶部提示条：正在刷新。 */
function showReloadBanner() {
  const old = document.getElementById('reloadBar');
  if (old !== null) return;

  const bar = document.createElement('div');
  bar.id = 'reloadBar';
  bar.style.cssText = [
    'position:fixed', 'left:50%', 'top:12px', 'transform:translateX(-50%)',
    'z-index:9999', 'padding:7px 14px', 'border-radius:20px',
    'background:#191b1f', 'color:#fff', 'font-size:12px',
    'box-shadow:0 6px 20px rgba(0,0,0,.25)', 'font-family:inherit'
  ].join(';');
  bar.textContent = '页面已更新，正在刷新…';
  document.body.appendChild(bar);

  /* 等 debounce 落盘再刷 */
  setTimeout(() => { location.reload(); }, 600);
}

/* 启动时查一次，之后每 3 秒一次 */
checkPageVersion();
setInterval(checkPageVersion, 3000);
