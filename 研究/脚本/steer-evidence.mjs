// 对照：官方用户插话(steer)在日志里长什么样，与 subai 直接 append 的差别
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

const evts = readEvents(process.argv[2])
// 找 agent/inbox/spliced 事件：那是收件箱变化的durable记录
const splices = evts.filter((e) => e.type === 'agent/inbox/spliced')
console.log(`agent/inbox/spliced 共 ${splices.length} 条`)

let shown = 0
for (let i = 0; i < evts.length && shown < 6; i += 1) {
  const e = evts[i]
  if (e.type !== 'agent/inbox/spliced') continue
  const target = e.data?.target
  const inserted = e.data?.inserted ?? []
  if (inserted.length === 0) continue
  const kind = inserted[0]?.source?.kind ?? '?'
  // 找这条 splice 之后第一个被新开出来的 step
  let nextStep = null
  let resultInBetween = 0
  for (let j = i + 1; j < evts.length; j += 1) {
    if (evts[j].type === 'step/start') { nextStep = j; break }
    if (evts[j].type === 'tool/result') resultInBetween += 1
    if (evts[j].type === 'turn/end') break
  }
  console.log(`\nseq=${e.seq} target=${target} kind=${kind}`)
  console.log(`  之后到下一个 step/start 之间发生的 tool/result 数: ${resultInBetween}`)
  console.log(`  下一个 step/start: ${nextStep === null ? '(无)' : '有，距 ${nextStep - i} 条事件'}`)
  shown += 1
}
