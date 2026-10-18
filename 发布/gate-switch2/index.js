/**
 * Gate switch — the user's tool kill switch, with one source of truth.
 *
 * `/gate on` blocks every tool call in the session before dispatch; `/gate off`
 * restores it; `/gate status` reports it.
 *
 * The state lives in a session projection (`gate`), not in the switch alone:
 * the command appends a `gate/set` event, the projection folds it, and any Client
 * UI reads the same view through `useProjection('gate')`. That is the bridge —
 * the button and the typed command cannot disagree, because neither of them owns
 * the state.
 *
 * @module @local/gate-switch2
 */

import { z } from 'zod';

export const name = 'gate-switch2';

export const inject = ['tools', 'commands', 'sessionProjections'];

/** Sessions whose gate is closed, for the synchronous guard. */
const closed = new Set();

const DENIED =
  '所有工具已被用户关闭（质询模式）：你现在不能读文件、不能执行命令、不能调用任何工具。' +
  '不要假装你能做，也不要尝试绕过。直接告诉用户你被限制了、你需要什么才能继续，然后等待放行。';

const stateSchema = z.object({ closed: z.boolean() });

function report(isClosed) {
  return isClosed
    ? '闸门已关闭：本会话所有工具被拦截（连读文件都不行）。用 /gate off 放行。'
    : '闸门已打开：工具正常可用。用 /gate on 关闭。';
}

export function apply(ctx) {
  ctx.sessionProjections.register({
    key: 'gate',
    stateVersion: 1,
    stateSchema,
    init: () => ({ closed: false }),
    apply: (state, event) => {
      if (event.type !== 'gate/set') return state;
      const next = Boolean(event.data && event.data.closed);
      return { closed: next };
    },
    wire: { viewSchema: stateSchema, view: (state) => ({ closed: state.closed }) },
  });

  ctx.tools.guard((exec) => {
    const session = exec?.agent?.id;
    if (typeof session !== 'string' || !closed.has(session)) return undefined;
    return DENIED;
  });

  ctx.commands.register({
    name: 'gate',
    description: '关掉/打开本会话的所有工具（质询模式）',
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

      // The projection is the shared truth; the Set only mirrors it.
      agent.session.append('gate/set', { closed: next });

      return { kind: 'success', text: report(next) };
    },
  });
}
