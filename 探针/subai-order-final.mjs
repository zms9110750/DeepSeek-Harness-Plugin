import { DatabaseSync } from 'node:sqlite'
import os from 'node:os'

const db = new DatabaseSync(os.homedir() + '/.dsh/subai/subai.db')

function check(label, rows) {
  let ok = true
  for (let i = 1; i < rows.length; i += 1) {
    const a = rows[i - 1], b = rows[i]
    if (a.sid > b.sid || (a.sid === b.sid && a.seq > b.seq)) ok = false
  }
  console.log(label, ok ? '有序 ✔' : '无序 ✘', `(${rows.length} 行)`)
  console.log('  前 3:', rows.slice(0, 3).map((r) => `${r.sid.slice(-6)}#${r.seq}`).join(' '))
}

// 模拟 GUI：点开视图，直接 SELECT *
check('SELECT * FROM session_events', db.prepare('select sid, seq from session_events').all())

// 模拟 TS：只筛一个会话，不写 ORDER BY
const one = db.prepare('select sid, seq, type from session_events where sid=?').all('session-32ef3db8-72df-49ec-bb3c-578490ec6297')
check('WHERE sid=?', one)
console.log('  首/尾:', one[0].seq, '/', one.at(-1).seq, ' 严格连续:', one.every((r, i) => r.seq === i))

// GUI 的翻页写法
const page = db.prepare('select seq from session_events where sid=? limit 5 offset 10').all('session-32ef3db8-72df-49ec-bb3c-578490ec6297')
console.log('LIMIT 5 OFFSET 10 →', page.map((r) => r.seq).join(','))

// 一次拿整份
const log = JSON.parse(db.prepare('select events from session_log where sid=?').get('session-32ef3db8-72df-49ec-bb3c-578490ec6297').events)
console.log('session_log 数组:', log.length, '严格升序:', log.every((e, i) => e.seq === i), '首/尾:', log[0].seq, '/', log.at(-1).seq)
