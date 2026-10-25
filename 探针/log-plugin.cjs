const fs = require('fs');
const zlib = require('zlib');
const buf = fs.readFileSync(process.argv[2]);
const MAGIC = Buffer.from([0x28, 0xB5, 0x2F, 0xFD]);
const offs = []; let pos = 0;
for (;;) { const at = buf.indexOf(MAGIC, pos); if (at === -1) break; offs.push(at); pos = at + 4; }
let text = '';
for (let k = 0; k < offs.length; k++) {
  const s = offs[k], e = k + 1 < offs.length ? offs[k + 1] : buf.length;
  try { text += zlib.zstdDecompressSync(buf.subarray(s, e)).toString('utf8'); } catch {}
}
const lines = text.split('\n').filter((l) => l.trim() !== '');
for (const l of lines) {
  try {
    const e = JSON.parse(l);
    if (String(e.type).startsWith('plugin:')) {
      console.log(JSON.stringify(e).slice(0, 400));
    }
  } catch {}
}
