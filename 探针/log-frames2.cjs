const fs = require('fs');
const zlib = require('zlib');
const file = process.argv[2];
const buf = fs.readFileSync(file);
const MAGIC = Buffer.from([0x28, 0xB5, 0x2F, 0xFD]);
const offsets = [];
let pos = 0;
for (;;) {
  const at = buf.indexOf(MAGIC, pos);
  if (at === -1) break;
  offsets.push(at);
  pos = at + 4;
}
let text = '';
let bad = 0;
for (let k = 0; k < offsets.length; k++) {
  const start = offsets[k];
  const end = k + 1 < offsets.length ? offsets[k + 1] : buf.length;
  try {
    text += zlib.zstdDecompressSync(buf.subarray(start, end)).toString('utf8');
  } catch (e) { bad++; }
}
console.log('frames:', offsets.length, 'bad:', bad);
const lines = text.split('\n').filter((l) => l.trim() !== '');
console.log('lines:', lines.length);
const types = {};
const kinds = new Set();
for (const l of lines) {
  try { const e = JSON.parse(l); types[e.type] = (types[e.type] || 0) + 1; if (e.type) kinds.add(e.type); } catch {}
}
console.log('types:', JSON.stringify(types));
fs.writeFileSync('X:\\temp\\dsh\\探针\\log-sample.txt', lines.slice(0, 200).join('\n'), 'utf8');
