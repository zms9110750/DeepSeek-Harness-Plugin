// 用官方 foldSurface 复算修复后的日志：加载通过 + 表面序列合法
import fs from 'node:fs'
import zlib from 'node:zlib'
import { foldSurface, deriveEventMessage } from '@deepseek-ai/dsh-session'

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

const all = readEvents(process.argv[2])
const events = all[0]?.type === 'session' ? all.slice(1) : all

let folded
try {
  folded = foldSurface(events)
  console.log(`foldSurface 通过，表面节点 ${folded.nodes.length} 个`)
} catch (e) {
  console.log(`foldSurface 失败：${e.message}`)
  process.exit(1)
}

// 按表面顺序还原成发给模型的消息序列，检查工具调用是否成对
const bySeq = new Map(events.map((e) => [e.seq, e]))
const roles = []
for (const seq of folded.nodes) {
  const e = bySeq.get(seq)
  const m = deriveEventMessage(e)
  if (m === null || m === undefined) continue
  const calls = (m.content ?? []).filter((b) => b.type === 'tool-call').map((b) => b.id)
  roles.push({ seq, type: e.type, role: m.role, calls })
}

let openCalls = new Set()
const problems = []
for (const r of roles) {
  if (r.role === 'assistant' && r.calls.length > 0) {
    openCalls = new Set(r.calls)
  } else if (r.role === 'tool') {
    openCalls.clear()
  } else if (openCalls.size > 0) {
    problems.push(`seq ${r.seq} role=${r.role} 夹在未回工具调用 ${[...openCalls].join(',')} 之间`)
  }
}

console.log(`模型可见消息 ${roles.length} 条`)
console.log(`非法夹层: ${problems.length === 0 ? 'PASS（无）' : 'FAIL'}`)
for (const p of problems.slice(0, 5)) console.log('  ', p)

// 确认那条通知确实不在表面里了
const gone = !roles.some((r) => JSON.stringify(bySeq.get(r.seq)).includes('session-14234f87'))
console.log(`被删通知已不在模型可见序列: ${gone ? 'PASS' : 'FAIL'}`)

process.exit(problems.length === 0 && gone ? 0 : 1)
