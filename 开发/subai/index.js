/**
 * subai — 自管日志的子 AI（mod）
 *
 * 目标：
 *   · 效果和官方派发子 AI 一样：建子会话、跑官方的 agent loop、把结果带回父。
 *   · 子会话的日志由本插件负责：sqlite，存在用户目录 `~/.dsh/subai/subai.db`。
 *   · 对外工具面与官方子 AI 工具包同形（只换名字），另加一个「按 seq 截断分叉」的工具。
 *
 * 做法（不改官方代码，只包活实例）：
 *   · 包住 `ctx.sessionPersistence` 的 create/open/stat/list/flush：命中本插件登记的 session id
 *     就用自己的 sqlite handle，其余原样交给官方 JSONL 后端。
 *   · 官方后端的 `session/event` 路由只认它自己的 writers 表；我们的会话不在里面，所以它静默不写
 *     （正是要的）；我们自己的监听器把事件写进 sqlite。
 *   · 循环、提示词、工具、模型请求全部走官方 `ctx.agents.create/resume`。
 *
 * 卸载：还原被包的方法、dispose 本插件建过的子 agent、关库。子会话日志留在 sqlite 里，
 * 但没有本插件就没人认得它们（这是明确接受的取舍）。
 *
 * @module @local/subai
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { boundContextSummary, createUserMessage } from '@deepseek-ai/dsh-llm'
import { buildForkSeed } from '@deepseek-ai/dsh-session/fork'
import {
	SessionHandleClosedError,
	SessionPersistenceNotFoundError,
	SessionReadOnlyError,
	assertContiguous,
	materializeAppendBatch,
	materializeCreateHeader,
} from '@deepseek-ai/dsh-session-persistence'

export const name = 'subai'

/** 需要活的服务：有了它们才谈得上「用官方循环 + 自己的日志」。 */
export const inject = ['tools', 'agents', 'sessionPersistence']

/** 子会话深度上限（和官方默认一样只允许直接子代）。 */
const MAX_DEPTH = 1

const ORIGINAL = Symbol.for('cordis.original')

/** 深冻结：一次解析后复用，handle.read 返回 shared-frozen。 */
function deepFreeze(value) {
	if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value
	for (const item of Array.isArray(value) ? value : Object.values(value)) deepFreeze(item)
	return Object.freeze(value)
}

function databasePath() {
	return path.join(os.homedir(), '.dsh', 'subai', 'subai.db')
}

// ---------------------------------------------------------------------------
// 存储：只有一个文件，两张表。events 存完整逻辑日志（v1 不做前缀引用）。
// ---------------------------------------------------------------------------

