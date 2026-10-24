import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

const root = process.argv[2]
const magic = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])

function events(file) {
  const buf = fs.readFileSync(file)
  const offsets = []
  for (let i = 0; ; ) {
    const k = buf.indexOf(magic, i)
    if (k < 0) break
    offsets.push(k)
    i = k + 4
  }
  const parts = []
  for (let n = 0; n < offsets.length; n += 1) {
    const start = offsets[n]
    const end = n + 1 < offsets.length ? offsets[n + 1] : buf.length
    try { parts.push(zlib.zstdDecompressSync(buf.subarray(start, end)).toString('utf8')) } catch {}
  }
  const out = []
  for (const line of parts.join('').split('\n')) {
    if (!line) continue
    try { out.push(JSON.parse(line)) } catch {}
  }
  return out
}

/** Walk a role-sequence and report tool messages not answered by a preceding tool_calls assistant message. */
function audit(evts) {
  const problems = []
  let pending = new Map() // callId -> seq index
  let role = null
  let lastAssistantToolCalls = null
  let i = 0
  for (const e of evts) {
    const t = e.type
    if (t === 'assistant/message') {
      const msg = e.data?.message ?? {}
      const calls = (msg.content ?? []).filter((b) => b.type === 'tool-call' || b.type === 'tool_call')
      if (calls.length) {
        lastAssistantToolCalls = calls.map((c) => c.id ?? c.callId)
        for (const id of lastAssistantToolCalls) pending.set(id, i)
      } else {
        lastAssistantToolCalls = null
      }
      role = 'assistant'
    } else if (t === 'tool/result') {
      const id = e.data?.callId ?? e.data?.id ?? e.data?.toolCallId
      if (id && pending.has(id)) pending.delete(id)
      else problems.push({ kind: 'orphan-tool-result', index: i, id, note: 'no matching assistant tool-call before it' })
      role = 'tool'
    } else if (t === 'session/disposed') {
      if (pending.size) { problems.push({ kind: 'pending-at-dispose', index: i, ids: [...pending.keys()] }); pending = new Map() }
    } else if (t === 'turn/start') {
      if (pending.size) { problems.push({ kind: 'pending-at-turn-start', index: i, ids: [...pending.keys()] }); pending = new Map() }
      lastAssistantToolCalls = null
    }
    i += 1
  }
  if (pending.size) problems.push({ kind: 'pending-at-end', ids: [...pending.keys()] })
  return problems
}

const dirs = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory())
for (const d of dirs) {
  const dir = path.join(root, d.name)
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.jsonl.zstd')) continue
    const file = path.join(dir, f)
    const stat = fs.statSync(file)
    let evts
    try { evts = events(file) } catch (e) { console.log('ERR', file, e.message); continue }
    const problems = audit(evts)
    const header = evts.find((e) => e.type === 'session')?.data ?? {}
    const stamp = new Date(stat.mtimeMs).toISOString()
    console.log(`${stamp}  ${d.name}/${f}  events=${evts.length}  problems=${problems.length}`)
    for (const p of problems.slice(0, 6)) console.log('    ', JSON.stringify(p).slice(0, 200))
  }
}
