/**
 * T-025 研究：自定义日志事件对会话加载的影响。
 *
 * 做法（隔离，绝不碰真实日志）：
 *   1. 读一份真实会话日志的若干帧，解出前 N 条事件
 *   2. 在副本里插入一条自定义事件，分别试「带 ignorable」「不带 ignorable」
 *   3. 用宿主自己的会话库（@deepseek-ai/dsh-session）解析，看会不会拒
 *
 * 只写 %TEMP%，只读真实日志。
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import zlib from 'node:zlib';

const HERE = dirname(fileURLToPath(import.meta.url));
const ASAR = 'B:\\DeepSeek Harness\\resources\\app.asar';
const OUT_DIR = join(tmpdir(), 't025-study');
mkdirSync(OUT_DIR, { recursive: true });

/* ── 从 asar 读一个包里的文件 ─────────────────────────────────────────── */
function readAsarFile(want) {
  const fd = require_fs().openSync(ASAR, 'r');
  const head = Buffer.alloc(16);
  require_fs().readSync(fd, head, 0, 16, 0);
  const jsonSize = head.readUInt32LE(12);
  const hb = Buffer.alloc(jsonSize);
  require_fs().readSync(fd, hb, 0, jsonSize, 16);
  const header = JSON.parse(hb.toString('utf8'));
  const baseOffset = 16 + jsonSize;
  function find(node, prefix) {
    if (!node.files) return null;
    for (const [name, child] of Object.entries(node.files)) {
      const full = prefix + '/' + name;
      if (child.files) {
        const r = find(child, full);
        if (r) return r;
        continue;
      }
      if (full === want) return child;
    }
    return null;
  }
  const entry = find(header, '');
  if (!entry) return null;
  const buf = Buffer.alloc(entry.size);
  require_fs().readSync(fd, buf, 0, entry.size, baseOffset + Number(entry.offset));
  require_fs().closeSync(fd);
  return buf.toString('utf8');
}
function require_fs() {
  return { openSync: (p, f) => fsOpen(p, f), readSync: (...a) => fsRead(...a), closeSync: (fd) => fsClose(fd) };
}
import { openSync as fsOpen, readSync as fsRead, closeSync as fsClose } from 'node:fs';

const out = [];
const say = (line) => {
  out.push(line);
  console.log(line);
};

/* ── 1. 读真实日志，取一批事件 ───────────────────────────────────────── */
const SAMPLE = process.env.T025_LOG;
if (!SAMPLE || !existsSync(SAMPLE)) {
  console.error('需要 T025_LOG 指向一份 session.v4.jsonl.zstd');
  process.exit(2);
}
const raw = readFileSync(SAMPLE);
const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
const offsets = [];
let pos = 0;
for (;;) {
  const at = raw.indexOf(MAGIC, pos);
  if (at === -1) break;
  offsets.push(at);
  pos = at + 4;
}
let text = '';
for (let k = 0; k < offsets.length; k++) {
  const start = offsets[k];
  const end = k + 1 < offsets.length ? offsets[k + 1] : raw.length;
  try {
    text += zlib.zstdDecompressSync(raw.subarray(start, end)).toString('utf8');
  } catch {
    /* 跳坏帧 */
  }
}
const lines = text.split('\n').filter((l) => l.trim() !== '');
say(`样本：${lines.length} 条事件，${offsets.length} 帧`);

/* 取前 40 条，够建一个能解析的会话头 */
const seed = lines.slice(0, 40);

/* ── 2. 构造三种自定义事件 ───────────────────────────────────────────── */
const maxSeq = Math.max(
  ...seed
    .map((l) => {
      try {
        return JSON.parse(l).seq ?? 0;
      } catch {
        return 0;
      }
    })
    .filter((n) => Number.isFinite(n)),
);

const customBase = {
  seq: maxSeq + 1,
  time: Date.now(),
  data: { hello: 'world' },
};

const variants = {
  'plugin 命名 + ignorable=true': { type: 'plugin:t025/probe', ...customBase, ignorable: true },
  'plugin 命名 + 无 ignorable': { type: 'plugin:t025/probe', ...customBase },
  '任意命名 + ignorable=true': { type: 't025-probe', ...customBase, ignorable: true },
  '任意命名 + 无 ignorable': { type: 't025-probe', ...customBase },
  '任意命名 + ignorable=false': { type: 't025-probe', ...customBase, ignorable: false },
};

/* ── 3. 用宿主的会话库解析 ───────────────────────────────────────────── */
const sessionLibPath = '/dsh/node_modules/@deepseek-ai/dsh-session/lib/index.js';
const source = readAsarFile(sessionLibPath);
if (source === null) {
  console.error('读不到 dsh-session');
  process.exit(2);
}
const tmpModule = join(OUT_DIR, 'session-lib.mjs');
writeFileSync(tmpModule, source, 'utf8');
say(`已解出会话库：${source.length} 字节`);

let sessionLib;
try {
  sessionLib = await import(pathToFileURL(tmpModule).href);
  say('会话库导入成功，导出：' + Object.keys(sessionLib).slice(0, 12).join(', '));
} catch (error) {
  say('会话库导入失败：' + error.message);
  process.exit(3);
}

/* 找解析入口 */
const parseFn = Object.keys(sessionLib).find(
  (k) => /parse|decode|replay|fromLog|readLog/i.test(k) && typeof sessionLib[k] === 'function',
);
say('候选解析入口：' + (parseFn || '（没找到，需要读源码确认）'));

/* ── 4. 把每种变体写出去，供后续用真实加载器验 ──────────────────────── */
for (const [label, event] of Object.entries(variants)) {
  const file = join(OUT_DIR, 'variant-' + label.replace(/[^\w]+/gu, '-') + '.jsonl');
  writeFileSync(file, [...seed, JSON.stringify(event)].join('\n') + '\n', 'utf8');
  say(`已写出：${file}`);
}

writeFileSync(join(OUT_DIR, 'report.txt'), out.join('\n'), 'utf8');
say(`目录：${OUT_DIR}`);
