# ② action —— 控件与校验

> 一个 action = 一份 JSON schema + 一组渲染函数。它只负责「接受什么样的参数」和「把参数画出来」。
> 它不知道卡片、不知道模板、不知道草稿还是采纳。

**状态：代码已落地（`packages/action/src/`），本文档与代码同步。**
**⚠ 未编译验证** —— 本会话 shell 因 ACL 故障不可用，`tsc` 一次都没跑过。

**分类纪律（本文档全篇遵守）：**
`【用户指令，YYYY-MM-DD HH:MM】` = 用户逐字原话 ｜ `【事实·已查实】` = 代码/文件里核实过 ｜
`【推断】` = 我推出来的 ｜ `【实现判断】` = 我的实现选择 ｜ `【待验证】` = 需运行或需他人确认

**⚠ 凡未标 `【用户指令】` 的段落都不是用户原话。**

---

## 一、用户原话（带时间锚点）

### 1.0 ⭐ 渲染器必须是函数，不是字符串（本轮最关键的一条）

> 【用户指令，2026-11-02 11:26】
> 渲染器开发是需要一个函数的，而不是在action里面用字符串写要什么。

### 1.1 action 只有两个核心 + 一个纯展示

> 【用户指令，2026-11-01 02:35】
> action行为清单。问他，他打算写什么行为。
> 我这里要写的只有两个东西。
> 一个是文本框，一个是选择框。一个纯展示
> 剩下的东西都是加在他们上面的。
> 例如文本框，文本框内部要有html的文本框那种没有内容，就显示虚色的字体。例如一个文本框上面要有可以可以渲染的md。
> 选择框要有一个"未选择"按钮。单选和多选是同一个行为，基于参数不同而变化。并且要有用户自行输入的输入框。
> 而且他们都要是数组形式。
> 例如：模板的章节会问，本次要设计什么问题。然后下面一个章节写，具体的设计。然后一个章节只有一个行为。所以一个行为都必须容纳复数数量。可以支持多个并列的选项。可以支持多个并列的文本框。
> 又比如选项卡，例如"预期不符"，有一个章节是"最小复现/出现频率"。他们是互斥的，二选一。虽然这里都是文本框。但是考虑可能性，以后可能某个章节的行为也是互斥的。所以，选项卡行为，包含选项卡和内容，内容则是递归的行为。但选项卡只是预告，现在没有做的必要性。不是冒烟测试里面的要求。

> 【用户指令，2026-11-01 02:35】
> 纯展示可以是文本框的只读（但那不叫作只读。文本框内的是不渲染的。只有文本框外面的标题才有md渲染），也可以是第三种行为。这是实现问题不是设计问题。
> 用文本框加禁止输入框，也能达到纯展示，那就是"实现了这个功能"

### 1.2 值的形状：object 最外层 + `$type` + 入口数组

> 【用户指令，2026-11-01 02:35】
> 行为，他的数量是动态的。也就是说，json架构，除了元数据（例如$type)以外，入口就是数组（或者是union，不用数组也可以支持一个直接成员）。因为json自己就是数组。所以数量是不固定的。
> 就像你自己身上的ask工具。他是一个参数决定是单选还是多选。你可以填一个问题也可以一次性填写很多个问题。

> 【用户指令，2026-11-01 02:35】
> json架构必须是object最外层。因为元数据是必须要的。因为一个模板里的章节可能支持多个行为。工具并不知道到底是哪一个行为。他不能用union根据字段去判断是哪一个。所以参数里面必须有明确的指示。所以元数据是必须要的。入口的数组，是跟元数据并列的一个字段，不是最外层的壳

### 1.3 章节声明是 union

> 【用户指令，2026-11-01 02:47】
> 章节声明的行为是union，是多个候选的。选择了以后，才用确定的一个去判断。所以行为才要有类似于选项卡这样的复合型，用于递归行为的，包装性质的行为。

### 1.4 渲染器是冻结的

> 【用户指令，2026-11-01 02:17】
> ai不直接写标签。ai写的是json。是给ai tool的参数。这个参数会到后端被当成数据和储存。然后这个渲染器（桥接层）翻译为ui界面上面的可点击交互的东西。渲染器是他的工作，是做完以后冻结的东西。是以后的ai不能插手的东西。渲染器是开发者侧的东西。不是一个参数。行为是固定的。

> 【用户指令，2026-11-01 02:17】
> 冻结是指渲染器不是变量。不会因为用户侧的参数而改变行为。也就是说不会发生sql注入的情况。
> 要动他必须去开发侧去动。

### 1.5 MD 只在控件外部渲染

> 【用户指令，2026-11-01 02:35】
> 文本框内的是不渲染的。只有文本框外面的标题才有md渲染

### 1.6 保存时机

> 【用户指令，2026-11-01 02:35】
> 用户点击的值什么回写。没有设计。包括外部提供的行为和渲染器可以有不同规范。但是，至少要望文生义的看起来像html的表单行为。逐字保存，失去焦点保存，带防抖的输入保存，点击保存按钮，不干涉。但是不能丢失数据，不能用户输入一大堆然后没了。也不能一次保存就刷新界面，把位置变了。

