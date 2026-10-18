/**
 * UI capture tool.
 *
 * The Host runs inside an Electron utility process, so neither `webContents`
 * nor `BrowserWindow` is reachable from here. The window is therefore copied by
 * the operating system: a small PowerShell helper finds the visible Harness
 * window and calls PrintWindow with PW_RENDERFULLCONTENT, then saves a PNG.
 *
 * The capability exists only while a rendered window does. In a headless or
 * browser-less run the helper finds no window and the call fails with that
 * reason instead of substituting something else.
 *
 * @module @local/ui-capture
 */

import { spawn } from 'node:child_process';
import { mkdir, open, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineTool } from '@deepseek-ai/dsh-tools';

export const name = 'ui-capture';

export const inject = ['tools', 'workingDirectory'];

const HERE = dirname(fileURLToPath(import.meta.url));
const CAPTURE_SCRIPT = join(HERE, 'capture.ps1');

/** Windows PowerShell 5.1, present on every supported Windows build. */
function powershellPath() {
  const root = process.env.SystemRoot ?? 'C:\\Windows';
  return join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

/** Local timestamp used in the file name: 20261018-173045. */
function stamp(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return (
    date.getFullYear().toString() +
    p(date.getMonth() + 1) +
    p(date.getDate()) +
    '-' +
    p(date.getHours()) +
    p(date.getMinutes()) +
    p(date.getSeconds())
  );
}

/**
 * Run the helper and wait for it to finish.
 * @param file - the PNG path the helper must write.
 */
function runCapture(file) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      powershellPath(),
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', CAPTURE_SCRIPT, '-Out', file],
      { stdio: 'ignore', windowsHide: true },
    );

    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    };

    const timer = setTimeout(() => {
      child.kill();
      finish(new Error('capture timed out'));
    }, 20000);

    child.on('error', (error) => finish(new Error('could not start the capture helper: ' + error.message)));
    child.on('exit', (code) =>
      finish(
        code === 0
          ? undefined
          : new Error(
              'capture failed: no rendered window surface could be copied (helper exit ' +
                code +
                '). This tool works only while the Harness window is visible.',
            ),
      ),
    );
  });
}

/**
 * Read the pixel size straight out of the PNG header.
 * @param file - a PNG file.
 */
async function pngSize(file) {
  const handle = await open(file, 'r');
  try {
    const header = Buffer.alloc(24);
    await handle.read(header, 0, 24, 0);
    return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
  } finally {
    await handle.close();
  }
}

export function apply(ctx) {
  ctx.tools.register(
    defineTool({
      name: 'screenshot',
      description:
        'Capture the current Harness window exactly as it renders and return the PNG path. Use it to see the actual interface: layout, spacing, colors, and whether a UI plugin really draws what it claims. It requires a rendered window, so it fails in headless runs. Nothing on screen is clicked or scrolled; the capture is read-only.',
      parameters: {},
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            path: { type: 'string', required: true },
            width: { type: 'integer', required: true },
            height: { type: 'integer', required: true },
            bytes: { type: 'integer', required: true },
          },
        },
        render: (_args, value) => [
          {
            type: 'text',
            text:
              'Captured ' +
              value.width +
              'x' +
              value.height +
              ' (' +
              Math.round(value.bytes / 1024) +
              ' KiB) → ' +
              value.path,
          },
        ],
      },
      async execute(_args, exec) {
        const session = exec.agent?.session;
        let cwd = process.cwd();
        try {
          if (session) cwd = ctx.workingDirectory.get(session);
        } catch {
          /* keep the process directory */
        }

        const directory = join(cwd, 'screenshots');
        await mkdir(directory, { recursive: true });

        const file = join(directory, 'ui-' + stamp() + '.png');
        await runCapture(file);

        const info = await stat(file);
        const { width, height } = await pngSize(file);

        return { path: file, width, height, bytes: info.size };
      },
    }),
  );
}
