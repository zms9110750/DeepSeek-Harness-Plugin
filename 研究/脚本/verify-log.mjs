// 修复后校验：事件数与内容不变、seq 连续、表面序列不再有非法错位
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

const fixed = readEvents(process.argv[2])
const backup = readEvents(process.argv[3])
const SURFACE = new Set(['system/message', 'developer/message', 'user/message', 'assistant/message', 'tool/result'])

// 1) 事件集合完全一致（只是顺序变了）
const key = (e) => `${e.seq}|${e.type}`
const before = new Set(backup.map(key))
const after = new Set(fixed.map(key))
const sameSet = before.size === after.size && [...before].every((k) => after.has(k))
console.log(`1) 事件集合不变: ${sameSet ? 'PASS' : 'FAIL'}  (${before.size} / ${after.size})`)

// 2) 内容完全一致
const contentKey = (e) => JSON.stringify(e)
const beforeContent = backup.map(contentKey).sort()
const afterContent = fixed.map(contentKey).sort()
const sameContent = JSON.stringify(beforeContent) === JSON.stringify(afterContent)
console.log(`2) 事件内容不变（仅顺序变化）: ${sameContent ? 'PASS' : 'FAIL'}`)

// 3) seq 连续（首行是 session 头，本身不带 seq；其后事件 seq 从 0 起逐条 +1）
let contiguous = true
const body = fixed[0]?.type === 'session' ? fixed.slice(1) : fixed
for (let i = 0; i < body.length; i += 1) {
  if (body[i].seq !== i) { contiguous = false; console.log(`   seq 断裂 at index ${i}: ${body[i].seq}`); break }
}
console.log(`3) seq 连续: ${contiguous ? 'PASS' : 'FAIL'}  (共 ${body.length} 条事件 + 1 个头)`)

// 4) 表面序列无非法错位
const bad = []
const pending = new Set()
for (const e of fixed) {
  if (e.surfaceOp !== 'append' || !SURFACE.has(e.type)) continue
  if (e.type === 'assistant/message') {
    for (const b of e.data?.message?.content ?? []) if (b.type === 'tool-call') pending.add(b.id)
  } else if (e.type === 'tool/result') {
    pending.delete(e.data?.message?.source?.callId)
  } else if (e.type === 'user/message' && pending.size > 0) {
    bad.push(e.seq)
  }
}
console.log(`4) 表面非法错位: ${bad.length === 0 ? 'PASS' : 'FAIL ' + JSON.stringify(bad)}`)

process.exit(sameSet && sameContent && contiguous && bad.length === 0 ? 0 : 1)
