# ② action —— 控件与校验

> 一个 action = 一份 JSON schema + 一个渲染器。它只负责「接受什么样的参数」和「把合法参数画出来」。
> 它不知道卡片、不知道模板、不知道草稿还是采纳。

**状态：设计已收口，等待开工授权。本文档记录用户裁决、我的判断、被推翻的方案。**

**分类纪律（本文档全篇遵守）：**
`【用户指令，YYYY-MM-DD HH:MM】` = 用户逐字原话 ｜ `【事实·已查实】` = 代码/文件里核实过 ｜
`【推断】` = 我推出来的 ｜ `【实现判断】` = 我的实现选择 ｜ `【待验证】` = 需运行或需他人确认

**⚠ 凡未标 `【用户指令】` 的段落都不是用户原话。**

---

## 一、用户原话（带时间锚点）

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
> json架构必须是object最外层。因为元数据是必须要的。因为一个模板里的章节可能支持多个行为。工具并不知道到底是哪一个行为。他不能用union根据字段去判断是哪一个。所以参数里面必须有明确的指示。所以元数据是必须要的。入口的数组，是跟元数据并列的一个字段。不是最外层的壳

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

### 1.10 输入框的提示在 action 里

> 【用户指令，2026-11-01 09:21】
> hint 的提示不在这里。模板的提示，是指导 ai 怎么选择 action 的。用户的这个提示，也是显示在用模板选 action 的阶段。输入框的提示在 action 里面。也就是说，现在你模板都没准备好，不能去决定 action 里面的样子。

### 1.11 「行为」一词在两种语境下的含义

> 【用户指令，2026-11-01 06:43】
> 行为，指的是状态的转移逻辑。就像我刚刚写的都是直接写在分类上的行为。可能部分模板自己有不同的语义，状态转移，状态转移动作。

> 【用户指令，2026-11-01 09:58】
> 分类（目标，工作，设计，记录），是在代码里面有行为的，天然有英文。所以模板里面的这个字段也写英文。因为英文已经有了。代码会另外给他们一个显示名的

**⚠ 两者的区别（本包语境固定为前者）：**

| 语境 | 「行为」指 | 归属 |
|---|---|---|
| **章节的行为** | **填进章节的 action（控件）** | **② 本包** |
| **分类/模板的行为** | **状态转移逻辑** | **③ types** |

**⇒ 本文档中所有「action」均指控件，不指状态转移。**

---

## 二、已确定的语义

### 2.1 三个内置 action

| `$type` | schema 字段 | 说明 |
|---|---|---|
| `text` | `$type` / `value?` / `placeholder?` / `row?` | 自由文本输入框。**无 `readonly`** |
| `markdown` | `$type` / `value?` / `placeholder?` | **全项目唯一渲染 markdown 的地方** |
| `ask` | `$type` / `items[]`（每项 `header?` / `question?` / `options[]` / `multi_select?` / `picked?` / `placeholder?`） | 选项选择。**无 `max_picks`** |

**【事实·已查实】** 三者形状来自 `templates/actions/{text,ask,markdown}.yaml`。

### 2.2 值的形状

```
{ $type: <string>, ...该 action 的字段 }
```

- **最外层必须是 object** —— 因为元数据（`$type`）必须有，工具侧无法按字段形状判别是哪个 action
- **`$type` 必填**，它是唯一的判别入口
- **`items` 是数组**（只有 `ask` 有），长度即控件实例数，天然动态

### 2.3 章节的 `accepts` 四态（③ 提供，② 消费）

```ts
type Accepts = readonly string[] | 'any'
//  string[]（非空）→ 只允许这些 $type
//  []              → 该章节不允许任何 action（NOT 'any'，语义相反）
//  'any'           → 模板没写 accepts ⇒ 任意已注册 action（含外来）
```

**【实现判断】** `'unresolved'` 态已删除 —— ③ 用整体 `undefined` 表达"模板/章节查不到"，而 ⑧ 在建卡流程开头就 fail-closed 中止，不会把它传进 ②。

