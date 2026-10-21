/**
 * 看一个会话日志里到底发生了什么：事件类型、以及每条事件的简要内容。
 * 用法：node peek-session.cjs <sessionId 前缀>
 */
const { readdirSync, readFileSync, statSync } = require('node:fs');
const { join } = require('node:path');
const { zstdDecompressSync } = require('node:zlib');

const ROOT = 'C:/Users/16229/.dsh/sessions';
const needle = process.argv[2] ?? '';

function findLog() {
  const hits = [];
  for (const bucket of readdirSync(ROOT)) {
    const dir = join(ROOT, bucket);
    let entries;
    try { entries = readdirSync(dir); } catch { continue; }
    for (const name of entries) {
      if (!name.startsWith('session-') || !name.includes(needle)) continue;
      const file = join(dir, name, 'session.v4.jsonl.zstd');
      try { hits.push({ file, mtime: statSync(file).mtimeMs }); } catch { /* 没日志 */ }
    }
  }
  hits.sort((a, b) => b.mtime - a.mtime);
  return hits[0]?.file;
}

/** 多帧 zstd：按魔数切开，逐帧解。 */
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
if (!file) { console.log('没找到日志，needle =', needle); process.exit(1); }
console.log('日志:', file.replace(/\\/g, '/'));

const text = decompressAll(readFileSync(file));
const lines = text.split('\n').filter(Boolean);
console.log('事件数:', lines.length, '\n');

for (const line of lines) {
  let event;
  try { event = JSON.parse(line); } catch { console.log('  <坏行>', line.slice(0, 80)); continue; }
  const data = event.data ?? {};
  let digest = '';
  if (event.type === 'user/message' || event.type === 'assistant/message') {
    const blocks = data.message?.content ?? data.content ?? [];
    digest = blocks.map((b) => (b.type === 'text' ? b.text : `[${b.type}]`)).join(' ').replace(/\s+/g, ' ').slice(0, 160);
  } else if (event.type === 'tool/result' || event.type === 'tool/call') {
    digest = JSON.stringify(data).slice(0, 160);
  } else {
    digest = JSON.stringify(data).slice(0, 160);
  }
  console.log(`${String(event.seq).padStart(3)} ${event.type.padEnd(24)} ${digest}`);
}
