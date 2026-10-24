-- 树上下文库 · 最终形状（日志一张表 + 每个会话一张视图）
--
-- 目标：不知情的人打开这个库，应该立刻看出"这是多个会话的归档"。
--
-- 他看到的：
--   tasks              元数据表：任务内容、父、从第几条 fork、对应会话、视图名
--   events             日志表：所有会话的事件，一行对一行（内部存法，随便看）
--   s_<任务 id>         每个会话一张视图，查它就是查这个会话拼好的完整日志
--   v_archive          目录：一行一个会话，带人话描述
--   v_log              程序用：所有会话拼好的日志（带 task_id）
--   v_event            人看的：seq + 事件类型 + 前 200 字
--
-- 只存每个会话自己新增的行（seq >= fork_at）；前缀属于父会话，视图负责拼。

PRAGMA journal_mode = WAL;
PRAGMA page_size = 4096;

CREATE TABLE IF NOT EXISTS tasks (
  id          TEXT    PRIMARY KEY,            -- 任务/节点 id
  title       TEXT,                           -- 任务标题
  body        TEXT,                           -- 计划正文（不可变）
  plan_id     TEXT,                           -- 属于哪份计划
  parent      TEXT,                           -- 父任务（根为 NULL）
  fork_at     INTEGER NOT NULL DEFAULT 0,     -- 从父任务的第几条 fork
  session_id  TEXT    NOT NULL,               -- 对应的会话
  view_name   TEXT    NOT NULL,               -- 这个会话的视图名（s_<任务 id>）
  created_at  INTEGER NOT NULL
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS tasks_parent ON tasks(parent);
CREATE INDEX IF NOT EXISTS tasks_session ON tasks(session_id);

-- 所有会话的日志都在这一张表里
CREATE TABLE IF NOT EXISTS events (
  session_id TEXT    NOT NULL,
  seq        INTEGER NOT NULL,
  line       TEXT    NOT NULL,                -- jsonl 原文
  PRIMARY KEY (session_id, seq)
) WITHOUT ROWID;

-- ── 目录：一行一个会话，带人话 ─────────────────────────────────────────
CREATE VIEW IF NOT EXISTS v_archive AS
SELECT
  t.id AS task,
  t.title AS title,
  t.session_id AS session,
  t.parent AS parent,
  t.fork_at AS fork_at,
  t.view_name AS view_name,
  (SELECT COUNT(*) FROM events e WHERE e.session_id = t.session_id AND e.seq >= t.fork_at) AS own_rows,
  (SELECT COUNT(*) FROM v_log l WHERE l.task_id = t.id) AS total_rows,
  CASE
    WHEN t.parent IS NULL THEN '根会话（没有从别处继承）'
    ELSE '从任务 ' || t.parent || ' 的第 ' || t.fork_at || ' 条之后接上（前 ' || t.fork_at || ' 行在父任务里）'
  END AS description
FROM tasks t;

-- ── 所有会话拼好的日志（程序用） ───────────────────────────────────────
CREATE VIEW IF NOT EXISTS v_log AS
WITH RECURSIVE up(root, node, from_seq, until_seq) AS (
  SELECT id, id, fork_at, 9223372036854775807 FROM tasks
  UNION ALL
  SELECT up.root, p.id, p.fork_at, up.from_seq
    FROM up
    JOIN tasks c ON c.id = up.node
    JOIN tasks p ON p.id = c.parent
)
SELECT up.root AS task_id, e.seq AS seq, e.line AS line
  FROM up
  JOIN events e
    ON e.session_id = (SELECT session_id FROM tasks WHERE id = up.node)
   AND e.seq >= up.from_seq
   AND e.seq < up.until_seq
 ORDER BY up.root, e.seq;

-- ── 人看的版本 ─────────────────────────────────────────────────────────
CREATE VIEW IF NOT EXISTS v_event AS
SELECT
  session_id,
  seq,
  json_extract(line, '$.type') AS type,
  substr(line, 1, 200) AS preview
FROM events;

-- ── 每个会话一张视图 ───────────────────────────────────────────────────
-- 这张不是固定的：store.cjs 每 import 一个会话就建一张，例如
--
--   CREATE VIEW "s_n1" AS
--   WITH RECURSIVE up(node, from_seq, until_seq) AS (
--     SELECT id, fork_at, 9223372036854775807 FROM tasks WHERE id = 'n1'
--     UNION ALL
--     SELECT p.id, p.fork_at, up.from_seq
--       FROM up JOIN tasks c ON c.id = up.node JOIN tasks p ON p.id = c.parent
--   )
--   SELECT e.seq AS seq, e.line AS line
--     FROM up JOIN events e ON e.session_id = (SELECT session_id FROM tasks WHERE id = up.node)
--    WHERE e.seq >= up.from_seq AND e.seq < up.until_seq
--    ORDER BY e.seq;
--
-- 于是"查某个会话"就是"查那张视图"，和在 events 里翻没有关系。
