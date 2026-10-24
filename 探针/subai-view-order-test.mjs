import { DatabaseSync } from 'node:sqlite'
import os from 'node:os'

const db = new DatabaseSync(os.homedir() + '/.dsh/subai/subai.db')

// 1) 带 ORDER BY 的视图，直接 SELECT *（模拟 GUI 点开）
db.exec("DROP VIEW IF EXISTS t_ordered")
db.exec(`CREATE VIEW t_ordered AS SELECT sid, seq, type FROM session_events ORDER BY sid, seq`)
const rows1 = db.prepare('select sid, seq from t_ordered').all()
let ordered1 = true
for (let i = 1; i < rows1.length; i += 1) {
  const a = rows1[i - 1], b = rows1[i]
  if (a.sid > b.sid || (a.sid === b.sid && a.seq > b.seq)) ordered1 = false
}
console.log('视图内 ORDER BY，SELECT * 是否有序:', ordered1, ' 行数', rows1.length)
console.log('前 3 行:', rows1.slice(0, 3).map((r) => `${r.sid.slice(-6)}#${r.seq}`).join(' '))

// 2) 不带 ORDER BY 的视图（现在的 session_events）
const rows2 = db.prepare('select sid, seq from session_events').all()
let ordered2 = true
for (let i = 1; i < rows2.length; i += 1) {
  const a = rows2[i - 1], b = rows2[i]
  if (a.sid > b.sid || (a.sid === b.sid && a.seq > b.seq)) ordered2 = false
}
console.log('无 ORDER BY 的视图，SELECT * 是否有序:', ordered2)

// 3) 单会话过滤 + LIMIT（GUI 常见做法）
const rows3 = db.prepare("select seq from session_events where sid=? limit 5").all('session-32ef3db8-72df-49ec-bb3c-578490ec6297')
console.log('单会话 LIMIT 5 的 seq:', rows3.map((r) => r.seq).join(','))

db.exec('DROP VIEW t_ordered')
