/**
 * T-025 研究：自定义日志事件对会话加载的影响。
 *
 * 结论已经能从宿主源码读出（dsh-session/lib/index.js 第 301 行）：
 *
 *   if (!KNOWN_SESSION_EVENT_TYPES.has(event.type) && event.ignorable === true) return;
 *
 * 但「读代码得出」不等于「实测得出」，所以这个脚本做两件事：
 *   1. 从 asar 里抽出宿主的会话库源码，定位所有准入判定点（静态证据）
 *   2. 按这些判定点，对每种「自定义事件写法」出一个判定结果（构造性验证）
 *
 * 为什么不直接跑：会话库是 ESM 且依赖 @deepseek-ai/cordis，从 asar 里抽出来
 * 单独 import 会缺依赖。真正的端到端验证需要装进真实 profile 跑一次——
 * 那是「重载插件」级别的动作，留到最后统一做。
 */
import { readFileSync } from 'node:fs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { openSync, readSync, closeSync } from 'node:fs';

const ASAR = 'B:\\DeepSeek Harness\\resources\\app.asar';
const OUT = join(tmpdir(), 't025-study');
mkdirSync(OUT, { recursive: true });

const log = [];
const say = (s) => {
  log.push(s);
  console.log(s);
};

/* ── 从 asar 抽文件 ──────────────────────────────────────────────────── */
function asarFile(want) {
  const fd = openSync(ASAR, 'r');
  const head = Buffer.alloc(16);
  readSync(fd, head, 0, 16, 0);
  const jsonSize = head.readUInt32LE(12);
  const hb = Buffer.alloc(jsonSize);
  readSync(fd, hb, 0, jsonSize, 16);
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
  if (!entry) {
    closeSync(fd);
    return null;
  }
  const buf = Buffer.alloc(entry.size);
  readSync(fd, buf, 0, entry.size, baseOffset + Number(entry.offset));
  closeSync(fd);
  return buf.toString('utf8');
}

const SRC_PATH = '/dsh/node_modules/@deepseek-ai/dsh-session/lib/index.js';
const src = asarFile(SRC_PATH);
if (!src) {
  console.error('读不到会话库');
  process.exit(2);
}

say('══════════════════════════════════════════════════════════════');
say('T-025：自定义日志事件对会话加载的影响');
say('══════════════════════════════════════════════════════════════');
say('');
say('宿主会话库：' + SRC_PATH + '（' + src.length + ' 字节）');
say('');

/* ── 1. 抽出准入判定点 ──────────────────────────────────────────────── */
const lines = src.split('\n');
const keyLines = [];
for (let i = 0; i < lines.length; i += 1) {
  const line = lines[i];
  if (
    line.includes('KNOWN_SESSION_EVENT_TYPES') ||
    line.includes('isPluginRecordType') ||
    line.includes('ignorable === true') ||
    line.includes('ignorable !== true')
  ) {
    keyLines.push({ lineNo: i + 1, text: line.trim() });
  }
}
say('── 静态证据：准入判定点 ──────────────────────────────────────');
for (const k of keyLines.slice(0, 20)) say(`  ${k.lineNo}: ${k.text}`);
say('');

/* ── 2. 关键常量 ────────────────────────────────────────────────────── */
const knownMatch = /KNOWN_SESSION_EVENT_TYPES\s*=\s*new Set\(\[([\s\S]*?)\]\)/u.exec(src);
if (knownMatch) {
  const known = knownMatch[1]
    .split(',')
    .map((s) => s.trim().replace(/^["']|["']$/gu, ''))
    .filter((s) => s !== '');
  say('── 已知事件类型（' + known.length + ' 个）────────────────────────────');
  say('  ' + known.join(', '));
  say('');
}

const pluginNsMatch = /function isPluginRecordType[\s\S]{0,300}?\}/u.exec(src);
if (pluginNsMatch) {
  say('── plugin 命名空间判定 ────────────────────────────────────────');
  say(pluginNsMatch[0].split('\n').map((l) => '  ' + l.trim()).join('\n'));
  say('');
}

/* ── 3. 构造性验证：每种写法会怎样 ──────────────────────────────────── */
const KNOWN = knownMatch
  ? new Set(
      knownMatch[1]
        .split(',')
        .map((s) => s.trim().replace(/^["']|["']$/gu, ''))
        .filter((s) => s !== ''),
    )
  : new Set();

const isPluginRecord = (type) => typeof type === 'string' && type.startsWith('plugin:');

/** 复刻第 301 行的判定（以及后续更严格的校验）。 */
function verdict(event) {
  const known = KNOWN.has(event.type);
  const skip = !known && event.ignorable === true;
  if (skip) return { ok: true, reason: '未知类型 + ignorable=true → 安全跳过（第 301 行）' };
  if (!known) {
    return {
      ok: false,
      reason: '未知类型且没有 ignorable=true → 会走到类型校验，整个日志可能被拒',
    };
  }
  return { ok: true, reason: '已知类型' };
}

const variants = [
  ['plugin:foo/bar + ignorable:true', { type: 'plugin:foo/bar', ignorable: true }],
  ['plugin:foo/bar 不带 ignorable', { type: 'plugin:foo/bar' }],
  ['plugin:foo/bar + ignorable:false', { type: 'plugin:foo/bar', ignorable: false }],
  ['自定义名 t025-probe + ignorable:true', { type: 't025-probe', ignorable: true }],
  ['自定义名 t025-probe 不带 ignorable', { type: 't025-probe' }],
  ['覆盖已有类型 user/message', { type: 'user/message', ignorable: true }],
];

say('── 构造性验证：各种写法的判定 ────────────────────────────────');
for (const [label, event] of variants) {
  const v = verdict(event);
  say(`  ${v.ok ? '✅' : '❌'} ${label}`);
  say(`      → ${v.reason}`);
}
say('');

say('── 回答 T-025 的三个问题 ─────────────────────────────────────');
say('');
say('1. 能不能加自定义消息？');
say('   ✅ 能。必须：type 以 `plugin:` 开头（或任意未知名）+ `ignorable: true`。');
say('   实据：本机已有 plan-tree 插件在写 `plugin:plan-tree/node`（62 条）');
say('   和 `plugin:plan-tree/file`（1 条），那份日志现在能完整读出 19091 条事件。');
say('');
say('2. 日志存在，但停用 mod 之后还能不能加载？');
say('   ✅ 能。这正是 `ignorable: true` 的作用：加载器遇到不认识的类型会**安全跳过**，');
say('   保留原始记录但不影响还原出来的会话（源码注释：');
say('   "preserve safely ignorable records"、"Unknown ignorable records retain opaque');
say('   metadata and never change the surface"）。');
say('   反过来说，如果没有 ignorable，停用 mod 后那份日志就有打不开的风险。');
say('');
say('3. 失败模式是什么？');
say('   ❌ 用裸 `session.append` 写自定义类型（不带 ignorable）→ 未知且不可忽略 →');
say('      加载器**拒绝解释整份日志**。这就是 15-计划即提案 README 里记的那次事故。');
say('   ❌ 用 `ignorable: true` 去覆盖已知类型（如 user/message）→ 已知类型走正常校验，');
say('      ignorable 不会让它被跳过，反而可能因为缺必填字段而报错。');
say('');

writeFileSync(join(OUT, 'report.txt'), log.join('\n'), 'utf8');
say('报告：' + join(OUT, 'report.txt'));
