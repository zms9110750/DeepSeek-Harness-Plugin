import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'

const file = 'X:/temp/dsh/探针/subai-view-proto.db'
fs.rmSync(file, { force: true })
const db = new DatabaseSync(file)
console.log('sqlite', db.prepare('select sqlite_version() v').get().v)

db.exec(`
CREATE TABLE sessions (
  id TEXT PRIMARY KEY, parent TEXT, cut INTEGER NOT NULL DEFAULT 0,
  header TEXT NOT NULL
) STRICT;
CREATE TABLE events (
  sid TEXT NOT NULL, seq INTEGER NOT NULL, type TEXT NOT NULL, json TEXT NOT NULL,
  PRIMARY KEY (sid, seq)
) WITHOUT ROWID;

CREATE VIEW session_events AS
WITH RECURSIVE
  use(root, src, lo, hi, depth) AS (
      SELECT id, id, cut, 9223372036854775807, 0 FROM sessions
    UNION ALL
      SELECT u.root, p.id, p.cut, u.lo, u.depth + 1
      FROM use u
      JOIN sessions c ON c.id = u.src
      JOIN sessions p ON p.id = c.parent
      WHERE u.depth < 64
  )
SELECT u.root AS sid, e.seq AS seq, e.type AS type, e.json AS json
FROM use u
JOIN events e ON e.sid = u.src AND e.seq >= u.lo AND e.seq < u.hi;

CREATE VIEW session_log AS
SELECT s.id AS sid, s.cut AS cut, s.header AS header,
  (SELECT json_group_array(json(v.json))
     FROM (SELECT json FROM session_events v WHERE v.sid = s.id ORDER BY seq) AS v) AS events
FROM sessions s;
`)

const ins = db.prepare('insert into events(sid,seq,type,json) values (?,?,?,?)')
const mk = (sid, seq, tag) => ins.run(sid, seq, 'text', JSON.stringify({ seq, tag }))

// A：40 行
db.prepare('insert into sessions(id,parent,cut,header) values (?,?,?,?)').run('A', null, 0, '{"id":"A"}')
for (let i = 0; i < 40; i += 1) mk('A', i, `A${i}`)

// B：fork A at 19（cut = 20），自己的行从 20 开始
db.prepare('insert into sessions(id,parent,cut,header) values (?,?,?,?)').run('B', 'A', 20, '{"id":"B"}')
mk('B', 20, 'marker')
mk('B', 21, 'B21')
mk('B', 22, 'B22')

// C：fork B at 21（cut = 22），自己的行从 22 开始 —— 验证跨两层
db.prepare('insert into sessions(id,parent,cut,header) values (?,?,?,?)').run('C', 'B', 22, '{"id":"C"}')
mk('C', 22, 'Cmarker')
mk('C', 23, 'C23')

for (const sid of ['A', 'B', 'C']) {
  const rows = db.prepare('select seq, json from session_events where sid=? order by seq').all(sid)
  console.log(sid, 'view rows:', rows.length, 'first/last seq:', rows[0]?.seq, rows.at(-1)?.seq, 'tags:', rows.map((r) => JSON.parse(r.json).tag).slice(0, 3).join(','), '...', rows.map((r) => JSON.parse(r.json).tag).slice(-2).join(','))
}
const log = db.prepare('select events from session_log where sid=?').get('C')
const arr = JSON.parse(log.events)
console.log('session_log C:', Array.isArray(arr), arr.length, 'first', arr[0], 'last', arr.at(-1))
console.log('stored rows:', db.prepare('select sid,count(*) n from events group by sid').all())
