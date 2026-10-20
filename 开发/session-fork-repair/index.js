/**
 * Session fork repair — make an unreadable session readable again without
 * touching the original.
 *
 * `/fork-repair <session-id>` reads that session's log, marks every event this
 * build does not know (and that is not already ignorable) as `ignorable: true`,
 * and writes the result as a NEW session directory beside the source. The
 * source log is never modified; the new session is what you open afterwards.
 *
 * The known-type list is a vendored copy of the build's generated catalog
 * (`known.js`), because an out-of-tree plugin cannot resolve the harness copy.
 * When the harness gains new event types, refresh that file.
 *
 * @module @local/session-fork-repair
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { KNOWN_SESSION_EVENT_TYPES } from './known.js';

export const name = 'session-fork-repair';

export const inject = ['commands'];

const ZSTD_MAGIC = 0xfd2fb528;
const CHECKSUM = zlib.constants.ZSTD_c_checksumFlag;
const OPTS = typeof CHECKSUM === 'number' ? { params: { [CHECKSUM]: 1 } } : undefined;
const ROOT = path.join(os.homedir(), '.dsh', 'sessions');

function splitFrames(buf) {
  const frames = [];
  let pos = 0;
  while (pos < buf.length) {
    if (buf.readUInt32LE(pos) !== ZSTD_MAGIC) throw new Error(`第 ${pos} 字节不是 zstd 帧头`);
    const d = buf[pos + 4];
    const fcs = d >> 6;
    const single = (d >> 5) & 1;
    const checksum = (d >> 2) & 1;
    const dict = d & 3;
    let p = pos + 5 + (single ? 0 : 1) + [0, 1, 2, 4][dict] + (fcs === 0 ? (single ? 1 : 0) : [0, 2, 4, 8][fcs]);
    for (;;) {
      const h = buf[p] | (buf[p + 1] << 8) | (buf[p + 2] << 16);
      p += 3 + (((h >> 1) & 3) === 1 ? 1 : h >> 3);
      if (h & 1) break;
    }
    if (checksum) p += 4;
    frames.push([pos, p]);
    pos = p;
  }
  return frames;
}

/** Find one session artifact by id across every workspace bucket. */
function locate(id) {
  if (typeof id !== 'string' || !/^[\w.-]+$/u.test(id)) return undefined;
  for (const bucket of fs.readdirSync(ROOT, { withFileTypes: true })) {
    if (!bucket.isDirectory()) continue;
    const file = path.join(ROOT, bucket.name, id, 'session.v4.jsonl.zstd');
    if (fs.existsSync(file)) return file;
  }
  return undefined;
}

function repair(file) {
  const raw = fs.readFileSync(file);
  const texts = splitFrames(raw).map(([s, e]) => zlib.zstdDecompressSync(raw.subarray(s, e)).toString('utf8'));
  if (!/^[^\n]*\n$/u.test(texts[0])) throw new Error('首帧不是「恰好一行 header」，与当前格式不符，拒绝改写');
  const lines = texts.join('').split('\n');
  lines.pop();
  const header = JSON.parse(lines[0]);
  const events = lines.slice(1).map((line) => JSON.parse(line));

  let marked = 0;
  const out = events.map((event) => {
    if (!KNOWN_SESSION_EVENT_TYPES.has(event.type) && event.ignorable !== true) {
      marked += 1;
      return { ...event, ignorable: true };
    }
    return event;
  });

  const newId = `session-${crypto.randomUUID()}`;
  header.id = newId;
  const dir = path.join(path.dirname(path.dirname(file)), newId);
  fs.mkdirSync(dir);
  const frames = [
    zlib.zstdCompressSync(Buffer.from(`${JSON.stringify(header)}\n`, 'utf8'), OPTS),
    ...out.map((event) => zlib.zstdCompressSync(Buffer.from(`${JSON.stringify(event)}\n`, 'utf8'), OPTS)),
  ];
  fs.writeFileSync(path.join(dir, 'session.v4.jsonl.zstd'), Buffer.concat(frames));
  return { newId, dir, events: out.length, marked };
}

export function apply(ctx) {
  ctx.commands.register({
    name: 'fork-repair',
    description: '把一份读不出来的会话复制成一份干净的新会话（原文件不动）',
    input: { hint: '<session-id>', attachments: false },
    recordInput: false,
    handler({ rawInput }) {
      const id = String(rawInput ?? '').trim();
      if (id === '') return { kind: 'error', text: '用法：/fork-repair <session-id>' };
      const file = locate(id);
      if (file === undefined) return { kind: 'error', text: `找不到会话 ${id} 的日志` };
      try {
        const result = repair(file);
        return {
          kind: 'success',
          text:
            `已生成新会话 ${result.newId}\n` +
            `事件 ${result.events} 条，标为 ignorable ${result.marked} 条\n` +
            `源文件未改动：${file}\n` +
            `打开新会话前建议刷新页面。`,
        };
      } catch (error) {
        return { kind: 'error', text: `分叉修复失败：${String(error?.message ?? error)}` };
      }
    },
  });
}
