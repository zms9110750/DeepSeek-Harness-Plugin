// Repair one DSH v4 session log: mark every unknown, non-ignorable event
// `ignorable: true` so the harness can load the history again.
//
// The file is a JSONL document stored as a concatenation of independent
// zstd frames (header frame first, then one frame per durable append batch).
// The writer applies a content checksum; frames are rewritten only when they
// contain a line this build does not know. Every other frame keeps its
// original bytes.
//
//   node repair-session-log.mjs <session.v4.jsonl.zstd> [--dry]
//
// Exit codes: 0 nothing to do, 10 repaired, 1 usage/io, 3 frame structure,
//             5 invalid JSON, 9 verification failed (original restored).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';

const KNOWN = new Set([
  'agent-preset/selected', 'agent/inbox/spliced', 'approval/asked', 'approval/decided',
  'approval/policy', 'assistant/attempt', 'assistant/message', 'command/done', 'command/run',
  'compaction/end', 'compaction/prune', 'compaction/start', 'compaction/summary',
  'deliverables/presented', 'developer/message', 'feedback/message-delete',
  'feedback/message-put', 'feedback/record', 'goal/change', 'hook/invoked', 'hook/result',
  'image/offload', 'job/registered', 'job/settled', 'llm/retry', 'llm/retry-started',
  'model/selection', 'permission/preset', 'plan/mode', 'request/context', 'request/header',
  'sandbox/mode', 'schedule/change', 'session-log-deepseek/delivery-accepted',
  'session/end-seed', 'session/title', 'session/title-llm-request', 'step/end', 'step/start',
  'subagent/catalog', 'subagent/descriptor', 'subagent/model-selection-policy',
  'system/message', 'team/member', 'team/message/delivered', 'team/message/queued',
  'team/task', 'todo/write', 'tool-workflow/agent-end', 'tool-workflow/agent-start',
  'tool-workflow/run-end', 'tool-workflow/run-start', 'tool/call', 'tool/ptc-dispatch',
  'tool/ptc-dispatch-start', 'tool/result', 'turn/end', 'turn/start', 'user/message',
  'web/deepseek-search-llm-request', 'working-directory/change', 'workspace/changes',
]);

const ZSTD_MAGIC = 0xfd2fb528;
const CHECKSUM = zlib.constants.ZSTD_c_checksumFlag;
const COMPRESS_OPTS = typeof CHECKSUM === 'number' ? { params: { [CHECKSUM]: 1 } } : undefined;
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

const file = process.argv[2];
const dry = process.argv.includes('--dry');
if (!file) {
  console.error('用法：repair-session-log.mjs <session.v4.jsonl.zstd> [--dry]');
  process.exit(1);
}

/** Walk each zstd frame; an incomplete final frame is reported, not decoded. */
function splitFrames(buf) {
  const frames = [];
  let pos = 0;
  while (pos < buf.length) {
    const start = pos;
    if (buf.length - pos < 4) return { frames, tornStart: start };
    if (buf.readUInt32LE(pos) !== ZSTD_MAGIC) throw new Error(`第 ${pos} 字节不是 zstd 帧头`);
    const descriptor = buf[pos + 4];
    if ((descriptor & 24) !== 0) throw new Error(`第 ${pos + 4} 字节帧头的保留位非零`);
    const fcsFlag = descriptor >> 6;
    const singleSegment = (descriptor >> 5) & 1;
    const checksum = (descriptor >> 2) & 1;
    const dictFlag = descriptor & 3;
    let p = pos + 5;
    if (!singleSegment) p += 1;
    p += [0, 1, 2, 4][dictFlag];
    p += fcsFlag === 0 ? (singleSegment ? 1 : 0) : [0, 2, 4, 8][fcsFlag];
    if (p > buf.length) return { frames, tornStart: start };
    for (;;) {
      if (buf.length - p < 3) return { frames, tornStart: start };
      const header = buf[p] | (buf[p + 1] << 8) | (buf[p + 2] << 16);
      const last = header & 1;
      const type = (header >> 1) & 3;
      const size = (header >> 3) & 0x1fffff;
      if (type === 3) throw new Error(`第 ${p} 字节出现保留块类型`);
      p += 3 + (type === 1 ? 1 : size);
      if (p > buf.length) return { frames, tornStart: start };
      if (last) break;
    }
    if (checksum) {
      if (buf.length - p < 4) return { frames, tornStart: start };
      p += 4;
    }
    frames.push({ start, end: p });
    pos = p;
  }
  return { frames };
}

let raw;
try {
  raw = fs.readFileSync(file);
} catch (error) {
  console.error(`读不到文件：${file}（${error.message}）`);
  process.exit(1);
}

let walked;
try {
  walked = splitFrames(raw);
} catch (error) {
  console.error(`结构异常：${error.message}`);
  process.exit(3);
}
const frames = walked.frames;
const tornBytes = walked.tornStart === undefined ? 0 : raw.length - walked.tornStart;

let texts;
try {
  texts = frames.map((frame) => zlib.zstdDecompressSync(raw.subarray(frame.start, frame.end)).toString('utf8'));
} catch (error) {
  console.error(`解压失败：${error.message}`);
  process.exit(3);
}

