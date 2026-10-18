/**
 * UI screenshot tool.
 *
 * Captures the desktop shell's own window through Electron's capturePage and
 * writes a PNG under `<session cwd>/screenshots/`. There is no browser-side
 * half: the picture is taken by the Host from the live window surface.
 *
 * Electron is loaded lazily, at call time, through CommonJS: its ESM facade does
 * not expose `BrowserWindow` as a named export, and a top-level import would
 * make the whole plugin fail to load.
 *
 * The capability only exists when a rendered UI is attached. In a headless or
 * browser-less run there is no window to capture, and the tool reports that
 * instead of inventing a substitute.
 *
 * @module @local/ui-screenshot
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { defineTool } from '@deepseek-ai/dsh-tools';

export const name = 'ui-screenshot';

export const inject = ['tools', 'workingDirectory'];

/** Cached Electron namespace; `undefined` until the first capture. */
let cachedElectron;

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
 * Load Electron from the Host process.
 * @returns the Electron module namespace.
 */
async function electron() {
  if (cachedElectron !== undefined) return cachedElectron;

  const attempts = [];

  try {
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    cachedElectron = require('electron');
    return cachedElectron;
  } catch (error) {
    attempts.push('require: ' + error.message);
  }

  try {
    const mod = await import('electron');
    cachedElectron = mod.default ?? mod;
    return cachedElectron;
  } catch (error) {
    attempts.push('import: ' + error.message);
  }

  throw new Error('screenshot unavailable: Electron is not reachable (' + attempts.join(' | ') + ')');
}

/** The window the user is actually looking at, when the shell has one. */
function liveWindow(electronModule) {
  const BrowserWindow = electronModule?.BrowserWindow;
  if (!BrowserWindow) return undefined;

  const windows = BrowserWindow.getAllWindows().filter((win) => !win.isDestroyed());
  if (!windows.length) return undefined;
  return windows.find((win) => win.isVisible()) ?? windows[0];
}

/**
 * Capture the window surface.
 * @returns the PNG bytes and its pixel size.
 */
async function capture() {
  const electronModule = await electron();
  const win = liveWindow(electronModule);

  if (!win) {
    throw new Error(
      'screenshot unavailable: no rendered UI is attached [' +
        'process.type=' + String(process.type) +
        '; electron=' + String(process.versions.electron) +
        '; BrowserWindow=' + typeof electronModule?.BrowserWindow +
        '; keys=' + Object.keys(electronModule ?? {}).slice(0, 10).join(',') +
        ']',
    );
  }

  const image = await win.webContents.capturePage();
  const { width, height } = image.getSize();
  if (!width || !height) {
    throw new Error('captured an empty image — the window is probably minimized');
  }

  return { png: image.toPNG(), width, height };
}

export function apply(ctx) {
  ctx.tools.register(
    defineTool({
      name: 'screenshot',
      description:
        'Capture the current Harness window exactly as it renders and save it as a PNG, returning the file path. Use it to see the actual interface: layout, spacing, colors, and whether a UI plugin really draws what it claims. It requires a rendered window, so it fails in headless runs. Nothing on screen is clicked or scrolled; the capture is read-only.',
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

        const { png, width, height } = await capture();
        const directory = join(cwd, 'screenshots');
        await mkdir(directory, { recursive: true });

        const file = join(directory, 'ui-' + stamp() + '.png');
        await writeFile(file, png);

        return { path: file, width, height, bytes: png.length };
      },
    }),
  );
}
