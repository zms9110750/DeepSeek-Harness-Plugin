// 修复卡死会话：删除插在 tool_calls 与 tool 结果之间的那条通知，并重编号。
//
// 为什么是删除而不是移动：日志加载时按位置强制校验 `seq === index`
// （dsh-session planSurfaceEvent: "session event seq ... is not contiguous"），
// 所以只能整体保持「第 i 条事件的 seq 就是 i」。把事件挪位置会让 seq 不再连续，
// 会话直接加载失败——比原来的 400 更糟。
//
// 为什么可以安全删除：它是一条纯通知（子 AI 结算提示）。内容在子会话日志里仍有，
// 父会话模型也已经看不到它了（正是它导致了 400）。删掉不损失任何可追溯信息。
//
// 其余事件全部原样保留，只把 seq 重排，并把 sourceEventSeqs 里的引用一起平移。
import fs from 'node:fs'
import zlib from 'node:zlib'

const magic = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])

function readLines(file) {
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
const write = process.argv.includes('--write')
const SURFACE = new Set(['system/message', 'developer/message', 'user/message', 'assistant/message', 'tool/result'])

const all = readLines(file)
const header = all[0]?.type === 'session' ? all[0] : null
const events = header === null ? all : all.slice(1)

// 找出所有错位的 user/message
const doomed = new Set()
{
  const pending = new Set()
  for (const e of events) {
    if (e.surfaceOp !== 'append' || !SURFACE.has(e.type)) continue
    if (e.type === 'assistant/message') {
      for (const b of e.data?.message?.content ?? []) if (b.type === 'tool-call') pending.add(b.id)
    } else if (e.type === 'tool/result') {
      pending.delete(e.data?.message?.source?.callId)
    } else if (e.type === 'user/message' && pending.size > 0) {
      doomed.add(e.seq)
    }
  }
}

if (doomed.size === 0) {
  console.log('没有需要修复的错位')
  process.exit(0)
}
console.log(`发现 ${doomed.size} 处错位，将删除这些纯通知事件：${[...doomed].join(', ')}`)

// 重编号：被删事件之后的所有 seq 减 1
const remap = (oldSeq) => {
  let shift = 0
  for (const d of doomed) if (d < oldSeq) shift += 1
  return oldSeq - shift
}

const kept = []
for (const e of events) {
  if (doomed.has(e.seq)) continue
  const next = { ...e, seq: remap(e.seq) }
  if (Array.isArray(next.sourceEventSeqs)) next.sourceEventSeqs = next.sourceEventSeqs.map(remap)
  if (next.surfaceOp && typeof next.surfaceOp === 'object') {
    next.surfaceOp = { ...next.surfaceOp }
    if ('start' in next.surfaceOp) next.surfaceOp.start = remap(next.surfaceOp.start)
    if ('end' in next.surfaceOp) next.surfaceOp.end = remap(next.surfaceOp.end)
  }
  kept.push(next)
}

// 自检：seq 必须等于下标
for (let i = 0; i < kept.length; i += 1) {
  if (kept[i].seq !== i) {
    console.error(`重编号后仍不连续：下标 ${i} 的 seq 是 ${kept[i].seq}，放弃`)
    process.exit(3)
  }
}
console.log(`自检通过：${kept.length} 个事件，seq 连续`)

if (!write) {
  console.log('（未加 --write，仅预览）')
  process.exit(0)
}

const backup = `${file}.bak-${Date.now()}`
fs.copyFileSync(file, backup)
console.log(`已备份：${backup}`)

const out = header === null ? kept : [header, ...kept]
const frames = out.map((e) => zlib.zstdCompressSync(Buffer.from(`${JSON.stringify(e)}\n`, 'utf8')))
fs.writeFileSync(file, Buffer.concat(frames))
console.log(`已写入：${out.length} 行 / ${frames.length} frame`)
