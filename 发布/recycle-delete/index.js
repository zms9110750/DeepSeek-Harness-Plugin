/**
 * Recycle-bin delete.
 *
 * One model-facing tool, `delete`. It never removes anything permanently: the
 * item is handed to the Windows Recycle Bin, and when that is not possible the
 * call fails without touching the file.
 *
 * The work happens in a PowerShell helper because the Shell API for "send to
 * recycle bin" lives in Microsoft.VisualBasic.FileIO, which the Host cannot call
 * directly.
 *
 * @module @local/recycle-delete
 */

import { spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineTool } from '@deepseek-ai/dsh-tools';

export const name = 'recycle-delete';

export const inject = ['tools', 'workingDirectory'];

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, 'delete.ps1');

/** Windows PowerShell 5.1, present on every supported Windows build. */
function powershellPath() {
  const root = process.env.SystemRoot ?? 'C:\\Windows';
  return join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

/**
 * Send one path to the recycle bin.
 * @param target - absolute path.
 */
function recycle(target) {
  return new Promise((done, fail) => {
    const child = spawn(
      powershellPath(),
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT, '-Path', target],
      { stdio: 'ignore', windowsHide: true },
    );

    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) fail(error);
      else done();
    };

    const timer = setTimeout(() => {
      child.kill();
      finish(new Error('delete timed out'));
    }, 30000);

    child.on('error', (error) => finish(new Error('could not start the delete helper: ' + error.message)));
    child.on('exit', (code) =>
      finish(
        code === 0
          ? undefined
          : new Error(
              'not deleted: the item could not be moved to the Recycle Bin (helper exit ' +
                code +
                '). Nothing was removed — handle it manually.',
            ),
      ),
    );
  });
}

/** True when the path no longer exists. */
async function gone(path) {
  try {
    await stat(path);
    return false;
  } catch {
    return true;
  }
}

export function apply(ctx) {
  ctx.tools.register(
    defineTool({
      name: 'delete',
      description:
        'Delete a file or folder by moving it to the Windows Recycle Bin. This never deletes permanently: if the item cannot be recycled (unsupported volume, permissions, network path), the call fails and nothing is removed, so the user can handle it themselves. Prefer this over a shell remove command.',
      parameters: {
        path: {
          type: 'string',
          required: true,
          description: 'Absolute path, or a path relative to the session working directory.',
        },
        reason: {
          type: 'string',
          description: 'Why it is being deleted — recorded in the result for the user.',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            path: { type: 'string', required: true },
            kind: { type: 'string', required: true },
            recycled: { type: 'boolean', required: true },
            reason: { type: 'string' },
          },
        },
        render: (_args, value) => [
          {
            type: 'text',
            text:
              'Sent to Recycle Bin: ' +
              value.path +
              ' (' +
              value.kind +
              ')' +
              (value.reason ? ' — ' + value.reason : ''),
          },
        ],
      },
      async execute(args, exec) {
        let cwd = process.cwd();
        try {
          const session = exec.agent?.session;
          if (session) cwd = ctx.workingDirectory.get(session);
        } catch {
          /* keep the process directory */
        }

        const target = isAbsolute(args.path) ? args.path : resolve(cwd, args.path);

        let info;
        try {
          info = await stat(target);
        } catch {
          throw new Error('nothing to delete: ' + target + ' does not exist');
        }

        const kind = info.isDirectory() ? 'folder' : 'file';

        await recycle(target);

        if (!(await gone(target))) {
          throw new Error(
            'not deleted: ' + target + ' still exists after the recycle call. Nothing was removed.',
          );
        }

        return { path: target, kind, recycled: true, reason: args.reason };
      },
    }),
  );
}
