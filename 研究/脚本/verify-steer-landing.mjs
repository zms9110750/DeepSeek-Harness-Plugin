// 验收：新送达的子 AI 通知，在父会话里是否落在工具调用之外（不产生非法交错）
import fs from 'node:fs'
import zlib from 'node:zlib'

const magic = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
function readEvents(file) {
  const buf = fs.readFileSync(file)
  const offsets = []
  for (let i = 0; ; ) {
    const k = buf.indexOf(magic, i)
    if (k < 0) break
    offsets.push(k)
    i = k + 4
  }
  const out = []
  for (let n = 0; n < offsets.length; n += 1) {
    const start = offsets[n]
    const end = n + 1 < offsets.length ? offsets[n + 1] : buf.length
    const text = zlib.zstdDecompressSync(buf.subarray(start, end)).toString('utf8')
    for (const line of text.split('\n')) if (line) out.push(JSON.parse(line))
  }
  return out
}

const file = process.argv[2]
const childId = process.argv[3]
const evts = readEvents(file)

// 前缀：session 头不带 seq
const header = evts[0]?.type === 'session'
const body = header ? evts.slice(1) : evts

// 找这条通知
const idx = body.findIndex(
  (e) => e.type === 'user/message' && JSON.stringify(e.data?.source ?? {}).includes(childId),
)
if (idx < 0) {
  console.log('未在父会话日志里找到该通知（可能还在队列里）')
  process.exit(2)
}

const note = body[idx]
console.log(`通知落在 seq ${note.seq}，kind=${note.data?.source?.kind}`)
console.log(`surfaceOp=${JSON.stringify(note.surfaceOp)}`)

// 上下文各 5 条
console.log('\n前后文：')
for (let i = Math.max(0, idx - 5); i <= Math.min(body.length - 1, idx + 3); i += 1) {
  const e = body[i]
  const mark = i === idx ? ' <<<< 通知' : ''
  console.log(`  ${String(e.seq).padStart(4)} ${e.type}${mark}`)
}

// 关键判定：此刻是否有「已发出、未回结果」的工具调用
const pending = new Set()
for (let i = 0; i < idx; i += 1) {
  const e = body[i]
  if (e.surfaceOp !== 'append') continue
  if (e.type === 'assistant/message') {
    for (const b of e.data?.message?.content ?? []) if (b.type === 'tool-call') pending.add(b.id)
  } else if (e.type === 'tool/result') {
    pending.delete(e.data?.message?.source?.callId)
  } else if (e.type === 'step/end' || e.type === 'turn/end') {
    pending.clear()
  }
}

const pass = pending.size === 0
console.log(`\n送达时仍未回的工具调用: ${pending.size === 0 ? '无' : [...pending].join(', ')}`)
console.log(pass ? 'PASS —— 通知落在工具调用之外，不会产生非法交错' : 'FAIL —— 仍插在工具调用中间')
process.exit(pass ? 0 : 1)
