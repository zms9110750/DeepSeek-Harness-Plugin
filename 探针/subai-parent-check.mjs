import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { DatabaseSync } from 'node:sqlite'

const ZSTD_MAGIC = 0xfd2fb528
function splitFrames(buf) {
  const frames = []
  let pos = 0
  while (pos < buf.length) {
    if (buf.readUInt32LE(pos) !== ZSTD_MAGIC) throw new Error(`第 ${pos} 字节不是 zstd 帧头`)
    const d = buf[pos + 4]
    const fcs = d >> 6
    const single = (d >> 5) & 1
    const checksum = (d >> 2) & 1
    const dict = d & 3
    let p = pos + 5 + (single ? 0 : 1) + [0, 1, 2, 4][dict] + (fcs === 0 ? (single ? 1 : 0) : [0, 2, 4, 8][fcs])
    for (;;) {
      const h = buf[p] | (buf[p + 1] << 8) | (buf[p + 2] << 16)
      p += 3 + (((h >> 1) & 3) === 1 ? 1 : h >> 3)
      if (h & 1) break
    }
    if (checksum) p += 4
    frames.push([pos, p])
    pos = p
  }
  return frames
}

function readLog(sessionId) {
  const root = path.join(os.homedir(), '.dsh', 'sessions')
  for (const bucket of fs.readdirSync(root, { withFileTypes: true })) {
    if (!bucket.isDirectory()) continue
    const dir = path.join(root, bucket.name, sessionId)
    if (!fs.existsSync(dir)) continue
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith('.jsonl.zstd')) continue
      const raw = fs.readFileSync(path.join(dir, name))
      const text = splitFrames(raw).map(([s, e]) => zlib.zstdDecompressSync(raw.subarray(s, e)).toString('utf8')).join('')
      return { file: path.join(dir, name), events: text.split('\n').filter(Boolean).map((line) => JSON.parse(line)) }
    }
  }
  return undefined
}

const db = new DatabaseSync(path.join(os.homedir(), '.dsh', 'subai', 'subai.db'))
// 父会话 = 最新子会话的 parent
const latest = db.prepare('select id, parent from sessions order by created_at desc limit 1').get()
const target = process.argv[2] ?? latest.parent
console.log('检查父会话:', target, '(最新子:', latest.id + ')')

const log = readLog(target)
if (log === undefined) {
  console.log('找不到 JSONL')
  process.exit(1)
}
console.log('文件:', log.file, '事件数:', log.events.length)
const notices = log.events.filter((e) => e.type === 'user/message' && e.data?.source?.kind === 'subagent-settled')
console.log('subagent-settled 的 user/message 条数:', notices.length)
for (const n of notices.slice(-3)) {
  console.log('  seq', n.seq, 'time', n.time, JSON.stringify(n.data.source).slice(0, 120), '|', String(n.data.content?.[0]?.text ?? '').slice(0, 60))
}
const splices = log.events.filter((e) => e.type === 'agent/inbox/spliced')
console.log('inbox/spliced 事件数:', splices.length, '(最后 3 个 seq:', splices.slice(-3).map((e) => e.seq).join(','), ')')
const last = log.events.at(-1)
console.log('父日志最后一条:', last.seq, last.type)