### 2.4 两个校验函数

```ts
validateForEdit(payload, { accepts })          // 只跑 L1
validateForCreate(payloads, sections)          // L1 + L2 + 完整 schema + MISSING_SECTION / SECTION_NOT_IN_TEMPLATE
```

- **`accepts` 必填、无默认** —— 它没有安全默认值（缺省 = 不限 = 静默放行）
- **`requireItems` 已彻底删除**（见 §4）
- **`validateForCreate` 对输入不做任何前置假设**：它必须能校验"任何由 `validateForEdit` 放行过的数据"，也必须能校验"从未经过编辑的数据"

### 2.5 L1 只有 4 条

```
1. payload 是 object（非 null / 非数组 / 非标量）
2. payload.$type 是非空字符串
3. $type 已注册（否则 UNKNOWN_TYPE）
4. $type ∈ accepts   （'any' 跳过此条；[] 拒绝一切；非空数组判成员）
```

**⇒ L1 不含任何字段级检查。** 理由见 §3.4。

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

**⚠ `severity` 字段已删除**（见 §4）。**`ok` 的判据不再是"全是 warning"，而是"没有 issue"。**

### 2.7 `issue code` 定稿（8 个）

```
L1:       INVALID_PAYLOAD / MISSING_TYPE / UNKNOWN_TYPE /
          NO_ACTION_ALLOWED / TYPE_NOT_IN_ACCEPTS
L2:       INVALID_FIELD
template: MISSING_SECTION / SECTION_NOT_IN_TEMPLATE
```

### 2.7b `additionalProperties: true` —— 未知字段穿过（用户 13:18 裁决）

> 【用户指令，2026-11-01 13:18】
> 不通过。

**【事实·已查实】** 三个 action 的 yaml 已改为 `additionalProperties: true`。

```yaml
additionalProperties: true   # 未知字段穿过，旧卡兼容
```

**⇒ 直接后果（`INVALID_FIELD` 的语义收窄）：**
- **`INVALID_FIELD` 只剩"已知字段类型错"**（如 `text.value` 是数字）
- **不再有"多余字段"这种错误** —— 未知字段一律放行
- **⇒ `validateForCreate` 不再拒绝未知字段**

**⇒ 为什么（用户选"放宽"的理由）**：模板改版后旧卡带新字段，**在需要重新经建卡校验的路径上**（如 fork 后重新建卡）原本会被拒。**用户答"不通过" = 不接受这个后果 ⇒ 旧卡兼容优先于 schema 封闭。**

**`SECTION_NOT_IN_TEMPLATE` = error**（建卡时模板里不存在的章节一律拒绝）。

### 2.8 `broken` 节点（渲染器遇到"上游出错"时的产物）

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

### 2.9 两个服务（② 拆成校验面与渲染面）

```ts
provide('taskboard2Actions', {          // 校验面 —— ⑦⑧⑨（8 项）
  validateForEdit, validateForCreate,
  isDeclarationOnlyChange, toIssueForUI,
  registerAction, list,
  splitPayload,                // ⑧ 判 hasUserContent（fork 时"这章丢了会不会损失数据"）
  emptyPayloadFor              // ⑧ 补 fork 时的缺章
})

provide('taskboard2Renderer', {         // 渲染面 —— ⑩
  view, edit, NodeTypes,
  viewFallback                 // 兜底渲染器（未注册 / 垃圾输入）
})
```

**【实现判断】** 拆分的理由：**⑩ 拿不到 `validateForEdit`，就 structurally 拿不到含 `diagnostic` 的 `Issue`** —— 把"`diagnostic` 不出 ②"从约定变成接口事实。

**⇒ 服务面语义**：**注册表是数据，校验方法是行为。`taskboard2Renderer` 只拿数据，不拿行为。**

### 2.9b `splitPayload` 与两个"空"的契约

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

**【实现判断】** 两个概念用**两个不同的名字**公开，**不合并成一个函数加注释** —— 注释拦不住误用。

