const fs = require('fs');
const zlib = require('zlib');
const file = process.argv[1];
const buf = fs.readFileSync(file);
// 尝试逐帧解压：zstd 帧各有一个 magic number 0x28B52FFD
const MAGIC = Buffer.from([0x28, 0xB5, 0x2F, 0xFD]);
const offsets = [];
let i = 0;
while (i >= 0 && i < buf.length) {
  const at = buf.indexOf(MAGIC, i);
  if (at === -1) break;
  offsets.push(at);
  i = at + 4;
}
console.log('frames:', offsets.length);
const out = [];
for (let k = 0; k < offsets.length; k++) {
  const start = offsets[k];
  const end = k + 1 < offsets.length ? offsets[k + 1] : buf.length;
  try {
    const chunk = zlib.zstdDecompressSync(buf.subarray(start, end));
    out.push(chunk.toString('utf8'));
  } catch (e) { /* 跳过坏帧 */ }
}
const text = out.join('');
const lines = text.split('\n').filter((l) => l.trim() !== '');
console.log('total lines:', lines.length);
const types = {};
for (const l of lines) {
  try {
    const e = JSON.parse(l);
    types[e.type] = (types[e.type] || 0) + 1;
  } catch {}
}
console.log('types:', JSON.stringify(types, null, 0));
