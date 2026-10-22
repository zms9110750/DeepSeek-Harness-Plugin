CREATE TABLE sessions(id TEXT PRIMARY KEY, parent TEXT, at_seq INTEGER, plan_id TEXT);
CREATE TABLE events(session_id TEXT, seq INTEGER, line TEXT, PRIMARY KEY(session_id,seq));
INSERT INTO sessions VALUES('02-04', NULL, 4821, 'p13'), ('02-04-06','02-04',99,'p14');
INSERT INTO events VALUES
 ('02-04',0,'{"type":"user/message","t":"root tail 1"}'),
 ('02-04',1,'{"type":"assistant/message","t":"root tail 2"}'),
 ('02-04-06',0,'{"type":"user/message","t":"leaf asks"}'),
 ('02-04-06',1,'{"type":"assistant/message","t":"leaf answers"}');
WITH RECURSIVE chain(id, at_seq, depth) AS (
  SELECT '02-04-06', NULL, 0
  UNION ALL
  SELECT s.parent, s.at_seq, c.depth+1 FROM chain c JOIN sessions s ON s.id=c.id WHERE s.parent IS NOT NULL
)
SELECT c.depth, c.id, e.seq, e.line FROM chain c JOIN events e ON e.session_id=c.id ORDER BY c.depth DESC, e.seq;