### 2.9c `emptyPayloadFor(accepts)`

```ts
emptyPayloadFor(accepts: readonly string[] | 'any') → payload | undefined
//  吃 accepts 数组（或 'any'），不吃 $type
//  accepts === []  ⇒ 必返 undefined（该章不允许任何 action，无法补）
//  'any'           ⇒ 返回默认 action（当前是实现内置的 text）的空 payload
//  string[]        ⇒ 取第一个（与模板声明顺序一致）
```

**【实现判断】** **参数是 `accepts` 而不是 `$type`** —— **core 不该知道"哪个 action 更合适"**，它只知道自己手上这一章的候选集合作者。

### 2.10 节点描述（`view` / `edit` 的产物）

```ts
type Node =
  | { kind: 'fragment'; children: Node[] }
  | { kind: 'md'; source: string }
  | { kind: 'text'; text: string }
  | { kind: 'element'; tag: string; props: Record<string, unknown>; children: Node[] }
  | { kind: 'broken'; ... }          // 已注册但字段坏了，见 §2.8
  | { kind: 'unregistered'; ... }    // $type 未注册，见 §2.10b
  | { kind: 'raw'; json: string }    // 垃圾输入，见 §2.10c
```

**【实现判断】** DOM 风格（`tag`/`props`/`children`），不绑 React。
**⇒ `Node` 是 ② 的对外契约；DOM 风格是当前默认，不绑定任何框架。⑩ 若采用 React 风格，由 ⑩ 侧适配，② 不改。**（② 是第 0 层，不为上层框架让路）

### 2.10b 兜底渲染器（用户 13:26 要求）

> 【用户指令，2026-11-01 13:26】
> action要做一个兜底渲染器，用来渲染没有注册的架构。效果是一个按钮，写着未注册的动作。点击以后展开，展示原始json。

```ts
viewFallback(payload: unknown) → Node
```

**UI 形态（用户指定）**：
- **一个按钮，文字「未注册的动作」**
- **点击后展开**
- **展开后展示原始 JSON**

**节点表达**：
```ts
{ kind: 'unregistered',
  typeText: string,       // 原始 $type（若连 $type 都没有则为空串）
  json: string }          // 展开后展示的原始 JSON 文本
```

**【实现判断】为什么不用 `broken` 复用（(乙) 被否）**：
- **`broken` 的语义是"这个 action 我认识，但数据坏了"** ⇒ ⑩ 该提示用户"数据有问题/可能有 bug"
- **未注册是"这个 action 我根本不认识"** ⇒ ⑩ 该提示"缺了某个插件/版本不匹配"
- **混成一个 code 会让 ⑩ 无法区分这两种"该找谁"** —— 前者找数据来源，后者找装配。

**【实现判断】"原始 JSON"展示什么**：**payload 本身**，不是整张卡（渲染器的输入是 payload，不是卡）。

### 2.10c 四级降级表（渲染器必须能渲染任何输入）

**用户原话（早前已定）**：「渲染器拿不到能解析的数据就渲染成"这条坏了"的卡片，不能让整个面板白屏。」
**⇒ 现在升级为：渲染器必须能渲染任何输入，四级都要有确定输出，不许抛异常、不许白屏。**

| 级 | 输入 | 输出 | 找谁 |
|---|---|---|---|
| **1 正常** | 已注册 + 字段合法 | 正常控件 | — |
| **2 `broken`** | 已注册 + 字段坏了（required 缺失 / 类型不符） | `broken` 节点 | **找数据来源**（数据被写坏了） |
| **3 `unregistered`** | `$type` 不在注册表 | `unregistered` 节点（按钮 + 展开 JSON） | **找装配**（缺插件/版本不匹配） |
| **4 `raw`** | 连对象都不是（`null` / `42` / `"abc"` / 数组） | `raw` 节点（同样按钮 + 展开原值） | **找数据来源** |

```ts
{ kind: 'raw', json: string }    // JSON.stringify 的原文，不做任何解释
```

