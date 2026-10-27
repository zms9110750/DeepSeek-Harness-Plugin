/**
 * 收件箱的构建脚本。
 *
 * ## 这个目录是什么
 *
 * **只服务于一件事：用户派活给 AI。**
 *
 * 界面冻在用户派 GU-03/GU-04 时的样子（2026-10-27 21:53）。
 * 之后 AI 的所有改版都在 ../work/ 里做，不动这里。
 *
 * 为什么隔离：之前两个页面从同一份源码生成，AI 每改一次版就
 * 直接把用户的收件箱换掉 —— 用户派活派到一半，界面变了。
 *
 * ## 只生成一个文件
 *
 * 工作区.html。不碰收件箱。
 *
 * 用法：node build.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (name) => readFileSync(join(HERE, name), 'utf8');

const STYLES = read('_src/styles.css');
const SEED = read('_src/seed.js');
const STORE = read('_src/store.js');
const TREE = read('_src/tree.js');
const BODY = read('_src/body.js');
const RENDER = read('_src/render.js');
const MODAL = read('_src/modal.js');
const FILTERS = read('_src/filters.js');
const BOOT = read('_src/boot.js');

/** sections.js 是可选的（冻版里可能没有）。 */
let SECTIONS = '';
try {
	SECTIONS = read('_src/sections.js');
} catch {
	SECTIONS = '';
}