### 1.7 用户也要能制造合法 JSON

> 【用户指令，2026-11-01 04:25】
> action 给他进行补充。渲染器，一个是已经被 ai 提交参数的合法的行为的 json。这个要渲染为 ui。除此外，ai 是直接写 json 送来的。没有问题。但用户是 ui 创建行为的。所以所有的参数，都要有用户可以写的地方并且也渲染为 ui。也就是制造这个合法的 json 的这个过程，也要图形化操作。这点他考虑过吗？

### 1.8 空章节规则

> 【用户指令，2026-11-01 07:00】
> 什么填齐全？现在连一个模板的章节都没有定义。确认了解了问题了吗？什么又是内容？我说的章节是可选行为的。而提交的时候必须要有行为。

> 【用户指令，2026-11-01 12:48】
> 提交时必须有。编辑期间可以是内存状态。但只要上了草稿就必须有行为了

### 1.9 中文只在终端

> 【用户指令，2026-11-01 03:10】
> 9 态的中文只在终端（ui 层、ai 工具层、dsh 命令层）；任务板内部交互用的就是英文名

### 1.10 兜底渲染器

> 【用户指令，2026-11-01 13:26】
> action要做一个兜底渲染器，用来渲染没有注册的架构。效果是一个按钮，写着未注册的动作。点击以后展开，展示原始json。

### 1.11 `additionalProperties` 放宽

> 【用户指令，2026-11-01 13:18】
> 不通过。

### 1.12 「行为」一词在两种语境下的含义

> 【用户指令，2026-11-01 06:43】
> 行为，指的是状态的转移逻辑。就像我刚刚写的都是直接写在分类上的行为。可能部分模板自己有不同的语义，状态转移，状态转移动作。

**⚠ 两者的区别（本包语境固定为前者）：**

| 语境 | 「行为」指 | 归属 |
|---|---|---|
| **章节的行为** | **填进章节的 action（控件）** | **② 本包** |
| **分类/模板的行为** | **状态转移逻辑** | **③ types** |

**⇒ 本文档中所有「action」均指控件，不指状态转移。**

---

## 二、已确定的语义

### 2.1 三个内置 action

**【事实·已查实】** 形状来自 `templates/actions/{text,ask,markdown}.yaml` 与
`packages/action/src/builtin/*.ts`，两边一致。

| `$type` | schema 字段 | 说明 |
|---|---|---|
| `text` | `$type` / `value?` / `placeholder?` | 自由文本。**无 `row`**、**无 `readonly`** |
| `markdown` | `$type` / `value?` / `placeholder?` | **全项目唯一渲染 markdown 的地方** |
| `ask` | `$type` / `items[]`（每项 `header?` / `question?` / `options[]` / `multi_select?` / `picked?` / `custom?` / `placeholder?`） | 选项选择。**无 `max_picks`** |

**⚠ `text` 不再有 `row`** —— 多行由渲染器自动增长，长到一定高度变滚动（见 §4）。

### 2.2 值的形状

```
{ $type: <string>, ...该 action 的字段 }
```

- **最外层必须是 object** —— 因为元数据（`$type`）必须有，工具侧无法按字段形状判别是哪个 action
- **`$type` 必填**，它是唯一的判别入口
- **`items` 是数组**（只有 `ask` 有），长度即控件实例数，天然动态
- **schema 只在创建时校验**；运行中不校验 —— **可以有额外字段，只要渲染器看得懂**

### 2.3 ⚠ `accepts` 已彻底移除

**【事实·已查实】** 模板章节不再有 `accepts` 字段；`sectionsOf` 不再返回它；`SectionSpec` 只剩 `{ id: string }`。

**⇒ 连带删除**（见 §4）：
- `type Accepts` / `type Accept`（整个类型）
- `NO_ACTION_ALLOWED` / `TYPE_NOT_IN_ACCEPTS`（两个 issue code）
- `validateForEdit` 的 `accepts` 入参
- `emptyPayloadFor(accepts)` 的 `accepts` 入参

### 2.4 两个校验函数

```ts
validateForEdit(payload, opts?: { sectionId?: string })   // 只跑 L1
validateForCreate(payloads, sections)                     // L1 + L2 + 完整 schema + MISSING_SECTION / SECTION_NOT_IN_TEMPLATE
```

- **`opts` 唯一字段是 `sectionId`**（只用于把问题定位回章节）；`accepts` 删了之后它没有必填项，故有默认值 `{}`
- **两个函数都不假设输入经过任何前置校验**：要"任意输入 → 判断"，不能"已知良好输入 → 增量检查"

### 2.5 L1 只有 3 条

```
1. payload 是 object（非 null / 非数组 / 非标量）
2. payload.$type 是非空字符串
3. $type 已注册（否则 UNKNOWN_TYPE）
```

**⇒ L1 不含任何字段级检查。** 理由见 §3.5。

### 2.6 `Issue` 形状

```ts
interface Issue {
  level: 'L1' | 'L2' | 'template'
  code: IssueCode
  sectionId: string
  field?: string
  path?: string
  diagnostic?: string      // 供 ⑨ 转述给模型；⑩ 不可见
}

ok = issues.length === 0
```

