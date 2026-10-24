// 验证：steer 的消息在 step 边界并入 => 模型看到的顺序合法
// 依据官方 Inbox.claim(): 只取 next-step（+ 至多一条 next-turn），
// 而 preStep 是每个 step 开头调用，所以消息一定落在上一步工具结果之后。
import fs from 'node:fs'

const src = fs.readFileSync(process.argv[2], 'utf8')
const lines = src.split('\n')

function show(from, to, label) {
  console.log(`\n===== ${label} =====`)
  for (let i = from - 1; i < to && i < lines.length; i += 1) {
    console.log(`${String(i + 1).padStart(4)}  ${lines[i]}`)
  }
}

// 1) Inbox 的两级结构与 claim 顺序
show(78, 110, 'Inbox: nextSte === / next-turn / claim()')
// 2) send/steer/followup 的分派
show(798, 814, 'send / followup / steer / inject')
// 3) preStep 在 step 边界 claim
show(903, 910, 'preStep 调用 inbox.claim')
