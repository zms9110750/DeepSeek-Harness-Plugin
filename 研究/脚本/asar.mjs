// 解析 Electron app.asar（Chrome pickle 头），列出/提取内部文件
import fs from 'node:fs'

const ASAR = process.argv[2]
const MODE = process.argv[3] ?? '--list'

function openAsar(file) {
  const fd = fs.openSync(file, 'r')
  const head = Buffer.alloc(16)
  fs.readSync(fd, head, 0, 16, 0)
  // 布局：[0..4)=4，[4..8)=pickle 长度，[8..12)=对齐后的串长，[12..16)=json 长度
  const pickleSize = head.readUInt32LE(4)
  const jsonLen = head.readUInt32LE(12)
  const jsonStart = 16
  const jsonBuf = Buffer.alloc(jsonLen)
  fs.readSync(fd, jsonBuf, 0, jsonLen, jsonStart)
  const header = JSON.parse(jsonBuf.toString('utf8'))
  const dataStart = 8 + pickleSize
  return { fd, header, dataStart }
}

function walk(node, prefix, out) {
  for (const [name, value] of Object.entries(node.files ?? {})) {
    const p = `${prefix}/${name}`
    if (value.files) { walk(value, p, out); continue }
    // unpacked 条目没有有意义的数据区偏移；用偏移量本身判断才可靠
    const raw = value.offset === undefined ? null : Number(value.offset)
    const usable = raw !== null && Number.isSafeInteger(raw) && raw >= 0
    out.push({ path: p, size: value.size, offset: usable ? raw : null })
  }
  return out
}

const asar = openAsar(ASAR)
const entries = walk(asar.header, '', [])
const byPath = new Map(entries.map((e) => [e.path, e]))

if (MODE === '--list') {
  const pattern = process.argv[4]
  console.log(`total ${entries.length} files`)
  for (const e of entries) {
    if (!pattern || e.path.includes(pattern)) console.log(String(e.size).padStart(9), e.path)
  }
} else if (MODE === '--read') {
  const target = process.argv[4]
  const e = byPath.get(target)
  if (!e) { console.error(`not found: ${target}`); process.exit(1) }
  const buf = Buffer.alloc(e.size)
  fs.readSync(asar.fd, buf, 0, e.size, asar.dataStart + e.offset)
  process.stdout.write(buf.toString('utf8'))
} else if (MODE === '--grep') {
  const needle = process.argv[4]
  const hits = []
  for (const e of entries) {
    if (e.offset === null || e.size > 8 * 1024 * 1024) continue
    if (!/\.(js|cjs|mjs|json|ts)$/.test(e.path)) continue
    const buf = Buffer.alloc(e.size)
    fs.readSync(asar.fd, buf, 0, e.size, asar.dataStart + e.offset)
    const text = buf.toString('utf8')
    if (text.includes(needle)) {
      const idx = text.indexOf(needle)
      hits.push({ path: e.path, size: e.size, line: text.slice(0, idx).split('\n').length })
    }
  }
  console.log(`命中 ${hits.length} 个文件（含 "${needle}"）`)
  for (const h of hits) console.log(`  ${h.path}  (首次出现在第 ${h.line} 行)`)

}
