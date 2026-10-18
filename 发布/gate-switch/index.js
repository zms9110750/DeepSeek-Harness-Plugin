/**
 * Gate switch — the user's control, not the model's.
 *
 * `/gate on` blocks every tool call in the current session before dispatch,
 * including reading files. `/gate off` restores them, `/gate status` reports.
 *
 * The switch is a slash command on purpose: it belongs to the human. There is no
 * model-facing tool for it, so the model cannot open the gate it is being held
 * behind.
 *
 * @module @local/gate-switch
 */

export const name = 'gate-switch';

export const inject = ['tools', 'commands'];

/** Session ids whose gate is currently closed. */
const closed = new Set();

const DENIED =
  '所有工具已被用户关闭（质询模式）：你现在不能读文件、不能执行命令、不能调用任何工具。' +
  '不要假装你能做，也不要尝试绕过。直接告诉用户你被限制了、你需要什么才能继续，然后等待放行。';

/** Read the current state as the user should see it. */
function report(agent) {
  const on = closed.has(agent.id);
  return on
    ? '闸门已关闭：本会话所有工具被拦截（连读文件都不行）。用 /gate off 放行。'
    : '闸门已打开：工具正常可用。用 /gate on 关闭。';
}

export function apply(ctx) {
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

      if (action === '' || action === 'status') {
        return { kind: 'success', text: report(agent) };
      }

      if (action === 'on') {
        closed.add(agent.id);
        return { kind: 'success', text: report(agent) };
      }

      if (action === 'off') {
        closed.delete(agent.id);
        return { kind: 'success', text: report(agent) };
      }

      return { kind: 'error', text: '用法：/gate on | off | status' };
    },
  });
}
