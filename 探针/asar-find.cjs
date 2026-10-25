const fs = require('fs');
const path = require('path');
const p = 'B:\\DeepSeek Harness\\resources\\app.asar';
const fd = fs.openSync(p, 'r');
const head = Buffer.alloc(16);
fs.readSync(fd, head, 0, 16, 0);
const jsonSize = head.readUInt32LE(12);
const buf = Buffer.alloc(jsonSize);
fs.readSync(fd, buf, 0, jsonSize, 16);
const header = JSON.parse(buf.toString('utf8'));
const baseOffset = 16 + jsonSize;
const hits = [];
function walk(node, prefix) {
  if (!node.files) return;
  for (const [name, child] of Object.entries(node.files)) {
    const full = prefix + '/' + name;
    if (child.files) { walk(child, full); continue; }
    if (!/\.(js|mjs|cjs)$/.test(name)) continue;
    if (full.includes('node_modules')) continue;
    const size = child.size || 0;
    if (size > 2_000_000) continue;
    try {
      const b = Buffer.alloc(size);
      const off = baseOffset + Number(child.offset);
      fs.readSync(fd, b, 0, size, off);
      const t = b.toString('utf8');
      if (t.includes('DSH_HOME') || t.includes('.dsh') && t.includes('homedir')) hits.push(full);
    } catch {}
  }
}
walk(header, '');
console.log('hits:', hits.length);
hits.slice(0, 20).forEach(h => console.log(' ', h));
