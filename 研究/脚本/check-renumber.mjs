// 评估「删除 seq 2048 并整体重编号」的影响面
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
const TARGET = 2048
const tail = evts.filter((e) => e.seq >= TARGET)
console.log(`seq >= ${TARGET} 的事件数: ${tail.length}`)

let refs = 0
for (const e of tail) {
  if (e.sourceEventSeqs !== undefined) {
    refs += 1
    console.log(`  sourceEventSeqs 引用 @seq ${e.seq} (${e.type}): ${JSON.stringify(e.sourceEventSeqs)}`)
  }
  if (e.surfaceOp && typeof e.surfaceOp === 'object') {
    console.log(`  replace surfaceOp @seq ${e.seq} (${e.type}): ${JSON.stringify(e.surfaceOp)}`)
  }
}
console.log(`\n带 sourceEventSeqs 的事件: ${refs}`)

// 该事件本身
const bad = evts.find((e) => e.seq === TARGET)
console.log('\n待删除事件:')
console.log(JSON.stringify(bad).slice(0, 500))
