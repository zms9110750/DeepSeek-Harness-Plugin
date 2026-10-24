// 校验 deliver 的投递规则：对照官方 send/steer/followup 语义
// 用假的 target 打桩，确认走到正确的分支，且绝不直接 append 表面序列。
import fs from 'node:fs'

const src = fs.readFileSync(process.argv[2], 'utf8')

// 剥掉模块依赖，只取 deliver 函数体来跑
const start = src.indexOf('function deliver(')
if (start < 0) { console.error('找不到 deliver'); process.exit(1) }
// 配平大括号取出完整函数
let depth = 0
let end = -1
let seenBody = false
for (let i = start; i < src.length; i += 1) {
  const c = src[i]
  if (c === '{') { depth += 1; seenBody = true }
  else if (c === '}') { depth -= 1; if (seenBody && depth === 0) { end = i + 1; break } }
}
const fnSrc = src.slice(start, end)
console.log('已取出 deliver：', fnSrc.split('\n').length, '行')

// 打桩
const calls = []
const makeAgent = (status, hasSteer = true) => {
  const agent = {
    status,
    followup: (m) => calls.push({ op: 'followup', status }),
    session: { append: (...a) => calls.push({ op: 'APPEND-SURFACE', args: a[0] }) },
  }
  if (hasSteer) agent.steer = (m) => calls.push({ op: 'steer', status })
  return agent
}

let current = null
const childOf = () => current
const createUserMessage = (x) => ({ id: 'm1', ...x })
const ctx = { logger: { warn: (m) => calls.push({ op: 'warn', m }) } }
const store = {}

const deliver = new Function('childOf', 'createUserMessage', `${fnSrc}; return deliver`)(childOf, createUserMessage)

const cases = [
  { name: '空闲 → followup（起一轮）', agent: makeAgent('idle'), expect: 'followup' },
  { name: '在跑 → steer（next-step，step 边界并入）', agent: makeAgent('running'), expect: 'steer' },
  { name: '老版本无 steer → 退回 followup', agent: makeAgent('running', false), expect: 'followup' },
]

let failed = 0
for (const c of cases) {
  calls.length = 0
  current = c.agent
  const ok = deliver(ctx, store, 'x', { text: 'hi', source: { kind: 'test' } })
  const ops = calls.map((x) => x.op)
  const got = ops[0]
  const surfaceAppend = ops.includes('APPEND-SURFACE')
  const pass = ok === true && got === c.expect && !surfaceAppend
  if (!pass) failed += 1
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${c.name}  实际=${got}  直接写表面=${surfaceAppend}`)
}

// 目标不存在
calls.length = 0
current = undefined
const ok = deliver(ctx, store, 'x', { text: 'hi', source: { kind: 'test' } })
const pass = ok === false && calls[0]?.op === 'warn'
if (!pass) failed += 1
console.log(`${pass ? 'PASS' : 'FAIL'}  目标不在本进程 → 返回 false 并告警`)

console.log(failed === 0 ? '\n全部通过' : `\n${failed} 项失败`)
process.exit(failed === 0 ? 0 : 1)
