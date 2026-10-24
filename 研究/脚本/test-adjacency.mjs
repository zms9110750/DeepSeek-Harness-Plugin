// 用真实库数据验证 adjacency 修复：子 → 父 应放行，父子表里没有父会话也不能挡
import { DatabaseSync } from 'node:sqlite'

const db = new DatabaseSync(process.argv[2])

// 复刻修复后的 adjacency
function adjacency(fromId, toId) {
  const get = (id) => db.prepare('SELECT * FROM sessions WHERE id = ?').get(id)
  const target = get(toId)
  if (target !== undefined && target.owner === fromId) return { ok: true, how: '我是它的运行期父' }
  const mine = get(fromId)
  if (mine !== undefined && (mine.owner === toId || mine.parent === toId)) {
    return { ok: true, how: mine.owner === toId ? '它是我的运行期父' : '它是我的血缘父' }
  }
  if (target === undefined) return { ok: false, reason: 'not a subai session and not my parent' }
  return { ok: false, reason: 'not directly adjacent' }
}

// 修复前的行为，用于对照
function adjacencyOld(fromId, toId) {
  const get = (id) => db.prepare('SELECT * FROM sessions WHERE id = ?').get(id)
  const target = get(toId)
  if (target === undefined) return { ok: false, reason: '"%s" is not a subai session'.replace('%s', toId) }
  if (target.owner === fromId) return { ok: true }
  const mine = get(fromId)
  if (mine !== undefined && mine.owner === toId) return { ok: true }
  return { ok: false, reason: 'not directly adjacent' }
}

const cases = [
  {
    name: '子 → 父（父不在 subai 表，本次失败的真实场景）',
    from: 'session-073ce3a8-2065-4116-9a78-c8b530e8db0c',
    to: 'session-cfcf6d53-6d3e-4ea5-ab5c-f23f71178dc1',
    expect: true,
  },
  {
    name: '父 → 子（运行期父给子发消息）',
    from: 'session-cfcf6d53-6d3e-4ea5-ab5c-f23f71178dc1',
    to: 'session-073ce3a8-2065-4116-9a78-c8b530e8db0c',
    expect: true,
  },
  {
    name: '子 → 无关会话（应拒绝）',
    from: 'session-073ce3a8-2065-4116-9a78-c8b530e8db0c',
    to: 'session-14234f87-3133-4fb4-88d7-21cfdb84a5c1',
    expect: false,
  },
]

let failed = 0
for (const c of cases) {
  const now = adjacency(c.from, c.to)
  const old = adjacencyOld(c.from, c.to)
  const pass = now.ok === c.expect
  if (!pass) failed += 1
  const flip = old.ok !== now.ok ? '  ← 行为已改变' : ''
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${c.name}`)
  console.log(`      修复前: ${old.ok ? '放行' : '拒绝'} ${old.reason ?? ''}`)
  console.log(`      修复后: ${now.ok ? `放行（${now.how}）` : `拒绝 ${now.reason}`}${flip}`)
}
console.log(failed === 0 ? '\n全部通过' : `\n${failed} 项失败`)
process.exit(failed === 0 ? 0 : 1)