**⚠ 无 `severity` 字段**（见 §4）。

### 2.7 `issue code` 定稿（6 个）

```
L1:       INVALID_PAYLOAD / MISSING_TYPE / UNKNOWN_TYPE
L2:       INVALID_FIELD
template: MISSING_SECTION / SECTION_NOT_IN_TEMPLATE
```

**`SECTION_NOT_IN_TEMPLATE` = error**（建卡时模板里不存在的章节一律拒绝）。

**⚠ `INVALID_FIELD` 只剩"已知字段类型错"**（如 `text.value` 是数字）；**不再有"多余字段"这种错误**（`additionalProperties: true`，见 §4）。

### 2.8 ⭐ 渲染器：四态 + 函数

```ts
type RenderPhase = 'create' | 'active' | 'ended' | 'plain';
type Renderer = (payload: unknown, onChange: (next: ActionPayload) => void) => Node | string;

interface ActionDefinition {
  $type: string
  summary: string
  schema: SchemaNode
  render: Partial<Record<RenderPhase, Renderer>>   // ← 挂的是真函数
}
```

**⇒ 渲染器是函数，不是"用字符串写要什么"**（用户 11:26）。

### 2.9 四态的语义

| 态 | `text` | `markdown` | `ask` |
|---|---|---|---|
| **create** | **只画灰字输入框**（`value` 若有值，原样保留、不画控件） | 源码框 + 「查看预览」按钮 | 选项 + 「未选择」+ 自填框 |
| **active** | 灰字只读显示，内容可编辑 | 只读渲染 | 同 create |
| **ended** | 只读，允许刮取复制 | 只读渲染 | 只读展示选择结果，可刮取 |
| **plain** | 返回 `value` 字符串 | 返回 md 源码原样 | 问题 / 描述 / 选项 / 用户选择 |

**⚠「刮取」= CSS `user-select: text`**，属渲染器/组件职责，**不在节点上加字段**（节点只标 `data-selectable: true` 供 ⑩ 用）。

**⚠ `markdown.create` 不画预览** —— 只给 `data-role: preview-toggle` 按钮，**展开状态归 ⑩**（见 §4）。

### 2.10 态回退规则（`plain` 不参与节点回退）

```
请求 create → create → active → ended → （都不行）降级节点
请求 active → active → ended → create → （都不行）降级节点
请求 ended  → ended → active → create → （都不行）降级节点
请求 plain  → 只查 plain，没有就降级
```

**【实现判断】** 若把 `plain` 混进回退链，请求 `ended` 时会拿到 `string`，而调用方期望 `Node` —— **那是类型错误，不是降级**。
**⇒ `plain` 只在请求 `plain` 时使用，永不作为节点态的替代。**

### 2.11 9 个具名渲染函数导出

**【事实·已查实】** 与 `templates/actions/*.yaml` 的 `renderer:` 一一对应：

```
textCreate / textActive / textEnded / textPlain
markdownCreate / markdownView / markdownPlain
askEditable / askEnded / askPlain
```

**共用关系是有意的，不要拆：**
- `markdown` 的 `active` / `ended` 共用 `markdownView`
- `ask` 的 `create` / `active` 共用 `askEditable`

**⚠ 它们的定位：不是给 inject 方用的。** 调用方应该用服务面的 `render(payload, phase)` —— 它会按 `$type` 查表、按态回退、并做降级。**这些导出只是「YAML 里的名字确实存在」的锚点。**

### 2.12 `normalizeResult` 兜底

**【实现判断】** 渲染器返回类型写错时的兜底：

| 情况 | 处理 |
|---|---|
| 请求 `plain`，拿到 `Node` | 转成字符串（用**安全版** `stringify`，不抛） |
| 节点态，拿到 `string` | 包成 `text()` 节点（不把 `string` 当 `Node` 交给 ⑩） |

**理由**：`string` 直接当 `Node` 交给 ⑩，会在 ⑩ 里炸，且**炸点离根因很远**。

### 2.13 `ask` 的 `custom` 与 `picked`

**【事实·已查实】** 自填值进 `custom`，**不进 `picked`**。

**`picked` 三态**：
```
字段不存在  → 未选择
[]         → 看了，但都不要
["A"]      → 选了 A
```

**⚠「未选择」与自填框恒存在**，不是参数开关（用户 02:35「要有一个」「要有」）。

### 2.14 `broken` 节点（已注册但字段坏了）

```ts
{ kind: 'broken',
  actionType: string,        // 哪个 $type 的渲染失败了
  code: 'MISSING_REQUIRED' | 'TYPE_MISMATCH',
  field: string,
  expected?: string,         // 仅 TYPE_MISMATCH
  actual?: string }          // 仅 TYPE_MISMATCH
```

- **不含任何人类语言字符串**（文案由 ⑩ 组织）
- **判据**：字段是 `required` 却不存在 / 字段存在但类型不符
- **不判"空"**：`items: []`、`value: ""` 是正常空状态，不是 broken

### 2.15 两个服务（校验面 / 渲染面）

