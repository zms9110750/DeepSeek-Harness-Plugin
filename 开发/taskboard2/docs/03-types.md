# ③ types —— 类型体系（状态 / 分类 / 模板 / 编号）

> 任务类型的整套词汇与规则。四块：`status` → `kind` → `template` → `id`，严格单向。
>
> **本文档只描述 ③ 自己**：它对外给什么、它怎么判断、它明确不做什么。
> 接口形状已与 ①②④⑦⑧ 逐条对齐；内容里的取舍标注来源等级。

---

## 一、用户原话（带时间锚点）

> 【用户指令，2026-11-01 01:29】
> 接口我不管。只要能支持全类型就可以了。接口问题他们让成员之间互相汇报提问。这也是一个不到冒烟测试不知道的东西。做大概就行了。有了原型实现才能改。

> 【用户指令，2026-11-01 01:29】
> 采纳是用户的按钮。把"草稿"转为"提交"的这个状态转移过程叫做采纳。只能用户来做。
> 领取是从"提交"状态转移为"处理中"的动作。
> 第九态使用"未指定"，不用"未知"。

> 【用户指令，2026-11-01 00:57】
> 草稿不是组。只有一个情况，做类型联合没有意义。但是，他的实际名字是未指定。而我在里面的术语都会用草稿。

> 【用户指令，2026-11-01 06:43】
> 行为，指的是状态的转移逻辑。就像我刚刚写的都是直接写在分类上的行为。可能部分模板自己有不同的语义，状态转移，状态转移动作。

> 【用户指令，2026-11-01 06:43】
> 草稿不能 fork。fork 和编辑，是一个按钮。

> 【用户指令，2026-11-01 06:43】
> 被取代后，如果没有完成，那么直接归为取消。如果完成了，不动状态。仍然参与，但是因为已经处于取消，大部分问题都不存在。

> 【用户指令，2026-11-01 06:43】
> 所有任务都可以创建子任务。任务图是一个像科技树的东西。

> 【用户指令，2026-11-01 06:43】
> 墓碑只有草稿才能进去。而草稿是不能被指的。

> 【用户指令，2026-11-01 06:43】
> 模板可以改。

> 【用户指令，2026-11-01 06:43】
> 建卡是提交时发号。

> 【用户指令，2026-11-01 06:43】
> 设计、记录，用户可以直接转为取消。
> 设计类、记录类，初始关系就是需要授权。

> 【用户指令，2026-11-01 06:55】
> 占位算的是"工作"且为"处理中"。目标的处理中是不算的。
> 工作一旦被自动转换为"搁置"类别下的状态，就已经不算处理中了。
> （释放后）回到「提交」。
> （未完成）不算。他们是终态。"完成"，是一个状态组。包括成功，失败，取消，拒绝。

> 【用户指令，2026-11-01 07:00】
> 章节是可选行为的，而提交的时候必须要有行为。

> 【用户指令，2026-11-01 12:48】
> （草稿能否作为关系目标）不含草稿
> （`{{ title }}` 指谁）源卡（当前卡）的标题
> （domain 存什么）保持纯展示
> （提交之后空章节）提交时必须有。编辑期间可以是内存状态。但只要上了草稿就必须有行为了

> 【用户指令，2026-11-01 03:32】
> 编号默认的就用他们的首字母。目标是 goal。
> 第100个是3位。
> ui 和终端显示的都是 GU-02。
> 空模板显示 G-02，是接受的。
> 外部注册不保证唯一性。不会因为非他的错而导致他不可用。
> 所以也允许 GUA-02 的形式。这里不限制。
> 删除是标记为删除。不是持久化里面不存了。
> 编号是用于搜索的，不是用于查询的。查询模板，列出模板，用的是他的元数据的模板完全名。

> 【用户指令，2026-11-01 03:47】
> 数字递增是看前缀的。会有 G01, GA01, GD01, GTT01

> 【用户指令，2026-11-01 03:32】
> 模板的元数据要有显示名，或者 i18n。他们的元数据名字就是英文的。
> 但即便如此也不能是算出来的，就是要填一个用于拼接编号的东西。而这一栏为空字符串是合法的。null 则不行。

> 【用户指令，2026-11-01 06:43（同一批，时间未能精确到分钟）】
> 9态的中文只在终端。例如 ui 层，ai 工具层，dsh 命令层。任务板内部交互用的就是英文名。

