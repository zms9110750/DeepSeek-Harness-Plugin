import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

const root = process.argv[2]
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

// Walk only model-visible surface nodes, and detect a user message that lands
// between an assistant tool-call message and its matching tool/result.
const SURFACE = new Set(['system/message', 'developer/message', 'user/message', 'assistant/message', 'tool/result'])

let violations = 0
let notices = 0
const summary = []

for (const d of fs.readdirSync(root, { withFileTypes: true })) {
  if (!d.isDirectory()) continue
  const dir = path.join(root, d.name)
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.zstd')) continue
    const file = path.join(dir, f)
    let evts
    try { evts = readEvents(file) } catch { continue }
    // surface append nodes only
    const nodes = evts.filter((e) => e.surfaceOp === 'append' && SURFACE.has(e.type))
    let pending = new Set()
    let local = 0
    for (const e of nodes) {
      if (e.type === 'assistant/message') {
        for (const b of e.data.message.content ?? []) if (b.type === 'tool-call') pending.add(b.id)
      } else if (e.type === 'tool/result') {
        const id = e.data?.message?.source?.callId
        pending.delete(id)
      } else if (e.type === 'user/message') {
        const kind = e.data?.source?.kind
        if (kind === 'subagent-settled') notices += 1
        if (pending.size > 0) {
          violations += 1
          local += 1
          if (local <= 2) {
            summary.push(`${d.name}/${f} seq=${e.seq} src=${kind} 仍未回的工具调用=${[...pending].join(',')}`)
          }
        }
      }
    }
  }
}

console.log(`subagent-settled 通知总数: ${notices}`)
console.log(`落在未完成工具调用之间的次数: ${violations}`)
for (const s of summary.slice(0, 15)) console.log('  ', s)
