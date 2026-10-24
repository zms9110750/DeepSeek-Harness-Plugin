import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

const root = process.argv[2]
const magic = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
const NEEDLE = 'must be a response to a preceding message'

function readEvents(file) {
  const buf = fs.readFileSync(file)
  const offsets = []
  for (let i = 0; ; ) {
    const k = buf.indexOf(magic, i)
    if (k < 0) break
    offsets.push(k)
    i = k + 4
  }
  const parts = []
  for (let n = 0; n < offsets.length; n += 1) {
    const start = offsets[n]
    const end = n + 1 < offsets.length ? offsets[n + 1] : buf.length
    try { parts.push(zlib.zstdDecompressSync(buf.subarray(start, end)).toString('utf8')) } catch {}
  }
  const out = []
  for (const line of parts.join('').split('\n')) {
    if (!line) continue
    try { out.push(JSON.parse(line)) } catch {}
  }
  return out
}

const hits = []
for (const d of fs.readdirSync(root, { withFileTypes: true })) {
  if (!d.isDirectory()) continue
  const dir = path.join(root, d.name)
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.zstd')) continue
    const file = path.join(dir, f)
    const evts = readEvents(file)
    const index = evts.findIndex((e) => JSON.stringify(e).includes(NEEDLE))
    if (index >= 0) hits.push({ dir: d.name, file, index, evts, size: evts.length })
  }
}

console.log(`sessions containing the error: ${hits.length}`)
for (const h of hits) {
  const stamp = new Date(fs.statSync(h.file).mtimeMs).toISOString()
  const e = h.evts[h.index]
  console.log(`\n### ${h.dir}  events=${h.size}  mtime=${stamp}  at=${h.index}  type=${e.type}`)
  console.log(JSON.stringify(e).slice(0, 900))
}