> 【用户指令，2026-11-01 06:43（同一批，时间未能精确到分钟）】
> 草稿期间不能换模板。但模板里面的行为可以换。关系也可以换。标题可以换。但编号不能换。而编号是基于模板（和模板的分类）算出来的。所以编号不换，模板就不能换。

---

## 二、已确定的语义

### 2.1 状态（`status.ts`）

**九个状态，固定，不开放注册。**

```
TASK_STATE_UNSPECIFIED  TASK_STATE_SUBMITTED  TASK_STATE_WORKING
TASK_STATE_INPUT_REQUIRED  TASK_STATE_AUTH_REQUIRED
TASK_STATE_COMPLETED  TASK_STATE_FAILED  TASK_STATE_CANCELED  TASK_STATE_REJECTED
```

- **字面量 = A2A 协议全名**（`TASK_STATE_*`）。依据用户 01:29「第九态使用"未指定"，不用"未知"」+ 00:57 的兼容要求，取协议全名而非线上小写。**【实现判断】**
- **`DRAFT = TaskState.UNSPECIFIED`**（独立常量，不进 `TaskState` 对象，因此 `Object.values(TaskState)` 仍是 9 项无重复）。
- **`DRAFT` 是"草稿"的**唯一**代码标识**；「草稿」是它的中文术语（用户 00:57）。**③ 不持有中文**（见 6.5）。

**组（三个，固定，禁止注册）：**

| 组 | 成员 |
|---|---|
| `ActiveStatus`（进行） | `SUBMITTED` · `WORKING` |
| `ShelvedStatus`（搁置） | `INPUT_REQUIRED` · `AUTH_REQUIRED` |
| `EndedStatus`（完成） | `COMPLETED` · `FAILED` · `CANCELED` · `REJECTED` |

- **组只是 TS 类型联合，没有任何运行时对象、没有任何行为。** 用途仅限「判断某状态是否属于某组」。
- **草稿不属于任何组**（用户 00:57「草稿不是组」）。
- **`EndedStatus` = 用户 06:55 所说的「完成」小组**：终态即完成态，两者等价。
- **不导出 `STATUS_GROUPS`（运行时可遍历数组）** —— 见 4.4。

### 2.2 分类（`kind.ts`）

**分类 = 一组可注册的规则数据，不是 `switch`。**

```ts
type KindDef = {
  id: Kind;
  initialStatus: TaskState;              // 建卡时的初始状态
  baseStatus: (input) => TaskState;      // 所有计算规则都不成立时的落点
  computeRules: readonly ComputeRule[];  // 有序；首个 when 为真者胜
  quota: readonly TaskState[];           // 占位判定用的状态集合
};
```

**判定顺序（固定，不是配置）：**
1. 状态 ∈ `EndedStatus` ⇒ **不重算**（终态粘滞）。
2. 状态 = `DRAFT` ⇒ **不重算**（草稿不参与）。
3. 顺序跑 `computeRules`，**首个 `when` 为真者胜**。
4. 全不成立 ⇒ **`baseStatus`**。

**内置四类初始值：**

| `id` | `initialStatus` | `baseStatus` |
|---|---|---|
| `goal` | `UNSPECIFIED` | `SUBMITTED` |
| `design` | `AUTH_REQUIRED` | `AUTH_REQUIRED` |
| `work` | `UNSPECIFIED` | `isHeld ? WORKING : SUBMITTED` |
| `record` | `AUTH_REQUIRED` | `AUTH_REQUIRED` |

- 依据用户 06:43「设计类、记录类，初始关系就是需要授权」+ 06:55 的释放/占位语义。**【事实·用户原话】**
- `goal` 的「无子任务或全草稿 → 提交」由 `baseStatus` 承担，不单列规则（同值，避免双写）。
- **内置四类与外部注册项走同一条 `registerKind`，零特权分支。**

**占位（quota）：**
- **`kind === 'work'` 且 `status === WORKING` 才算占位**（用户 06:55）。
- **目标的「处理中」不占位**；工作一旦滑入搁置，就不再算处理中 ⇒ 占位自动释放，**不需要显式 `release`**。**【事实·用户原话】**

