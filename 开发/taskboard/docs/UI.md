# UI

> 界面怎么组织。两个入口、四种视图、一套主题。
>
> 代码：`packages/ui/client.js`（**打包产物，没有源文件**）、`packages/ui/index.js`

---

# 一、最重要的前提：`client.js` 是打包产物

```
packages/ui/client.js    7195 行   没有源文件
```

**直接改它。** 改完必须验证，因为没有编译步骤兜底。

## 为什么没有源文件

历史原因。最早的客户端代码是手写的单文件，后来加了打包步骤但没保留源码。

**这意味着三件事：**

1. 改之前先 `node --check` 确认语法
2. 改动要小步 —— 出问题难回滚到「改之前那一版」
3. **改状态词表这类全局替换尤其危险**（见下面「踩过的坑」）

## 包名必须是两段

```
@local/taskboard-ui    ✅ ['@local','taskboard-ui']  两段
@local/taskboard/ui    ❌ 三段，客户端永不加载
```

dsh-client-modules 的 `exactPackageSpecifier` 只认两段。这是硬限制。

---

# 二、两个入口

```js
window.__TASKBOARD_UI_PARTS__ = ["drawer", "sidebar"];
```

| 入口 | 在哪 | 组件 |
| --- | --- | --- |
| `drawer` | 输入框旁边的小箭头 | `ComposerDrawer` |
| `sidebar` | 右侧栏的「任务」标签页 | `RightbarPanel` → `TaskBoard` |

## 两个都能关

`packages/ui/index.js` 的 `Config`：

```js
export const Config = z.object({
  drawer:    z.boolean().default(true).volatile(),
  sidebar:   z.boolean().default(true).volatile(),
  prototype: z.boolean().default(false).volatile(),
});
```

**两个都关掉 = 界面上什么入口都没有。** 这时可以把整条插件记录也关掉，
客户端代码根本不加载。

## ⚠️ 每个字段都必须 `.volatile()`

源码（dsh-settings 的 `volatileForm`）会**丢掉**没有 `volatile` 的字段。
全都没有就返回 `undefined` → 没有表单 → `props.form` 是 `undefined`。

「volatile」= 改完立刻生效，不需要重新挂载插件。

## 第三个入口：原型预览

`prototype: true` 时右侧栏多一个「原型」tab，里面是 iframe 装着研究沙盘的界面。

```js
h("iframe", { srcDoc: content, sandbox: "allow-same-origin allow-scripts ..." })
```

**为什么用 iframe**：沙盘那套 CSS 是全局的（`body` / `html` / `*` 都动），
直接渲染会污染整个控制台。

**为什么走命令不走静态资源**：客户端插件拿不到自己的资源 URL
（打包后的模块没有 `import.meta.url`），唯一能跟宿主说话的路是
`remote.commands.execute`。所以 HTML 由 `taskboard-prototype` 命令返回。

---

# 三、四种视图

`TaskBoard` 是主组件，里面切视图。

| 视图 | 组件 | 什么时候用 |
| --- | --- | --- |
| **列表** | `TaskList` | 看一批任务的标题和状态 |
| **科技树** | `TechTree` | 看父子结构 |
| **详情** | `DetailPane` | 看/改一条 |
| **新建** | `CreateForm` | 建一条 |

## 科技树的画法

和 mod 里的保持一致：

```
viewBox     0 0 8 8
marker      refX 7 refY 4，7×7
path        M0 0 L8 4 L0 8 Z
正常        opacity 0.5   width 1.2
高亮        opacity 1     width 2
变暗        opacity 0.14
```

拖拽用 dagre 布局（打包进来的 `@dagrejs/dagre`）。

## 详情页的分区

```
头部    id 12.5px 在上、类别/领域标签在下、标题 19px 在右
状态    pill + 状态判别依据（目标只读，不给按钮）
关系    「展开关系 N」 —— N 是**钩子**不是预告
元数据  子工作区 / 权限 / 标记 …
正文    按章节渲染
底部    备注输入框（固定，不跟着内容滚）
```

### 「展开关系 3」为什么不给摘要

有人提过：知道有 3 条但不知道是父子还是依赖，展开前给个摘要成本很低。

**这是错的。** 那个 3 的用途**不是预告内容，是给一个打开的理由**。

