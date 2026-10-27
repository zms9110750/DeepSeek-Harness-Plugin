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
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.trim() === '') { flushList(); continue; }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) { flushList(); const lv = h[1].length + 2; out.push('<h' + lv + '>' + inline(h[2]) + '</h' + lv + '>'); continue; }
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