class SubaiStore {
	constructor(file) {
		fs.mkdirSync(path.dirname(file), { recursive: true })
		this.file = file
		this.db = new DatabaseSync(file)
		this.db.exec('PRAGMA journal_mode = WAL')
		this.db.exec('PRAGMA synchronous = FULL')
		this.db.exec('PRAGMA busy_timeout = 2000')
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS sessions (
				id          TEXT PRIMARY KEY,
				parent      TEXT,
				owner       TEXT,
				cut         INTEGER NOT NULL DEFAULT 0,
				header      TEXT NOT NULL,
				label       TEXT,
				description TEXT,
				status      TEXT NOT NULL DEFAULT 'idle',
				created_at  INTEGER NOT NULL,
				revision    INTEGER NOT NULL DEFAULT 0
			) STRICT
		`)
		// `owner` = 运行期的父（谁派的）。`parent` = 血缘父（fork 的源）。
		// 两者在 fork 时会分叉：血缘父是源会话，运行期父是发起 fork 的那个会话。
		const columns = this.db.prepare('PRAGMA table_info(sessions)').all().map((column) => column.name)
		if (!columns.includes('owner')) this.db.exec('ALTER TABLE sessions ADD COLUMN owner TEXT')
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS events (
				sid  TEXT NOT NULL,
				seq  INTEGER NOT NULL,
				type TEXT NOT NULL,
				json TEXT NOT NULL,
				PRIMARY KEY (sid, seq)
			) WITHOUT ROWID
		`)
		// 只存“自己的”行；前缀沿 parent + cut 由视图拼回来。
		// 视图体里带 ORDER BY：SQLite 对外层没有自己 ORDER BY 的查询会照做，
		// 于是 GUI 点开、SELECT *、SELECT * WHERE sid=? 都是 (sid, seq) 有序，不用再排。
		this.db.exec('DROP VIEW IF EXISTS session_events')
		this.db.exec(`
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
			JOIN events e ON e.sid = u.src AND e.seq >= u.lo AND e.seq < u.hi
			ORDER BY sid, seq
		`)
		// 一条 SQL 直接把某个会话的完整逻辑日志摊成一个 JSON 数组。
		// 每次启动重建：顺序由聚合里的 ORDER BY seq 保证，不依赖子查询的偶然顺序。
		this.db.exec('DROP VIEW IF EXISTS session_log')
		this.db.exec(`
			CREATE VIEW session_log AS
			SELECT s.id AS sid, s.parent AS parent, s.cut AS cut, s.header AS header,
				(SELECT json_group_array(json(v.json) ORDER BY v.seq)
					FROM session_events v WHERE v.sid = s.id) AS events
			FROM sessions s
		`)
		// 旧版本把前缀也写进了 events：清掉这些重复行（幂等）。
		this.db.exec(`
			DELETE FROM events
			WHERE EXISTS (SELECT 1 FROM sessions s WHERE s.id = events.sid AND events.seq < s.cut)
		`)
		this.pending = new Map()
		this.claims = new Map()
		this.cache = new Map()
		this.known = new Set()
		this.unknown = new Set()
	}

	/** 是否由本插件负责：先看内存，未命中才查库（并记住结果，避免每个事件都查一次）。 */
	has(id) {
		if (this.pending.has(id) || this.known.has(id)) return true
		if (this.unknown.has(id)) return false
		const found = this.db.prepare('SELECT 1 FROM sessions WHERE id = ?').get(id) !== undefined
		if (found) this.known.add(id)
		else this.unknown.add(id)
		return found
	}

	reserve(id, meta) {
		this.pending.set(id, meta ?? {})
		this.unknown.delete(id)
	}

	release(id) {
		this.pending.delete(id)
		this.unknown.delete(id)
	}

	createSession(header, cut) {
		const meta = this.pending.get(header.id) ?? {}
		this.pending.delete(header.id)
		this.known.add(header.id)
		this.unknown.delete(header.id)
		this.db
			.prepare(
				'INSERT OR REPLACE INTO sessions (id, parent, owner, cut, header, label, description, status, created_at, revision) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)',
			)
			.run(
				header.id,
				header.parentSession ?? null,
				meta.owner ?? null,
				cut,
				JSON.stringify(header),
				meta.label ?? null,
				meta.description ?? null,
				'running',
				header.createdAt,
			)
	}

	openSession(id) {
		const row = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id)
		if (row === undefined) return undefined
		this.known.add(id)
		return {
			id: row.id,
			parent: row.parent,
			owner: row.owner,
			cut: row.cut,
			header: JSON.parse(row.header),
			label: row.label,
			description: row.description,
			status: row.status,
			createdAt: row.created_at,
			revision: row.revision,
		}
	}

	listSessions() {
		return this.db.prepare('SELECT * FROM sessions ORDER BY created_at').all().map((row) => ({
			id: row.id,
			parent: row.parent,
			owner: row.owner,
			cut: row.cut,
			header: JSON.parse(row.header),
			label: row.label,
			description: row.description,
			status: row.status,
			createdAt: row.created_at,
			revision: row.revision,
		}))
	}

	/** 完整逻辑事件数组（沿视图拼好、深冻结，缓存到下一次写）。 */
	events(id) {
		const cached = this.cache.get(id)
		if (cached !== undefined) return cached
		const rows = this.db.prepare('SELECT seq, json FROM session_events WHERE sid = ? ORDER BY seq').all(id)
		for (let index = 0; index < rows.length; index += 1) {
			if (rows[index].seq !== index) {
				const session = this.openSession(id)
				throw new Error(
					`subai: logical log of "${id}" breaks at seq ${index}; parent "${session?.parent ?? '?'}" is missing or truncated`,
				)
			}
		}
		const frozen = Object.freeze(rows.map((row) => deepFreeze(JSON.parse(row.json))))
		this.cache.set(id, frozen)
		return frozen
	}

	appendEvents(id, events) {
		if (events.length === 0) return
		const insert = this.db.prepare('INSERT INTO events (sid, seq, type, json) VALUES (?, ?, ?, ?)')
		this.db.exec('BEGIN IMMEDIATE')
		try {
			for (const event of events) insert.run(id, event.seq, event.type, JSON.stringify(event))
			this.db.prepare('UPDATE sessions SET revision = revision + 1 WHERE id = ?').run(id)
			this.db.exec('COMMIT')
		} catch (error) {
			try {
				this.db.exec('ROLLBACK')
			} catch {}
			throw error
		}
		this.cache.delete(id)
	}

	setStatus(id, status) {
		this.db.prepare('UPDATE sessions SET status = ? WHERE id = ?').run(status, id)
	}

	/** 一个事件都没有的会话在关闭时删掉，避免留下幽灵行。 */
	deleteIfEmpty(id) {
		const row = this.db.prepare('SELECT cut FROM sessions WHERE id = ?').get(id)
		if (row === undefined || row.cut > 0) return
		const own = this.db.prepare('SELECT COUNT(*) AS n FROM events WHERE sid = ?').get(id).n
		if (own > 0) return
		this.db.prepare('DELETE FROM sessions WHERE id = ?').run(id)
		this.known.delete(id)
		this.unknown.add(id)
		this.cache.delete(id)
	}

	snapshot(row) {
		const own = this.db.prepare('SELECT COUNT(*) AS n FROM events WHERE sid = ? AND seq >= ?').get(row.id, row.cut).n
		return {
			header: structuredClone(row.header),
			revision: `subai:${row.revision}:${row.cut}:${row.cut + own}`,
			eventCount: row.cut + own,
		}
	}

	claim(id, handle) {
		if (this.claims.has(id)) throw new SessionAlreadyOwnedLike(id)
		this.claims.set(id, handle)
	}

	unclaim(id) {
		this.claims.delete(id)
	}

	close() {
		try {
			this.db.close()
		} catch {}
	}
}