**⇒ 分级的判据**：**"我认不认识这个 action"**（3 vs 1/2）与 **"它是不是一个 object"**（4 vs 3）。
**⇒ 2 与 3 的区别是"该找谁"** —— 这是分级的实际价值，不是分类洁癖。

### 2.10d ⚠ 校验拒 vs 渲染不拒（两条路径必须分开）

**`UNKNOWN_TYPE` 是 L1 的第 3 条（`$type` 已注册），`validateForCreate` 会拒。**
**但用户要求未注册的 payload 能被渲染 ⇒ 说明"未注册的 payload"是能存在的。**

| 路径 | 对未注册 `$type` 的行为 |
|---|---|
| **`validateForCreate`** | **拒**（`UNKNOWN_TYPE`）—— 建卡必须是已注册 action |
| **`validateForEdit`** | **拒**（`UNKNOWN_TYPE` 也属 L1） |
| **`view` / `edit`（渲染）** | **不拒，走 `unregistered` 兜底渲染** |

**⇒ 为什么能并存**：**"能不能落库"与"能不能显示"是两个问题。**
- 未注册的 payload 可能来自：旧卡（插件卸了）、外部写入、迁移脚本
- **它不该被写进新卡，但已经存在的必须能显示** —— 否则面板白屏。

**⇒ 实现约束**：**渲染器不得依赖"payload 已经过校验"这个前提**（与 `validateForCreate` 不假设输入经过校验，是同一条原则的两侧）。

### 2.11 `edit` 的契约

```ts
edit(payload, onChange) → Node
  任何改动都调 onChange(nextPayload)
  nextPayload 是「整份候选 payload」，不是「值变了」
```

**⇒ 改 `placeholder`、加一个选项、切 `multi_select`、填值 —— 全都是「产生了一份新 payload」。**

### 2.12 空章节规则（用户 12:48 裁决的三条）

| 时刻 | 要求 | ② 的实现 |
|---|---|---|
| 建卡提交（落库） | **每章必须有 payload** | `validateForCreate` 的 `MISSING_SECTION` |
| 编辑期间（内存） | **允许不完整** | `validateForEdit` 只跑 L1 |
| 已落库的草稿卡 | **每章必须有，不能缺章** | **不变量**：它当初经 `validateForCreate` 落库；编辑期由 ⑦ 禁删键维持 |

---

## 三、我的判断与实现选择

**本节全部是【实现判断】，不是用户原话。**

### 3.1 `text` 的 `value` 是 `string`，不是 `string[]`

**依据**：`text` 的语义是"一个框里写一句或一段"。多框由 `items` 表达（只有 `ask` 有 `items`），单框的 `value` 是单值。
**【实现判断】** 若定成 `string[]`，会变成 `string[][]` 的双层数组，没有模板需要它。

### 3.2 `ask` 的 `items` 是数组 —— 一个 ask 装复数问题

**依据**：用户原话「就像你自己身上的 ask 工具…你可以填一个问题也可以一次性填写很多个问题」。
**【实现判断】** `items[i]` 各带自己的 `header` / `question` / `options` / `picked`，互不干扰。

### 3.3「未选择」和自填框恒存在，不是参数开关

**【实现判断】** 用户原话是「要有一个」「要有」，不是「可以配置」。⇒ 少两个参数 = 少两种非法组合。
**`picked` 三态**：`键不存在`（未选择）/ `[]`（看了但都不要）/ `["A"]`（选了）。

### 3.4 单选/多选是 `multi_select` 布尔，不是上限

**【实现判断】** 布尔说不清"最多选 3 个"，但用户明确「没有 max_picks」。⇒ 只有两态：佛系多选（不限）或单选（≤1）。

### 3.5 L1 只有 4 条 —— 依据是可扩展性，不是字段统计

**【实现判断】** L1 若能检查 action 私有字段，就等于 ② 在 L1 里**硬编码了 action 的形状**；而 action 可注册（含外来）⇒ 硬编码必然漏检或误判。
**⇒ L1 只能检查"所有 action 共有"的东西，而共有字段只有 `$type`。这是可扩展性的必然结论，不是取舍。**

