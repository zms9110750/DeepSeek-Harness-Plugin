import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'

const ZSTD_MAGIC = 0xfd2fb528
function splitFrames(buf) {
  const frames = []; let pos = 0
  while (pos < buf.length) {
    if (buf.readUInt32LE(pos) !== ZSTD_MAGIC) throw new Error('not zstd')
    const d = buf[pos + 4], fcs = d >> 6, single = (d >> 5) & 1, checksum = (d >> 2) & 1, dict = d & 3
    let p = pos + 5 + (single ? 0 : 1) + [0, 1, 2, 4][dict] + (fcs === 0 ? (single ? 1 : 0) : [0, 2, 4, 8][fcs])
    for (;;) { const h = buf[p] | (buf[p + 1] << 8) | (buf[p + 2] << 16); p += 3 + (((h >> 1) & 3) === 1 ? 1 : h >> 3); if (h & 1) break }
    if (checksum) p += 4
    frames.push([pos, p]); pos = p
  }
  return frames
}

const root = path.join(os.homedir(), '.dsh', 'sessions')
let file
for (const bucket of fs.readdirSync(root, { withFileTypes: true })) {
  if (!bucket.isDirectory()) continue
  const dir = path.join(root, bucket.name, 'session-5c125856-9f57-4795-8f9d-46b492017940')
  const candidate = path.join(dir, 'session.v4.jsonl.zstd')
  if (fs.existsSync(candidate)) { file = candidate; break }
}
const raw = fs.readFileSync(file)
const text = splitFrames(raw).map(([s, e]) => zlib.zstdDecompressSync(raw.subarray(s, e)).toString('utf8')).join('')
const lines = text.split('\n').filter(Boolean)

console.log('=== 官方文件第一行（物理 header）')
console.log(lines[0].slice(0, 400))
console.log('\n=== 我们库里存的 header（逻辑 SessionHeader）')
const { DatabaseSync } = await import('node:sqlite')
const db = new DatabaseSync(os.homedir() + '/.dsh/subai/subai.db')
console.log(db.prepare('select header from sessions limit 1').get().header.slice(0, 400))

const withRefs = lines.filter((l) => l.includes('"sourceEventSeqs"') || l.includes('"messageSeqs"'))
console.log('\n=== 含 seq 数组的物理行（看有没有被压成区间）')
for (const line of withRefs.slice(0, 2)) {
  const m = line.match(/"sourceEventSeqs":(\[[^\]]*\]?[^\]]*?\]|\[.*?\]\])|"messageSeqs":([^,}]*)/)
  console.log(m ? m[0] : line.slice(0, 300))
}
console.log('含 seq 数组的行数:', withRefs.length, '/', lines.length - 1)
