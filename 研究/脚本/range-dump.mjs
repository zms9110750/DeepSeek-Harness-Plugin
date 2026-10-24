import fs from 'node:fs'
import zlib from 'node:zlib'

const file = process.argv[2]
const from = Number(process.argv[3] ?? 0)
const to = Number(process.argv[4] ?? 1e9)
const magic = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])

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
const evts = []
for (const line of parts.join('').split('\n')) {
  if (!line) continue
  try { evts.push(JSON.parse(line)) } catch {}
}

function brief(e) {
  const t = e.type
  const d = e.data ?? {}
  if (t === 'assistant/message') {
    const c = (d.message?.content ?? []).map((b) => `${b.type}${b.id ? '(' + b.id + ')' : ''}${b.text ? ':' + JSON.stringify(b.text).slice(0, 70) : ''}`)
    return `turn=${d.turn} step=${d.step} [${c.join(' | ')}]`
  }
  if (t === 'tool/result') {
    return `callId=${d.callId ?? d.id} ${JSON.stringify(d).slice(0, 120)}`
  }
  if (t === 'user/message') {
    const c = (d.message?.content ?? d.content ?? []).map((b) => `${b.type}:${JSON.stringify(b.text ?? '').slice(0, 90)}`)
    return `src=${JSON.stringify(d.message?.source ?? d.source)} [${c.join(' | ')}]`
  }
  return JSON.stringify(e).slice(0, 220)
}

console.log(`total events ${evts.length}`)
for (let i = from; i < Math.min(to, evts.length); i += 1) {
  console.log(`${i}\t${evts[i].type}\t${brief(evts[i])}`)
}