**转移判决：`canTransition(kind, from, to, actor, ctx) → { ok: true } | { ok: false, reason }`**

```ts
type Actor = 'user' | 'ai' | 'host';
type TransitionCtx = {
  depsAllEnded: boolean;        // 依赖目标是否全部处于「完成」组（= EndedStatus）
  actorHasActiveWork: boolean;  // 该 actor 名下是否已有「处理中的工作」卡
};
```
- `actor` 只分三种：用户 / AI / 宿主。足以表达「用户可、AI 不可」的条目（采纳、释放以外的若干）。
- **所有"外部世界的事实"都走 `ctx`，不走 `actor`** —— `actor` 只承载身份种类，不承载依赖、占用、计数等状态信息。
- **③ 只给判决，不执行、不写状态、不维护领取。**

**`ctx.depsAllEnded` 的用途（`DEPENDS_ON_GATE` 规则）：**
- 规则：`to === WORKING && from === SUBMITTED && kind === 'work' && !ctx.depsAllEnded ⇒ 拒绝`。
- **依据用户 13:18**：「效果是所有依赖对象都进入了完成态，这个卡才能被领取（从提交转为处理中的那个状态转换的按钮）」。
- **依赖是否全部完成由 ⑧ 计算后传入**（⑧ 取依赖目标状态 → 算"是否全部 ∈ `EndedStatus`" → 传给 ③）⇒ **③ 仍不读关系、不查别的卡。**
- **只对「提交 → 处理中」这一条转移生效**；其它转移不受依赖影响。
- **`undefined` 必须报错，不得默认 `true`** —— 默认 `true` = 静默放行领取（fail-open）。

**采纳与领取（转移的名字，不是状态值）：**

| 动作 | 转移 | 允许者 |
|---|---|---|
| **采纳** | `UNSPECIFIED → SUBMITTED` | **仅用户** |
| **领取** | `SUBMITTED → WORKING` | 用户 / AI |
| **释放** | `WORKING → SUBMITTED` | 用户 / AI |

- 依据用户 01:29（采纳只能用户、领取是提交→处理中）+ 06:55（释放回提交）。**【事实·用户原话】**
- **采纳不产生任何关系**；「取代」只在 fork 时建立，与采纳无关。**【实现判断·已与⑦对齐】**

**工作类「一个 actor 只能占一张」：**
- 规则 `WORK_SINGLE_CLAIM`：`to === WORKING && kind === 'work' && actorHasActiveWork ⇒ 拒绝`。
- **规则表述在 ③，计算与拦截在 ⑧，⑦ 只做单卡准入并把 ⑧ 的布尔原样递给 ③；`undefined` 必须报错，不得默认 `false`。**【实现判断·三方已对齐】

### 2.3 模板（`template.ts`）

**模板 = 元数据 + 章节声明，不含任何 payload。**

```ts
type TemplateDef = {
  name: string;          // 稳定英文标识
  fullName: string;      // 入口别名（用户输入面）
  kind: Kind;
  domain: string;        // 纯展示，中文字面量（用户 12:48）
  codePrefix: string;    // 拼编号用；'' 合法，null 非法
  sections: readonly SectionDef[];
  displayName?: string;  // 不落中文
};

type SectionDef = {
  id: string;       // 模板内唯一；正则 /^[A-Za-z][A-Za-z0-9_-]*$/
  label: string;    // 纯文本，不渲染 md
  accepts: Accept;  // 见 2.4
  required: boolean; // 纯元数据，无校验语义
};
```

- **`codePrefix` 必须显式填，不从 `name` 推**（用户 03:32「不能是算出来的」）；`''` = 该模板不提供字母段（如空模板）。
- **`required` 是纯声明、无闸门**（② 不读、⑧ 不拦）。它的存在只为「UI 必填标记」。
- **模板层可注册 `computeRules`，语义 = 追加/回落**：`模板层 → 分类层 → 兜底`。
  - **安全规则（终态不可转、草稿不可直转处理中、`WORK_SINGLE_CLAIM`、草稿不参与计算）不在 `computeRules` 里，因此任何层都不可覆盖。**
  - **`initialStatus` 不可被模板覆盖**（四类初始状态是用户裁的；若可改，会造出"有草稿期的设计卡"，连锁破坏三条已裁结论）。

### 2.4 `accepts` 三态