```ts
provide('taskboard2Actions', {          // 校验面 —— ⑦⑧⑨（10 项）
  validateForEdit, validateForCreate,
  isDeclarationOnlyChange, toIssueForUI,
  registerAction, list,
  splitPayload,                // ⑧ 判 hasUserContent（fork 时"这章丢了会不会损失数据"）
  emptyPayloadFor,             // ⑧ 补 fork 时的缺章
  isEmptyForValidity,
  hasUserContent,
})

provide('taskboard2Renderer', {         // 渲染面 —— ⑩（2 项）
  render,                      // render(payload, phase, onChange?) → Node | string
  NodeTypes,
})
```

**⚠ ⑩ 只拿渲染面，不拿校验面** —— 否则它能拿到 `validateForEdit`，进而拿到含 `diagnostic` 的 `Issue`，第四层隔离就破了。

**【实现判断】** 拆分的理由：**⑩ 拿不到 `validateForEdit`，就 structurally 拿不到含 `diagnostic` 的 `Issue`** —— 把"`diagnostic` 不出 ②"从约定变成接口事实。

**⇒ 服务面语义**：**注册表是数据，校验方法是行为。`taskboard2Renderer` 只拿数据与渲染，不拿行为。**

### 2.16 节点描述

```ts
type Node =
  | { kind: 'fragment'; children: Node[] }
  | { kind: 'md'; source: string }
  | { kind: 'text'; text: string }
  | { kind: 'element'; tag: string; props: Record<string, unknown>; children: Node[] }
  | { kind: 'broken'; ... }          // 已注册但字段坏了，见 §2.14
  | { kind: 'unregistered'; ... }    // $type 未注册
  | { kind: 'raw'; json: string }    // 垃圾输入
```

**【实现判断】** DOM 风格（`tag`/`props`/`children`），不绑 React。
**⇒ `Node` 是 ② 的对外契约；DOM 风格是当前默认，不绑定任何框架。⑩ 若采用 React 风格，由 ⑩ 侧适配，② 不改。**（② 是第 0 层，不为上层框架让路）

### 2.17 四级降级（渲染器必须能渲染任何输入）

| 级 | 输入 | 输出 | 找谁 |
|---|---|---|---|
| **1 正常** | 已注册 + 字段合法 | 正常控件 | — |
| **2 `broken`** | 已注册 + 字段坏了 | `broken` 节点 | **找数据来源**（数据被写坏了） |
| **3 `unregistered`** | `$type` 不在注册表 | `unregistered` 节点（按钮 + 展开 JSON） | **找装配**（缺插件/版本不匹配） |
| **4 `raw`** | 连对象都不是（`null` / `42` / 字符串 / 数组） | `raw` 节点（同样按钮 + 展开原值） | **找数据来源** |

**`unregistered` 节点**（用户 13:26 指定的形态：按钮「未注册的动作」+ 点击展开原始 JSON）：
```ts
{ kind: 'unregistered',
  typeText: string,       // 原始 $type（连 $type 都没有则为空串）
  json: string }          // 展开后展示的原始 JSON 文本
```

**⇒ 分级的判据**：**"我认不认识这个 action"**（3 vs 1/2）与 **"它是不是一个 object"**（4 vs 3）。
**⇒ 2 与 3 的区别是"该找谁"** —— 这是分级的实际价值，不是分类洁癖。

### 2.18 校验拒 vs 渲染不拒

| 路径 | 对未注册 `$type` 的行为 |
|---|---|
| **`validateForCreate`** | **拒**（`UNKNOWN_TYPE`）—— 建卡必须是已注册 action |
| **`validateForEdit`** | **拒**（`UNKNOWN_TYPE` 也属 L1） |
| **`render`（渲染）** | **不拒，走 `unregistered` 兜底渲染** |

**⇒ 为什么能并存**：**"能不能落库"与"能不能显示"是两个问题。**
未注册的 payload 可能来自旧卡（插件卸了）、外部写入、迁移脚本 —— **它不该被写进新卡，但已经存在的必须能显示**，否则面板白屏。

### 2.19 `splitPayload` 与两个"空"的契约

```ts
splitPayload(payload) → { declaration, answer }
//  declaration = 去掉所有答案字段后的结构（含 $type、items 长度与顺序、每个 item 除答案外的字段）
//  answer      = 按 items 顺序排列的答案值
```

**⚠ 同一份 payload 上有两个"空"，判据相反，必须用两个名字分开：**

| 概念 | 判据 | `ask.picked = []` | `text.value = ""` | `ask.items = []` |
|---|---|---|---|---|
| **`isEmptyForValidity`** | 合法性用 | 空 | 空 | 空 |
| **`hasUserContent`** | **是否有用户表达** | **有内容** | 无 | 无 |

**⇒ 写死一条：`ask.picked === [] ⇒ hasUserContent = true`。**

**理由**：**用户主动表达"都不要"是有信息量的，丢了就是丢信息。** 若这条不写死，**fork 时会静默丢掉用户的"都不要"表态。**

### 2.20 `emptyPayloadFor(preferredType?)`

