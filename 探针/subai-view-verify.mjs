import { DatabaseSync } from 'node:sqlite'
import os from 'node:os'

const db = new DatabaseSync(os.homedir() + '/.dsh/subai/subai.db')
console.log(db.prepare("select sql from sqlite_master where name='session_log'").get().sql)
const row = db.prepare('select events from session_log where sid=?').get('session-b93479eb-6078-41a7-a25f-c1e90bae8d5f')
const arr = JSON.parse(row.events)
console.log('数组长度', arr.length, '严格升序?', arr.every((e, i) => e.seq === i), '首', arr[0].type, arr[0].seq, '尾', arr.at(-1).type, arr.at(-1).seq)