```ts
type Accept = readonly string[] | 'any';
```
- **非空数组** = 只允许这些 `$type`。
- **`[]`（空数组）** = **该章节不接受任何 action**（禁止）。
- **`'any'`** = 章节省略了 `accepts` ⇒ 任意已注册 action。
- **没有第四态。** 模板或章节查不到 ⇒ **查询函数整体返回 `undefined`**，不是元素态。

### 2.5 编号（`id.ts`）

**编号 = 前缀 + 流水号，直接拼接，无分隔符。**

- **canonical**：`/^[A-Z]+[0-9]+$/`（大写、无连字符）。例 `G01` / `GA01` / `GTT01`（用户 03:47）。
- **展示形**：`G-01` / `GU-02`（`toDisplay` 插入一个连字符）；**空模板显示 `G-02`**（用户 03:32 已接受）。
- **前缀 = 分类字母 + 模板的 `codePrefix`**；`codePrefix === ''` 时退化为「分类字母 + 流水」。
- **递增按前缀分桶**（用户 03:47「数字递增是看前缀的」）；**每个 `(工作空间, 前缀)` 一套序列**，互不影响。
- **流水号补零 2 位，`≥100` 自然三位**（用户 03:32「第100个是3位」），不截断、不回绕。
- **唯一性只在工作空间内**（用户 03:32「编号是一个工作空间内唯一」）；跨空间可重复。
- **删除是标记删除**（用户 03:32）⇒ **编号永不复用，跳号合法**。⇒ `nextId` 的 `usedIds` **必须含墓碑** —— 这是**调用方义务**，不是 ③ 的，也不是 ① store 的。
- **外部注册不保证唯一**（用户 03:32）⇒ **不得因编号冲突拒绝外部模板**；「编号全局唯一」不是不变式，只是内部空间的性质。

四个函数：

```ts
nextId(prefix, usedIds) → string      // 纯函数：按前缀过滤 + 取 max + 1；不读存储；不管并发（事务归 ⑧）
parse(id)               → { prefix, serial } | undefined   // 只拆字母段与数字段；不解析分类/模板/空间
normalize(raw)          → string      // 去空白/连字符、转大写
toDisplay(id)           → string      // 插连字符
```
- **`parse` 不反推分类**：外部注册可同前缀、一模板多分类、前缀长度不定 ⇒ **解析不出**。要分类请走 `resolve`。
- **归一化只有一份**（`normalize` / `toDisplay` 由 ③ 提供），**消费者不得自带第二份**。

### 2.6 对外 9 个导出（定稿）

```ts
// 注册（⑧ 启动编排）
registerTemplate(tpl, opts?: { actionTypes?: readonly string[] })

// 查询（⑧ / ⑩）
resolve(name)            → { name, kind, domain, codePrefix, sections } | undefined
sectionsOf(templateRef)  → Array<{ id: string; accepts: Accept }> | undefined
templateMeta(name)       → { displayName, usage, description, sections: Array<{ id, label, hint }> } | undefined

// 词表 / 规则（⑦）
TaskState / DRAFT / type Kind
initialStatus(kind) / canTransition(kind, from, to, actor, ctx)

// 编号（⑧）
nextId(prefix, usedIds) / parse(id) / normalize(id) / toDisplay(id)
```

- **`Kind = keyof typeof KIND_DEFS`** —— 从注册表派生，**不是手写四值联合**。新增分类时自动加宽（编译期可发现，⑦ 的 `switch` 必须有 `default`）。
- **`ref` 就是 `name`**：卡上字段叫 `template.ref`，值是模板的 `name` 字符串。`resolve(ref)` 与 `resolve(name)` 是同一个调用，**不存在转换步骤**。证据：`templates/presets/expectedMismatchQuick.yaml:17` 的 `template: expectedMismatch` 指向的就是顶层 `name`。**【事实·已查实】**
- **`resolve` 的两条失败路径不合并**：
  - **注册表未初始化 ⇒ 抛错**（时序 / 系统未就绪）；
  - **已初始化但无此模板 ⇒ 返回 `undefined`**（数据错误，调用方 fail-closed）。
  - **理由**：内部键未命中 = bug（抛）；外部输入未命中 = 用户错误（返回）。`findByFullName` 属后者 ⇒ 只返回 `undefined`。
