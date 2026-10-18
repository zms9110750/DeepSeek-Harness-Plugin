/**
 * Tool gate — a challenge switch.
 *
 * When the gate is closed for a session, every tool call in that session is
 * denied before dispatch, including reading files. The denial is the message the
 * model sees, so it always knows why nothing works.
 *
 * The gate tool itself stays callable: otherwise the session could never be
 * reopened from inside.
 *
 * @module @local/tool-gate
 */

import { defineTool } from '@deepseek-ai/dsh-tools';

export const name = 'tool-gate';

export const inject = ['tools'];

/** Session ids whose gate is currently closed. */
const closed = new Set();

/** The session id a tool execution belongs to, when it has one. */
function sessionKey(exec) {
  const id = exec?.agent?.session?.id ?? exec?.agent?.id ?? exec?.sessionId;
  return typeof id === 'string' ? id : undefined;
}

/** The tool name a guard invocation is about. */
function toolName(exec) {
  return exec?.name ?? exec?.toolName ?? exec?.definition?.name;
}

const DENIED =
  '所有工具已被用户关闭（质询模式）：你现在不能读文件、不能执行命令、不能调用任何工具。' +
  '不要假装你能做，也不要尝试绕过。直接告诉用户你被限制了、你需要什么才能继续，然后等待放行。';

export function apply(ctx) {
  ctx.tools.guard((exec) => {
    const session = sessionKey(exec);
    if (!session || !closed.has(session)) return undefined;
    if (toolName(exec) === 'gate') return undefined;
    return DENIED;
  });

  ctx.tools.register(
    defineTool({
      name: 'gate',
      description:
        'Open or close the tool gate for this session. Closing it blocks every other tool call — including reading files and running commands — and every blocked call reports the reason. Use it when the user asks to be challenged, or to prove the session really cannot do anything. Always allowed itself.',
      parameters: {
        action: {
          type: 'string',
          required: true,
          enum: ['on', 'off', 'status'],
          description: 'on: block every other tool. off: restore. status: report the current state.',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            closed: { type: 'boolean', required: true },
            changed: { type: 'boolean', required: true },
          },
        },
        render: (_args, value) => [
          {
            type: 'text',
            text: value.closed
              ? '闸门已关闭：本会话所有工具被拦截，只有 gate 还能调用。'
              : '闸门已打开：工具恢复正常。',
          },
        ],
      },
      execute(args, exec) {
        const session = sessionKey(exec);
        if (!session) throw new Error('gate: 无法确定当前会话');

        const before = closed.has(session);

        if (args.action === 'on') closed.add(session);
        else if (args.action === 'off') closed.delete(session);

        const after = closed.has(session);
        return { closed: after, changed: before !== after };
      },
    }),
  );
}