/** 与官方同名的错误类在本机不一定能拿到，自己造一个同形状的。 */
class SessionAlreadyOwnedLike extends Error {
	constructor(id) {
		super(`session "${id}" is already owned by a write handle`)
		this.name = 'SessionAlreadyOwnedError'
		this.sessionId = id
	}
}

// ---------------------------------------------------------------------------
// Handle：完整的 SessionHandle 形状（read/append/flush/close）。
// ---------------------------------------------------------------------------

class SqliteHandle {
	constructor(store, row, access, options = {}) {
		this.store = store
		this.id = row.id
		this.header = row.header
		this.inheritedEventCount = row.cut
		this.access = access
		this.closed = false
		// 新建的会话还没有任何自己的行：游标从 0 开始（种子随后整段交进来）。
		// 重新打开的会话：游标 = 完整逻辑日志长度（前缀 + 自己的行）。
		this.next = options.fresh === true ? 0 : store.events(row.id).length
	}

	assertOpen() {
		if (this.closed) throw new SessionHandleClosedError(this.id)
	}

	async read(offset = 0, length, _options) {
		this.assertOpen()
		const all = this.store.events(this.id)
		const end = length === undefined ? all.length : offset + length
		return { eventState: 'shared-frozen', events: all.slice(offset, end) }
	}

	async append(events, _options) {
		this.assertOpen()
		if (this.access !== 'write') throw new SessionReadOnlyError(this.id)
		if (events.length === 0) return
		const batch = materializeAppendBatch(events)
		assertContiguous(this.id, batch, this.next)
		// 只落自己的行：seq < cut 的那段属于父，读的时候由 session_events 视图拼回来。
		const own = batch.filter((event) => event.seq >= this.inheritedEventCount)
		this.store.appendEvents(this.id, own)
		this.next += batch.length
	}

	async flush(_options) {
		this.assertOpen()
		// 每次 append 已经同步写进 sqlite（synchronous=FULL），这里没有额外缓冲。
	}

	async close() {
		if (this.closed) return
		this.closed = true
		if (this.access === 'write') {
			this.store.unclaim(this.id)
			// 建了但一个事件都没写的会话，关闭时不留痕迹（对齐官方「未物化就不存在」）。
			this.store.deleteIfEmpty(this.id)
		}
	}

	[Symbol.asyncDispose]() {
		return this.close()
	}
}

// ---------------------------------------------------------------------------
// 门面：包住活实例的方法，只接管自己登记的会话。
// ---------------------------------------------------------------------------