### 3.6 `validateForEdit` 只跑 L1，不跑 schema

**【实现判断】** 若编辑期跑 schema，用户"删到 `ask` 最后一项"就存不下来（`minItems: 1` 会拒），且**无法绕过**（必须先加一项才能删）。
**⇒ 编辑期的正确性由"渲染器健壮性"兜底，不由校验兜底** —— 宽松的校验层必须配健壮的消费层。

### 3.7 `broken` 的判定：只看"上游出错"，不看"空"

**【实现判断】** 判据是「渲染器要读的字段处于上游出错状态」：
- `required` 字段缺失 ⇒ broken（`MISSING_REQUIRED`）
- 字段存在但类型不符 ⇒ broken（`TYPE_MISMATCH`）
- **可选字段缺失、空数组、空串 ⇒ 不 broken**（是用户操作的正常结果）

**⚠ 这个判据不完备**（渲染器不读的字段不会被判 broken），**但被允许**：**提交期有完整 L2 兜底，两层判据不同是分工，不是缺陷。**

### 3.8 中文文案的隔离：四层，强度逐层标注

**【实现判断】** 内部层不产最终文案。`broken` 节点无中文，`Issue.diagnostic` 可含中文（供 ⑨ 转述给模型，不直接呈现给用户）。

| 层 | 手段 | 强度 |
|---|---|---|
| 1 | 命名自证（`diagnostic` 而非 `message`） | 防不知情者 |
| 2 | lint：⑩ 源码不出现 `.diagnostic` | **可发现，可绕过** |
| 3 | 分类型导出（`IssueForUI` 不含该字段） | **编译期拦住常规用法，`as any` 可绕过** |
| 4 | ⑧ 投影时丢弃（经 `toIssueForUI`） | **运行时也读不到**（需 ⑧ 是唯一出口） |

**⇒ 前三条防"不费力的误用"，第四条才防"刻意绕过"。**

### 3.9 为什么删 `readonly` / `max_picks` / `requireItems` / `complete`

| 删掉的 | 理由 |
|---|---|
| `text.readonly` | 只读展示用 `markdown` action；两个 action 各司其职，不给 `text` 加开关 |
| `max_picks` | 用户明确没有它；单选/多选是 `multi_select` 布尔 |
| `requireItems` | **「items 非空」在 3 个 action 里 2 个不可表达、1 个被 schema 的 `minItems` 覆盖 ⇒ 空转参数**；且它是 L3 的替身 |
| `complete` / L3 | 「章节内容填齐」是伪问题（用户 07:00 驳回）；真正要求是"提交时每章有 `$type`" |

### 3.10 注册形态

**【实现判断】**
- 所有 action 在 `apply(ctx)` 内注册，返回 disposer；**不做模块加载期自注册**
- **② 的模块顶层只允许 `import` / `export` / 常量字面量，不得有调用语句** —— 因为 ⑦ 需静态 import ② 的类型，顶层副作用会在 ⑦ 加载时提前执行
- 不允许覆盖已注册的 `$type`
- **注册 API 不进工具参数**（渲染器是开发侧的，不是参数）

### 3.10b `accepts` 非法取值必须兜底拒绝，不得静默放行

**【实现判断】** `Accepts` 的静态类型只有 `readonly string[]` / `'any'`。但**运行时（JS 调用方、`any` 穿透）可能传入其他值**，TypeScript 检查不到。

**⇒ 校验函数末尾必须有兜底分支（`throw`），不得让"什么都不匹配"变成"什么都不检查"。**

```ts
function checkAccepts(accepts, $type, sectionId): Issue[] {
  if (accepts === 'any') return []
  if (Array.isArray(accepts)) {
    if (accepts.length === 0) return [NO_ACTION_ALLOWED]
    return accepts.includes($type) ? [] : [TYPE_NOT_IN_ACCEPTS]
  }
  throw new Error(`taskboard2-action: accepts 取值非法（${String(accepts)}）`)
}
```

