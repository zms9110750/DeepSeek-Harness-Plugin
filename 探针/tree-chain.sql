CREATE TABLE sessions(id TEXT PRIMARY KEY, parent TEXT, at_seq INTEGER, plan_id TEXT);
CREATE TABLE events(session_id TEXT, seq INTEGER, line TEXT, PRIMARY KEY(session_id,seq));

-- A 从根的第 4821 条接上；A-1 从 A 的第 2 条之后接上
INSERT INTO sessions VALUES ('A', NULL, 4821, 'p13'), ('A-1', 'A', 2, 'p14');

INSERT INTO events VALUES
 ('A',0,'{"t":"A.0"}'), ('A',1,'{"t":"A.1"}'),
 ('A',2,'{"t":"A.2 分叉之后才产生的"}'), ('A',3,'{"t":"A.3 同上"}'),
 ('A-1',0,'{"t":"A-1.0"}'), ('A-1',1,'{"t":"A-1.1"}');