function installFacade(ctx, store) {
	const service = ctx.sessionPersistence
	const raw = service?.[ORIGINAL] ?? service
	if (raw === undefined || typeof raw.create !== 'function') {
		ctx.logger?.warn?.('subai: sessionPersistence has no usable create(); child logs stay official')
		return () => {}
	}

	const saved = new Map()
	for (const key of ['create', 'open', 'stat', 'list', 'flush']) {
		saved.set(key, Object.getOwnPropertyDescriptor(raw, key) ?? null)
	}
	const original = {
		create: raw.create.bind(raw),
		open: raw.open.bind(raw),
		stat: raw.stat.bind(raw),
		list: raw.list.bind(raw),
		flush: raw.flush.bind(raw),
	}

	const wrapped = {
		async create(header, options) {
			const id = header?.id
			if (typeof id !== 'string' || !store.has(id)) return original.create(header, options)
			const detached = materializeCreateHeader(header)
			store.createSession(detached, Number(options?.inheritedEventCount ?? 0))
			const row = store.openSession(id)
			const handle = new SqliteHandle(store, row, 'write', { fresh: true })
			store.claim(id, handle)
			return handle
		},
		async open(id, access, options) {
			if (!store.has(id)) return original.open(id, access, options)
			const row = store.openSession(id)
			if (row === undefined) throw new SessionPersistenceNotFoundError(id)
			const handle = new SqliteHandle(store, row, access)
			if (access === 'write') store.claim(id, handle)
			return handle
		},
		async stat(id, options) {
			if (!store.has(id)) return original.stat(id, options)
			const row = store.openSession(id)
			return row === undefined ? undefined : store.snapshot(row)
		},
		async list(options) {
			const official = await original.list(options)
			const mine = store.listSessions().map((row) => store.snapshot(row))
			return [...official, ...mine]
		},
		async flush() {
			await original.flush()
			// 我们的 handle 没有缓冲；逐个 flush 只是为了语义一致。
			for (const handle of store.claims.values()) {
				if (handle instanceof SqliteHandle) await handle.flush()
			}
		},
	}

	for (const key of Object.keys(wrapped)) {
		Object.defineProperty(raw, key, {
			value: wrapped[key],
			configurable: true,
			writable: true,
			enumerable: false,
		})
	}

	return () => {
		for (const key of Object.keys(wrapped)) {
			if (raw[key] !== wrapped[key]) continue // 别人后来也包了，别踩
			const descriptor = saved.get(key)
			if (descriptor === null || descriptor === undefined) delete raw[key]
			else Object.defineProperty(raw, key, descriptor)
		}
	}
}

// ---------------------------------------------------------------------------
// 子 agent 的建立 / 结算
// ---------------------------------------------------------------------------

/** 从父上下文取它当前的预设 id（不覆盖，只沿用）。 */
function composedPreset(ctx, parent) {
	try {
		return ctx.get('agentPresets')?.composedPreset?.(parent.ctx)
	} catch {
		return undefined
	}
}

function modelSelection(ctx) {
	try {
		const selection = ctx.get('agentDefaultModel')?.currentSelection?.()
		return selection === undefined ? undefined : JSON.parse(JSON.stringify(selection))
	} catch {
		return undefined
	}
}

function depthOf(agent) {
	return Number(agent?.session?.header?.delegationDepth ?? 0)
}

async function createChild(ctx, store, parent, input) {
	if (depthOf(parent) >= MAX_DEPTH) {
		throw new Error(
			`subai: delegation depth limit reached (current ${depthOf(parent)}, max ${MAX_DEPTH}); ` +
				'set MAX_DEPTH in the plugin if you really want deeper children',
		)
	}

	const id = `session-${randomUUID()}`
	const header = parent.session.header
	const presetId = composedPreset(ctx, parent)
	const presets = ctx.get('agentPresets')
	const agentOptions = modelSelection(ctx)

	const cwd = input.cwd ?? header.cwd
	const meta = {
		...(cwd === undefined ? {} : { cwd }),
		...(presetId === undefined ? {} : { agentPreset: presetId }),
		parentSession: input.parentSession ?? header.id,
		isSeeded: input.seed !== undefined,
		origin: 'subagent',
		delegationDepth: depthOf(parent) + 1,
	}

	store.reserve(id, { label: input.label, description: input.description, owner: input.owner ?? header.id })

	let handle
	try {
		handle = await ctx.agents.create({
			sessionId: id,
			parentAgent: parent,
			meta,
			...(agentOptions === undefined ? {} : { agentOptions }),
			...(input.seed === undefined
				? {}
				: { seed: input.seed, inheritedEventCount: input.boundary + 1 }),
			...(presets === undefined || presetId === undefined
				? {}
				: {
						setup: async (childCtx) => {
							await presets.mount(childCtx, presetId)
						},
					}),
		})
	} catch (error) {
		store.release(id)
		throw error
	}

	const child = handle.agent ?? handle
	store.setStatus(id, 'running')
	child.followup(createUserMessage({ content: [{ type: 'text', text: input.prompt }], source: { kind: 'user' } }))
	return { id, child, handle }
}