```ts
emptyPayloadFor(preferredType?: string) → payload | undefined
//  收可选的 $type（不是 accepts —— accepts 已删）
//  preferredType 已注册 ⇒ 用它
//  否则 ⇒ 退到内置 text
//  再否则 ⇒ 退到第一个已注册的 action
//  一个 action 都没注册 ⇒ undefined
```

**⇒ 参数从 `accepts` 改成 `preferredType`**（见 §4）。

### 2.21 答案位置按 `$type` 分派

```
text     → 顶层 value
markdown → 顶层 value
ask      → items[i].picked
```

**⇒ ② 提供 `isDeclarationOnlyChange(prev, next) → boolean`**：真 = 只有答案变；**元素增删 / 顺序变化 / 任一声明字段变化 都判假**。

**⚠ 唯一出参是布尔** —— 不存在返回 diff 的重载或兄弟函数（否则 ⑦ 会开始理解字段语义，与"对 payload 零参与"冲突）。

### 2.22 空章节规则

| 时刻 | 要求 | ② 的实现 |
|---|---|---|
| 建卡提交（落库） | **每章必须有 payload** | `validateForCreate` 的 `MISSING_SECTION` |
| 编辑期间（内存） | **允许不完整** | `validateForEdit` 只跑 L1 |
| 已落库的草稿卡 | **每章必须有，不能缺章** | **不变量**：当初经 `validateForCreate` 落库；编辑期由 ⑦ 禁删键维持 |

---

## 三、我的判断与实现选择

**本节全部是【实现判断】，不是用户原话。**

### 3.1 `text` 的 `value` 是 `string`，不是 `string[]`

**依据**：`text` 的语义是"一个框里写一句或一段"。多框由 `sections` 的多个章节表达，单框的 `value` 是单值。
**→ 若定成 `string[]`，会变成 `string[][]` 的双层数组，没有模板需要它。**

### 3.2 `ask` 的 `items` 是数组 —— 一个 ask 装复数问题

**依据**：用户原话「就像你自己身上的 ask 工具…你可以填一个问题也可以一次性填写很多个问题」。
**→ `items[i]` 各带自己的 `header` / `question` / `options` / `picked` / `custom`，互不干扰。**

### 3.3 单选/多选是 `multi_select` 布尔，不是上限

**→ 布尔说不清"最多选 3 个"，但用户明确「没有 max_picks」。⇒ 只有两态：多选（不限）或单选（≤1）。**

### 3.4 `create` 只画灰字，不画内容框

**依据**：用户 02:35「文本框内部要有 html 的文本框那种没有内容，就显示虚色的字体」。
**→ `create` 态只能编辑 `placeholder`（灰字）；`value` 若有值（AI 传的）原样保留、不画控件。**
**`active` 态才是"填内容"的地方** —— 这两个态的分离，正是"创建时定义这一章长什么样、进行时填这一章的内容"。

### 3.5 L1 只有 3 条 —— 依据是可扩展性，不是字段统计

**→ L1 若能检查 action 私有字段，就等于 ② 在 L1 里硬编码了 action 的形状；而 action 可注册（含外来）⇒ 硬编码必然漏检或误判。**
**⇒ L1 只能检查"所有 action 共有"的东西，而共有字段只有 `$type`。这是可扩展性的必然结论，不是取舍。**

### 3.6 `validateForEdit` 只跑 L1，不跑 schema

**→ 若编辑期跑 schema，用户"删到 `ask` 最后一项"就存不下来（`minItems: 1` 会拒），且无法绕过（必须先加一项才能删）。**
**⇒ 编辑期的正确性由"渲染器健壮性"兜底，不由校验兜底** —— 宽松的校验层必须配健壮的消费层。

### 3.7 `broken` 的判定：只看"上游出错"，不看"空"

**→ 判据是「渲染器要读的字段处于上游出错状态」：**
- `required` 字段缺失 ⇒ broken（`MISSING_REQUIRED`）
- 字段存在但类型不符 ⇒ broken（`TYPE_MISMATCH`）
- **可选字段缺失、空数组、空串 ⇒ 不 broken**（是用户操作的正常结果）

**⚠ 这个判据不完备**（渲染器不读的字段不会被判 broken），**但被允许**：**提交期有完整 L2 兜底，两层判据不同是分工，不是缺陷。**

### 3.8 中文文案的隔离：四层，强度逐层标注

**→ 内部层不产最终文案。`broken` / `unregistered` / `raw` 节点无中文，`Issue.diagnostic` 可含中文（供 ⑨ 转述给模型，不直接呈现给用户）。**

| 层 | 手段 | 强度 |
|---|---|---|
| 1 | 命名自证（`diagnostic` 而非 `message`） | 防不知情者 |
| 2 | lint：⑩ 源码不出现 `.diagnostic` | **可发现，可绕过** |
| 3 | 分类型导出（`IssueForUI` 不含该字段） | **编译期拦住常规用法，`as any` 可绕过** |
| 4 | ⑧ 投影时丢弃（经 `toIssueForUI`） | **运行时也读不到**（需 ⑧ 是唯一出口） |