const code = [SEED, STORE, SECTIONS, TREE, BODY, RENDER, MODAL, FILTERS, BOOT]
	.filter((part) => part !== '')
	.join('\n\n');

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>工作区 · AI 改版沙盘</title>
<style>
  :root{
    --bg:#f4f5f6; --card:#fff; --border:#e4e6e8; --border-2:#d3d6da;
    --text:#23262b; --text-2:#6b7075; --text-3:#9ba0a6;
    --black:#1a1d21; --brand:#3b7dd8; --goal:#7c5cd6; --work:#2e9e6b;
    --record:#8a9099; --warn:#c98a20; --danger:#c0392b;
  }
  *{box-sizing:border-box}
  body{margin:0;padding:22px 20px 60px;background:var(--bg);color:var(--text);
    font:13px/1.5 system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif}
  h1{margin:0 0 4px;font-size:18px;font-weight:650}
  .sub{margin:0 0 18px;color:var(--text-2);font-size:12.5px;max-width:900px}
  .sub code{font:11.5px ui-monospace,Menlo,Consolas,monospace;background:#eceef0;padding:1px 5px;border-radius:3px}
  .toplink{float:right;font-size:12px;color:var(--brand);text-decoration:none;
    padding:5px 11px;border:1px solid var(--brand);border-radius:6px}
  .toplink:hover{background:rgba(59,125,216,.07)}

  .layout{display:grid;grid-template-columns:minmax(0,1fr) 430px;gap:18px;align-items:start}
  @media(max-width:1180px){.layout{grid-template-columns:1fr}}

  .panel{background:var(--card);border:1px solid var(--border);border-radius:10px;
    box-shadow:0 1px 3px rgba(16,18,22,.06),0 8px 24px rgba(16,18,22,.05);overflow:hidden}
  .panel-head{display:flex;align-items:center;gap:10px;padding:11px 14px;border-bottom:1px solid var(--border)}
  .panel-title{font-weight:650;font-size:13.5px}
  .count{color:var(--text-3);font-size:11.5px}
  .grow{flex:1}
  .btn{font:inherit;font-size:12px;padding:5px 11px;border-radius:6px;border:1px solid var(--border-2);
    background:#fff;color:var(--text);cursor:pointer}
  .btn:hover{border-color:#b9bdc2}
  .btn.primary{background:var(--black);border-color:var(--black);color:#fff;font-weight:550}

  .groups{display:flex;align-items:center;gap:6px;padding:9px 14px;border-bottom:1px solid var(--border);flex-wrap:wrap;background:#fcfcfd}
  .group{font:inherit;font-size:12px;padding:4px 11px;border-radius:14px;border:1px solid var(--border-2);
    background:#fff;color:var(--text-2);cursor:pointer}
  .group.on{background:var(--black);border-color:var(--black);color:#fff;font-weight:600}
  .group .n{opacity:.65;font-size:11px;margin-left:3px}

  .filters{display:flex;align-items:center;gap:6px;padding:9px 14px;border-bottom:1px solid var(--border);flex-wrap:wrap}
  .chip{font:inherit;font-size:11.5px;padding:3px 10px;border-radius:12px;border:1px solid var(--border-2);
    background:#fff;color:var(--text-2);cursor:pointer}
  .chip.on{background:var(--brand);border-color:var(--brand);color:#fff;font-weight:600}
  .search{font:inherit;font-size:12px;padding:5px 9px;border-radius:6px;border:1px solid var(--border-2);
    background:#fff;outline:none;width:150px;margin-left:auto}

  .rows{max-height:520px;overflow:auto}
  .row{display:grid;grid-template-columns:auto auto 1fr auto;align-items:center;gap:9px;
    padding:9px 14px;border-bottom:1px solid #f0f1f2;cursor:pointer;text-align:left;
    background:transparent;border-left:0;border-right:0;border-top:0;font:inherit;width:100%}
  .row:hover{background:#f7faff}
  .row.on{background:#eef3fb;box-shadow:inset 3px 0 0 var(--brand)}
  .row .id{font-weight:700;font-size:11.5px;letter-spacing:.02em;flex:none}
  .row .kind{font-size:10px;padding:1px 6px;border-radius:3px;flex:none}
  .row .title{color:var(--text-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
  .row .dot{font-size:8px;flex:none}

  .detail{background:var(--card);border:1px solid var(--border);border-radius:10px;
    box-shadow:0 1px 3px rgba(16,18,22,.06),0 8px 24px rgba(16,18,22,.05);
    display:flex;flex-direction:column;max-height:calc(100vh - 120px);position:sticky;top:16px}
  .d-head{padding:13px 15px 10px;border-bottom:1px solid var(--border);flex:none;position:relative}
  .d-top{display:flex;align-items:center;gap:7px;margin-bottom:7px}
  .d-top .id{font-weight:700;font-size:12px}
  .d-top .kind{font-size:10px;padding:1px 7px;border-radius:3px}
  .d-top .tpl{font-size:10px;padding:1px 6px;border-radius:3px;border:1px solid var(--border-2);color:var(--text-3)}
  .icon-btn{width:26px;height:26px;padding:0;border:0;border-radius:5px;background:transparent;
    color:var(--text-2);cursor:pointer;font-size:13px;display:grid;place-items:center}
  .icon-btn:hover{background:#f2f4f6}
  .d-head h3{margin:0 0 7px;font-size:16px;font-weight:650;line-height:1.35}
  .d-meta{display:flex;align-items:center;gap:9px;font-size:11px;color:var(--text-2);flex-wrap:wrap}
  .status-pill{display:inline-flex;align-items:center;gap:5px;padding:3px 9px;border-radius:10px;
    font:inherit;font-size:11px;font-weight:600;border:1px solid transparent;background:transparent;cursor:pointer}
  .status-menu{position:absolute;left:15px;top:calc(100% + 6px);z-index:30;width:236px;padding:5px;
    background:#fff;border:1px solid var(--border-2);border-radius:8px;
    box-shadow:0 4px 10px rgba(16,18,22,.08),0 16px 40px rgba(16,18,22,.16)}
  .status-menu[hidden]{display:none}
  .menu-cap{font-size:10px;font-weight:700;color:var(--text-3);letter-spacing:.06em;padding:6px 9px 4px}
  .menu-item{display:flex;align-items:center;gap:8px;width:100%;padding:6px 9px;font:inherit;font-size:12.5px;
    text-align:left;background:transparent;border:0;border-radius:5px;cursor:pointer;color:var(--text)}
  .menu-item:hover{background:#f2f4f6}
  .menu-item .ic{flex:none;width:14px;text-align:center;opacity:.7}
  .menu-item.primary{color:var(--brand);font-weight:600}
  .menu-item.bad{color:var(--danger)}
  .menu-note{font-size:10.5px;color:var(--text-3);padding:6px 9px;line-height:1.5;
    border-top:1px solid var(--border);margin-top:4px}

  .parent-row{display:flex;align-items:center;gap:8px;padding:8px 15px;
    border-bottom:1px solid var(--border);flex:none;background:#fcfcfd}
  .rel-toggle{display:inline-flex;align-items:center;gap:5px;flex:none;padding:4px 9px;font:inherit;
    font-size:11.5px;color:var(--text-2);background:#fff;border:1px solid var(--border-2);
    border-radius:6px;cursor:pointer}
  .rel-toggle[aria-expanded="true"]{background:#eef0f2}
  .rel-toggle .n{font-size:10px;font-weight:700;padding:0 5px;border-radius:8px;
    background:#eceef0;color:var(--text-2);line-height:15px}
  .rel-toggle .chev{font-size:8px;transition:transform .15s;display:inline-block}
  .rel-toggle[aria-expanded="true"] .chev{transform:rotate(90deg)}
  .vsep{width:1px;height:16px;background:var(--border-2);flex:none}
  .pcap{font-size:11px;font-weight:600;color:var(--text-3);flex:none}
  .pbtn{display:inline-flex;align-items:center;gap:5px;padding:2px 9px;font:inherit;font-size:11px;
    background:#fff;border:1px solid var(--border-2);border-radius:8px;color:var(--brand);cursor:pointer}
  .derive-btn{display:inline-flex;align-items:center;gap:5px;flex:none;padding:5px 11px;font:inherit;
    font-size:12px;font-weight:550;background:#fff;border:1px solid var(--border-2);
    border-radius:6px;color:var(--text);cursor:pointer;margin-left:auto}
  .derive-btn:hover{border-color:var(--black);background:#f7f8f9}

  .rel-body{padding:0 15px 10px;border-bottom:1px solid var(--border);background:#fbfbfc;flex:none}
  .rel-body[hidden]{display:none}
  .rel-headrow{display:grid;grid-template-columns:repeat(3,1fr);margin-top:10px;
    background:#e4e7ea;border:1px solid var(--border-2);border-bottom:2px solid var(--border-2);
    border-radius:5px 5px 0 0;overflow:hidden}
  .rel-head{display:flex;align-items:center;gap:6px;font-size:11.5px;font-weight:700;
    padding:6px 9px;border-left:3px solid var(--border-2)}
  .rel-head.active{border-left-color:var(--brand)}
  .rel-head.held{border-left-color:var(--warn)}
  .rel-head.done{border-left-color:var(--work)}
  .rel-block{margin-top:8px}
  .rel-banner{display:flex;align-items:center;gap:6px;font-size:10.5px;font-weight:700;
    color:var(--text-2);letter-spacing:.03em;padding:3px 9px;background:#eef0f2;
    border-left:3px solid var(--border-2);border-radius:4px 4px 0 0}
  .rel-cells{display:grid;grid-template-columns:repeat(3,1fr)}
  .rel-cell{padding:5px 4px 3px;display:grid;gap:3px;align-content:start;border-radius:4px}
  .rel-cell.void{background-image:repeating-linear-gradient(45deg,transparent,transparent 3px,rgba(0,0,0,.022) 3px,rgba(0,0,0,.022) 6px)}
  .rel-item{display:inline-flex;align-items:center;gap:5px;padding:2px 8px;font:inherit;font-size:11px;
    line-height:20px;background:#fff;border:1px solid var(--border);border-radius:8px;
    color:var(--brand);cursor:pointer;white-space:nowrap}
  .rel-item:hover{border-color:var(--brand)}

  .d-body{overflow:auto;padding:4px 15px 14px;flex:1;min-height:0}
  .sec{border-top:1px solid var(--border);padding:11px 0 2px}
  .sec:first-child{border-top:0}
  .sec-title{display:flex;align-items:center;gap:7px;font-size:11px;font-weight:700;
    color:var(--text-3);letter-spacing:.04em;margin-bottom:8px}
  .sec-title .n{font-size:10px;font-weight:700;padding:0 5px;border-radius:8px;
    background:#eceef0;color:var(--text-2);line-height:15px}
  .prose{font-size:12.5px;line-height:1.7;word-break:break-word}
  .prose code{font:11.5px ui-monospace,Menlo,Consolas,monospace;background:#f2f4f6;padding:1px 4px;border-radius:3px}
  .prose p{margin:0 0 8px}
  .prose h3{margin:12px 0 6px;font-size:14px;font-weight:650}
  .prose h4{margin:10px 0 5px;font-size:13px;font-weight:650}
  .prose h5,.prose h6{margin:9px 0 4px;font-size:12.5px;font-weight:650}
  .prose ul,.prose ol{margin:0 0 8px;padding-left:20px}
  .prose li{margin:2px 0}
  .prose blockquote{margin:0 0 8px;padding:6px 10px;border-left:2px solid var(--border-2);
    background:#f7f8f9;color:var(--text-2);font-size:12px}
  .prose hr{margin:10px 0;border:0;border-top:1px solid var(--border)}
  .prose strong{font-weight:650}
  .prose table{border-collapse:collapse;margin:0 0 9px;font-size:12px;width:100%}
  .prose th,.prose td{border:1px solid var(--border);padding:4px 8px;text-align:left;vertical-align:top}
  .prose th{background:#f2f4f6;font-weight:650;white-space:nowrap}
  .prose td code{font-size:11px}
  .prose pre.code{margin:0 0 9px;padding:9px 11px;background:#f7f8f9;border:1px solid var(--border);
    border-radius:6px;overflow-x:auto;font-size:11.5px;line-height:1.6}
  .prose pre.code code{background:transparent;padding:0;font-family:ui-monospace,Menlo,Consolas,monospace;
    color:var(--text);white-space:pre;font-size:inherit}
  .prose pre.code code[data-lang]::before{content:attr(data-lang);display:block;font-size:10px;
    color:var(--text-3);margin-bottom:4px;font-family:inherit}

  .inter{border:1px solid var(--border);border-radius:8px;padding:10px 11px 11px;margin-bottom:9px;background:#fcfcfd}
  .inter-cap{display:flex;align-items:baseline;gap:7px;flex-wrap:wrap;font-size:11.5px;
    font-weight:650;margin-bottom:8px}
  .inter-cap .src{font-size:10px;font-weight:500;color:var(--text-3);padding:0 5px;
    border-radius:3px;background:#eceef0}
  .choice{display:flex;align-items:flex-start;gap:8px;width:100%;padding:8px 11px;margin-bottom:6px;
    font:inherit;font-size:12.5px;text-align:left;color:var(--text);background:#fff;
    border:1px solid var(--border-2);border-radius:7px;cursor:pointer}
  .choice:hover{border-color:var(--brand);background:#f7faff}
  .choice.on{border-color:var(--brand);background:#f7faff;color:var(--brand);font-weight:600}
  .choice .radio{flex:none;width:13px;height:13px;border-radius:50%;border:1.5px solid var(--border-2);
    display:grid;place-items:center;margin-top:2px}
  .choice.on .radio{border-color:var(--brand)}
  .choice.on .radio::after{content:'';width:6px;height:6px;border-radius:50%;background:var(--brand)}
  .rank-row{display:flex;align-items:center;gap:8px;padding:6px 9px;margin-bottom:4px;
    background:#fff;border:1px solid var(--border-2);border-radius:6px;font-size:12.5px}
  .rank-row .no{flex:none;width:16px;color:var(--text-3);font-size:10px}
  .rank-row .txt{flex:1}
  .quick-task{display:inline-flex;align-items:center;gap:6px;padding:6px 11px;margin:0 6px 6px 0;
    font:inherit;font-size:12px;background:#fff;border:1px dashed var(--border-2);
    border-radius:6px;cursor:pointer}
  .quick-task:hover{border-style:solid;border-color:var(--brand);color:var(--brand)}
  .quick-task .code{font-size:10px;font-weight:700;color:var(--text-3);padding:0 4px;
    border-radius:3px;background:#f0f2f4}
  .unknown{border:1px dashed var(--border-2);border-radius:6px;background:#f7f8f9;
    padding:9px 11px;font-size:11.5px;color:var(--text-2)}
  .unknown pre{margin:5px 0 0;font:11px/1.5 ui-monospace,Menlo,Consolas,monospace;white-space:pre-wrap}

  .d-foot{padding:10px 15px 12px;border-top:1px solid var(--border);flex:none;background:#fcfcfd}
  .ta{width:100%;min-height:48px;resize:vertical;padding:8px 10px;font:12.5px/1.55 inherit;
    font-family:inherit;border:1px solid var(--border-2);border-radius:6px;outline:none;background:#fff}

  .writer{background:var(--card);border:1px solid var(--border);border-radius:10px;
    box-shadow:0 1px 3px rgba(16,18,22,.06);padding:14px 16px;margin-top:18px}
  .writer h2{margin:0 0 6px;font-size:14px;font-weight:650}
  .writer p{margin:0 0 10px;font-size:12px;color:var(--text-2)}
  .writer p code{font:11px ui-monospace,Menlo,Consolas,monospace;background:#eceef0;padding:1px 5px;border-radius:3px}
  .writer textarea{width:100%;min-height:200px;padding:11px 12px;font:12.5px/1.7 ui-monospace,Menlo,Consolas,monospace;
    border:1px solid var(--border-2);border-radius:7px;outline:none;resize:vertical;background:#fcfcfd}
  .writer-row{display:flex;align-items:center;gap:9px;margin-top:9px;font-size:11.5px;color:var(--text-3)}
  .saved{color:var(--work);font-weight:600}

  .mask{position:fixed;inset:0;z-index:100;background:rgba(20,22,26,.32);
    display:grid;place-items:center;padding:24px}
  .modal{background:#fff;border-radius:10px;box-shadow:0 24px 60px rgba(16,18,22,.28);
    width:min(680px,100%);max-height:86vh;display:flex;flex-direction:column;overflow:hidden}
  .modal-head{display:flex;align-items:center;gap:10px;padding:13px 16px;border-bottom:1px solid var(--border)}
  .modal-head b{font-size:14px;font-weight:650}
  .modal-body{padding:14px 16px;overflow:auto;display:grid;gap:11px}
  .modal-foot{display:flex;align-items:center;gap:9px;padding:11px 16px;border-top:1px solid var(--border);background:#fcfcfd}
  .hint{font-size:10.5px;color:var(--text-3)}

${STYLES}
</style>
</head>
<body>

<a class="toplink" href="http://127.0.0.1:52311/">切换到收件箱 →</a>
<h1>工作区 · AI 改版沙盘</h1>
<p class="sub">
  <b>这一份是我改版用的，和你无关。</b>数据完全独立（<code>工作区.json</code>），
  格式随时会变 —— 有破坏性更新时它可能暂时读不出来，那是我在改，刷新一下就好。
  <br><span id="syncState" style="color:var(--work)">正在连接…</span>
</p>

<div class="layout">
  <div class="panel">
    <div class="panel-head">
      <span class="panel-title">任务</span>
      <span class="count" id="count">共 0 条</span>
      <span class="legend" id="legend">
        <span class="lg"><svg width="18" height="8"><line x1="0" y1="4" x2="18" y2="4"
          stroke="var(--border-2)" stroke-width="1.5"/></svg>父子</span>
        <span class="lg"><svg width="18" height="8"><line x1="0" y1="4" x2="18" y2="4"
          stroke="var(--brand)" stroke-width="1.5" stroke-dasharray="4 3"/></svg>链接</span>
      </span>
      <span class="grow"></span>
      <span class="views">
        <button class="vw on" type="button" data-view="tree">科技树</button>
        <button class="vw" type="button" data-view="list">列表</button>
      </span>
      <button class="btn" type="button" id="newBtn">新建</button>
      <button class="btn" type="button" id="resetBtn">重置为样本</button>
    </div>

    <div class="groups" id="groups"></div>

    <div class="filters" id="filters"></div>

    <div class="rows" id="rows" hidden></div>
    <div class="treeview" id="treeview"></div>
  </div>

  <div class="detail" id="detail"></div>
</div>

<div class="writer">
  <h2>改版笔记（自由文本）</h2>
  <p>我改版时记点东西 —— 存成 <code>工作区-笔记.md</code>。</p>
  <textarea id="draft"></textarea>
  <div class="writer-row">
    <button class="btn primary" type="button" id="exportBtn">立即保存</button>
    <button class="btn" type="button" id="clearBtn">清空</button>
    <span class="grow"></span>
    <span id="saveHint">—</span>
  </div>
</div>

<script>
${code}
</script>
</body>
</html>
`;

/* 自检 */
const s = html.indexOf('<script>') + 8;
const e = html.indexOf('</script>', s);
const body = html.slice(s, e);
const decl = {};
for (const m of body.matchAll(/function (\w+)\s*\(/gu)) decl[m[1]] = (decl[m[1]] ?? 0) + 1;
const dups = Object.entries(decl).filter(([, v]) => v > 1);
if (dups.length > 0) throw new Error('函数重复: ' + dups.map(([k, v]) => k + '×' + v).join(','));
try {
	new Function(body);
} catch (error) {
	throw new Error('语法错误: ' + error.message);
}

writeFileSync(join(HERE, '工作区.html'), html, 'utf8');
console.log(`工作区: ${(html.length / 1024).toFixed(1)} KB, ${Object.keys(decl).length} 个函数`);