/** 子停稳后，把最后一条 assistant 文本带回父（与官方 completion notice 同形）。 */
function watchSettlement(ctx, store, parent, child, childId, disposedRef) {
	const settle = child.whenIdle
	if (typeof settle !== 'function') return
	const running = Promise.resolve(settle.call(child))
		.then(() => {
			store.setStatus(childId, 'idle')
			if (disposedRef.value) return undefined
			const events = child.session.snapshotEvents()
			const last = [...events].reverse().find((event) => event.type === 'assistant/message')
			const blocks = last?.data?.message?.content ?? []
			const body =
				blocks
					.filter((block) => block.type === 'text')
					.map((block) => block.text)
					.join('\n\n') || '(no final text)'
			const firstLine = body.split('\n')[0]?.trim() || `subai ${childId}`
			// 投递策略见 deliver()：在跑就 steer 进 next-step（当前 step 收尾后并入，
			// 不会插进工具调用中间），空闲就 followup 起一轮。
			deliver(ctx, store, parent.session.id, {
				text: `[subai ${childId} finished]\n${body}`,
				source: {
					kind: 'subagent-settled',
					form: 'notice',
					summary: boundContextSummary(firstLine),
					senderSessionId: childId,
				},
			})
			return undefined
		})
		.catch((error) => {
			ctx.logger?.warn?.(`subai: settle watch failed for ${childId}: ${String(error?.message ?? error)}`)
			return undefined
		})
	return running
}

function childOf(ctx, id) {
	const agent = ctx.agents.get(id)
	return agent ?? undefined
}

/**
 * 把一条消息投给某个会话，规则与官方 sendMessage 完全一致。
 *
 * 官方 agent-loop 的收件箱有两级：
 *   · `next-step` —— 下一个 step 边界就并入（包括当前这轮还没结束）；
 *   · `next-turn` —— 等当前 turn 完全结束，才在下一轮开头并入。
 * `preStep()` 在每个 step 开头 `inbox.claim()`，把 `next-step` 里的消息一次性取走，
 * 于是它们落在「上一步的工具调用已全部回结果」之后 —— 顺序天然合法。
 *
 * 所以：
 *   · 空闲  → `followup`（= next-turn + 唤醒），起一轮；
 *   · 在跑  → `steer`（= next-step + 唤醒），当前 step 收尾后并入；
 *   · 在跑且正卡在工具调用与结果之间 → 也走 `steer`，因为它在 step 边界才并入，
 *     不会插进调用中间。
 *
 * 注意 `session.append(..., { surfaceOp: 'append' })` 是**另一条路**：它直接往表面序列尾部
 * 塞一条 user 消息，不看当前 step 走到哪。父会话正在等工具结果时塞进去，就成了
 * `assistant(tool_calls) → user → tool`，上游直接 400。别用那条路。
 */
function deliver(ctx, store, targetId, payload) {
	const target = childOf(ctx, targetId)
	if (target === undefined) {
		ctx.logger?.warn?.(`subai: deliver to "${targetId}" skipped — no live agent in this process`)
		return false
	}
	const message = createUserMessage({ content: [{ type: 'text', text: payload.text }], source: payload.source })
	try {
		if (target.status === 'running' && typeof target.steer === 'function') {
			target.steer(message)
		} else {
			target.followup(message)
		}
		return true
	} catch (error) {
		ctx.logger?.warn?.(`subai: deliver to "${targetId}" failed: ${String(error?.message ?? error)}`)
		return false
	}
}

/**
 * 邻接规则，照抄官方 sendMessage：直系子 ↔ 直系父，不跨代、不兄弟。
 *
 * 注意 `toId`（父会话）通常**不在** subai 库里 —— 库里只登记本插件建的子会话。
 * 所以「对方不是 subai 会话」不能直接判失败：要再看我方登记的 `owner`/`parent`
 * 是不是正好指向它。早期版本只看 `openSession(toId)`，导致子 AI 永远无法回报
 * （报错 `"<父id>" is not a subai session`）。
 */
function adjacency(store, fromId, toId) {
	const target = store.openSession(toId)
	if (target !== undefined && target.owner === fromId) return { ok: true } // 我是它的运行期父
	const mine = store.openSession(fromId)
	if (mine !== undefined && (mine.owner === toId || mine.parent === toId)) {
		return { ok: true } // 它是我的运行期父 / 血缘父
	}
	if (target === undefined) {
		return {
			ok: false,
			reason: `"${toId}" is not a subai session and is not the parent of "${fromId}"`,
		}
	}
	return { ok: false, reason: `"${fromId}" and "${toId}" are not directly adjacent` }
}

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------

