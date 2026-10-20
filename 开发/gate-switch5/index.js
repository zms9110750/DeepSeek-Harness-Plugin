/**
 * Gate switch — the user's tool kill switch, with an in-memory guard and a
 * model-visible system notice.
 *
 * `/gate on` blocks every tool call in the session before dispatch and tells
 * the model why; `/gate off` restores tools and says so; `/gate status`
 * reports the current state.
 *
 * Two separate concerns
 * ---------------------
 * 1. Enforcement is synchronous and lives in this module: `ctx.tools.guard`
 *    reads a `Set` keyed by session id, so a closed gate cannot be talked
 *    around by the model.
 * 2. The notice is history, not local state: a `user/message` whose `source`
 *    is `{ kind: 'system' }` — the same channel the harness itself uses for
 *    runtime context and the skill catalog. It is a known event type, it
 *    persists, and every later request replays it, so the model actually
 *    knows it is gated instead of only seeing refusals.
 *
 * Why not a custom event (the 2.0.0 `gate/set`)
 * ---------------------------------------------
 * The session reader accepts only `KNOWN_SESSION_EVENT_TYPES`, plus unknown
 * types whose envelope carries `ignorable: true`. Third-party plugins cannot
 * write such an envelope (`appendPluginRecord` is in-repo only and touches
 * private session fields), so a bare custom type makes the whole log
 * unreadable ("unknown to this harness and not marked ignorable").
 * `user/message` needs no such marker: it is part of the vocabulary.
 *
 * Why not `system/message`
 * ------------------------
 * That slot IS the system prompt: the newest non-empty `system/message` node
 * is the effective prompt, and the loop reconciles it with the rendered
 * prompt every step — a notice appended there would be rewritten. The
 * sourced user message sits in history instead and survives.
 *
 * @module @local/gate-switch4
 */

import { randomUUID } from 'node:crypto';

export const name = 'gate-switch5';

export const inject = ['tools', 'commands'];

/** Session ids whose gate is closed, for the synchronous guard. */
const closed = new Set();

const CLOSED_TOKEN = '闸门已关闭';
const OPEN_TOKEN = '闸门已打开';

const DENIED =
  '所有工具已被用户关闭（质询模式）：你现在不能读文件、不能执行命令、不能调用任何工具。' +
  '不要假装你能做，也不要尝试绕过。直接告诉用户你被限制了、你需要什么才能继续，然后等待放行。';

const CLOSED_NOTICE =
  '[系统通知] 用户已关闭本会话的所有工具（/gate on）。你现在不能调用任何工具，包括读文件、搜索和执行命令。' +
  '不要假装调用，也不要尝试绕过；直接告诉用户你被限制、你需要什么才能继续，然后等待用户执行 /gate off。';

const OPEN_NOTICE =
  '[系统通知] 用户已恢复本会话的工具（/gate off）。现在可以正常调用工具；此前被拦下的调用不会自动重试，需要时重新发起。';

function report(isClosed) {
  return isClosed
    ? `${CLOSED_TOKEN}：本会话所有工具被拦截（连读文件都不行）。用 /gate off 放行。`
    : `${OPEN_TOKEN}：工具正常可用。用 /gate on 关闭。`;
}

/**
 * Append one system-sourced message so the notice enters the model's history.
 * @returns an empty string on success, or the append error for the caller to surface.
 */
function announce(agent, text) {
  try {
    // `user/message` is surface-eligible: without a surfaceOp marker the
    // session refuses the append ("requires a surfaceOp marker"). 'append'
    // puts the notice at the end of the visible history, where the model
    // replays it on the next request.
    agent.session.append(
      'user/message',
      {
        id: randomUUID(),
        role: 'user',
        content: [{ type: 'text', text }],
        source: { kind: 'system' },
      },
      { surfaceOp: 'append' },
    );
    return '';
  } catch (error) {
    return String(error?.message ?? error);
  }
}

export function apply(ctx) {
  ctx.tools.guard((exec) => {
    const session = exec?.agent?.id;
    if (typeof session !== 'string' || !closed.has(session)) return undefined;
    return DENIED;
  });

  ctx.commands.register({
    name: 'gate',
    description: '关掉/打开本会话的所有工具（质询模式；关闭时会向模型发一条系统来源的通知）',
    input: { hint: 'on | off | status' },
    recordInput: false,
    handler({ agent, rawInput }) {
      const action = String(rawInput ?? '').trim().toLowerCase();
      const isClosed = closed.has(agent.id);

      if (action === '' || action === 'status') {
        return { kind: 'success', text: report(isClosed) };
      }

      if (action !== 'on' && action !== 'off') {
        return { kind: 'error', text: '用法：/gate on | off | status' };
      }

      const next = action === 'on';
      if (next) closed.add(agent.id);
      else closed.delete(agent.id);

      const failure = announce(agent, next ? CLOSED_NOTICE : OPEN_NOTICE);
      const base = report(next);
      return failure === ''
        ? { kind: 'success', text: base }
        : { kind: 'error', text: `${base}\n（系统通知追加失败：${failure}）` };
    },
  });
}