**⇒ 前三条防"不费力的误用"，第四条才防"刻意绕过"。**

### 3.9 `plain` 不参与节点回退

**→ `plain` 的返回类型是 `string`，节点态是 `Node`。混进回退链会让"请求 ended"拿到 string —— 那是类型错误，不是降级。**
**⇒ `plain` 单独一支；四个态完全缺失才走降级节点。**

### 3.10 注册形态

**→**
- 所有 action 在 `apply(ctx)` 内注册，返回 disposer；**不做模块加载期自注册**
- **② 的模块顶层只允许 `import` / `export` / 常量字面量，不得有调用语句** —— 因为 ⑦ 需静态 import ② 的类型，顶层副作用会在 ⑦ 加载时提前执行
- 不允许覆盖已注册的 `$type`
- **注册 API 不进工具参数**（渲染器是开发侧的，不是参数）

### 3.11 `isDeclarationOnlyChange` 不是纯函数

**→ 它按 `$type` 分派答案位置 ⇒ 隐式依赖注册表 ⇒ 不是纯函数 ⇒ 必须走服务面，不能静态导出。**

**⇒ 判据**：`provide` 里的属性只有一条到达路径（`ctx.taskboard2Actions.*`）；静态 `export` 会形成第二条路径。

**⚠ 但 9 个渲染函数是例外**：它们被导出，但**不是给调用方用的**（调用方该用 `render()`）—— 它们只是 YAML 对照表的锚点，见 §2.11。

### 3.12 保存策略（默认，可被单个 action 覆盖）

**→ 行为决定"什么时候调 `onChange`"，框架只负责持久化：**
- 默认：**防抖 500ms + 失焦立即 flush + 卸载/页面隐藏前 flush**
- **IME 组合过程中绝不触发保存或重渲染**（否则中文候选词被打断）
- 保存不做整体重渲染；列表 key 用稳定 id，**不用数组索引**
- 外部值变化只在"与本地草稿不同"时采用，避免回声覆盖光标
- 保存失败：保留草稿 + 标记未保存，不清空、不弹窗打断

### 3.13 渲染器不得抛、不得白屏

**→ `safeRender` 兜住"渲染器自身抛异常"；`normalizeResult` 兜住"返回类型写错"。**
**⇒ 这两层兜的是 bug，不是数据问题** —— 数据问题由 `readField` 在 action 内部处理（产出 `broken` 节点）。

---

## 四、作废与被推翻的方案

| 作废项 | 作废理由 / 何时被推翻 |
|---|---|
| **`render: { view, edit }` 两态** | **用户 11:26「渲染器开发是需要一个函数的」** ⇒ 渲染器必须挂真函数。**同时从 2 态扩到 4 态**（`create` / `active` / `ended` / `plain`），因为"创建时只能改灰字、进行时填内容、终结后只读、给 AI 要纯文本"是四种不同行为 |
| **`accepts` 整个概念** | 模板章节不再有该字段（用户 11:26 批；③ 已删）。连带作废：`type Accepts`、`SectionSpec.accepts`、`validateForEdit` 的 `accepts` 入参、`validateForCreate` 的 `accepts` 校验 |
| **`NO_ACTION_ALLOWED` / `TYPE_NOT_IN_ACCEPTS`** | `accepts` 删了 ⇒ 这两个 code 没有输入能触发。按"类型里能出现的值必须真有产生路径"删 |
| **`emptyPayloadFor(accepts)`** | 改成 `emptyPayloadFor(preferredType?: string)` —— 收可选 `$type`，不收 `accepts` |
| **L1 的第 4 条（`$type ∈ accepts`）** | 随 `accepts` 一起删。**L1 从 4 条降到 3 条** |
| **`text.row` 字段** | **多行由渲染器自动增长，长到一定高度变滚动** —— 不需要数据字段控制高度 |
| **`markdown.create` 的常驻预览** | 预览是**点按钮才展开**；且**展开状态归 ⑩**，② 只给 `data-role: preview-toggle` 标记 |
| **`edit` / `view` 两个入口** | 合成单个 `render(payload, phase, onChange?)` —— 相位是参数，不是入口 |
| **态回退里包含 `plain`** | 会让"请求 ended"拿到 `string` 而调用方期望 `Node` —— **类型错误不是降级**。`plain` 只在请求 `plain` 时用 |
| **`ask` 的自填值混入 `picked`** | 改成进 `custom`（与 YAML 一致）。`picked` 只装"选了哪些现有选项" |
| **`additionalProperties: false` = 严格拒绝未知字段** | **用户 13:18 裁决「不通过」** ⇒ 三个 action 的 yaml 全部改为 `additionalProperties: true`，**未知字段穿过、旧卡兼容**。`INVALID_FIELD` 随之收窄为"只剩已知字段类型错" |
| **`severity` 字段** | `SECTION_NOT_IN_TEMPLATE` 升 error 后 `warning` 无任何 code ⇒ 空壳。**⚠ 将来若出现"不阻断但需报告"的场景，必须重新加它** —— 删它的理由不是"不需要分级"，而是"当前没有任何值会产生" |
| **`'unresolved'` 态** | ③ 用整体 `undefined` 表达解析失败，元素级不可能失败 |
| **`ACCEPTS_UNRESOLVED` code** | 无输入可触发它 |
| **`complete` 维度 + L3（章节内容完整）** | 用户 07:00 明确驳回：「什么填齐全？…什么又是内容？」 |
| **`requireItems` 参数 + 「items 非空」规则** | 3 个 action 里 2 个无 `items`、1 个被 `minItems` 覆盖 ⇒ 空转；且它是 L3 换名字复活 |
| **`requireItems` 的「必填 vs 可选」之争** | 问题不存在 —— 参数本身被删了 |
| **`text.readonly`** | 只读展示改用 `markdown` action |
| **`max_picks`** | 用户明确没有它 |
| **9 个候选 action 清单**（`rank` / `derive` / `tab` / `sort` / `creat_link` / 别名） | 用户 02:35「我这里要写的只有两个东西」 |
| **裸 id 章节方案（跨模板唯一）** | 用户 10:27 只要求「模板内唯一」；跨模板唯一是我们自己加的 |
| **「L2 在任何时刻（含草稿）必须成立」** | 那句建立在"只有一个校验函数"的假设上；拆成两个函数后，L2 只在 `validateForCreate` 成立 |
| **`~~splitPayload` 挂服务面~~（后又恢复）** | ⑦ 只需要一个布尔 ⇒ 曾降为内部函数。**但 ⑧ 需要它判 `hasUserContent` ⇒ 已恢复到服务面。** 这是一次"先删后加"的记录 |
| **`MdNode`** | 曾考虑删（"markdown action 自己是唯一渲染 md 的地方"）；**实际保留** —— `markdown` 的 `view` 需要把 md 源文本递给 ⑩ 的 Markdown 管线，这正是 `md` 节点的用途 |
| **单服务（只有一个 `taskboard2Actions`）** | ⑩ 若 inject 它就能拿到校验方法 ⇒ `diagnostic` 隔离破；拆成校验面/渲染面两服务 |
| **旧版 `packages/actions/` 作为任何正面依据** | 用户 00:36「原版项目冒烟测试没过。也不能信」；只能当故障线索 |
| **`render.ts` 的 `builders` 导出** | `{ element, fragment, text }` —— **定义了但零使用**。⑩ 通过 `render(payload, phase)` 拿节点就够了。**将来 ⑩ 要包一层容器时再加**，现在留着是死代码 |
| **`issue.ts` 的 `toIssuesForUI`（批量投影）** | **零消费者** —— ⑧ 自己 `issues.map(actions.toIssueForUI)` 逐条调单个版，不需要批量版 |