export function apply(ctx) {
	const store = new SubaiStore(databasePath())
	const disposedRef = { value: false }
	const children = new Set()
	const uninstall = installFacade(ctx, store)

	// 官方后端不会为我们的会话落盘；我们自己接这三条。
	ctx.on('session/event', (session, event) => {
		if (!store.has(session.id)) return
		const row = store.openSession(session.id)
		if (row === undefined) return
		const handle = store.claims.get(session.id)
		if (handle instanceof SqliteHandle) {
			handle.append([event]).catch((error) => {
				ctx.logger?.warn?.(`subai: append failed for ${session.id}: ${String(error?.message ?? error)}`)
			})
		}
	})
	ctx.on('session/flush', (session) => {
		const handle = store.claims.get(session.id)
		if (!(handle instanceof SqliteHandle)) return undefined
		return handle.flush()
	})
	ctx.on('session/disposed', (session) => {
		const handle = store.claims.get(session.id)
		if (handle instanceof SqliteHandle) {
			handle.close().catch(() => {})
			store.setStatus(session.id, 'closed')
		}
	})

	ctx.tools.register(
		defineTool({
			name: 'subai',
			description:
				'Spawn a sub-AI that runs on the official agent loop, but whose session log is owned by this plugin ' +
				'(stored in the user directory, SQLite). Same surface as the built-in subagent tool: it starts the child, ' +
				'returns its id, and the runtime notifies you when it finishes. The child gets your current working ' +
				'directory and preset, so include everything it needs in the prompt.',
			parameters: {
				cwd: {
					type: 'string',
					description:
						'Initial child working directory. Relative paths use your current directory; omitted inherits it. Later directory changes in either agent are independent.',
				},
				description: { type: 'string', required: true, description: 'A short (3-5 word) description of the delegated task, for display.' },
				prompt: {
					type: 'string',
					required: true,
					description:
						"The complete, self-contained task for the sub-AI. It does not share this conversation's context, so include everything it needs.",
				},
			},
			output: {
				schema: {
					type: 'object',
					additionalProperties: false,
					properties: {
						kind: { type: 'string', required: true, const: 'activation' },
						subagentId: { type: 'string', required: true },
					},
				},
				render: (_args, value) => [{ type: 'text', text: `started subai ${value.subagentId}` }],
			},
			async execute(args, exec) {
				const parent = exec.agent
				if (parent === undefined) throw new Error('subai requires an owning agent session')
				const created = await createChild(ctx, store, parent, {
					label: args.description,
					description: args.description,
					prompt: args.prompt,
					cwd: args.cwd,
				})
				children.add(created.handle)
				watchSettlement(ctx, store, parent, created.child, created.id, disposedRef)
				return { kind: 'activation', subagentId: created.id }
			},
		}),
	)

	ctx.tools.register(
		defineTool({
			name: 'subai_fork',
			description:
				'Fork an existing sub-AI session at a chosen event seq (inclusive) and start a new sub-AI from that prefix. ' +
				'The new child inherits history up to and including atSeq; everything after it is cut off. ' +
				'This is the only tool that can fork a child session — the built-in fork only forks the current session.',
			parameters: {
				target: { type: 'string', required: true, description: 'Session id of the sub-AI to fork (from subai_list).' },
				atSeq: {
					type: 'number',
					description:
						'Inclusive event seq to keep. Default: the source log end. Truncating mid-turn closes the open tail with synthetic forked results.',
				},
				cwd: {
					type: 'string',
					description: 'Initial working directory for the new child; omitted inherits the forking session directory.',
				},
				description: { type: 'string', required: true, description: 'A short (3-5 word) description of the new child, for display.' },
				prompt: {
					type: 'string',
					required: true,
					description:
						"The task for the new child. It already sees the source conversation up to atSeq, so build on it and state only what is new.",
				},
			},
			output: {
				schema: {
					type: 'object',
					additionalProperties: false,
					properties: {
						kind: { type: 'string', required: true, const: 'activation' },
						subagentId: { type: 'string', required: true },
						source: { type: 'string', required: true },
						atSeq: { type: 'number', required: true },
					},
				},
				render: (_args, value) => [
					{ type: 'text', text: `forked subai ${value.source} @ ${value.atSeq} → ${value.subagentId}` },
				],
			},
			async execute(args, exec) {
				const parent = exec.agent
				if (parent === undefined) throw new Error('subai_fork requires an owning agent session')
				const sourceId = String(args.target)
				if (!store.has(sourceId)) throw new Error(`subai_fork: no such subai session "${sourceId}"`)

				const live = childOf(ctx, sourceId)
				const events = live === undefined ? store.events(sourceId) : live.session.snapshotEvents()
				if (events.length === 0) throw new Error(`subai_fork: session "${sourceId}" has no events to fork`)

				const boundary = args.atSeq === undefined ? events.length - 1 : Number(args.atSeq)
				if (!Number.isSafeInteger(boundary) || boundary < 0 || boundary >= events.length) {
					throw new Error(`subai_fork: atSeq ${String(args.atSeq)} is outside 0..${events.length - 1}`)
				}
				if (events[boundary]?.seq !== boundary) {
					throw new Error(`subai_fork: stored log of "${sourceId}" is not contiguous at seq ${boundary}`)
				}

				const seed = buildForkSeed(events, boundary)
				const created = await createChild(ctx, store, parent, {
					label: args.description,
					description: args.description,
					prompt: args.prompt,
					cwd: args.cwd,
					seed,
					boundary,
					parentSession: sourceId,
					owner: parent.session.id,
				})
				children.add(created.handle)
				watchSettlement(ctx, store, parent, created.child, created.id, disposedRef)
				return { kind: 'activation', subagentId: created.id, source: sourceId, atSeq: boundary }
			},
		}),
	)

	ctx.tools.register(
		defineTool({
			name: 'subai_report',
			description:
				'Report progress to your direct parent session (or to a direct child, when they are the ones waiting). ' +
				'If the target is running the message lands in its log immediately and it sees it at the next model step; ' +
				'if it is idle the message wakes it for one turn, like a user message. Not blocking.',
			parameters: {
				message: { type: 'string', required: true, description: 'What to report. Keep it to the conclusion, not the transcript.' },
				to: {
					type: 'string',
					description: 'Target session id. Default: your direct parent. Only directly adjacent sessions are accepted.',
				},
			},
			output: {
				schema: {
					type: 'object',
					additionalProperties: false,
					properties: {
						delivered: { type: 'boolean', required: true },
						to: { type: 'string', required: true },
						mode: { type: 'string', required: true },
					},
				},
				render: (_args, value) => [
					{ type: 'text', text: value.delivered ? `reported to ${value.to} (${value.mode})` : `report dropped: ${value.to}` },
				],
			},
			async execute(args, exec) {
				const from = exec.agent?.session?.id
				if (from === undefined) throw new Error('subai_report requires an owning agent session')
				const mine = store.openSession(from)
				if (mine === undefined) throw new Error(`subai_report: "${from}" is not a subai session`)
				const to = String(args.to ?? mine.owner ?? mine.parent ?? '')
				if (to === '') throw new Error('subai_report: this session has no parent to report to')
				const allowed = adjacency(store, from, to)
				if (!allowed.ok) throw new Error(`subai_report: ${allowed.reason}`)
				const target = childOf(ctx, to)
				const delivered = deliver(ctx, store, to, {
					text: `[subai ${from}] ${String(args.message)}`,
					source: { kind: 'agent-message', form: 'relay', senderSessionId: from },
				})
				return { delivered, to, mode: target?.status === 'running' ? 'inserted' : 'woke' }
			},
		}),
	)

	ctx.tools.register(
		defineTool({
			name: 'subai_send',
			description:
				'Send a message to a sub-AI. A running target receives it at its nearest step; an idle target starts a new turn; ' +
				'a stopped target is cold-resumed from this plugin’s SQLite log first. Same surface as the built-in send_message.',
			parameters: {
				agent_id: { type: 'string', required: true, description: 'The session id of the sub-AI to message.' },
				message: { type: 'string', required: true, description: 'The message to deliver.' },
			},
			output: {
				schema: {
					type: 'object',
					additionalProperties: false,
					properties: { messageId: { type: 'string', required: true } },
				},
				render: (_args, value) => [{ type: 'text', text: `message delivered to subai ${value.messageId}` }],
			},
			async execute(args, exec) {
				const id = String(args.agent_id)
				if (!store.has(id)) throw new Error(`subai_send: no such subai session "${id}"`)
				let agent = childOf(ctx, id)
				if (agent === undefined) {
					const row = store.openSession(id)
					const presetId = row?.header?.agentPreset
					const presets = ctx.get('agentPresets')
					// 冷续必须把模型选择带上：系统提示词的 {{model}} 由它取，
					// 缺了就 turn/end error（实测过）。
					const selection = modelSelection(ctx)
					const resumed = await ctx.agents.resume({
						resumeSessionId: id,
						parentAgent: exec.agent,
						...(selection === undefined ? {} : { agentOptions: selection }),
						...(presetId === undefined || presets === undefined
							? {}
							: {
									setup: async (childCtx) => {
										await presets.mount(childCtx, presetId)
									},
								}),
					})
					children.add(resumed)
					agent = resumed.agent ?? resumed
				}
				const message = createUserMessage({
					content: [{ type: 'text', text: String(args.message) }],
					source: { kind: 'user' },
				})
				// 和投递同一条规则：在跑就 steer（next-step，当前 step 收尾后并入），
				// 空闲就 followup 起一轮。绝不能直接 append 进表面序列。
				if (agent.status === 'running' && typeof agent.steer === 'function') {
					agent.steer(message)
				} else {
					agent.followup(message)
				}
				return { messageId: message.id }
			},
		}),
	)

	ctx.tools.register(
		defineTool({
			name: 'subai_interrupt',
			description:
				'Interrupt a running sub-AI. Stops only its current turn; already-queued messages stay parked. ' +
				'Same surface as the built-in interrupt_agent.',
			parameters: {
				agent_id: { type: 'string', required: true, description: 'The session id of the sub-AI to interrupt.' },
			},
			output: {
				schema: {
					type: 'object',
					additionalProperties: false,
					properties: { accepted: { type: 'boolean', required: true } },
				},
				render: (_args, value) => [{ type: 'text', text: value.accepted ? 'interrupt requested' : 'no live subai to interrupt' }],
			},
			async execute(args) {
				const id = String(args.agent_id)
				const agent = childOf(ctx, id)
				if (agent === undefined) return { accepted: true }
				agent.cancel({ kind: 'parent', reason: 'interrupted by parent' }, { keepInbox: true })
				return { accepted: true }
			},
		}),
	)

	ctx.tools.register(
		defineTool({
			name: 'subai_list',
			description:
				'List the sub-AI sessions this plugin owns. Logs live in the user directory, not in the official session store. ' +
				'Same surface as the built-in list_agents: children by default, or the whole tree below you.',
			parameters: {
				scope: {
					type: 'string',
					enum: ['children', 'descendants'],
					description:
						'children (default) lists direct children, which accept subai_send in any status. descendants lists the whole tree below you, each entry carrying its parent and depth.',
				},
			},
			output: {
				schema: {
					type: 'array',
					items: {
						type: 'object',
						additionalProperties: false,
						properties: {
							kind: { type: 'string', required: true, const: 'child' },
							id: { type: 'string', required: true },
							label: { type: 'string', required: true },
							status: { type: 'string', required: true },
							parent: { type: 'string' },
							depth: { type: 'number' },
						},
					},
				},
				render: (_args, value) => [
					{
						type: 'text',
						text:
							value.length === 0
								? '(no subai)'
								: value
										.map((entry) => `${entry.id} [${entry.status}]${entry.depth > 1 ? ` depth=${entry.depth}` : ''} — ${entry.label}`)
										.join('\n'),
					},
				],
			},
			async execute(args, exec) {
				const caller = exec.agent?.session?.id
				const rows = store.listSessions()
				const byId = new Map(rows.map((row) => [row.id, row]))
				/** 沿运行期父（owner）上溯；老数据没有 owner 时退回血缘父（parent）。 */
				const depthUnder = (row) => {
					let depth = 1
					let current = row
					for (let guard = 0; guard < 64; guard += 1) {
						const up = current.owner ?? current.parent
						if (up === caller) return depth
						const parent = byId.get(up)
						if (parent === undefined) return undefined
						depth += 1
						current = parent
					}
					return undefined
				}
				const selected = []
				for (const row of rows) {
					const depth = depthUnder(row)
					if (depth === undefined) continue
					if (args.scope !== 'descendants' && depth !== 1) continue
					const live = childOf(ctx, row.id)
					selected.push({
						kind: 'child',
						id: row.id,
						label: row.label ?? '',
						status: live !== undefined && live.status === 'running' ? 'running' : 'inactive',
						parent: row.parent ?? undefined,
						owner: row.owner ?? undefined,
						depth,
					})
				}
				return selected
			},
		}),
	)

	// 卸载：先停子 agent，再还原门面，最后关库。
	ctx.effect(() => () => {
		disposedRef.value = true
		for (const handle of children) {
			try {
				Promise.resolve(handle.dispose?.()).catch(() => {})
			} catch {}
		}
		uninstall()
		store.close()
	}, 'subai lifecycle')
}