- **`sectionsOf` 是权威章节集**，`id` 是唯一比对依据；返回元素用数组（声明顺序），不用 object。
- **③ 零依赖**：不读 YAML、不碰文件系统、`apply` 里**不注册任何东西**（只有纯注册函数与注册表）。注册路径 = **⑧ 启动期读 YAML → 解析 → 调 `registerTemplate(obj)`**。

---

## 三、我的判断与实现选择

- **【实现判断】九态固定、不开放注册。** 用户 01:29 的兼容目的以 A2A 1:1 为锚；新分类的「新行为」应落成**规则**，不落成新状态。若将来要扩状态，需用户裁（会连带全下游）。
- **【实现判断】三个组固定、禁止注册。** 若允许新状态自由分组，未被任何组包含的状态会让按组的计算规则**静默漏算**（fail-open）。
- **【实现判断】注册表 = 单表 + `presetOf?` 判别**（普通模板与预设模板一次查找、同形返回；预设的 `kind`/`domain`/`codePrefix` 在注册时从目标模板固化）。⑦ 与 ⑧ 都**不需要知道"预设"这个概念**。
- **【实现判断】预设必须注册进 ③**，否则 `derive[].template` 指向的预设无人校验存在性，只能建卡时才发现。
- **【实现判断】`accepts` 名字合法性不在注册期校验。** `actionTypes` 是**可选入参**：传了就校验 `accepts ⊆ actionTypes`，不传则跳过。生产装配必须传（API 可选只为单测）。
- **【实现判断】章节 id 契约 = 注册期校验，三条**：全局唯一（跨模板）、永不复用（`unregister` 不释放 id）、**无 `updateTemplate`**（改章节 = 注册新模板）。**形式不限**（`goal-question` 或 `detail2` 均可），契约只约束"指向不错配"。
- **`label` 合法性不归 ③。** `$type` 是代码注册的标识符（无规范化问题），`label` 是用户手写中文（有 trim/大小写问题）。若 ③ 也校验 label，就要复制一份比较规则 ⇒ 两份真值。⇒ **③ 只做形状校验**（`links` 是数组、`label` 是非空字符串、`to` 是字符串），**词汇校验归 ④ 的收口处**。
- **【实现判断】link 的 `label` = 英文标识 + 中文显示名**（用户 13:18「关系是有行为的。所以是英文和显示名」）。
  - **③ 不持有这份词汇表**（它归 ④）。**③ 只做形状校验**：`label` 是非空字符串。
  - **`hasBehavior` 只有「依赖」为 `true`**（判据见 2.2 的 `DEPENDS_ON_GATE`）—— **该判据在 ④ 的 `LINK_KINDS` 上，③ 只在状态机里用它的效果（`depsAllEnded`），不读 `LINK_KINDS`。**
  - **`displayName`（中文名词）归 ④ 的词汇表，不是终端文案** —— 判据：**不随上下文变化的名称归词汇表；会随上下文变化的句子归终端。**
- **【实现判断】`kindOverride?: never`**（⑧ 提，lead 已裁）：多分类当前不支持，但若将来支持，core 建卡签名要改 ⇒ 预留一个**类型上禁止传值**的参数位，将来 `never → Kind` 即可放开、不改签名。
  ```ts
  // 形状预留：多分类不支持；放开时 never → Kind
  kindOverride?: never
  ```
  **必须带注释**（`never` 不自解释），**且不写运行时 throw**（"能调但会炸"比类型禁止更差）。
- **【实现判断】`accepts` 未知值必须 fail-closed。** 用户 01:29 说不定接口形状，但这里不是形状问题：未知 `accepts` 意味着"不知道这一章允许什么"，**当"什么都可以"是典型 fail-open**。
  - `Accept` 类型只有三态；**运行时（JS 调用方 / `any` 穿透）收到未知值 ⇒ 抛错**，不得静默放行。
- **【实现判断】注册表纯内存、不持久化。** 启动期由 ⑧ 注册，进程内使用；不写盘、不缓存到模块级可变变量。
- **【实现判断】`nextId` 收全量 `usedIds` 并按前缀内部过滤**（调用方不必先分组），代价是每次发号要遍历一次已用集合。若将来集合过大，可改为收「该前缀已用集合」——**接口形状变、语义不变**。
- **【实现判断】目标类基底取 `SUBMITTED`。** 用户 06:43 说「规则没覆盖的等下再看规则」⇒ 允许覆盖不全；③ 的契约因此是「**必须可判定**」：规则都不成立 ⇒ 回基底。**目标类基底值仍待确认**（见 5.2）。