---

## 五、待用户裁决

**无。**

**最后一条（`additionalProperties` 严格/放宽）已于 2026-11-01 13:18 由用户裁决为「放宽」**，见 §4。

---

## 六、需要与其它成员对齐的

### 6.1 与 ③ types

| 项 | 内容 |
|---|---|
| **`sectionsOf` 签名** | `sectionsOf(templateRef: string) → Array<{ id: string }> \| undefined`（**不再有 `accepts`**） |
| **`templateRef` 是模板 `name` 字符串** | 不是对象、不是 `fullName`；`fullName → name` 的解析**归 ⑧** |
| **`accepts` 已删** | ② 不再消费它；`validateForCreate` 的 `sections` 只吃 `{ id }` |
| **`$type` 集合校验** | **③ 运行期零校验**。② 是唯一注册表来源（`list()`） |

### 6.2 与 ⑦ taskcard

| 项 | 内容 |
|---|---|
| **`inject` 含 `taskboard2Actions`** | ⑦ 通过 `ctx.taskboard2Actions.isDeclarationOnlyChange(prev, next)` 调用 |
| **不具名 import ② 的运行时导出** | 唯一例外是 `import type`。**⚠ 9 个渲染函数虽然被导出，但不是给 ⑦ 用的**（见 §2.11） |
| **`isDeclarationOnlyChange` 只在服务面** | ② 的 `index.ts` 不 export 它 |
| **`splitPayload` 在服务面** | ⑦ 不消费；**⑧ 消费**（判 `hasUserContent`） |
| **答案位置按 `$type` 分派** | `text`/`markdown` → 顶层 `value`；`ask` → `items[i].picked`（**自填值在 `custom`，不在 `picked`**） |
| **`picked` 三态归一化** | `缺省`/`[]`/`[...]` 保持三个不同身份；**`缺省 → []` 判为答案变化** |
| **② 不提供键集比较能力** | ⑦ 手上有两份 `sections`，纯本地比较 |
| **② 不校验"草稿期不得删键"** | 归 ⑦ 的键集比较（`next.sections` 键集 ⊇ `current.sections` 键集） |
| **⑦ 不消费 `Issue`** | `Issue` 由 ⑧ 处理并转文案 |

### 6.3 与 ⑧ core

