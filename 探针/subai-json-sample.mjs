import { DatabaseSync } from 'node:sqlite'
import os from 'node:os'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

const db = new DatabaseSync(os.homedir() + '/.dsh/subai/subai.db')
const sample = db.prepare("select sid, seq, type, json from events where type='turn/end' order by seq limit 1").get()
console.log('=== 我们库里的一条 turn/end')
console.log('列 sid =', sample.sid)
console.log('列 seq =', sample.seq, ' 列 type =', sample.type)
console.log('列 json =', sample.json)
console.log('json 字符数 =', sample.json.length)
const parsed = JSON.parse(sample.json)
console.log('反序列化后的键 =', Object.keys(parsed), ' data =', JSON.stringify(parsed.data))

const total = db.prepare('select count(*) n, sum(length(json)) bytes from events').get()
console.log('\n本库事件总数', total.n, ' json 原文合计', total.bytes, '字节（未压缩）')

// 官方 JSONL 里同样形状的一行
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
for (const bucket of fs.readdirSync(root, { withFileTypes: true })) {
  if (!bucket.isDirectory()) continue
  const dir = path.join(root, bucket.name, 'session-5c125856-9f57-4795-8f9d-46b492017940')
  if (!fs.existsSync(dir)) continue
  const file = path.join(dir, 'session.v4.jsonl.zstd')
  if (!fs.existsSync(file)) continue
  const raw = fs.readFileSync(file)
  const text = splitFrames(raw).map(([s, e]) => zlib.zstdDecompressSync(raw.subarray(s, e)).toString('utf8')).join('')
  const line = text.split('\n').filter(Boolean).find((l) => JSON.parse(l).type === 'turn/end')
  console.log('\n=== 官方 JSONL 里的一条 turn/end（同一形状）')
  console.log(line)
  console.log('该文件大小 =', raw.length, '字节（zstd 压缩后）')
  break
}
