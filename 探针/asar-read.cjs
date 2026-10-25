const fs = require('fs');
const p = 'B:\\DeepSeek Harness\\resources\\app.asar';
const fd = fs.openSync(p, 'r');
const head = Buffer.alloc(16);
fs.readSync(fd, head, 0, 16, 0);
const jsonSize = head.readUInt32LE(12);
const buf = Buffer.alloc(jsonSize);
fs.readSync(fd, buf, 0, jsonSize, 16);
const header = JSON.parse(buf.toString('utf8'));
const baseOffset = 16 + jsonSize;
function find(node, prefix, want) {
  if (!node.files) return null;
  for (const [name, child] of Object.entries(node.files)) {
    const full = prefix + '/' + name;
    if (child.files) { const r = find(child, full, want); if (r) return r; continue; }
    if (full === want) return child;
  }
  return null;
}
const entry = find(header, '', '/lib/main.js');
const size = entry.size;
const b = Buffer.alloc(size);
fs.readSync(fd, b, 0, size, baseOffset + Number(entry.offset));
const text = b.toString('utf8');
const lines = text.split('\n');
lines.forEach((l, i) => {
  if (l.includes('DSH_HOME') || (l.includes('.dsh') && (l.includes('homedir') || l.includes('appData') || l.includes('userData')))) {
    console.log((i+1) + ': ' + l.trim().slice(0, 200));
  }
});
