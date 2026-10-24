// 反向验证：正常场景下不能误判为「有未完成调用」，否则投递会被不必要地延后
function pendingAfter(events) {
  const pending = new Set()
  for (const event of events) {
    switch (event.type) {
      case 'turn/start':
      case 'turn/end':
      case 'step/end':
        pending.clear()
        break
      case 'assistant/message':
        for (const block of event.data?.message?.content ?? []) {
          if (block.type === 'tool-call') pending.add(block.id)
        }
        break
      case 'tool/result': {
        const callId = event.data?.message?.source?.callId
        if (callId !== undefined) pending.delete(callId)
        break
      }
      default:
        break
    }
  }
  return pending
}

const msg = (content) => ({ type: 'assistant/message', data: { message: { content } } })
const result = (id) => ({ type: 'tool/result', data: { message: { source: { callId: id } } } })
const user = () => ({ type: 'user/message', data: { source: { kind: 'user' } } })

const cases = [
  {
    name: '已完成的工具调用之间（可以 append）',
    events: [
      { type: 'turn/start' }, msg([{ type: 'tool-call', id: 'a' }]), result('a'),
      user(), msg([{ type: 'text', text: '完成' }]),
    ],
    expect: false,
  },
  {
    name: '工具调用与结果之间（必须排队，旧行为会插进去）',
    events: [{ type: 'turn/start' }, msg([{ type: 'tool-call', id: 'a' }])],
    expect: true,
  },
  {
    name: 'step 已结束但调用没回（边界清空，按官方语义视为未挂起）',
    events: [{ type: 'turn/start' }, msg([{ type: 'tool-call', id: 'a' }]), { type: 'step/end' }],
    expect: false,
  },
  {
    name: '多个调用只回了一半',
    events: [msg([{ type: 'tool-call', id: 'a' }, { type: 'tool-call', id: 'b' }]), result('a')],
    expect: true,
  },
  {
    name: '空日志',
    events: [],
    expect: false,
  },
]

let failed = 0
for (const c of cases) {
  const got = pendingAfter(c.events).size > 0
  const ok = got === c.expect
  if (!ok) failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.name}  期望=${c.expect} 实际=${got}`)
}
console.log(failed === 0 ? '\n全部通过' : `\n${failed} 项失败`)
process.exit(failed === 0 ? 0 : 1)