---

## 四、作废与被推翻的方案

| # | 作废项 | 原因 |
|---|---|---|
| 4.1 | **`sectionAccepts(name, sectionId)`** | 与 `sectionsOf` 的 `accepts` **取同一字段** ⇒ 两处取数 = 第三种真值。单章 `accepts` 由 ⑧ 从 `sections` 里查。 |
| 4.2 | **`kindOfInternalTemplate(template)`** | 与 `resolve(name).kind` **取同一字段**。⑦⑧ 一律用 `resolve().kind`。 |
| 4.3 | **`relationLabels` 注册入参** | label 校验归 ④ 收口处；③ 不 import ④（同为第 0 层，调了成环）。 |
| 4.4 | **`STATUS_GROUPS`（运行时可遍历组列表）** | ④⑤ 零消费方；⑧ 只用常量判等。若 ⑩ 将来要遍历，**直接 import ③，不经 core 转发**（否则 core 成"状态词汇二次分发点"）。 |
| 4.5 | **`severity: 'warning'`** | 真空壳：所有 issue code 都升成 error 后，`warning` 永不可能产生。判据见 4.7。 |
| 4.6 | **`ACCEPTS_UNRESOLVED`** | 真空壳：没有输入能触发它（③ 不产出 `'unresolved'`）。 |
| 4.7 | **`'unresolved'`（`accepts` 第四态）** | **不是真空壳**，单独说明见 4.8。 |
| 4.8 | **「跨模板唯一」的章节 id** | 用户新形状只要求**模板内唯一**；跨模板唯一会让"预设与目标模板 key 一致"这条校验被误读成全局唯一。 |
| 4.9 | **`{{ domain }}` 变量** | 用户 12:48「domain 保持纯展示」⇒ 卡上无 `domain` ⇒ 变量无落点，删除。`derive` 变量只剩 `{{ title }}` / `{{ parent }}` / `{{ kind }}`。 |
| 4.10 | **`template: { ref, kind, domain }`** | 同 4.9。卡形状维持 `template: { ref, kind }`。 |
| 4.11 | **「编号 = 模板编号 + 分隔符 + 流水号（按模板分段）」** | 用户 03:47「数字递增是看前缀的」⇒ 按**前缀**分桶，不是按模板。 |
| 4.12 | **「编号全局唯一」** | 用户 03:32「编号是一个工作空间内唯一」+「外部注册不保证唯一性」。 |
| 4.13 | **「编号用于查询」** | 用户 03:32「编号是用于搜索的，不是用于查询的」。精确取模板用 `name`/`fullName`；精确取卡用内部键，不用编号。 |
| 4.14 | **「中文名表归 ③」** | 用户 06:43「9态的中文只在终端」⇒ ③ 不持有任何中文数据。 |
| 4.15 | **「旧编号升级（`T-001` 类）」** | 可先不做，留空位；旧版源码不可信、目标格式无依据。 |
| 4.16 | **`deriveInactive` 整块** | 用户 06:43「被取代后未完成→取消」后，旧卡状态已进 `status`，不再需要从取代边推导失效集合。③ 因此**不读任何关系**，重回零跨包依赖。 |

### 4.7 / 4.8 「`'unresolved'`」的单独说明（**不要和其他删除并为一类**）

两类东西不能混：

| 类型 | 例子 | 性质 |
|---|---|---|
| **真空壳** | `severity:'warning'`、`ACCEPTS_UNRESOLVED` | **类型里有、永远没有产生路径，也防不了外部输入** ⇒ 删，不留。 |
| **fail-closed 守卫** | `'unresolved'` | **领域里合法、③ 不产出，但"防外部错误输入时静默放行"** ⇒ 有价值。 |
| **形状预留** | `kindOverride?: never` | **类型上禁止传值**，只在将来放开 ⇒ 不撒谎。 |