if (texts.length === 0) {
  console.error('文件里没有完整的 zstd 帧。');
  process.exit(3);
}
if (!/^[^\n]*\n$/u.test(texts[0])) {
  console.error('首帧不是「恰好一行 header」，与当前格式不符，拒绝改写。');
  process.exit(3);
}
for (let i = 0; i < texts.length; i += 1) {
  if (!texts[i].endsWith('\n')) {
    console.error(`第 ${i} 帧不以换行结尾，与当前格式不符，拒绝改写。`);
    process.exit(3);
  }
}

const lines = texts.join('').split('\n');
lines.pop();
const events = [];
for (let i = 0; i < lines.length; i += 1) {
  try {
    events.push(JSON.parse(lines[i]));
  } catch (error) {
    console.error(`第 ${i} 行不是合法 JSON：${error.message}`);
    process.exit(5);
  }
}

const unknown = events
  .map((value, index) => ({ value, index }))
  .filter(({ value, index }) => index > 0
    && value && typeof value.type === 'string'
    && !KNOWN.has(value.type) && value.ignorable !== true);

console.log(`文件：${file}`);
console.log(`帧：${frames.length}${tornBytes ? `（末尾 ${tornBytes} 字节是不完整帧，将被丢弃）` : ''}，行：${lines.length}`);
if (unknown.length === 0) {
  console.log('没有需要处理的未知事件。');
  process.exit(0);
}
console.log(`未知且未标 ignorable 的事件：${unknown.length} 条`);
for (const { value } of unknown.slice(0, 20)) {
  console.log(`  seq ${value.seq}  ${value.type}`);
}
if (unknown.length > 20) console.log(`  ……另有 ${unknown.length - 20} 条`);

if (dry) {
  console.log('（--dry：只报告，不写文件）');
  process.exit(10);
}

// Session directories must keep exactly their own artifacts: the harness
// derives a session from the directory contents, and a stray backup file next
// to the log can make the session unreadable. Backups and the temp artifact
// therefore live outside the sessions tree, under ~/.dsh/session-log-backups.
const BACKUP_ROOT = path.join(os.homedir(), '.dsh', 'session-log-backups');
const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
const backup = path.join(BACKUP_ROOT, `${path.basename(path.dirname(file))}-${stamp}.zstd.bak`);
fs.mkdirSync(BACKUP_ROOT, { recursive: true });
try {
  fs.copyFileSync(file, backup, fs.constants.COPYFILE_EXCL);
} catch (error) {
  console.error(`备份失败，未改动原文件：${error.message}`);
  process.exit(1);
}
if (sha(fs.readFileSync(backup)) !== sha(raw)) {
  console.error('备份哈希与原文件不一致，未改动原文件。');
  process.exit(1);
}

let changed = 0;
let changedFrames = 0;
let lineIndex = 0;
const chunks = texts.map((text, frameIndex) => {
  let touched = false;
  const out = text.slice(0, -1).split('\n').map((line) => {
    const current = lineIndex;
    lineIndex += 1;
    if (current === 0) return line;
    const value = JSON.parse(line);
    if (typeof value.type === 'string' && !KNOWN.has(value.type) && value.ignorable !== true) {
      value.ignorable = true;
      touched = true;
      changed += 1;
      return JSON.stringify(value);
    }
    return line;
  });
  if (!touched) return raw.subarray(frames[frameIndex].start, frames[frameIndex].end);
  changedFrames += 1;
  return zlib.zstdCompressSync(Buffer.from(`${out.join('\n')}\n`, 'utf8'), COMPRESS_OPTS);
});

const packed = Buffer.concat(chunks);
const tmp = path.join(BACKUP_ROOT, `.tmp-${process.pid}-${path.basename(file)}`);
try {
  fs.writeFileSync(tmp, packed);
  fs.renameSync(tmp, file);
} catch (error) {
  try { fs.unlinkSync(tmp); } catch { /* ignore */ }
  console.error(`写回失败（${error.code || error.message}）。原文件未动，备份在：${backup}`);
  console.error('如果提示被占用，请先关掉那个会话标签或退出 Harness，再运行一次。');
  process.exit(1);
}

// Verify by decoding the written artifact again.
try {
  const after = fs.readFileSync(file);
  const afterWalked = splitFrames(after);
  const afterTexts = afterWalked.frames.map((frame) => zlib.zstdDecompressSync(after.subarray(frame.start, frame.end)).toString('utf8'));
  const afterLines = afterTexts.join('').split('\n');
  afterLines.pop();
  const afterUnknown = afterLines.slice(1).map((line) => JSON.parse(line))
    .filter((value) => typeof value.type === 'string' && !KNOWN.has(value.type) && value.ignorable !== true).length;
  const headerOk = /^[^\n]*\n$/u.test(afterTexts[0]);
  if (!headerOk || afterUnknown !== 0 || afterWalked.tornStart !== undefined || afterLines.length !== lines.length) {
    fs.copyFileSync(backup, file);
    console.error('校验未通过，已用备份还原。');
    process.exit(9);
  }
} catch (error) {
  fs.copyFileSync(backup, file);
  console.error(`校验失败（${error.message}），已用备份还原。`);
  process.exit(9);
}

console.log(`已修复：${changed} 条事件，重写 ${changedFrames} 帧；其余帧字节未动。`);
console.log(`备份：${backup}`);
process.exit(10);