**理由**：**若写成无兜底的 `if / else if`，非法值会两个分支都不进 ⇒ 静默跳过 `$type` 检查（fail-open）** —— 这正是"默认值是最宽松的那个"的形态。

**⇒ 为什么兜底用 `throw` 而不是新增 issue code**：`Issue` 描述**数据的问题**，而 `accepts` 非法是**调用方违反契约** —— 两者性质不同，不该共用 `issues` 通道。`throw` 让问题暴露在调用点，不会混进业务错误里。

**⚠ 这不与 §4「删 `'unresolved'`」矛盾**：`'unresolved'` 在类型里确实没有产生路径（删得对）；兜底守的是**类型系统管不到的运行时路径**。

### 3.11 `isDeclarationOnlyChange` 按 `$type` 分派答案位置

**【实现判断】** 答案位置因 action 而异（`text`/`markdown` → 顶层 `value`；`ask` → `items[i].picked`）⇒ **它隐式依赖注册表 ⇒ 不是纯函数 ⇒ 必须走服务面，不能静态导出。**

**⇒ 判据**：`provide` 里的属性只有一条到达路径（`ctx.taskboard2Actions.*`）；静态 `export` 会形成第二条路径。

### 3.12 保存策略（默认，可被单个 action 覆盖）

**【实现判断】** 行为决定"什么时候调 `onChange`"，框架只负责持久化：
- 默认：**防抖 500ms + 失焦立即 flush + 卸载/页面隐藏前 flush**
- **IME 组合过程中绝不触发保存或重渲染**（否则中文候选词被打断）
- 保存不做整体重渲染；列表 key 用我方生成的稳定 id，**不用数组索引**
- 外部值变化只在"与本地草稿不同"时采用，避免回声覆盖光标
- 保存失败：保留草稿 + 标记未保存，不清空、不弹窗打断

---

## 四、作废与被推翻的方案

| 作废项 | 作废理由 / 何时被推翻 |
|---|---|
| **9 个候选 action 清单**（`text`/`markdown`/`ask`/`rank`/`derive`/`tab`/`sort`/`creat_link` / 别名） | 用户 02:35「我这里要写的只有两个东西」 |
| **`complete` 维度 + L3（章节内容完整）** | 用户 07:00 明确驳回：「什么填齐全？…什么又是内容？」 |
| **`requireItems` 参数 + 「items 非空」规则** | 3 个 action 里 2 个无 `items`、1 个被 `minItems` 覆盖 ⇒ 空转；且它是 L3 换名字复活 |
| **`text.readonly`** | 只读展示改用 `markdown` action |
| **裸 id 章节方案（跨模板唯一）** | 用户 10:27 只要求「模板内唯一」；跨模板唯一是我们自己加的 |
| **`max_picks`** | 用户明确没有它 |
| **「L2 在任何时刻（含草稿）必须成立」** | 那句建立在"只有一个校验函数"的假设上；拆成两个函数后，L2 只在 `validateForCreate` 成立 |
| **`severity` 字段** | `SECTION_NOT_IN_TEMPLATE` 升 error 后 `warning` 无任何 code ⇒ 空壳。**⚠ 将来若出现"不阻断但需报告"的场景，必须重新加它** —— 删它的理由不是"不需要分级"，而是"当前没有任何值会产生"（类型里能出现的值必须真有产生路径） |
| **`'unresolved'` 态** | ③ 用整体 `undefined` 表达解析失败，元素级不可能失败 |
| **`ACCEPTS_UNRESOLVED` code** | 无输入可触发它 |
| **~~`splitPayload` 挂服务面~~（后又恢复）** | ⑦ 只需要一个布尔 ⇒ 曾降为内部函数。**但 ⑧ 需要它判 `hasUserContent`（fork 时"这章丢了会不会损失数据"）⇒ 已恢复到服务面（§2.9）。** 这是一次"先删后加"的记录：删是因为 ⑦ 不用，加是因为 ⑧ 用 |
| **`MdNode`** | `markdown` action 自己就是唯一渲染 md 的地方，节点描述里不需要"请你渲染 md"的节点 |
| **单服务（只有一个 `taskboard2Actions`）** | ⑩ 若 inject 它就能拿到校验方法 ⇒ `diagnostic` 隔离破；拆成校验面/渲染面两服务 |
| **「渲染器与解析器同版本成对发布」的原始理由** | 理由更正为「两者是同一开发者契约的两面」，不是"因为冻结" |
| **旧版 `packages/actions/` 作为任何正面依据** | 用户 00:36「原版项目冒烟测试没过。也不能信」；只能当故障线索 |
| **`requireItems` 的「必填 vs 可选」之争** | 问题不存在 —— 参数本身被删了 |
| **「`additionalProperties: false` = 严格拒绝未知字段」** | **作废**。用户 13:18 裁决「不通过」⇒ 三个 action 的 yaml 全部改为 `additionalProperties: true`，**未知字段穿过、旧卡兼容**。**`INVALID_FIELD` 随之收窄为"只剩已知字段类型错"，不再有"多余字段"这种错误**（§2.7b） |