**`'unresolved'` 的最终处置**：
- **从 `Accept` 类型删除**（类型里只留三态）。
- **防外部输入的职责转移到运行时**：校验函数**末尾必须兜底拒绝**，未知值 ⇒ **抛错**，绝不 `?? 'any'`。
- **理由：两处至少留一处，不能都没有。** 现在选了「从类型里删」，所以**运行时兜底是必须的，不是可选的**。

---

## 五、待用户裁决

### 5.1 两条内容取舍（都不是设计问题）

1. **`templates/userNeed.yaml:9` 的 `kind: 目标`（中文）**
   - ③ 的注册校验**拒绝非英文 `kind`**（`kind` 值域 = 已注册分类的英文 `id`）⇒ **该文件当前注册不通过**。
   - **属内容待改**，不是形状问题。**同类**：`domain` 为中文是**合法**的（纯展示，不校验语言），**两个相邻字段规则不同，不能统一处理**。

2. **`max_picks`** —— 已由 lead 从 `presets/expectedMismatchQuick.yaml` 删除。保留此条只为记录：它与 `ask` 的 `additionalProperties` 冲突，会按 schema 校验失败。

### 5.2 已裁：`additionalProperties` = 放宽（`true`）

- **【事实·已裁】** 三个内置 action 的 `additionalProperties` 已定为**放宽（`true`）**，允许未知字段穿过。
- **含义**：模板改版后，旧卡携带的新字段**不会**让它在重新经 `validateForCreate` 的路径上被判 `SCHEMA_INVALID`。
- **代价（如实记录）**：schema 不再封闭 —— 拼错的字段名不会在提交时被拒，只能靠 ② 的 `L1`（`$type` 已注册 / `items` 是数组等）与运行时渲染兜底。
- **对 ③ 无影响**：③ 不解析 payload、不校验字段。

### 5.3 实现层待确认（不需要用户裁，需需求方/lead 确认）

- **目标类基底值**：当前取 `SUBMITTED`。若"子任务全部终结但无成功"（例如全部被取消）时希望目标转 `CANCELED`，需改这一处。
- **`OCCUPYING_STATES`（哪些状态算"持有中"）**：默认 `{WORKING, INPUT_REQUIRED, AUTH_REQUIRED}`（依据用户 06:55「必须先放下」需要存在可控动作）——**【推断】**，非裁决。
  - 与 `QUOTA_STATES`（已裁 = `{WORKING}` 且仅 `work`）**独立声明、不得互为别名**。
- **多分类模板：当前不支持。** 注册表是 `Map<name, def>`，一个 `name` 只能有一个 `kind` ⇒ 「空模板可用于四分类 / 外部一模板多分类」**表达不出来**。
  - **若将来要支持**，必须**连带确认「创建期 `card.template.kind` 的快照从哪来」**，否则 core 还要再裁一次。

---

## 六、需要与其它成员对齐的

### 6.1 与 ⑧ core
- 调 **`registerTemplate` / `resolve` / `sectionsOf` / `nextId` / `parse` / `normalize` / `toDisplay` / `initialStatus` / `canTransition`**。
- **`canTransition` 要传 `ctx`**：`ctx.depsAllEnded`（依赖是否全部在完成组）+ `ctx.actorHasActiveWork`（该 actor 是否已有处理中的工作卡）。**两者都由 ⑧ 计算后传入，③ 不自己查。`undefined` 必须报错，不得给默认值。**
- **启动编排**：读 YAML → 解析 → 调 `registerTemplate(obj)`。**③ 不自动注册**，所以 `apply` 跑完模板并不在 ⇒ ⑧ 必须显式触发。
- **`sectionsOf` 只在 `validateForCreate` 那一次被调**（建卡）。**不需要"高频友好"**。
- **建卡时** `resolve(ref).kind` 填入 `card.template.kind`；`resolve` 返回 `undefined` ⇒ 拒绝建卡；**注册表未初始化是另一种错误，应中止而非拒绝**。
- **`usedIds` 必须含墓碑**（编号永不复用）。
- **core 侧不写 `status` 字面量**，只 import ③ 的常量。**状态字面量单源在 ③**（⑦ 同守）。
- **core 在 fork 路径上不是纯转发层**：它组合 ⑦ 的 `droppedSections` / `missingSections` 与 ② 的 `hasUserContent` / `emptyPayloadFor`。**但这属"编排 + 消费判定"，不是"在 core 里写业务 if"** —— "允许丢弃 + 留痕"是已裁策略，core 不需要每次判断可接受性。

