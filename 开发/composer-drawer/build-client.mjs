/**
 * 构建客户端 bundle。
 *
 * 一份源码（client.src.js）→ 两个**独立包**的 client.js：
 *
 *   ../taskboard-ui-drawer/client.js    输入栏旁边的箭头抽屉
 *   ../taskboard-ui-sidebar/client.js   右侧栏的「任务」标签页
 *
 * 为什么用一份源码：两个 UI **共用同一个 TaskBoard 视图**
 * （用户要求「他们拥有相同的视图」）。抄成两份会立刻分叉——
 * 改了抽屉忘了改侧栏，是最容易出的错。
 *
 * 为什么是两个独立的包而不是同一个包里的两个子目录：
 * 客户端半边靠**包级** `dsh.client` 声明（写在 package.json 上）被发现，
 * 而加载器扫的是 loader entry 模块名对应的那个 package.json。
 * 同一个包只能声明一次 `dsh.client`，所以两个 UI 必须是两个包。
 */
import { build } from 'esbuild';

const TARGETS = [
  {
    outfile: '../taskboard-ui-drawer/client.js',
    moduleId: '@local/taskboard-ui-drawer',
    parts: ['drawer'],
  },
  {
    outfile: '../taskboard-ui-sidebar/client.js',
    moduleId: '@local/taskboard-ui-sidebar',
    parts: ['sidebar'],
  },
];

for (const target of TARGETS) {
  await build({
    entryPoints: ['client.src.js'],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    outfile: target.outfile,
    logLevel: 'warning',
    /* 构建时注入模块 id。 */
    define: {
      __TASKBOARD_MODULE_ID__: JSON.stringify(target.moduleId),
    },
    /* 要装哪一半，用 banner 写在最前面（IIFE 之外）——
     * 客户端 load 时先读 window.__TASKBOARD_UI_PARTS__。 */
    banner: {
      js: `window.__TASKBOARD_UI_PARTS__ = ${JSON.stringify(target.parts)};`,
    },
  });
  console.log(`✅ ${target.outfile}  (${target.moduleId}, parts=${target.parts.join('+')})`);
}
