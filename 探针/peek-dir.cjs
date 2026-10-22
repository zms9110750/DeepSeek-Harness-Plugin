/**
 * 看一个会话目录里的日志（目录名不必以 session- 开头）。
 * 用法：node peek-dir.cjs <目录名片段> [关键字]
 */
const { readdirSync, readFileSync, statSync } = require('node:fs');
const { join } = require('node:path');
const { zstdDecompressSync } = require('node:zlib');

const ROOT = 'C:/Users/16229/.dsh/sessions';
const needle = process.argv[2] ?? '';
const filter = process.argv[3] ?? '';

function findLog() {
  const hits = [];
  for (const bucket of readdirSync(ROOT)) {
    const dir = join(ROOT, bucket);
    let entries;
    try { entries = readdirSync(dir); } catch { continue; }
    for (const name of entries) {
      if (!name.includes(needle)) continue;
      const file = join(dir, name, 'session.v4.jsonl.zstd');
      try { hits.push({ file, mtime: statSync(file).mtimeMs }); } catch { /* 没日志 */ }
    }
  }
  hits.sort((a, b) => b.mtime - a.mtime);
  return hits[0]?.file;
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
if (file === undefined) {
  console.log('没找到日志，needle = ' + needle);
  process.exit(1);
}
console.log('日志: ' + file);
const lines = decompressAll(readFileSync(file)).split('\n').filter((line) => line.trim() !== '');
console.log('事件数: ' + lines.length + '\n');

lines.forEach((line, index) => {
  let event;
  try { event = JSON.parse(line); } catch { return; }
  const type = event.type ?? '?';
  const data = event.data ?? {};
  const body = JSON.stringify(data);
  if (filter !== '' && !body.includes(filter)) return;
  const preview = body.length > 200 ? body.slice(0, 200) + '…' : body;
  const extra = type === 'request/header' ? ' [工具 ' + (data.header?.tools?.length ?? '?') + ' 个]' : '';
  console.log(String(index).padStart(4) + ' ' + type.padEnd(22) + extra + ' ' + preview);
});
