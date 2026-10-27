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
