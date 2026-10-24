import fs from 'node:fs'
import zlib from 'node:zlib'

const magic = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
const file = process.argv[2]

const buf = fs.readFileSync(file)
const offsets = []
for (let i = 0; ; ) {
  const k = buf.indexOf(magic, i)
  if (k < 0) break
  offsets.push(k)
  i = k + 4
}
const lines = []
for (let n = 0; n < offsets.length; n += 1) {
  const start = offsets[n]
  const end = n + 1 < offsets.length ? offsets[n + 1] : buf.length
  const text = zlib.zstdDecompressSync(buf.subarray(start, end)).toString('utf8')
  for (const line of text.split('\n')) if (line) lines.push(line)
}

console.log(`frames=${offsets.length} lines=${lines.length}`)

// 展开：chunk 行会变成多个事件，这里只统计行类型
const kinds = new Map()
for (const line of lines) {
  let v
  try { v = JSON.parse(line) } catch { kinds.set('UNPARSED', (kinds.get('UNPARSED') ?? 0) + 1); continue }
  const t = v.type ?? '?'
  const isChunkRow = t === 'text-chunks' || t === 'reasoning-chunks' || t === 'tool-call-chunks'
  kinds.set(isChunkRow ? `ROW:${t}` : t, (kinds.get(isChunkRow ? `ROW:${t}` : t) ?? 0) + 1)
}
for (const [k, v] of [...kinds].sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(' ', v, k)
