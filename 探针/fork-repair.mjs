// Fork-repair probe: copy one session log into a NEW session id, marking every
// unknown non-ignorable event as ignorable. The source file is never touched.
//
//   node fork-repair.mjs <source.../session.v4.jsonl.zstd> [--keep]
//
// Prints the new session directory and validates it with the harness's own
// validateStoredEvents. Without --keep the new directory is removed at the end
// (probe mode), so the UI does not accumulate test sessions.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

const src = process.argv[2];
const keep = process.argv.includes('--keep');
if (!src) {
  console.error('usage: node fork-repair.mjs <.../session.v4.jsonl.zstd> [--keep]');
  process.exit(2);
}

const base = 'X:/temp/dsh/探针/asar/out/dsh/node_modules/@deepseek-ai';
const { KNOWN_SESSION_EVENT_TYPES } = await import(
  pathToFileURL(`${base}/dsh-session/lib/types/known-event-types.js`).href
);
const persistence = await import(
  pathToFileURL(`${base}/dsh-session-persistence/lib/index.js`).href
);

const ZSTD_MAGIC = 0xfd2fb528;
const CHECKSUM = zlib.constants.ZSTD_c_checksumFlag;
const OPTS = typeof CHECKSUM === 'number' ? { params: { [CHECKSUM]: 1 } } : undefined;

function splitFrames(buf) {
  const frames = [];
  let pos = 0;
  while (pos < buf.length) {
    if (buf.readUInt32LE(pos) !== ZSTD_MAGIC) throw new Error(`bad magic at ${pos}`);
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

const raw = fs.readFileSync(src);
const texts = splitFrames(raw).map(([s, e]) => zlib.zstdDecompressSync(raw.subarray(s, e)).toString('utf8'));
if (!/^[^\n]*\n$/u.test(texts[0])) {
  console.error('source frame 0 is not exactly one header line');
  process.exit(3);
}
const lines = texts.join('').split('\n');
lines.pop();
const header = JSON.parse(lines[0]);
const events = lines.slice(1).map((line) => JSON.parse(line));

const newId = `session-${crypto.randomUUID()}`;
header.id = newId;

let fixed = 0;
const outEvents = events.map((event) => {
  if (!KNOWN_SESSION_EVENT_TYPES.has(event.type) && event.ignorable !== true) {
    fixed += 1;
    return { ...event, ignorable: true };
  }
  return event;
});

const dir = path.join(path.dirname(path.dirname(src)), newId);
fs.mkdirSync(dir);
const target = path.join(dir, 'session.v4.jsonl.zstd');
const frames = [
  zlib.zstdCompressSync(Buffer.from(`${JSON.stringify(header)}\n`, 'utf8'), OPTS),
  ...outEvents.map((event) => zlib.zstdCompressSync(Buffer.from(`${JSON.stringify(event)}\n`, 'utf8'), OPTS)),
];
fs.writeFileSync(target, Buffer.concat(frames));

// Validate the new artifact with the harness's own reader.
const written = fs.readFileSync(target);
const wTexts = splitFrames(written).map(([s, e]) => zlib.zstdDecompressSync(written.subarray(s, e)).toString('utf8'));
const wLines = wTexts.join('').split('\n');
wLines.pop();
const wHeader = JSON.parse(wLines[0]);
const wEvents = wLines.slice(1).map((line) => JSON.parse(line));
persistence.assertStoredId(newId, wHeader);
persistence.assertVersion(wHeader, { path: target });
persistence.validateStoredEvents(wHeader, wEvents, { path: target });

console.log(JSON.stringify({
  ok: true,
  source: src,
  newSession: newId,
  directory: dir,
  events: wEvents.length,
  markedIgnorable: fixed,
  bytes: written.length,
}, null, 2));

if (!keep) {
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('(probe mode: new directory removed; pass --keep to keep it)');
}