---

## 五、待用户裁决

**无。**

**最后一条（`additionalProperties` 严格/放宽）已于 2026-11-01 13:18 由用户裁决为「放宽」**，见 §2.7b 与 §4。

**其余全部已答**（`domain` 纯展示、空章节规则、多章、`max_picks`、`requireItems` 删除）—— 见 §2 / §4，不在本节。

---

## 六、需要与其它成员对齐的

### 6.1 与 ③ types

| 项 | 内容 |
|---|---|
| **`sectionsOf` 签名** | `sectionsOf(templateRef: string) → Array<{ id: string; accepts: readonly string[] \| 'any' }> \| undefined` |
| **`templateRef` 是模板 `name` 字符串** | 不是对象、不是 `fullName`；`fullName → name` 的解析**归 ⑧** |
| **`accepts` 四态** | `string[]`（含 `[]`）/ `'any'`；**整体 `undefined` = 模板/章节查不到** ⇒ ⑧ fail-closed 中止，不进 ② |
| **`$type` 集合校验** | **③ 运行期零校验**。② 是唯一注册表来源（`list()`），⑧ 取它传给 ③ 的 `actionTypes`；不传 ⇒ ③ 跳过校验 |
| **`accepts ⊆ actionTypes`** | 「⑧ 传了就校验、不传就跳过」，② 不参与 |

### 6.2 与 ⑦ taskcard

| 项 | 内容 |
|---|---|
| **`inject` 含 `taskboard2Actions`** | ⑦ 通过 `ctx.taskboard2Actions.isDeclarationOnlyChange(prev, next)` 调用 |
| **不具名 import ② 的运行时导出** | 唯一例外是 `import type`（语言层擦除，不产生绑定）。静态 `export` 才是"第二个入口"，`provide` 里的属性不是 |
| **`isDeclarationOnlyChange` 只在服务面** | ② 的 `index.ts` 不 export 它 |
| **`splitPayload` 在服务面** | ⑦ 不消费它（⑦ 只要一个布尔）；**⑧ 消费**（判 `hasUserContent`）。见 §6.3 |
| **答案位置按 `$type` 分派** | `text`/`markdown` → 顶层 `value`；`ask` → `items[i].picked` |
| **`picked` 三态归一化** | `缺省`/`[]`/`[...]` 保持三个不同身份；**`缺省 → []` 判为答案变化**（声明比较先剔除答案键，所以不会误判成结构变化） |
| **② 不提供键集比较能力** | ⑦ 手上有两份 `sections`，纯本地比较；**② 不校验"编辑期新增 sectionId 是否存在于模板"** |
| **② 不校验"草稿期不得删键"** | 归 ⑦ 的键集比较（`next.sections` 键集 ⊇ `current.sections` 键集） |
| **⑦ 不消费 `Issue`** | `Issue` 由 ⑧ 处理并转文案 |

