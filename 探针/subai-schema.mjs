import { DatabaseSync } from 'node:sqlite'
import os from 'node:os'

const db = new DatabaseSync(os.homedir() + '/.dsh/subai/subai.db')
for (const row of db.prepare("select type, name, sql from sqlite_master where name in ('sessions','events','session_events','session_log') order by type, name").all()) {
  console.log('====', row.type, row.name)
  console.log(row.sql)
}
console.log('\n==== 当前数据')
for (const s of db.prepare('select id, parent, cut, label, status, revision from sessions').all()) {
  const own = db.prepare('select count(*) n, min(seq) lo, max(seq) hi from events where sid=?').get(s.id)
  const view = db.prepare('select count(*) n from session_events where sid=?').get(s.id)
  console.log(`${s.id}  parent=${s.parent ?? '-'}  cut=${s.cut}  status=${s.status}  own=${own.n}(${own.lo}..${own.hi})  view=${view.n}  ${s.label}`)
}
console.log('\n==== events 一行样例')
const row = db.prepare('select sid, seq, type, substr(json,1,120) j from events order by seq limit 1').get()
console.log(row)
