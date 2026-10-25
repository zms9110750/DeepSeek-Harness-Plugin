/**
 * 构建任务板的客户端 bundle。
 *
 * 产物一份：`client.js`（放在包根，由根 package.json 的 dsh.client 加载）。
 *
 * ## 为什么是一份而不是两份
 *
 * 用户要求「任务板」是一个整体：设置页一张卡片，点进去看得到全部内容。
 * 而 DSH 的客户端模块发现有个硬限制（读 dsh-client-modules 源码确认）：
 *
 *     function exactPackageSpecifier(specifier) {
 *       if (specifier.startsWith('@')) {
 *         const parts = specifier.split('/');
 *         return parts.length === 2 && parts.every(Boolean) ? specifier : undefined;
 *       }
 *       ...  // 非 @ 开头：不能含 '/' 或 ':'
 *     }
 *
 *     locatePkgJson(loaderName) {
 *       const expected = exactPackageSpecifier(loaderName);
 *       if (!pathLike && expected === undefined) return undefined;   // ← 放弃扫描
 *       ...
 *     }
 *
 * 也就是说：**row 的 name 必须是裸包名**（`@scope/name`，正好两段）。
 * `@local/taskboard/ui-drawer` 是三段 → 返回 undefined → 不做客户端发现。
 *
 * 结论：一个包里只能有**一个客户端入口**。所以两个 UI 合成一份 client.js，
 * 由包级 Config 的两个 bool 决定各自开不开（见 index.js 的 Config）。
 *
 * ## 两个 UI 共用同一份视图
 *
 * 抽屉和右侧栏画的是**同一个 TaskBoard**（用户原话：「他们拥有相同的视图」）。
 * 抄成两份会立刻分叉，所以这里一份源码、一次构建。
 */
import { build } from 'esbuild';

await build({
  entryPoints: ['client.src.js'],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  outfile: '../taskboard/packages/ui/client.js',
  logLevel: 'warning',
  define: {
    __TASKBOARD_MODULE_ID__: JSON.stringify('@local/taskboard-ui'),
  },
  /* 两个 UI 都编译进同一份产物；运行时由 Config 决定注册哪一个。
   * banner 只是给调试看的标记。 */
  banner: {
    js: 'window.__TASKBOARD_UI_PARTS__ = ["drawer", "sidebar"];',
  },
});

console.log('✅ ../taskboard/packages/ui/client.js  (@local/taskboard-ui, parts=drawer+sidebar)');