### 6.3 与 ⑧ core

| 项 | 内容 |
|---|---|
| **`sections` 参数原样传** | ⑧ 把 ③ 的 `sectionsOf(templateRef)` 结果原样传给 `validateForCreate`，无需包一层 |
| **`MISSING_SECTION` / `SECTION_NOT_IN_TEMPLATE` 都由 ② 造** | ⑧ 不自己循环造 issue |
| **`SECTION_NOT_IN_TEMPLATE` = error** | 建卡时模板里不存在的章节一律拒绝 |
| **⑧ 的 fork 义务** | **fork 旧卡时，先用 `sectionsOf(新模板)` 过滤旧 payloads，再调 `validateForCreate`**；不过滤 ⇒ 多章一律拒（**正确的失败，会立刻发现**） |
| **`toIssueForUI(issue)`** | ⑧ 在"提交校验返回"与"编辑期校验转发"两处都调它，丢弃 `diagnostic` |
| **`splitPayload(payload)`** | ⑧ 用它判 `hasUserContent`：**fork 时判断"这章丢了会不会损失用户数据"**。**⚠ `ask.picked === []` ⇒ `hasUserContent = true`**（用户主动表达"都不要"有信息量） |
| **`emptyPayloadFor(accepts)`** | ⑧ 用它补 fork 时的缺章。**吃 `accepts` 不吃 `$type`** —— core 不该知道"哪个 action 更合适"；**`accepts === []` ⇒ 返回 `undefined`**（该章不允许任何 action，无法补） |
| **⑩ 的实时校验必须经 ⑧ 转发** | ⑩ 不得直接 inject `taskboard2Actions` |
| **`assertSectionsComplete` / `updateBody` 不属 ②** | 它们是 ⑧ 的函数；② 只提供 `toIssueForUI` / `splitPayload` / `emptyPayloadFor` |

### 6.4 与 ⑩ ui

| 项 | 内容 |
|---|---|
| **`view` / `edit`** | ⑩ 调 `taskboard2Renderer.view(payload)` / `.edit(payload, onChange)` |
| **兜底渲染器 `viewFallback`** | ⑩ 遇 `$type` 未注册 / 垃圾输入时调它（或直接用 `view`，由 `view` 内部兜底）—— **见 §2.10b** |
| **`broken` / `unregistered` / `raw` 三种节点由 ⑩ 画** | 文案由 ⑩ 组织（三类节点里都无中文）；**`unregistered` 是"按钮 + 点击展开原始 JSON"**（用户 13:26 指定的形态） |
| **`Node` 契约归属 ②** | DOM 风格是默认；⑩ 若用 React 风格，由 ⑩ 侧适配，② 不改 |
| **`diagnostic` ⑩ 不可见** | 见 §3.8 四层隔离 |
| **⑩ 不得假设 payload 已过校验** | 渲染器必须能渲染四级输入（§2.10c），未注册的也要能显示 |

### 6.5 与 ④/⑤ relation / search

| 项 | 内容 |
|---|---|
| **`view` 只被 ⑩ 调** | ④/⑤ 永不调用（它们不产节点描述、不渲染） |
| **关系栏不走 `view`** | 关系栏与章节链路是**并列两块**，⑩ 两条渲染路径互不调用 |
| **② 不提供关系栏渲染件** | — |

---

## 七、附：依赖与边界

- **② 是第 0 层，`inject = []`**，不 import ① 或任何 `@local/*` 的运行时导出
- **② 不读写存储、不持有卡引用、不认识模板/章节/状态**
- **② 的唯一输入面**：`payload`（单章）、`payloads` + `sections`（整卡）、`accepts`
- **② 的唯一输出面**：校验结果、节点描述、新 payload 候选
- **渲染器必须能渲染任何输入**（四级降级，§2.10c），**校验会拒的东西渲染不拒**（§2.10d）
