import fs from 'node:fs'
import zlib from 'node:zlib'

const file = process.argv[2]
const want = process.argv.slice(3).map(Number)
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
for (const n of want) {
  const e = evts[n]
  if (!e) { console.log(`#${n} MISSING`); continue }
  console.log(`\n===== #${n} ${e.type} surfaceOp=${JSON.stringify(e.surfaceOp)} =====`)
  console.log(JSON.stringify(e, null, 1).slice(0, 1800))
}
