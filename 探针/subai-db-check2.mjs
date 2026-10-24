import { DatabaseSync } from 'node:sqlite'
import os from 'node:os'
import fs from 'node:fs'

const dir = os.homedir() + '/.dsh/subai'
const db = new DatabaseSync(`${dir}/subai.db`)
console.log('文件:', fs.readdirSync(dir).map((f) => `${f} ${fs.statSync(`${dir}/${f}`).size}B`).join(' | '))
console.log('视图:', db.prepare("select name from sqlite_master where type='view'").all().map((r) => r.name).join(','))

const stored = db.prepare('select sid, count(*) n, min(seq) lo, max(seq) hi from events group by sid').all()
console.log('events 里实际存的行:')
for (const r of stored) console.log(' ', r.sid, 'n=', r.n, `${r.lo}..${r.hi}`)

for (const s of db.prepare('select id, parent, cut from sessions').all()) {
  const v = db.prepare('select count(*) n, min(seq) lo, max(seq) hi from session_events where sid=?').get(s.id)
  console.log('视图', s.id, 'parent=', s.parent, 'cut=', s.cut, '→ rows', v.n, `${v.lo}..${v.hi}`)
}

const log = db.prepare('select events from session_log where sid=?').get('session-32ef3db8-72df-49ec-bb3c-578490ec6297')
const arr = JSON.parse(log.events)
console.log('session_log 数组长度', arr.length, '第 0 条 type/seq', arr[0].type, arr[0].seq, '最后一条', arr.at(-1).type, arr.at(-1).seq)
const marker = arr.find((e) => e.type === 'session/end-seed')
console.log('marker:', marker.seq, JSON.stringify(marker.data), '  16 号事件 type:', arr[16].type)