写成「1 父子 · 2 依赖」，用户读完摘要会觉得「我知道了，不用点开」——
反而更少点开。只给一个数字，用户不知道内容，好奇心会推着他点。

---

# 四、状态怎么显示

## 九个状态、四组、每个状态一个颜色

```js
const STATUS_GROUPS = {
  未指定: [],
  提交: ['进行'], 处理中: ['进行'],
  需要信息: ['进行', '搁置'], 需要授权: ['进行', '搁置'],
  成功: ['结束'], 失败: ['结束'], 取消: ['结束'], 拒绝: ['结束'],
};
```

**颜色按状态取，不是按组取。**

```
完成   绿
失败   红    ← 唯一需要后续动作的终结
取消   灰
拒绝   灰    ← 主动放弃，不需要处理
需要信息 / 需要授权   黄
提交 / 处理中         蓝
```

为什么：按组取色会让「失败」和「完成」同色 ——
**一条失败的卡和一条完成的卡长得一模一样，扫一眼以为全绿**。
这不是审美问题，是看板会撒谎。

## 目标的四种推导态

目标的状态是**推导**的，不能手动设。详情页只显示四行判别依据 + 当前项高亮。

---

# 五、踩过的坑（都是真的）

## ① 状态词表漂移

改代码时把宿主的 `完成` → `成功`、`需要补充` → `需要信息` 都换了，
**忘了 `client.js` 是独立产物**。

后果不只是显示不对 —— **所有状态按钮发出的命令都被宿主拒绝**：

```
client.js:3407   runCommand("/task-state <id> 完成")   ← 硬编码旧词
宿主词表         成功 / 需要信息 / 组名 结束
```

**修完之后要核对两边完全一致**，不能只看代码「好像没旧词了」。

## ② 搜索框每敲一个字丢焦点

`oninput` → `renderAll()` → `renderAll` 第一步是 `renderFilters()` →
那里 `box.innerHTML = ''` 把搜索框连焦点一起销毁。

**修法**：渲染拆成两半：

```
renderContent()   只重绘列表和详情
renderAll()       过滤器 + 内容
```

搜索框和过滤点击改调 `renderContent()`。

## ③ 弹层被裁掉

`position: absolute` 的祖先有 `overflow: auto` → 弹层被裁。

**修法**：`position: fixed` + 自己算视口坐标（`placePop()`）。

## ④ 章节 key 靠位置对齐 → 静默写错章

老渲染器按「这是第几个标签」去对应「这是第几个章节」。
一旦对不上（`body.want = null` / 章节缺 action / 旧字符串正文），
**之后每一章都错开一格，用户改 A 章写进 B 章，不报错**。

**修法**：把 key 写进 mdx 本身（`<Ask key="want" ... />`），身份跟着标签走。

详见 [交互行为.md](./交互行为.md)。

## ⑤ 两个同名 CSS 规则，旧的赢

`.tpl-pop` 有两套规则（旧的和追加的），旧的那套 `width: 560px` 还在生效，
新写的 `width` 不起作用，表现是「弹层宽度改不动」。

**改 CSS 前先 grep 一遍有没有同名规则。**

## ⑥ `requestAnimationFrame` 在页面不可见时暂停

滚动恢复的代码放在 rAF 里，切到别的标签页时永远不执行。

**修法**：`rAF` + `setTimeout(0)` + `setTimeout(32)` 三重兜底。

---

# 六、改 UI 的检查清单

改完 `client.js` 之后：

```
1. node --check packages/ui/client.js          语法
2. node --test test/taskboard.test.mjs          79 个用例
3. 核对状态词表两边一致（宿主 vs client）
4. 起一个真浏览器点一遍                          ← 最容易漏
```

**第 4 条不能省。** 前三步全绿也可能界面是坏的 ——
`client.js` 是打包产物，语法正确 ≠ 运行时正确。

---

# 七、和其它文档的关系

| 想知道 | 看 |
| --- | --- |
| 一章怎么渲染出来 | [交互行为.md](./交互行为.md) |
| 状态有哪些、什么颜色 | [模板分类和状态转移.md](./模板分类和状态转移.md) |
| 详情页里的关系怎么来的 | [关系.md](./关系.md) |
