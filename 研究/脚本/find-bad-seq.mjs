import fs from 'node:fs'
import zlib from 'node:zlib'

const magic = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
const file = process.argv[2]

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

const evts = readEvents(file)
const SURFACE = new Set(['system/message', 'developer/message', 'user/message', 'assistant/message', 'tool/result'])

// 按 surfaceOp=append 的可见节点顺序，列出所有「user 插在 tool_calls 与 tool 结果之间」
const nodes = evts.filter((e) => e.surfaceOp === 'append' && SURFACE.has(e.type))
const pending = new Map() // callId -> 发起它的 assistant seq
const bad = []
for (const e of nodes) {
  if (e.type === 'assistant/message') {
    for (const b of e.data.message.content ?? []) if (b.type === 'tool-call') pending.set(b.id, e.seq)
  } else if (e.type === 'tool/result') {
    const id = e.data?.message?.source?.callId
    pending.delete(id)
  } else if (e.type === 'user/message' && pending.size > 0) {
    bad.push({ seq: e.seq, kind: e.data?.source?.kind, text: (e.data?.content ?? []).map((b) => b.text).join('').slice(0, 60), blocking: [...pending.keys()] })
  }
}

console.log(`可见节点 ${nodes.length} 个，非法错位 ${bad.length} 处`)
for (const b of bad) console.log('  ', JSON.stringify(b))
