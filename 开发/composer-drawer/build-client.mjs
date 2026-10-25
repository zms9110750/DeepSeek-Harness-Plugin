/**
 * 构建客户端 bundle。
 *
 * 一份源码（client.src.js）→ 三个包：
 *
 *   ui-drawer   输入框旁边的箭头抽屉
 *   ui-sidebar  右侧栏的「任务」标签页
 *   full        两个都装（兼容旧的单包用法）
 *
 * 为什么用一份源码：两个 UI **共用同一个 TaskBoard 视图**
 * （用户要求「他们拥有相同的视图」）。抄成两份会立刻分叉——
 * 改了抽屉忘了改侧栏，是最容易出的错。
 *
 * 三个包在设置页是三个独立插件，各有开关。
 */
import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';

const TARGETS = [
  { dir: 'ui-drawer', moduleId: '@local/taskboard-ui-drawer', parts: ['drawer'] },
  { dir: 'ui-sidebar', moduleId: '@local/taskboard-ui-sidebar', parts: ['sidebar'] },
  { dir: 'full', moduleId: '@local/composer-drawer', parts: ['drawer', 'sidebar'] },
];

for (const target of TARGETS) {
  await build({
    entryPoints: ['client.src.js'],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    outfile: `client.${target.dir}.js`,
    logLevel: 'warning',
    /* 构建时注入：模块 id + 要装哪一半。
       注意 parts 用 JSON 字符串，客户端读的是 window.__TASKBOARD_UI_PARTS__。 */
    define: {
      __TASKBOARD_MODULE_ID__: JSON.stringify(target.moduleId),
    },
    banner: {
      js: `window.__TASKBOARD_UI_PARTS__ = ${JSON.stringify(target.parts)};`,
    },
  });
  console.log(`✅ client.${target.dir}.js  (${target.moduleId}, parts=${target.parts.join('+')})`);
}
