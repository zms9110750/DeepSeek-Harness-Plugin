// 修复后校验：除被删的那条通知外，其余事件内容逐条一致（只允许 seq 平移）
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
const banner = '='.repeat(52)

const fixedBody = fixed[0]?.type === 'session' ? fixed.slice(1) : fixed
const bakBody = backup[0]?.type === 'session' ? backup.slice(1) : backup

// 找出被删事件：备份里有、修复后没有（按「内容去掉 seq」比对）
const strip = (e) => {
  const { seq, ...rest } = e
  return JSON.stringify(rest)
}
const fixedKeys = fixedBody.map(strip)
const bakKeys = bakBody.map(strip)

// 用多重集合找差集
const pool = new Map()
for (const k of fixedKeys) pool.set(k, (pool.get(k) ?? 0) + 1)
const missing = []
for (const k of bakKeys) {
  const n = pool.get(k) ?? 0
  if (n > 0) pool.set(k, n - 1)
  else missing.push(k)
}

console.log(banner)
console.log(`1) 恰好删除 ${missing.length} 条事件: ${missing.length === 1 ? 'PASS' : 'FAIL'}`)
for (const m of missing) {
  const o = JSON.parse(m)
  console.log(`   被删：${o.type} source.kind=${o.data?.source?.kind ?? '-'} text=${JSON.stringify((o.data?.content ?? []).map((b) => b.text).join('').slice(0, 60))}`)
}
const extra = [...pool.values()].reduce((a, b) => a + b, 0)
console.log(`2) 没有多出的事件: ${extra === 0 ? 'PASS' : `FAIL (多出 ${extra})`}`)

// 3) seq 连续
let contiguous = true
for (let i = 0; i < fixedBody.length; i += 1) {
  if (fixedBody[i].seq !== i) { contiguous = false; console.log(`   seq 断裂 at ${i}: ${fixedBody[i].seq}`); break }
}
console.log(`3) seq 连续: ${contiguous ? 'PASS' : 'FAIL'}  (${fixedBody.length} 条事件)`)

// 4) 表面非法错位
const SURFACE = new Set(['system/message', 'developer/message', 'user/message', 'assistant/message', 'tool/result'])
const bad = []
const pending = new Set()
for (const e of fixedBody) {
  if (e.surfaceOp !== 'append' || !SURFACE.has(e.type)) continue
  if (e.type === 'assistant/message') {
    for (const b of e.data?.message?.content ?? []) if (b.type === 'tool-call') pending.add(b.id)
  } else if (e.type === 'tool/result') {
    pending.delete(e.data?.message?.source?.callId)
  } else if (e.type === 'user/message' && pending.size > 0) {
    bad.push(e.seq)
  }
}
console.log(`4) 表面非法错位: ${bad.length === 0 ? 'PASS' : `FAIL ${JSON.stringify(bad)}`}`)

// 5) 头部完好
console.log(`5) session 头完好: ${fixed[0]?.type === 'session' && fixed[0]?.id === backup[0]?.id ? 'PASS' : 'FAIL'}`)

// 6) 顺序：除被删事件外，事件相对顺序完全不变
const orderSame = JSON.stringify(bakKeys.filter((k) => !missing.includes(k))) === JSON.stringify(fixedKeys)
console.log(`6) 其余事件相对顺序不变: ${orderSame ? 'PASS' : 'FAIL'}`)
console.log(banner)
process.exit(missing.length === 1 && extra === 0 && contiguous && bad.length === 0 && orderSame ? 0 : 1)