| 项 | 内容 |
|---|---|
| **`sections` 参数只吃 `{ id }`** | ⑧ 把 ③ 的 `sectionsOf(templateRef)` 结果原样传给 `validateForCreate` |
| **`MISSING_SECTION` / `SECTION_NOT_IN_TEMPLATE` 都由 ② 造** | ⑧ 不自己循环造 issue |
| **`SECTION_NOT_IN_TEMPLATE` = error** | 建卡时模板里不存在的章节一律拒绝 |
| **⑧ 的 fork 义务** | **fork 旧卡时，先用 `sectionsOf(新模板)` 过滤旧 payloads，再调 `validateForCreate`**；不过滤 ⇒ 多章一律拒（**正确的失败，会立刻发现**） |
| **`toIssueForUI(issue)`** | ⑧ 在"提交校验返回"与"编辑期校验转发"两处都调它，丢弃 `diagnostic` |
| **`splitPayload(payload)`** | ⑧ 用它判 `hasUserContent`。**⚠ `ask.picked === []` ⇒ `hasUserContent = true`** |
| **`emptyPayloadFor(preferredType?)`** | ⑧ 用它补 fork 时的缺章。**收可选 `$type`，不收 `accepts`** |
| **⑩ 的实时校验必须经 ⑧ 转发** | ⑩ 不得直接 inject `taskboard2Actions` |
| **`assertSectionsComplete` / `updateBody` 不属 ②** | 它们是 ⑧ 的函数；② 只提供 `toIssueForUI` / `splitPayload` / `emptyPayloadFor` |

### 6.4 与 ⑩ ui

| 项 | 内容 |
|---|---|
| **`render(payload, phase, onChange?)`** | ⑩ 调服务面这一个入口，**不要直接调 9 个具名函数** |
| **四态语义** | 见 §2.9；`create` 只能改灰字、`active` 改内容、`ended` 只读可刮取、`plain` 是纯文本 |
| **`broken` / `unregistered` / `raw` 三种节点由 ⑩ 画** | 文案由 ⑩ 组织（三类节点里都无中文）；**`unregistered` 是"按钮 + 点击展开原始 JSON"** |
| **`data-selectable`** | ② 只标这个属性；**实际 `user-select: text` 由 ⑩/组件负责** |
| **`data-role: preview-toggle`** | `markdown.create` 只给这个标记；**「展开与否」归 ⑩ 持有** |
| **`Node` 契约归属 ②** | DOM 风格是默认；⑩ 若用 React 风格，由 ⑩ 侧适配，② 不改 |
| **`diagnostic` ⑩ 不可见** | 见 §3.8 四层隔离 |
| **⑩ 不得假设 payload 已过校验** | 渲染器必须能渲染四级输入（§2.17） |

### 6.5 与 ④/⑤ relation / search

| 项 | 内容 |
|---|---|
| **`render` 只被 ⑩ 调** | ④/⑤ 永不调用（它们不产节点描述、不渲染） |
| **关系栏不走 `render`** | 关系栏与章节链路是**并列两块**，⑩ 两条渲染路径互不调用 |
| **② 不提供关系栏渲染件** | — |

---

## 七、附：依赖与边界与代码位置

**依赖**
- **② 是第 0 层，`inject = []`**，不 import ① 或任何 `@local/*` 的运行时导出
- **② 不读写存储、不持有卡引用、不认识模板/章节/状态**

**输入 / 输出**
- **输入面**：`payload`（单章）、`payloads` + `sections`（整卡）、`phase`（渲染态）
- **输出面**：校验结果、节点描述 / 纯文本、新 payload 候选

**硬约束**
- **渲染器必须能渲染任何输入**（四级降级，§2.17），**校验会拒的东西渲染不拒**（§2.18）

**代码位置**（`packages/action/src/`）

| 文件 | 内容 |
|---|---|
| `index.ts` | Cordis 入口：`name` / `inject` / `apply` → provide 两个服务；9 个渲染函数导出 |
| `types.ts` | `SchemaNode` / `ActionPayload` / `Issue` / `RenderPhase` / `Renderer` / `ActionDefinition` |
| `nodes.ts` | 7 种 `Node` + 构造器 + `readField` 安全读取 + `isPlainObject` / `stringify` |
| `registry.ts` | `registerAction`（校验 + 冻结 + disposer）/ `getAction` / `list` |
| `validate.ts` | `runL1`（3 条）/ `runL2`（schema walk）/ `validateForEdit` / `validateForCreate` |
| `issue.ts` | `toIssueForUI`（**真删 `diagnostic`**） |
| `split.ts` | `splitPayload` / `isDeclarationOnlyChange` / `isEmptyForValidity` / `hasUserContent` |
| `empty.ts` | `emptyPayloadFor(preferredType?)` |
| `render.ts` | `render` / `pickRenderer`（`NODE_FALLBACK`）/ `safeRender` / `normalizeResult` / `NodeTypes` |
| `builtin/text.ts` | `textCreate` / `textActive` / `textEnded` / `textPlain` |
| `builtin/markdown.ts` | `markdownCreate` / `markdownView` / `markdownPlain` |
| `builtin/ask.ts` | `askEditable` / `askEnded` / `askPlain` |

**⇒ 已删除的两处死导出**（见 §4）：`render.ts` 的 `builders`、`issue.ts` 的 `toIssuesForUI`。
