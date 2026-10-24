// 从 asar 里递归抽取一个包的完整依赖闭包（含 peer/dependencies）
import fs from 'node:fs'
import path from 'node:path'

const ASAR = process.argv[2]
const OUT = process.argv[3]
const ROOTS = process.argv.slice(4)

const fd = fs.openSync(ASAR, 'r')
const head = Buffer.alloc(16)
fs.readSync(fd, head, 0, 16, 0)
const pickleSize = head.readUInt32LE(4)
const jsonLen = head.readUInt32LE(12)
const jb = Buffer.alloc(jsonLen)
fs.readSync(fd, jb, 0, jsonLen, 16)
const header = JSON.parse(jb.toString('utf8'))
const dataStart = 8 + pickleSize

// 建立 path -> entry 映射（只保留需要的扩展名）
const keep = /\.(js|json|d\.ts)$/
const index = new Map()
function walk(node, prefix) {
  for (const [name, value] of Object.entries(node.files ?? {})) {
    const p = `${prefix}/${name}`
    if (value.files) { walk(value, p); continue }
    const raw = value.offset === undefined ? null : Number(value.offset)
    const usable = raw !== null && Number.isSafeInteger(raw) && raw >= 0
    index.set(p, { size: value.size, offset: usable ? raw : null })
  }
}
walk(header, '')

function readText(p) {
  const e = index.get(p)
  if (!e || e.offset === null) return undefined
  const buf = Buffer.alloc(e.size)
  fs.readSync(fd, buf, 0, e.size, dataStart + e.offset)
  return buf
}

const done = new Set()
const queue = [...ROOTS]
let files = 0

while (queue.length > 0) {
  const pkg = queue.shift()
  if (done.has(pkg)) continue
  done.add(pkg)
  const base = `/dsh/node_modules/${pkg}`
  const manifestPath = `${base}/package.json`
  const raw = readText(manifestPath)
  if (raw === undefined) { console.log(`  跳过（asar 内没有）: ${pkg}`); continue }
  const manifest = JSON.parse(raw.toString('utf8'))

  // 抽文件
  let n = 0
  for (const [p, e] of index) {
    if (!p.startsWith(base + '/')) continue
    const rel = p.slice(base.length + 1)
    if (!keep.test(rel)) continue
    const dst = path.join(OUT, ...pkg.split('/'), ...rel.split('/'))
    if (e.offset === null) continue
    fs.mkdirSync(path.dirname(dst), { recursive: true })
    const buf = Buffer.alloc(e.size)
    fs.readSync(fd, buf, 0, e.size, dataStart + e.offset)
    fs.writeFileSync(dst, buf)
    n += 1
    files += 1
  }
  console.log(`  ${pkg}@${manifest.version} → ${n} 个文件`)

  const deps = {
    ...manifest.dependencies,
    ...manifest.peerDependencies,
  }
  for (const dep of Object.keys(deps ?? {})) {
    if (dep.startsWith('@deepseek-ai/')) queue.push(dep)
  }
}

console.log(`\n共抽取 ${files} 个文件，${done.size} 个包`)
