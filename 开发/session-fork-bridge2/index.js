/**
 * Session fork bridge — let the UI's fork button work on a session the reader
 * refuses to interpret.
 *
 * The controller forks by observing the source first; an unknown event type
 * makes that observation throw ("fork source unavailable"). This plugin wraps
 * the live `sessionController.fork` instance method: it calls the original, and
 * only when that failure is the unknown-event refusal does it
 *
 *   1. copy the source log to a NEW session id, marking every unknown,
 *      non-ignorable event `ignorable: true` (sequence numbers are preserved, so
 *      the requested `atSeq` boundary still means the same event),
 *   2. retry the original fork against the copy,
 *   3. leave the copy in place as the fork's parent.
 *
 * The source file is never modified. Anything that is not an unknown event —
 * broken JSON, a malformed first frame, a missing session — is rethrown as-is.
 *
 * @module @local/session-fork-bridge
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { KNOWN_SESSION_EVENT_TYPES } from './known.js';

export const name = 'session-fork-bridge2';

export const inject = ['sessionController'];

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
export function locate(id) {
  if (typeof id !== 'string' || !/^[\w.-]+$/u.test(id)) return undefined;
  for (const bucket of fs.readdirSync(ROOT, { withFileTypes: true })) {
    if (!bucket.isDirectory()) continue;
    const file = path.join(ROOT, bucket.name, id, 'session.v4.jsonl.zstd');
    if (fs.existsSync(file)) return file;
  }
  return undefined;
}

/**
 * Copy one log into a new session id, marking unknown non-ignorable events.
 * @returns {{ newId: string, dir: string, events: number, marked: number }}
 */
export function repairCopy(file) {
  const raw = fs.readFileSync(file);
  const texts = splitFrames(raw).map(([s, e]) => zlib.zstdDecompressSync(raw.subarray(s, e)).toString('utf8'));
  if (!/^[^\n]*\n$/u.test(texts[0])) throw new Error('首帧不是「恰好一行 header」，与当前格式不符，拒绝复制');
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

/** Whether one fork failure is the reader refusing an unknown event type. */
export function isUnknownEventFailure(error) {
  const text = String(error?.message ?? error);
  return /unknown to this harness|contains event type|SessionFormatUnsupported|fork source unavailable/u.test(text);
}

export function apply(ctx) {
  // Cordis tracks this effect: unloading the plugin runs the disposer and puts
  // the original method back. A bare assignment would survive unload and leave
  // a wrapper bound to a disposed context — forks would then fail for everyone.
  ctx.effect(() => {
    const controller = ctx.sessionController;
    const original = controller.fork;
    if (typeof original !== 'function') throw new Error('session-fork-bridge2: sessionController.fork is not callable');

    const wrapped = async function bridgedFork(request) {
      try {
        return await original.call(this, request);
      } catch (error) {
        if (!isUnknownEventFailure(error)) throw error;
        const file = locate(request?.sessionId);
        if (file === undefined) throw error;
        const repaired = repairCopy(file);
        if (repaired.marked === 0) throw error;
        return await original.call(this, { ...request, sessionId: repaired.newId });
      }
    };

    controller.fork = wrapped;
    return () => {
      // Restore only our own wrapper: another plugin may have wrapped it later.
      if (controller.fork === wrapped) controller.fork = original;
    };
  });

  /**
   * 第二个补丁：会话摘要里带不动的值。
   *
   * 宿主创建会话之后要发 `api-session/added` 给界面，发之前过一道 `assertJsonArgs`，
   * 要求参数是**无损 JSON**。参数是 `listState.summaryFor(session)`，里面带着
   * `projections`。
   *
   * 分叉出来的会话，投影是从父的**活事件对象**折叠的（`buildForkSeed` 的注释写着
   * "retaining the source event objects"），活对象里有类实例、Date 之类，检查直接拒：
   *   forwarded host event "api-session/added" argument 0 is not lossless JSON data
   * 内置 `subagent_fork` 同样中招，所以不是调用方的问题。
   *
   * 这里不碰 fork 本身——fork 已经成功了，炸的是"报告新会话"。所以只在摘要出站前
   * 把它洗成纯 JSON。这一层在会话内部，插件只能从外面裹。
   */
  ctx.effect(() => {
    const listState = ctx.sessionController?.listState;
    const original = listState?.summaryFor;
    if (typeof original !== 'function') return () => {};

    const wrapped = function cleanSummaryFor(session) {
      const summary = original.call(this, session);
      try {
        // 往返一次：去掉 undefined、把类实例摊平成普通对象、Date 变字符串。
        return JSON.parse(JSON.stringify(summary));
      } catch {
        return summary;
      }
    };

    listState.summaryFor = wrapped;
    return () => {
      if (listState.summaryFor === wrapped) listState.summaryFor = original;
    };
  });
}
