// 用真实日志验证 hasPendingToolCall 的判定是否与「上游会不会报 400」一致
import fs from 'node:fs'
import zlib from 'node:zlib'

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

// 与插件里 hasPendingToolCall 相同的逻辑，作用于「截至某事件为止」的前缀
function pendingAfter(events) {
  const pending = new Set()
  for (const event of events) {
    switch (event.type) {
      case 'turn/start':
      case 'turn/end':
      case 'step/end':
        pending.clear()
        break
      case 'assistant/message':
        for (const block of event.data?.message?.content ?? []) {
          if (block.type === 'tool-call') pending.add(block.id)
        }
        break
      case 'tool/result': {
        const callId = event.data?.message?.source?.callId
        if (callId !== undefined) pending.delete(callId)
        break
      }
      default:
        break
    }
  }
  return pending
}

const file = process.argv[2]
const evts = readEvents(file)

let hit = null
for (let i = 0; i < evts.length; i += 1) {
  const e = evts[i]
  if (e.type === 'user/message' && e.data?.source?.kind === 'subagent-settled') {
    const pending = pendingAfter(evts.slice(0, i))
    if (pending.size > 0 && hit === null) hit = { seq: e.seq, pending: [...pending] }
  }
}

console.log('错位点（旧行为会插进去的地方）:', hit)
console.log('该会话出现过 400 吗:', evts.some((e) => JSON.stringify(e).includes(NEEDLE)))
