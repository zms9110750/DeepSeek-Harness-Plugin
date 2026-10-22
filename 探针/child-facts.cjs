/**
 * 取一个会话日志的关键事实：header、runtime-context 快照、工单、turn 边界。
 * 用法：node child-facts.cjs <会话目录名片段>
 */
const { readdirSync, readFileSync, statSync } = require('node:fs');
const { join } = require('node:path');
const { zstdDecompressSync } = require('node:zlib');

const ROOT = 'C:/Users/16229/.dsh/sessions';
const needle = process.argv[2] ?? '';

function findLog() {
  for (const bucket of readdirSync(ROOT)) {
    const dir = join(ROOT, bucket);
    let entries;
    try { entries = readdirSync(dir); } catch { continue; }
    for (const name of entries) {
      if (!name.includes(needle)) continue;
      const file = join(dir, name, 'session.v4.jsonl.zstd');
      try { statSync(file); return file; } catch { /* 没日志 */ }
    }
  }
  return undefined;
}

function decompressAll(buffer) {
  const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
  const starts = [];
  for (let i = 0; i + 4 <= buffer.length; i += 1) {
    if (buffer.compare(MAGIC, 0, 4, i, i + 4) === 0) starts.push(i);
  }
  if (starts.length === 0) return buffer.toString('utf8');
  const parts = [];
  for (let k = 0; k < starts.length; k += 1) {
    const slice = buffer.subarray(starts[k], starts[k + 1] ?? buffer.length);
    try { parts.push(zstdDecompressSync(slice).toString('utf8')); } catch { parts.push(''); }
  }
  return parts.join('');
}

const file = findLog();
if (file === undefined) { console.log('没找到日志: ' + needle); process.exit(1); }
const lines = decompressAll(readFileSync(file)).split('\n').filter((l) => l.trim() !== '');
console.log('日志: ' + file);
console.log('事件数: ' + lines.length + '\n');

const events = lines.map((l) => { try { return JSON.parse(l); } catch { return undefined; } }).filter(Boolean);
const first = events[0];
console.log('=== 首事件 header ===');
console.log(JSON.stringify(first?.data?.header ?? first?.header ?? first, null, 1).slice(0, 1200));

for (const e of events) {
  const d = e.data ?? {};
  const text = (d.content ?? []).filter?.((b) => b.type === 'text').map((b) => b.text).join('\n') ?? '';
  const isSnapshot = (d.source?.kind === 'runtime-context') || text.startsWith('Current runtime context');
  if (isSnapshot) {
    console.log(`\n=== 快照 seq=${e.seq} (${e.type}) ===`);
    console.log(text.slice(0, 500));
  }
  if (text.includes('You are executing plan node')) {
    console.log(`\n=== 工单 seq=${e.seq} ===`);
    console.log(text.slice(0, 400));
  }
}

console.log('\n=== turn/start 的 seq ===');
console.log(events.filter((e) => e.type === 'turn/start').map((e) => e.seq).join(', '));