### 6.2 与 ② action
- **③ 不持 action schema、不持 `$type` 名单**。② 是唯一来源（`taskboard2Actions.list() → string[]`）。
- ③ 传给它的是 **`Accept` 三态**；`[]` ⇒ 禁止任何 action；`'any'` ⇒ 跳过 `$type ∈ accepts`；**整体 `undefined` 由 ⑧ 在建卡流程开头 fail-closed，不进入 ②**。
- **`sectionsOf` 元素形状**：`{ id: string; accepts: Accept }`（**不含 `'unresolved'`**）；**整体 `undefined` = 模板不存在**。
- ② 侧需提供：**`splitPayload`**（⑧ 判 `hadContent`）、**`emptyPayloadFor(accepts)`**（⑧ 补空章）—— 这两项是 fork 链路的前提，**不是 ③ 的接口**。

### 6.3 与 ⑦ taskcard
- ③ 供给 ⑦：**`DRAFT` / `type Kind` / `initialStatus(kind)` / `canTransition(kind, from, to, actor, ctx)` / `resolve(name)`**。
- ⑦ **不需要** `sectionsOf` / `templateMeta`（⑦ 对 `sections` 内容零参与；`sectionId` 只做键集比较）。
- **依赖完成度判定不归 ⑦**：⑦ 的 `planClaim` 只做单卡准入 + `actorHasActiveWork` 非空校验；**「提交→处理中」的合法性（含 `depsAllEnded`）归 ③ 的 `canTransition`**，`depsAllEnded` 由 ⑧ 算好传入。
- **卡形状 `template: { ref, kind }`**；`ref` 的值 = 模板 `name`；`kind` 存英文 id。
- **「草稿期不得删除已有 `sectionId` 键」归 ⑦**（`planChange` 校验 `next.sections` 键集 ⊇ `current.sections` 键集）。**⑦ 只保证"不缺键"，不保证"新增键是模板里真实存在的章节"** —— 后者靠 ② 的 `SECTION_NOT_IN_TEMPLATE`。
- **fork 两个方向**：⑦ 产 `fork-discarded` / `fork-filled` 事件（**仅 `sectionId[]`，不读 payload**），⑧ 落盘并决定事件名。

### 6.4 与 ① store / ④ relation / ⑤ search / ⑩ ui
- **① store：零耦合。** ③ 不调 store、不读文件、不写任何东西。`readAll` 返回全量含墓碑是 ① 的义务，**但"`usedIds` 含墓碑"是 ⑧ 的义务**。
- **④ relation：零接触面。** ④ 不认识状态、不认识分类、不调 ③。
- **⑤ search：零调用。** ⑤ 的条件里状态 / 分类 / 模板都是**字符串**；`card.template.kind` 与 `card.template.ref` 是它唯一需要的字段路径。**⑤ 不读 `accepts`、不读章节、不读正文/备注。**
- **⑩ ui：只取 `templateMeta`**（`displayName` / `usage` / `description` / 章节的 `id,label,hint`）。**core 的取数面不含展示字段**。三栏筛选（领域/类别/模板）= **③ 注册表数据 + ⑩ 渲染**，⑤ 不参与。

### 6.5 中文与文案
- **③ 不持有任何中文**（用户 06:43「9态的中文只在终端」）。`displayName` 字段由 ③ 定义，但**不落中文**。
- **`domain` 是例外**：它是**中文字面量、纯展示、不校验语言**（用户 12:48）。**与 `kind` 强校验英文的不对称是刻意且已裁的**，不是妥协。

---

## 附：待验证

- **【待验证】模板的运行期来源未定** —— 仓库 `templates/` 安装到别的机器上不存在（打进包内 / 复制到 `<dshHome>` / 可配置路径）。**影响 ⑧，不影响 ③ 的接口。**
- **【待验证】YAML 解析器来源未定** —— 当前项目无 `node_modules`，Node 无内置 YAML。**依赖顺序：先定"从哪读"，再定"谁解析"。**
- **【待验证】注册表纯内存不持久化** —— 进程重启后需 ⑧ 重新注册；③ 自身不缓存到磁盘、不缓存到模块级可变变量。
