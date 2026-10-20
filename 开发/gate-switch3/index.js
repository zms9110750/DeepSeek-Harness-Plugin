/**
 * Gate switch — the user's tool kill switch, held in memory.
 *
 * `/gate on` blocks every tool call in the session before dispatch; `/gate off`
 * restores it; `/gate status` reports it.
 *
 * Why nothing is written to the session log
 * -----------------------------------------
 * A session event type outside the harness's generated vocabulary
 * (`KNOWN_SESSION_EVENT_TYPES`) is only readable when its envelope carries
 * `ignorable: true`, and out-of-tree plugins have no supported way to write
 * such an envelope: `appendPluginRecord()` is reserved for in-repo
 * `packages/experimental/` code and touches private session fields, so a
 * plugin that resolves its own `@deepseek-ai/dsh-session` copy cannot call it
 * with the host's Session. Writing a bare custom type (`gate/set`) instead
 * poisons the log: every later load refuses the whole history with
 * "contains event type ... unknown to this harness and not marked ignorable".
 *
 * So the switch lives in this module's memory only. Consequences, accepted:
 *   - a restart reopens the gate (the switch defaults to open);
 *   - the state is per process, not per log.
 *
 * Status contract for the UI
 * --------------------------
 * The command result carries only text, so `status` (and the on/off replies)
 * embed the stable tokens `闸门已关闭` / `闸门已打开`. The composer toggle
 * reads the state by executing `/gate status` and matching those tokens; both
 * the typed command and the button therefore observe the same Set.
 *
 * @module @local/gate-switch2
 */

export const name = 'gate-switch3';

export const inject = ['tools', 'commands'];

/** Session ids whose gate is closed, for the synchronous guard. */
const closed = new Set();

const CLOSED_TOKEN = '闸门已关闭';
const OPEN_TOKEN = '闸门已打开';

const DENIED =
  '所有工具已被用户关闭（质询模式）：你现在不能读文件、不能执行命令、不能调用任何工具。' +
  '不要假装你能做，也不要尝试绕过。直接告诉用户你被限制了、你需要什么才能继续，然后等待放行。';

function report(isClosed) {
  return isClosed
    ? `${CLOSED_TOKEN}：本会话所有工具被拦截（连读文件都不行）。用 /gate off 放行。`
    : `${OPEN_TOKEN}：工具正常可用。用 /gate on 关闭。`;
}

export function apply(ctx) {
  ctx.tools.guard((exec) => {
    const session = exec?.agent?.id;
    if (typeof session !== 'string' || !closed.has(session)) return undefined;
    return DENIED;
  });

  ctx.commands.register({
    name: 'gate',
    description: '关掉/打开本会话的所有工具（质询模式，状态只在内存里，重启后打开）',
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

      return { kind: 'success', text: report(next) };
    },
  });
}
