import fs from 'node:fs'
import zlib from 'node:zlib'

const file = process.argv[2]
const mode = process.argv[3] ?? 'types'
const buf = fs.readFileSync(file)
const magic = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
const offsets = []
for (let i = 0; ; ) {
  const k = buf.indexOf(magic, i)
  if (k < 0) break
  offsets.push(k)
  i = k + 4
}
const parts = []
let broken = 0
for (let n = 0; n < offsets.length; n += 1) {
  const start = offsets[n]
  const end = n + 1 < offsets.length ? offsets[n + 1] : buf.length
  try {
    parts.push(zlib.zstdDecompressSync(buf.subarray(start, end)).toString('utf8'))
  } catch {
    broken += 1
  }
}
const lines = parts.join('').split('\n').filter(Boolean)
const events = []
for (const line of lines) {
  try { events.push(JSON.parse(line)) } catch {}
}
console.error(`frames=${offsets.length} broken=${broken} events=${events.length}`)
let index = 0
for (const e of events) {
  const type = e.type ?? '?'
  const data = e.data ?? {}
  if (mode === 'types') {
    const extra = type === 'user/message' || type === 'assistant/message'
      ? ' ' + JSON.stringify(data).slice(0, 160)
      : ''
    console.log(index, type, extra)
  } else {
    console.log(JSON.stringify(e))
  }
  index += 1
}
