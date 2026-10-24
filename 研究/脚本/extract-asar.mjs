// 把 asar 里指定子树抽到目标目录（保留相对路径）
import fs from 'node:fs'
import path from 'node:path'

const ASAR = process.argv[2]
const PREFIX = process.argv[3]      // 例如 /dsh/node_modules/@deepseek-ai/dsh-session
const OUT = process.argv[4]

const fd = fs.openSync(ASAR, 'r')
const head = Buffer.alloc(16)
fs.readSync(fd, head, 0, 16, 0)
const pickleSize = head.readUInt32LE(4)
const jsonLen = head.readUInt32LE(12)
const jb = Buffer.alloc(jsonLen)
fs.readSync(fd, jb, 0, jsonLen, 16)
const header = JSON.parse(jb.toString('utf8'))
const dataStart = 8 + pickleSize

let count = 0
const keep = /\.(js|json|d\.ts)$/

function walk(node, prefix) {
  for (const [name, value] of Object.entries(node.files ?? {})) {
    const p = `${prefix}/${name}`
    if (value.files) { walk(value, p); continue }
    if (!p.startsWith(PREFIX + '/')) continue
    const rel = p.slice(PREFIX.length + 1)
    if (!keep.test(rel)) continue
    const dst = path.join(OUT, ...rel.split('/'))
    fs.mkdirSync(path.dirname(dst), { recursive: true })
    const buf = Buffer.alloc(value.size)
    fs.readSync(fd, buf, 0, value.size, dataStart + Number(value.offset))
    fs.writeFileSync(dst, buf)
    count += 1
  }
}

walk(header, '')
console.log(`抽取 ${count} 个文件 → ${OUT}`)
