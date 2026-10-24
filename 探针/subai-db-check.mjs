import { DatabaseSync } from 'node:sqlite'
import os from 'node:os'
import fs from 'node:fs'

const dir = os.homedir() + '/.dsh/subai'
console.log('目录内容:', fs.readdirSync(dir).map((f) => `${f} ${fs.statSync(`${dir}/${f}`).size}B`).join(' | '))

const db = new DatabaseSync(`${dir}/subai.db`)
console.log('表:', db.prepare("select name from sqlite_master where type='table'").all().map((r) => r.name).join(','))

const src = 'session-00689b35-7a85-489d-ba81-0fd0107e5cf2'
const dst = 'session-32ef3db8-72df-49ec-bb3c-578490ec6297'

const a = db.prepare('select seq,json from events where sid=? and seq<=15 order by seq').all(src)
const b = db.prepare('select seq,json from events where sid=? and seq<=15 order by seq').all(dst)
let same = 0
for (let i = 0; i < Math.min(a.length, b.length); i += 1) if (a[i].json === b[i].json) same += 1
console.log('源前缀行数', a.length, '分叉子同段行数', b.length, '逐字节相同', same)
console.log('分叉子 cut 之后的行数', db.prepare('select count(*) n from events where sid=? and seq>=16').get(dst).n)
console.log('全库行数', db.prepare('select count(*) n from events').get().n, '会话数', db.prepare('select count(*) n from sessions').get().n)
