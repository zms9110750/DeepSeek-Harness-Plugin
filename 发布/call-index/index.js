/**
 * Call index — every tool call gets a number.
 *
 * A waterfall listener on `tools/post-execute` assigns the next number in the
 * session, records the call (name, raw arguments, raw result), and appends `#n`
 * to the rendered result. The model therefore knows the number of the call it
 * just made, and the user sees the same number on the card.
 *
 * Two tools read that index back: `calls` lists recent numbers, `show_call`
 * replays one verbatim. Neither summarizes: the point is the original content.
 *
 * @module @local/call-index
 */

import { defineTool } from '@deepseek-ai/dsh-tools';

export const name = 'call-index';

export const inject = ['tools'];

/** How many entries one session keeps in memory. */
const MAX_ENTRIES = 200;

/** sessionId → { seq, entries[], byId } */
const states = new Map();

function stateOf(key) {
  let state = states.get(key);
  if (!state) {
    state = { seq: 0, entries: [], byId: new Map() };
    states.set(key, state);
  }
  return state;
}

/** Flatten content blocks into plain text for replay. */
function textOf(content) {
  if (!Array.isArray(content)) return '';
  return content
    .map((block) => {
      if (!block) return '';
      if (block.type === 'text') return String(block.text ?? '');
      return '[' + String(block.type ?? 'block') + ']';
    })
    .join('\n');
}

/** One compact line describing a call's arguments. */
function brief(value, max = 90) {
  let text;
  if (typeof value === 'string') text = value;
  else {
    try {
      text = JSON.stringify(value);
    } catch {
      text = String(value);
    }
  }
  text = String(text ?? '').replace(/\s+/g, ' ').trim();
  return text.length > max ? text.slice(0, max) + '…' : text;
}

function fmtTime(at) {
  const d = new Date(at);
  const p = (n) => String(n).padStart(2, '0');
  return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
}

export function apply(ctx) {
  ctx.on('tools/post-execute', async (exec, result, next) => {
    const decision = await next();
    if (!decision || decision.kind !== 'accept') return decision;

    // A PTC-style accept carries a canonical value; leave that path untouched.
    if ('value' in decision && decision.value !== undefined) return decision;

    const key = exec.agent?.id ?? 'unowned';
    const state = stateOf(key);

    state.seq += 1;
    const n = state.seq;

    const entry = {
      n,
      name: String(exec.name ?? '?'),
      args: exec.arguments,
      ok: result?.isError !== true,
      content: result?.content ?? [],
      at: Date.now(),
    };

    state.entries.push(entry);
    state.byId.set(n, entry);
    if (state.entries.length > MAX_ENTRIES) {
      const dropped = state.entries.shift();
      state.byId.delete(dropped.n);
    }

    const base = decision.content ?? result?.content ?? [];
    return { kind: 'accept', content: [...base, { type: 'text', text: '#' + n }] };
  });

  ctx.tools.register(
    defineTool({
      name: 'calls',
      description:
        'List recent tool calls by their number (#n), newest first, with tool name, argument preview, status and time. Use it when the user refers to a call by number, or to find out which number a call got.',
      parameters: {
        limit: { type: 'number', description: 'How many to list, 1–50. Defaults to 20.' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: { text: { type: 'string', required: true } },
        },
        render: (_args, value) => [{ type: 'text', text: value.text }],
      },
      execute(args, exec) {
        const key = exec.agent?.id ?? 'unowned';
        const state = stateOf(key);
        const limit = Math.min(Math.max(Math.trunc(args?.limit ?? 20) || 20, 1), 50);

        if (!state.entries.length) return { text: '还没有任何调用记录。' };

        const lines = state.entries
          .slice(-limit)
          .reverse()
          .map(
            (e) =>
              '#' +
              e.n +
              '  ' +
              e.name.padEnd(14) +
              ' ' +
              (e.ok ? '✓' : '✗') +
              '  ' +
              fmtTime(e.at) +
              '  ' +
              brief(e.args),
          );

        return { text: lines.join('\n') };
      },
    }),
  );

  ctx.tools.register(
    defineTool({
      name: 'show_call',
      description:
        'Replay one tool call verbatim by its number: the raw arguments and the raw result, with no summary and no truncation of meaning. Use it when the user asks to see exactly what a call returned.',
      parameters: {
        id: { type: 'number', required: true, description: 'The call number, for example 12 for #12.' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: { text: { type: 'string', required: true } },
        },
        render: (_args, value) => [{ type: 'text', text: value.text }],
      },
      execute(args, exec) {
        const key = exec.agent?.id ?? 'unowned';
        const state = stateOf(key);
        const n = Math.trunc(args?.id ?? 0);

        const entry = state.byId.get(n);
        if (!entry) {
          const range = state.entries.length
            ? '现有 ' + state.entries[0].n + '–' + state.entries[state.entries.length - 1].n
            : '还没有任何记录';
          throw new Error('没有 #' + n + ' 这个调用（' + range + '）');
        }

        let rawArgs;
        try {
          rawArgs = JSON.stringify(entry.args, null, 2);
        } catch {
          rawArgs = String(entry.args);
        }

        const body = textOf(entry.content);

        return {
          text:
            '#' +
            entry.n +
            '  ' +
            entry.name +
            '  ' +
            (entry.ok ? '成功' : '失败') +
            '  ' +
            fmtTime(entry.at) +
            '\n--- 原始参数 ---\n' +
            rawArgs +
            '\n--- 原始返回 ---\n' +
            (body || '（空）'),
        };
      },
    }),
  );
}
