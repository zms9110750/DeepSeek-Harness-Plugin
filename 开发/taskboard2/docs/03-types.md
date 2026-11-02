# ③ types —— 类型体系（状态 / 分类 / 模板 / 编号）

> 任务类型的整套词汇与规则。四块：`status` → `kind` → `template` → `id`，严格单向。
>
> **本文档只描述 ③ 自己**：它对外给什么、它怎么判断、它明确不做什么。
> 接口形状已与 ①②④⑦⑧ 逐条对齐；内容里的取舍标注来源等级。
>
> **最后更新（本批，`13:30` 之后）：**
> ① **`liveChildren` 语义变更**（滤墓碑 → 滤墓碑 **+ 草稿**）；
> ② **三条规则判据改**（`design.2.2` 判模板 `research`；`work.3.3`/`3.4` 改纯状态判）；
> ③ **采纳权限按分类分**（design/record 允许 `agentMessageLoop`）；
> ④ **`Actor` 的 `'loop'` 改名 `'agentMessageLoop'`**；
> ⑤ **新增权限总原则**（用户 13:30）+ 工作卡失败权限记录。
> **（本批依据 lead 转达的 `【用户指令，2026-11-02 12:46 / 13:15 / 13:20 / 13:30】`。）**
>
> **上一批：模板语法收缩** —— `accepts` / 预设取消，章节新增 `default`，`displayName` 改必填，`kindLetter` 与 `deriveStatus` 进服务面（依据 `11:26` 与 `Lead 决定 12:10 / 12:25`）。

---

## 一、用户原话（带时间锚点）

> **⚠️ 来源等级说明（整节适用）**：以下**全部是 lead 转述给 ③ 的版本**（③ 作为成员不直接与用户对话，用户原话经 lead 转发）。
> - 逐字度：**除 `2026-11-02 11:26` 那批外，均为 lead 转述的逐字块**；
> - **`2026-11-02 11:26` 一批是 lead 转述的「要点」，不是逐字原文**；
> - **真正的逐字原文在 lead 处**。**本文件不声称是用户原笔，也不得被引用为"用户原话"的最终依据。**

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

> 【用户指令，2026-11-02 02:25】
> 那当然递归。第一，你自己这个测试不就已经出问题了吗。
> 第二，所有任务卡都是监听自己的监听对象。目标看自己的子任务的状态变化。既然变了，扳机，触发时点就出来了。那当然应该触发。
> 然后现在的计算态应该全都是监听自己的子任务。唯一一个跨任务的是依赖。但是这个的触发时点是手动操作，所以不需要立刻检查。

> 【用户指令，2026-11-02 11:26】
> （模板与派生规则，**lead 转述的要点**）
> `derive` 只剩 `label` / `description` / `template`。
> `title` 和 `relations` 两个字段从模板语法中删除 —— 它们的值现在由代码按固定规则生成。
> `{{ title }}` / `{{ parent }}` / `{{ kind }}` / `{{ domain }}` 全部删除。
> `accepts` 彻底移除：模板章节不再有 `accepts` 字段，`sectionsOf` 不再返回 `accepts`，`SectionDef` 只剩 `id` / `label` / `hint`。
> 预设模板取消：`presetOf` 判别、预设注册路径全部删除。
> 章节新增 `default` 字段（一份填好的 action payload）。

> 【用户指令，2026-11-02 12:46】
> 不算。新卡默认草稿。而草稿不是有效卡，创建一个草稿是不广播的。
> 子任务变了，就会广播到G01。G01就要算。不变就不变。变了就要继续往上面广播。

> 【用户指令，2026-11-02 13:15】
> 归档在现阶段只有草稿才能归档。而草稿不是有效卡。所有的转化规则里面都特意没纳入草稿。
> 你现在通知不通知没有行为差异。你自己决定。冒烟测试除了问题再说。
> 设计卡/工作卡会因为"有个草稿子卡"而变成「需要信息」。这里的计算都要是有效卡，就是进行，或者搁置。草稿是不算的。
> 我现在允许设计和记录，由actor为ai的时候通过。

> 【用户指令，2026-11-02 13:20】
> 出现子任务为**调研**，这是明确的模板类型。因为调研是真的需要调研。别的工作，我不知道你实际上是做什么。比如写代码。那这个事情跟我的状态是没关系的。
> 子任务能执行才是能执行。如果子任务是被搁置的。那自己的进行依赖子任务。那自己肯定要被搁置。子任务都不做，自己怎么做。

> 【用户指令，2026-11-02 13:30】
> **权限总原则**：设计当然只有用户能确认。记录也只有用户能确认。这两个都是直接决定方向的。ai不能决定方向。ai的任务只有服从用户的意志。除非用户授权，否则没资格解释用户意志。
> **工作卡失败**：我加上去了。工作的进行和搁置的4个状态都可以用户点击失败。
> **loop 改名**：loop确实是ai。但我希望改名。loop名字太离谱里。我说的是"消息循环"。消息必须体现出来。
> loop要改名，前缀改就一起改。
> agentMessageLoop
> **模板名字面量**：直接在ts里面写字面量。因为核心的含义就是随包分发不可关闭的。就是预设这个东西一直在工作。
> 改模板名字就把这里一起改了就是。

---

**⚠️ 时间锚点说明**：
- `2026-11-02 11:26` 这一批是 **lead 转述的要点**，**不是逐字原文**；完整原文见 lead 处记录。
- `2026-11-02 02:25`（递归）为 lead 转述的逐字块。
- **`2026-11-02 13:30` 这一批包含 4 件事，其中 2 件不归 ③**：
  - ✅ **归 ③**：权限总原则（`canTransition` 的 actor 限制总依据）、工作卡失败权限、`loop` → `agentMessageLoop`（出现在 `Actor` 类型里）；
  - ❌ **不归 ③**：「模板名字面量直接写在 ts 里」—— 那是 **⑧ 的注册编排**（`registerTemplate` 的调用处），**③ 只提供 `registerTemplate` 函数，不决定谁调用、名字写在哪**。**此处收录原话只为完整，③ 无对应改动。**

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
  letter: string;                        // 编号里的分类字母，单个大写字母（G/D/W/R）
  initialStatus: TaskState;              // 建卡时的初始状态
  baseStatus: (input) => TaskState;      // 所有计算规则都不成立时的落点
  computeRules: readonly ComputeRule[];  // 有序；首个 when 为真者胜
  quota: readonly TaskState[];           // 占位判定用的状态集合
};
```

**分类字母（`letter`）：**
- **编号前缀的第一段** = `分类字母 + 模板的 codePrefix`（用户 03:32「编号默认的就用他们的首字母。目标是 goal。」）
- **内置四类**：`goal → G`（用户点名的唯一一个）/ `design → D` / `work → W` / `record → R`。
  - **`D` / `W` / `R` 是按「默认首字母」推的【推断】**，用户只点明了 `goal ⇒ G`。
- **注册期校验两条**：**必须是单个大写字母**；**已注册分类之间不得重复**。
  - **理由**：两个分类同字母 ⇒ 编号前缀撞车，**而 `nextId` 只按前缀分桶，查不出这是两个分类。**
- **`kindLetter(kind)` 未注册 ⇒ 抛错**，**不猜字母**（猜 = 造一个会撞号的前缀，比失败更糟）。

**判定顺序（固定，不是配置）：**
1. 状态 ∈ `EndedStatus` ⇒ **不重算**（终态粘滞）。
2. 状态 = `DRAFT` ⇒ **不重算**（草稿不参与）。
3. 顺序跑 `computeRules`，**首个 `when` 为真者胜**。
4. 全不成立 ⇒ **`baseStatus`**。

**计算态求值：`deriveStatus(kind, input) → TaskState`**

```ts
type ChildSnapshot = {
  id: string;
  kind: string;
  template: string;      // 模板 ref（= card.template.ref = 模板 name）
  status: TaskState;
  deleted: boolean;      // 墓碑
};

type RuleInput = {
  status: TaskState;                    // 该卡当前状态
  isHeld: boolean;                      // 是否被某 actor 持有（由 ⑧ 从 claimedBy 判空）
  children: readonly ChildSnapshot[];   // 完整子任务列表
};
```

- **`template` 是必填** —— `design.2.2` 要判「子任务是否为 `research` 模板」（用户 13:20），**光有 `kind` 判不出来**。
- **`children` 必须传完整列表**（含草稿、含终态、**含墓碑**）：**③ 内部用 `liveChildren` 统一裁**，调用方**不得预先过滤**（两处都滤会不一致）。
- **`liveChildren` = 「有效卡」判定，滤掉两块**：
  1. **墓碑**（`deleted === true`）；
  2. **草稿**（`status === UNSPECIFIED`）。
  - **依据**：用户 `12:46`「新卡默认草稿。而**草稿不是有效卡**，创建一个草稿是不广播的。」+ 用户 `13:15`「这里的计算**都要是有效卡，就是进行，或者搁置。草稿是不算的**。」+ 用户 `13:15`「所有的转化规则里面都特意没纳入草稿。」
  - **⇒ 参与推导的子任务状态集合 = `{SUBMITTED, WORKING, INPUT_REQUIRED, AUTH_REQUIRED, COMPLETED, FAILED, CANCELED, REJECTED}`**（即九态去掉草稿）。
  - **⇒ 只有草稿子卡的父卡，等价于「没有子卡」**，落 `baseStatus`。
- **`isHeld` 是 `work` 类 `baseStatus` 的唯一输入**：`baseStatus = isHeld ? WORKING : SUBMITTED`。**传错会让"搁置解除后"的工作卡回错状态**（该回处理中的回了提交）。
- **每层只算一层**（只看直接子任务），**递归由 ⑧ 在外层循环做**（用户 02:25「所有任务卡都是监听自己的监听对象」）。
- **分类未注册 ⇒ 抛错**（调用方违约，不猜）。

**8 条 `computeRules` 的判据（定稿）：**

| 规则 | 判据 | 依据 |
|---|---|---|
| `goal.1.3` | 有子任务 ∈ {`SUBMITTED`, `WORKING`} ⇒ `WORKING` | 矩阵 三/提交「出现子任务为进行，转移为处理中」 |
| `goal.1.4` | 有子任务 = `INPUT_REQUIRED` ⇒ `INPUT_REQUIRED` | 矩阵 三/提交 |
| `goal.1.5` | 有子任务 = `AUTH_REQUIRED` ⇒ `AUTH_REQUIRED` | 矩阵 三/提交 |
| `goal.1.6` | 有 `FAILED` 且无 `COMPLETED` ⇒ `FAILED` | 矩阵 三/提交「没有成功，且具有失败」 |
| `goal.1.7` | 有子任务 = `COMPLETED` ⇒ `COMPLETED` | 矩阵 三/提交 |
| **`design.2.2`** | 有子任务**模板 = `research`** 且未终结 ⇒ `INPUT_REQUIRED` | **用户 13:20**「出现子任务为**调研**，这是明确的模板类型…别的工作…跟我的状态是没关系的」 |
| **`work.3.3`** | 有子任务 = `INPUT_REQUIRED` ⇒ `INPUT_REQUIRED` | **用户 13:20**「子任务是被搁置的…自己肯定要被搁置」+ 矩阵 五/提交 |
| **`work.3.4`** | 有子任务 = `AUTH_REQUIRED` ⇒ `AUTH_REQUIRED` | 同上（**纯状态判**，改前只认 `record` 类） |

- **`goal` 的 5 条全部是「纯状态判」**，不看 `kind`、不看 `template` ⇒ **本次改动不涉及它们**。
- **`design.2.2` 是唯一看 `template` 的规则** —— 理由只有一条：**「调研」是模板，不是分类**（用户 13:20）。
  - **⇒ 这次改动同时也修正了一个实际错误**：改前判 `child.kind === 'work'`，会把「校验」「编写代码」这些 work 子卡也算进去，让设计卡无端变「需要信息」。**用户明确说这些「跟我的状态是没关系的」。**
- **`work.3.3` / `work.3.4` 的顺序不能换**：`INPUT_REQUIRED` 优先于 `AUTH_REQUIRED`，与矩阵「有需要信息 ⇒ 需要信息；**没有**需要信息且具有需要授权 ⇒ 需要授权」一致；`computeRules` 数组本身有序、首个命中者胜 ⇒ **顺序由数组顺序保证**。
- **`work.3.4` 的判据放宽了**：改前 `kind === 'record' && AUTH_REQUIRED`（只认记录类），改后 `AUTH_REQUIRED`（任何子任务）—— 依据用户 13:20「如果子任务是被搁置的…自己肯定要被搁置」。**这是有意的放宽，不是遗漏。**

**内置四类初始值：**

| `id` | `initialStatus` | `baseStatus` |
|---|---|---|
| `goal` | `UNSPECIFIED` | `SUBMITTED` |
| `design` | `AUTH_REQUIRED` | `AUTH_REQUIRED` |
| `work` | `UNSPECIFIED` | `isHeld ? WORKING : SUBMITTED` |
| `record` | `AUTH_REQUIRED` | `AUTH_REQUIRED` |

- 依据用户 06:43「设计类、记录类，初始关系就是需要授权」+ 06:55 的释放/占位语义。**【事实·用户原话】**
- **`goal` 的「无子任务或全草稿 → 提交」由 `baseStatus` 承担**，不单列规则（同值，避免双写）。
  - **⚠️ 这句话只有在 `liveChildren` 滤掉草稿后才真正成立**：滤之前，"只有草稿子卡"不是"无子任务"，5 条规则里虽不会命中（草稿不等于任一目标状态），但 `design`/`work` 的规则会命中。**滤掉后，`baseStatus` 才真正承接"全草稿"这一情形。**
- **内置四类与外部注册项走同一条 `registerKind`，零特权分支。**

**占位（quota）：**
- **`kind === 'work'` 且 `status === WORKING` 才算占位**（用户 06:55）。
- **目标的「处理中」不占位**；工作一旦滑入搁置，就不再算处理中 ⇒ 占位自动释放，**不需要显式 `release`**。**【事实·用户原话】**
- **③ 侧的载体**：`KindDef.quota: readonly TaskState[]`，**只有 `work` 非空、值为 `[S.WORKING]`**，其余三类为空数组；访问器 `quotaStatesOf(kind)`（**不在服务面**，见 2.8）。
- **⚠️ ③ 不提供「持有中」的判定**：`OCCUPYING_STATES` **是 ⑧ 自己定义的概念**（`packages/core/src/claims.ts:13-18`），**③ 里没有这个常量**。这两件事**不是同一个东西，不得互为别名**（见 5.3）。

**转移判决：`canTransition(kind, from, to, actor, ctx) → { ok: true } | { ok: false, reason }`**

```ts
type Actor = 'user' | 'agentMessageLoop' | 'host';
type TransitionCtx = {
  depsAllEnded: boolean;        // 依赖目标是否全部处于「完成」组（= EndedStatus）
  actorHasActiveWork: boolean;  // 该 actor 名下是否已有「处理中的工作」卡
};
```
- `actor` 只分三种：用户 / 消息循环 / 宿主。足以表达「用户可、AI 不可」的条目。
- **⚠️ `'agentMessageLoop'` 是用户 `13:30` 的改名要求**：
  > 「loop 确实是 ai。但我希望改名。loop 名字太离谱了。我说的是"**消息循环**"。**消息必须体现出来。**」「loop 要改名，前缀改就一起改。」「**agentMessageLoop**」
  - **原名 `'loop'` 作废**（见 4.22）。
  - **术语对应**：「AI」这个业务概念在代码里叫 `agentMessageLoop` —— **它体现"消息循环"这个机制，而不是泛指"AI"**。
- **所有"外部世界的事实"都走 `ctx`，不走 `actor`** —— `actor` 只承载身份种类，不承载依赖、占用、计数等状态信息。
- **③ 只给判决，不执行、不写状态、不维护领取。**

**⭐ actor 限制的总依据（用户 `13:30` 逐字）：**
> **设计当然只有用户能确认。记录也只有用户能确认。这两个都是直接决定方向的。ai 不能决定方向。ai 的任务只有服从用户的意志。除非用户授权，否则没资格解释用户意志。**

- **⇒ 这句是 `canTransition` 里所有 actor 限制的总原则**，不是"某几条规则的局部理由"。
- **⇒ 读法**：**"能确认方向"的动作用户专属**（确认设计、确认记录）；**AI 只能执行被授权的动作**。
- **⇒ 13:15「我现在允许设计和记录，由 actor 为 ai 的时候通过」= 一次明确的「用户授权」** —— 正是上面那句里「除非用户授权」的那个"除非"。
  - **⚠️ 这条授权的边界**：**它授权的是「采纳」这个动作**（草稿 → 需要授权），**不是"AI 可以确认设计/记录"** —— 确认（`AUTH_REQUIRED → COMPLETED`）仍然只有用户能做。

**`ctx.depsAllEnded` 的用途（`DEPENDS_ON_GATE` 规则）：**
- 规则：`to === WORKING && from === SUBMITTED && kind === 'work' && !ctx.depsAllEnded ⇒ 拒绝`。
- **依据用户 13:18**：「效果是所有依赖对象都进入了完成态，这个卡才能被领取（从提交转为处理中的那个状态转换的按钮）」。
- **依赖是否全部完成由 ⑧ 计算后传入**（⑧ 取依赖目标状态 → 算"是否全部 ∈ `EndedStatus`" → 传给 ③）⇒ **③ 仍不读关系、不查别的卡。**
- **只对「提交 → 处理中」这一条转移生效**；其它转移不受依赖影响。
- **`undefined` 必须报错，不得默认 `true`** —— 默认 `true` = 静默放行领取（fail-open）。

**采纳与领取（转移的名字，不是状态值）：**

| 动作 | 转移 | 允许者 | ③ 代码是否强制 |
|---|---|---|---|
| **采纳**（goal / work） | `UNSPECIFIED → SUBMITTED` | **仅 `user`** | ✅ 已强制 |
| **采纳**（design / record） | `UNSPECIFIED → AUTH_REQUIRED` | **`user` / `agentMessageLoop`** | ✅ 已强制（`host` 拒） |
| **领取** | `SUBMITTED → WORKING` | `user` / `agentMessageLoop` | ⚠️ **未强制 actor**（只判依赖门 + 占位） |
| **释放** | `WORKING → SUBMITTED` | `user` / `agentMessageLoop` | ⚠️ **未强制 actor**（准入在 ⑦ 的 `planRelease`） |
| **确认**（design / record） | `AUTH_REQUIRED → COMPLETED` | **按权限总原则应仅 `user`** | ❌ **未强制**（走默认放行，见 5.5） |

**⚠️ 最右列是本次核对新增的** —— **它把"矩阵要求"与"③ 代码现状"分开**，避免把设计意图读成已实现。

- **⚠️「采纳」是同一个名字、两条不同转移**（目的地不同）：
  - **goal / work** 采纳后进「提交」（进入计算、可领取）；
  - **design / record** 采纳后进「需要授权」（它们生来就是搁置态）。
  - **⇒ 目的地按分类判定，不做「任意草稿→任意非草稿都算采纳」的放宽**（那会把非矩阵转移也套上采纳的限制）。
- **采纳的 actor 限制按分类分**（用户 `13:15`「我现在允许设计和记录，由 actor 为 ai 的时候通过」）：
  - **goal / work ⇒ 仅 `user`**（依据用户 01:29「采纳是用户的按钮…只能用户来做」+ 矩阵 三/草稿、五/草稿只列「用户点击采纳」）；
  - **design / record ⇒ `user` / `agentMessageLoop`**（依据用户 13:15 + 矩阵 四/草稿、六/草稿列了「ai 调用采纳」）；
  - **`host` 一律不允许**（矩阵里从未出现 ⇒ 不猜）。
  - **⚠️ 修正记录**：此前 ③ 把它实现成「全分类只能 user」，**是把 01:29 那句话的适用范围写宽了** —— 那句讲的是 goal/work 的草稿→提交，design/record 的草稿→需要授权是另一条转移。

**⭐ 工作卡的「失败」权限（用户 `13:30` 新增）：**

> **我加上去了。工作的进行和搁置的 4 个状态都可以用户点击失败。**

**⇒ `kind === 'work'` 时，以下 4 个状态下 `user` 都可以置 `FAILED`：**

| 状态 | 组 |
|---|---|
| `SUBMITTED` | 进行 |
| `WORKING` | 进行 |
| `INPUT_REQUIRED` | 搁置 |
| `AUTH_REQUIRED` | 搁置 |

- **⚠️ 这句只授权 `user`，不授权 `agentMessageLoop`** —— 原文是「都可以**用户**点击失败」。
- **⚠️ 只针对 `kind === 'work'`** —— 原文是「**工作的**进行和搁置的 4 个状态」。
- **⇒ 其它分类（goal / design / record）的失败权限不受此句影响**，仍按各自矩阵条款。
- **⚠️ ③ 的实现现状**：`canTransition` **没有为这条写专门分支** —— 因为它的默认路径是「其余转移 ⇒ 放行」，`work` 的这 4 个状态 → `FAILED` **本来就会被放行**。**⇒ 这条是"确认已有行为正确"，不是"新增规则"。**
  - **⚠️ 但 `user` 专属这一点没有在代码里强制**：现在 `agentMessageLoop` 走这条路也会被放行。**若要求严格只允许 `user`，需要在 `canTransition` 加一条分支。**（**待确认项，见 5.4**）
- 依据用户 01:29（领取是提交→处理中）+ 06:55（释放回提交）。**【事实·用户原话】**
- **采纳不产生任何关系**；「取代」只在 fork 时建立，与采纳无关。**【实现判断·已与⑦对齐】**

**工作类「一个 actor 只能占一张」：**
- 规则 `WORK_SINGLE_CLAIM`：`to === WORKING && kind === 'work' && actorHasActiveWork ⇒ 拒绝`。
- **规则表述在 ③，计算与拦截在 ⑧，⑦ 只做单卡准入并把 ⑧ 的布尔原样递给 ③；`undefined` 必须报错，不得默认 `false`。**【实现判断·三方已对齐】

### 2.3 模板（`template.ts`）

**模板 = 元数据 + 章节声明 + 每章的预填 payload（`default`）。**

```ts
type TemplateDef = {
  name: string;           // 稳定英文标识（卡上 template.ref 存的就是它）
  fullName?: string;      // 入口别名（用户输入面），当前与 name 同值
  kind: Kind;
  domain: string;         // 纯展示，中文字面量（用户 12:48），不校验语言
  codePrefix: string;     // 拼编号用；'' 合法，null/undefined 非法
  sections?: readonly SectionDef[];  // 可省 = 零章节（如空模板）
  displayName: string;    // 必填。展示名（不落中文 —— 中文只在终端）
  usage?: string;         // 列表那行小字（给 ⑩，core 不读）
  description?: string;   // 点模板才展开的完整说明（给 ⑩，core 不读）
};

type SectionDef = {
  id: string;       // 模板内唯一；正则 /^[A-Za-z][A-Za-z0-9_-]*$/
  label: string;    // 纯文本，不渲染 md
  hint?: string;    // 给 AI 挑 action 看的「我要什么」
  default?: unknown; // 该章的预填 payload —— ③ 不解释、不校验
};
```

- **`codePrefix` 必须显式填，不从 `name` 推**（用户 03:32「不能是算出来的」）；`''` = 该模板不提供字母段（如空模板）。
- **`displayName` 是必填，且注册期有运行时非空校验**（见「三、实现判断」里 `displayName` 那一条）—— 派生按钮拼标题要用它，**给兜底值 `?? name` 就是 ③ 在造数据**。
- **`default` 是③唯一"拿着但不看"的字段**：一份填好的 action payload。**③ 不解释、不校验**（合法性归 ②，最终在建卡时由 `validateForCreate` 判）。用 `unknown` 而不是对象类型 —— **写成对象类型会暗示"③ 懂它的形状"**。
- **⚠️ `TemplateDef` 里没有 `computeRules` —— 模板层规则当前未实现。**
  - **代码事实**：`deriveStatus(kind, input)` **只收分类 id，没有模板参数** ⇒ **模板层规则在签名上就进不来**。
  - **⇒ 计算态规则目前只有一层（分类层）**；「模板层 → 分类层 → 兜底」的三层结构**是设计意图，不是现状**（见 4.21）。
  - **`initialStatus` 也不可被模板覆盖**（四类初始状态是用户裁的；若可改，会造出"有草稿期的设计卡"，连锁破坏三条已裁结论）——**这一条属"本来就不打算开放"，与"尚未实现"不同**。
  - **安全规则（终态不可转、草稿不可直转处理中、`WORK_SINGLE_CLAIM`、草稿不参与计算）不在 `computeRules` 里，因此任何层都不可覆盖。**

### 2.4 模板注册表只有一种模板（**没有"预设"**）

- **注册表是 `Map<name, TemplateDef>`，只有普通模板。** 「预设模板」这个概念**整个取消**（见 4.19）。
- **`derive` 不在 ③ 的 schema 里**，`registerTemplate` 也**不拒多余字段**（宽收）。
  - **⇒ `derive` 由 ⑧ 的 YAML 解析层负责；③ 忽略它。**（见「三、实现判断」里 `derive` 那一条）

### 2.5 编号（`id.ts`）

**编号 = 前缀 + 流水号，直接拼接，无分隔符。**

- **canonical**：`/^[A-Z]+[0-9]+$/`（大写、无连字符）。例 `G01` / `GA01` / `GTT01`（用户 03:47）。
- **展示形**：`G-01` / `GU-02`（`toDisplay` 插入一个连字符）；**空模板显示 `G-02`**（用户 03:32 已接受）。
- **前缀 = `kindLetter(kind)` + 模板的 `codePrefix`**；`codePrefix === ''` 时退化为「分类字母 + 流水」。
  - **分类字母从 `kindLetter(kind)` 取，模板配置不写这一位**（用户 03:32；分类段归分类定义，见 2.2）。
  - **拼法**：`nextId(kindLetter(kind) + tpl.codePrefix, usedIds)`。例 `G` + `U` ⇒ 前缀 `GU` ⇒ `GU02`。
  - **⚠️ `kindLetter` 未注册分类 ⇒ 抛错**（不猜字母：猜一个会造出会撞号的前缀）。
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

### 2.6 对外导出面（定稿）

```ts
// 注册（⑧ 启动编排）—— 单参数，没有 opts
registerTemplate(tpl)
markTemplateRegistryReady()

// 查询（⑧ / ⑩）
resolve(ref)             → { name, displayName, kind, domain, codePrefix, sections } | undefined
                           //   sections: Array<{ id: string; default?: unknown }>
sectionsOf(ref)          → Array<{ id: string; default?: unknown }> | undefined
templateMeta(ref)        → { displayName, usage, description,
                             sections: Array<{ id, label, hint?, default? }> } | undefined

// 词表 / 规则（⑦）
TaskState / DRAFT / type Kind
initialStatus(kind) / kindLetter(kind) / canTransition(kind, from, to, actor, ctx)
deriveStatus(kind, input)      // 计算态求值（⑧ 的监听链用）

// 编号（⑧）
nextId(prefix, usedIds) / parse(id) / normalize(id) / toDisplay(id)
```

- **`Kind = keyof typeof KIND_DEFS`** —— 从注册表派生，**不是手写四值联合**。新增分类时自动加宽（编译期可发现，⑦ 的 `switch` 必须有 `default`）。
- **`resolve` 返回里 `displayName` 是必填** —— 派生按钮拼标题要用（⑧ 提）。
- **`ref` 就是 `name`**：卡上字段叫 `template.ref`，值是模板的 `name` 字符串。`resolve(ref)` 与 `resolve(name)` 是同一个调用，**不存在转换步骤**。证据：`templates/code/expectedMismatch.yaml:26` 的 `derive[].template: research` 指向的就是另一模板的顶层 `name`（**不是**文件路径、**不是** `fullName`）。**【事实·已查实】**
  - **⚠️ 旧的 `templates/presets/` 目录已不存在**（见 4.19）；此前引用的 `presets/expectedMismatchQuick.yaml` 已随预设一并删除。
- **`resolve` / `sectionsOf` / `templateMeta` / `getTemplate` 的两条失败路径不合并**：
  - **注册表未初始化 ⇒ 抛错**（时序 / 系统未就绪）；
  - **已初始化但无此模板 ⇒ 返回 `undefined`**（数据错误，调用方 fail-closed）。
  - **理由**：内部键未命中 = bug（抛）；外部输入未命中 = 用户错误（返回）。`findByFullName` 属后者 ⇒ 只返回 `undefined`。
- **`sectionsOf` 是权威章节集**，`id` 是唯一比对依据；返回元素用数组（声明顺序），不用 object。
- **`sectionsOf` 与 `templateMeta` 各自完整**：两条路都会带出 `default`（⑧ 补缺章走前者、⑩ 预填走后者），**不互相依赖**。
- **③ 零依赖**：不读 YAML、不碰文件系统、`apply` 里**不注册任何东西**（只有纯注册函数与注册表）。注册路径 = **⑧ 启动期读 YAML → 解析 → 调 `registerTemplate(obj)` → `markTemplateRegistryReady()`**。

### 2.7 服务面（`apply` 里 `provide` 的东西）

**`inject = []`（零依赖），但 `apply` 必须 `provide`** —— 否则 `inject` 了本包的 ⑦ / ⑧ 会**永远停在 `PENDING`**（Cordis 的行为：`inject` 里任一项没人 provide ⇒ 该插件不启动，`apply` 永不执行）。

```ts
ctx.provide('taskboard2Types', {
  // 词表
  TaskState, DRAFT,
  // 组判定（⑧ 的级联 / 领取用）
  isEndedStatus, isShelvedStatus, isActiveStatus, isDraftStatus,
  // 规则
  initialStatus, kindLetter, canTransition, deriveStatus,
  // 模板
  registerTemplate, markTemplateRegistryReady, resolve, sectionsOf, templateMeta,
  // 编号
  nextId, parse, normalize, toDisplay,
});
```

- **`provide` 与模块导出是两套并列的对外面**：静态导出给 `import`（①④⑤⑦⑧ 的结构化引用），`provide` 给 `inject` 动态取。
- **两者内容必须一致**（除纯类型外）；**新增对外函数时两处都要加**，否则会出现"能 import 但 inject 拿不到 `undefined`"——**运行期才炸，类型检查抓不到**。
- **`apply` 里仍不注册任何模板**（只 provide）。

### 2.8 只有模块导出、不在服务面的（供排查）

`registerKind` / `getKind` / `listKinds` / `quotaStatesOf` / `KIND_DEFS` / `getTemplate` / `listTemplates` / `resetTemplateRegistry` / `isTemplateRegistryReady` / `findByFullName`。
**⇒ 若某个包要经 `inject` 用它们，必须显式加进 `provide`**（见 2.7 最后一条）。

---

## 三、我的判断与实现选择

- **【实现判断】九态固定、不开放注册。** 用户 01:29 的兼容目的以 A2A 1:1 为锚；新分类的「新行为」应落成**规则**，不落成新状态。若将来要扩状态，需用户裁（会连带全下游）。
- **【实现判断】三个组固定、禁止注册。** 若允许新状态自由分组，未被任何组包含的状态会让按组的计算规则**静默漏算**（fail-open）。
- **【实现判断】注册表 = 单表 `Map<name, TemplateDef>`，没有"预设"这一维。** 见 4.19。
- **【实现判断】章节 id 契约 = 注册期校验**：**模板内唯一**（不是跨模板）、**永不复用**（`unregister` 不释放 id）、**无 `updateTemplate`**（改章节 = 注册新模板）。**形式不限**（`goal-question` 或 `detail2` 均可），契约只约束"指向不错配"。
- **`label` 合法性不归 ③。** `$type` 是代码注册的标识符（无规范化问题），`label` 是用户手写中文（有 trim/大小写问题）。若 ③ 也校验 label，就要复制一份比较规则 ⇒ 两份真值。**⇒ 关系（含 `label` / `links`）的形状与词汇校验全部归 ④，③ 不碰。**
  - **⚠️ 旧版本此处写「③ 只做形状校验（`links` 是数组…）」—— 与代码不符**：③ 从未有任何 `links` 相关代码（`grep` 零命中）。**③ 对关系是零接触面**（见 6.4）。
- **【实现判断】link 的 `label` = 英文标识 + 中文显示名**（用户 13:18「关系是有行为的。所以是英文和显示名」）。
  - **③ 不持这份词汇表、也不做任何 `links` 校验**（它全部归 ④；③ 对关系是零接触面，见 6.4）。
  - **`hasBehavior` 只有「依赖」为 `true`**（判据见 2.2 的 `DEPENDS_ON_GATE`）—— **该判据在 ④ 的 `LINK_KINDS` 上；③ 只在状态机里用它的效果（`depsAllEnded` 这个布尔），不读 `LINK_KINDS`、不读关系数据。**
  - **`displayName`（中文名词）归 ④ 的词汇表，不是终端文案** —— 判据：**不随上下文变化的名称归词汇表；会随上下文变化的句子归终端。**
- **【实现判断】`kindOverride?: never`**（⑧ 提，lead 已裁）：多分类当前不支持，但若将来支持，core 建卡签名要改 ⇒ 预留一个**类型上禁止传值**的参数位，将来 `never → Kind` 即可放开、不改签名。
  ```ts
  // 形状预留：多分类不支持；放开时 never → Kind
  kindOverride?: never
  ```
  **必须带注释**（`never` 不自解释），**且不写运行时 throw**（"能调但会炸"比类型禁止更差）。
- **【实现判断】`displayName` 有两种约束，两者都要**：
  1. **类型上必填**（`TemplateDef.displayName: string`、`ResolvedTemplate.displayName: string`）；
  2. **注册期运行时非空校验**（`registerTemplate` 里 `typeof !== 'string' || === ''` ⇒ 抛错）。
  - **为什么两者都要**：**⑧ 从 YAML 解析来的对象可以是 `any`/JSON，类型拦不住** ⇒ 只有类型必填时，漏写 `displayName` 的 YAML 会静默进库。
- **【实现判断】`default` 是③唯一"拿着但不看"的字段**：类型是 `unknown`，**③ 不校验、不解释**。`$type` 是否为已注册 action **不在注册期校验**（③ 不持 action 注册表，这是 2.5 边界）；**拼错要到建卡时由 ② 报**。
- **【实现判断】`derive` 是"宽收"而非"拒收"**：`TemplateDef` 里没有 `derive`，`registerTemplate` 也**不校验多余字段**。
  - **为什么不拒**：**③ 收的是已解析 JS 对象**，**TS 的 excess property check 只在字面量赋值时生效**，跨 `any`/JSON 传进来时多余属性会随对象带过但类型上不报错 ⇒ **③ 这一层拦不住，硬拦只会造成"以为拦了其实没拦"**。
  - **⇒ 拒绝 `derive.title` / `relations` 的责任在 ⑧ 的 YAML 解析层。**（同前）
- **【实现判断】注册表纯内存、不持久化。** 启动期由 ⑧ 注册，进程内使用；不写盘、不缓存到模块级可变变量。
- **【实现判断】`nextId` 收全量 `usedIds` 并按前缀内部过滤**（调用方不必先分组），代价是每次发号要遍历一次已用集合。若将来集合过大，可改为收「该前缀已用集合」——**接口形状变、语义不变**。
- **【实现判断】目标类基底取 `SUBMITTED`。** 用户 06:43 说「规则没覆盖的等下再看规则」⇒ 允许覆盖不全；③ 的契约因此是「**必须可判定**」：规则都不成立 ⇒ 回基底。**目标类基底值仍待确认**（见 5.3）。

---

## 四、作废与被推翻的方案

| # | 作废项 | 原因 |
|---|---|---|
| 4.1 | **`sectionAccepts(name, sectionId)`** | 与 `sectionsOf` **取同一字段** ⇒ 两处取数 = 第三种真值。单章信息由 ⑧ 从 `sectionsOf` 里查。 |
| 4.2 | **`kindOfInternalTemplate(template)`** | 与 `resolve(name).kind` **取同一字段**。⑦⑧ 一律用 `resolve().kind`。 |
| 4.3 | **`relationLabels` 注册入参** | label 校验归 ④ 收口处；③ 不 import ④（同为第 0 层，调了成环）。 |
| 4.4 | **`STATUS_GROUPS`（运行时可遍历组列表）** | ④⑤ 零消费方；⑧ 只用常量判等。若 ⑩ 将来要遍历，**直接 import ③，不经 core 转发**（否则 core 成"状态词汇二次分发点"）。 |
| 4.5 | **`severity: 'warning'`** | 真空壳：所有 issue code 都升成 error 后，`warning` 永不可能产生。 |
| 4.6 | **`ACCEPTS_UNRESOLVED`** | 真空壳：没有输入能触发它。**随 4.18 的 `accepts` 取消一并消失。** |
| 4.7 | **`'unresolved'`（曾有过的第四态）** | 见下方「4.7 的单独说明」。**随 4.18 一并消失。** |
| 4.8 | **「跨模板唯一」的章节 id** | 用户新形状只要求**模板内唯一**。 |
| 4.9 | **`{{ title }}` / `{{ parent }}` / `{{ kind }}`** | 用户 11:26 后**变量全部作废**（`derive` 只剩 `label`/`description`/`template`，值由代码按固定规则生成）。③ 代码里从未校验过它们。 |
| 4.10 | **`{{ domain }}` 变量** | 用户 12:48「domain 保持纯展示」⇒ 卡上无 `domain` ⇒ 变量无落点。后随 4.9 一起整体作废。 |
| 4.11 | **`template: { ref, kind, domain }`** | 同 4.10。卡形状维持 `template: { ref, kind }`。 |
| 4.12 | **「编号 = 模板编号 + 分隔符 + 流水号（按模板分段）」** | 用户 03:47「数字递增是看前缀的」⇒ 按**前缀**分桶，不是按模板。 |
| 4.13 | **「编号全局唯一」** | 用户 03:32「编号是一个工作空间内唯一」+「外部注册不保证唯一性」。 |
| 4.14 | **「编号用于查询」** | 用户 03:32「编号是用于搜索的，不是用于查询的」。精确取模板用 `name`/`fullName`；精确取卡用内部键，不用编号。 |
| 4.15 | **「中文名表归 ③」** | 用户 06:43「9态的中文只在终端」⇒ ③ 不持有任何中文数据。 |
| 4.16 | **「旧编号升级（`T-001` 类）」** | 可先不做，留空位；旧版源码不可信、目标格式无依据。 |
| 4.17 | **`deriveInactive` 整块** | 用户 06:43「被取代后未完成→取消」后，旧卡状态已进 `status`，不再需要从取代边推导失效集合。③ 因此**不读任何关系**，重回零跨包依赖。 |
| **4.18** | **`accepts` 概念整体（含 `Accept` 类型、`accepts` 字段、`actionTypes` 入参、`RegisterTemplateOptions`）** | 见下方「4.18 与 4.19 的单独说明」。 |
| **4.19** | **「预设模板」整个概念（含 `presetOf` 字段、预设注册路径、预设继承 kind/domain/codePrefix）** | 见下方「4.18 与 4.19 的单独说明」。 |
| **4.20** | **`SectionAccepts` 类型名** | 带 `accepts` 语义；删字段后名不副实 ⇒ 改名 **`SectionInfo`**。 |
| **4.21** | **「模板层 `computeRules`」这条设计意图（三层结构：模板层 → 分类层 → 兜底）** | **代码从未实现**：`deriveStatus(kind, input)` 只收分类 id，**没有模板参数** ⇒ 模板层规则在签名上进不来。**本文件中凡是写"模板层可注册 computeRules"的地方，都是设计意图而非现状。** 若要真做，需先裁「模板层规则从哪来」（`TemplateDef` 加字段？还是 `resolve` 时合并？）——**这是待裁项，不是已完成项。** |
| **4.22** | **`Actor` 的 `'loop'` 取值** | 用户 `13:30`「loop 名字太离谱了。我说的是"消息循环"。**消息必须体现出来。**」「**agentMessageLoop**」⇒ 改为 **`'agentMessageLoop'`**。**⑦ 的 `Principal` 同步改名**（`packages/taskcard/src/types.ts:106` **已改**，我核过）。 |
| **4.23** | **`liveChildren` 只滤墓碑的旧语义** | 见下方「4.23 的单独说明」。 |

### 4.7 「`'unresolved'`」的单独说明

| 类型 | 例子 | 性质 |
|---|---|---|
| **真空壳** | `severity:'warning'`、`ACCEPTS_UNRESOLVED` | **类型里有、永远没有产生路径，也防不了外部输入** ⇒ 删，不留。 |
| **fail-closed 守卫** | `'unresolved'`（历史上的第四态） | **领域里合法、③ 不产出，但"防外部错误输入时静默放行"** ⇒ 有价值。 |
| **形状预留** | `kindOverride?: never` | **类型上禁止传值**，只在将来放开 ⇒ 不撒谎。 |

**历史处置（`'unresolved'` 曾从类型删除，防外部输入的职责转到运行时）**：
- 它曾从类型删除，因为 ③ 从不产出；防外部输入的职责转移到**运行时兜底拒绝**。
- **⇒ 这条历史规则已随 4.18（`accepts` 整体取消）一并失效** —— 已经没有 `accepts` 这个入参了。

### 4.18 与 4.19 的单独说明（**这两条是本批最大的收缩，理由要写清**）

**4.18 `accepts` 整体取消**
- **作废对象**：`type Accept`（`readonly string[] | 'any'`）、`SectionDef.accepts`、`ResolvedTemplate.sections[].accepts`、`sectionsOf` 的 `accepts`、`RegisterTemplateOptions`（它只有 `actionTypes` 一个字段）、`registerTemplate` 的第二参数。
- **理由**：**用户 11:26 的模板形状里，章节不再声明"接受哪些 action"。** ⇒ **"这一章允许哪些 action"这个概念从词汇表里消失了**，不是"暂时不用"。
- **连带**：② 的 `NO_ACTION_ALLOWED` / `TYPE_NOT_IN_ACCEPTS` 两个 issue code 也失去输入（已同步 ② 删除）。
- **⚠️ 历史说明**：`accepts` 曾有四态（`string[]` / `[]` / `'any'` / `'unresolved'`），后收敛为三态，再整体取消。**这条演进链不要再被误读成"现在还有三态"。**

**4.19 「预设模板」整体取消**
- **作废对象**：`TemplateDef.presetOf`、注册期的「目标模板必须存在」校验、「预设章节集必须与目标模板一致」校验、预设继承 `kind`/`domain`/`codePrefix` 的语义、注册表里"普通 vs 预设"的判别。
- **理由**：**用户 11:26 后模板语法里没有预设概念** ⇒ 注册表只剩一种模板。
- **连带**：⑧ 的 `derive[].template` 现在**只能指向普通模板**；"指向预设"这种情形不存在了。

### 4.23 `liveChildren` 旧语义作废的单独说明

**作废的旧实现：**
```ts
// 旧（本批之前）
function liveChildren(children) {
  return children.filter((child) => !child.deleted);   // 只滤墓碑
}
```

**新实现：**
```ts
function liveChildren(children) {
  return children.filter((child) => !child.deleted && !isDraftStatus(child.status));
}
```

**理由（用户原话，两句都要）：**
> **不算。新卡默认草稿。而草稿不是有效卡，创建一个草稿是不广播的。**（`12:46`）
> **这里的计算都要是有效卡，就是进行，或者搁置。草稿是不算的。**（`13:15`）
> **所有的转化规则里面都特意没纳入草稿。**（`13:15`）

**⇒ 为什么这是一个真 bug，不只是措辞问题：**
- **改前**：一张 `design` 卡下面建一张**草稿状态的调研（work）子卡** ⇒ `design.2.2` 命中（`work` 且非终态）⇒ **设计卡立刻跳到「需要信息」**，而**用户连调研都还没采纳**。
- **改后**：只有草稿子卡 ⇒ `liveChildren` 为空 ⇒ 不命中任何规则 ⇒ 落 `baseStatus`，与矩阵一致。

**⚠️ 受影响的规则精确是 2 条**（不是全部 8 条）：
- **只有 `goal` / `work` 的 `initialStatus` 是 `UNSPECIFIED`**，`design` / `record` 生来 `AUTH_REQUIRED` ⇒ **草稿子卡只可能出现在 goal/work 类子卡上**；
- **⇒ 改动实际影响 `design.2.2` 与 `work.3.3`**（判据含「非终态」的两条）；其余 6 条判据都是「等于某具体状态」，草稿 `UNSPECIFIED` 不匹配任何一个。

**⚠️ 跨包影响（已在代码注释里双向留痕）：** ⑧ 的「删除不广播」依赖本函数**同时**滤墓碑与草稿（见 5.4 与 `kind.ts` 的 `liveChildren` JSDoc）。
---

## 五、待用户裁决

### 5.1 内容取舍（原两条，**均已消解**）

1. ~~**`templates/userNeed.yaml:9` 的 `kind: 目标`（中文）**~~ —— **已修**。
   - **现状（已查实）**：`templates/core/userNeed.yaml:3` 是 **`kind: goal`（英文）** ⇒ 注册可通过。
   - **保留记录只为说明规则仍然生效**：③ 的注册校验**拒绝非英文 `kind`**（值域 = 已注册分类的英文 `id`）。
   - **`domain` 仍是中文且合法**（纯展示，不校验语言）——**两个相邻字段规则不同，不能统一处理**。

2. ~~**`max_picks`**~~ —— **已消解**。
   - **现状（已查实）**：`presets/` 目录**已不存在**（现只有 `templates/core` / `templates/code` / `templates/actions`），该条已无落点。

### 5.2 已裁：`additionalProperties` = 放宽（`true`）

- **【事实·已裁】** 三个内置 action 的 `additionalProperties` 已定为**放宽（`true`）**，允许未知字段穿过。
- **含义**：模板改版后，旧卡携带的新字段**不会**让它在重新经 `validateForCreate` 的路径上被判 `SCHEMA_INVALID`。
- **代价（如实记录）**：schema 不再封闭 —— 拼错的字段名不会在提交时被拒，只能靠 ② 的 `L1`（`$type` 已注册 / `items` 是数组等）与运行时渲染兜底。
- **对 ③ 无影响**：③ 不解析 payload、不校验字段。

### 5.3 实现层待确认（不需要用户裁，需需求方/lead 确认）

- **目标类基底值**：当前取 `SUBMITTED`。若"子任务全部终结但无成功"（例如全部被取消）时希望目标转 `CANCELED`，需改这一处。
- **`OCCUPYING_STATES`（哪些状态算"持有中"）**：**③ 只有 `KindDef.quota`（仅 `work`、值 `[WORKING]`）；`OCCUPYING_STATES` 是 ⑧ 自己定义的概念（`packages/core/src/claims.ts`），两者是两件事、不得互为别名。**
  - **⚠️ 归属更正（`【Lead 决定，2026-11-02 12:35】`）**：本节此前写「`OCCUPYING_STATES` 在 ③ 里不存在 / 若 ⑧ 需要则自己算或由 lead 裁定」—— **后半句是错的**：**⑧ 已经自己定义了**（`packages/core/src/claims.ts:13-18` 文件头注释，**已查实**）。
  - **⇒ 准确表述**：**它不在 ③，但在 ⑧**；③ **不提供**这个概念，也**不需要**提供。
  - **⑧ 的两个集合（供对照，非 ③ 的定义）**：
    - `OCCUPYING_STATES`（`claimedBy` 非空的状态）= 处理中 ∪ 搁置；
    - `QUOTA_STATES`（计入「一个 actor 只能占 1 个」）= 只有处理中。
  - **③ 的 `quota` 对应的是后者**（`work` 且 `WORKING`），**不是前者**。
  - **⚠️ 用户依据仍是 `06:55`「必须先放下」**（需要有可控动作才谈得上"放下"），但**该判据的落点在 ⑧，不在 ③**。
- **多分类模板：当前不支持。** 注册表是 `Map<name, def>`，一个 `name` 只能有一个 `kind` ⇒ 「空模板可用于四分类 / 外部一模板多分类」**表达不出来**。
  - **若将来要支持**，必须**连带确认「创建期 `card.template.kind` 的快照从哪来」**，否则 core 还要再裁一次。

### 5.4 `work` 的「失败」权限是否要强制 `user` 专属 —— **需 lead 确认**

**用户 `13:30` 原话：**
> **我加上去了。工作的进行和搁置的 4 个状态都可以用户点击失败。**

- **⇒ 明确的部分**：`kind === 'work'` 在 `SUBMITTED` / `WORKING` / `INPUT_REQUIRED` / `AUTH_REQUIRED` 四态下，`user` 可以置 `FAILED`。
- **⚠️ 未明确的部分**：「**用户**点击失败」这句，**是"只允许用户"还是"至少用户能"？**

**③ 的现状（代码事实）：**
- `canTransition` 的默认路径是「其余转移 ⇒ 放行」 ⇒ **这 4 条转移对 `user` / `agentMessageLoop` / `host` 都会被放行**；
- **⇒ `user` 专属这一层没有在 ③ 里强制。**

**两个选项：**
| 选项 | 含义 | 代价 |
|---|---|---|
| **(甲) 不强制，保持放行** | 「用户能点失败」是**至少**用户能；AI 也能（矩阵五/提交里本来就有「ai 调用失败，且具有一个失败的交付或阻碍」） | **零改动** |
| **(乙) 强制 `user` 专属** | 加一条 `kind === 'work' && to === FAILED && actor !== 'user' ⇒ deny` | 与矩阵五/提交的「**ai 调用失败**」条款**冲突** |

**⚠️ 我倾向 (甲)**，因为**矩阵五/提交明确列了「ai 调用失败，且具有一个失败的交付或阻碍，变成失败」** —— 若强制 user 专属，会把这条已有条款打死。
**⇒ 但这是裁决题，不是我能定的。等你裁。**

**⚠️ 另一条相关事实（代码与矩阵的差异，不影响本批但要知道）：**
- 矩阵 五/提交 的 AI 失败条件是「**且具有一个失败的交付或阻碍**」；
- ③ 的 `canTransition` **不做这个前置条件检查**（它只看从/到/actor，$type 级别的 payload 事实它不知道）⇒ **这个前置条件应由 ⑦/⑧ 在动作准入时判，不在 ③。**

### 5.5 「确认方向」类动作的 `user` 专属是否要在 ③ 强制 —— **需 lead 确认**

**用户 `13:30` 权限总原则：**
> **设计当然只有用户能确认。记录也只有用户能确认。这两个都是直接决定方向的。ai 不能决定方向。**

**⇒ 明确要求**：`design` / `record` 的**确认**（`AUTH_REQUIRED → COMPLETED`）**只有用户能做**。

**③ 的现状（代码事实）：**
- `canTransition` **没有为"确认"写任何 actor 分支**；
- **⇒ 它走默认路径「其余转移 ⇒ 放行」** ⇒ **`agentMessageLoop` 也能确认设计/记录**；
- **⇒ 这与用户 13:30 的权限总原则冲突。**

**⚠️ 但这条不是"③ 应该补"，需先确认「谁该强制它」：**
| 选项 | 含义 |
|---|---|
| **(甲) ③ 补分支** | `kind ∈ {design, record} && from === AUTH_REQUIRED && to === COMPLETED && actor !== 'user' ⇒ deny` |
| **(乙) ⑦/⑧ 层拦** | ③ 只判状态机合法性，动作权限由上层动作表（哪个按钮谁能点）决定 |

**⚠️ 我倾向 (甲)，理由：**
- **`canTransition` 的签名里已经有 `actor`** —— 若"确认只能用户"不在这里判，**`actor` 这个参数就没有存在意义了**（至少对确认这类动作用不上）；
- **且 ③ 已经在用 `actor` 判采纳** ⇒ **同一类判断分散两层，会形成两个真值来源**。

**⇒ 但这是裁决题。等你裁。**

---

## 六、需要与其它成员对齐的

### 6.1 与 ⑧ core
- 调 **`registerTemplate`（单参数）/ `markTemplateRegistryReady` / `resolve` / `sectionsOf` / `templateMeta` / `nextId` / `parse` / `normalize` / `toDisplay` / `initialStatus` / `kindLetter` / `canTransition` / `deriveStatus`**。
- **`canTransition` 要传 `ctx`**：`ctx.depsAllEnded`（依赖是否全部在完成组）+ `ctx.actorHasActiveWork`（该 actor 是否已有处理中的工作卡）。**两者都由 ⑧ 计算后传入，③ 不自己查。`undefined` 必须报错，不得给默认值。**
- **⚠️ `actor` 的取值（用户 13:30 改名）**：③ 的 `Actor` 是 **`'user' | 'agentMessageLoop' | 'host'`**。**⑧ 若要传 `'ai'` 或 `'loop'` ⇒ 类型不通过、且运行期会走错分支。**
- **启动编排**：读 YAML → 解析 → 调 **`registerTemplate(obj)`（单参数）** → 全部注册完后调 **`markTemplateRegistryReady()`**。**③ 不自动注册**，所以 `apply` 跑完模板并不在 ⇒ ⑧ 必须显式触发。
  - **⚠️ 用户 `13:30` 的另一句**：「**直接在 ts 里面写字面量**。因为核心的含义就是随包分发不可关闭的。就是预设这个东西一直在工作。改模板名字就把这里一起改了就是。」
  - **⇒ 这句是对 ⑧ 说的，不归 ③**：③ 只提供 `registerTemplate` 函数，**模板名写在哪（YAML 还是 ts 字面量）由 ⑧ 的注册编排决定**。
- **`resolve(ref).displayName` 与 `.kind`**：建卡时 `.kind` 填入 `card.template.kind`；派生按钮拼标题用 `.displayName`（**必填，不用兜底**）。
- **`sectionsOf` 的返回形状（唯一正确版本）**：
  ```ts
  sectionsOf(templateRef) → Array<{ id: string; default?: unknown }> | undefined
  ```
  - **`default` 的类型是 `unknown`**（**不是** `Record<string, unknown>`、**不是** `object`）—— ③ **不解释它**，写成具体对象类型会暗示"③ 懂它的形状"。
  - **元素里没有 `sections` 字段、没有 `accepts` 字段**（`accepts` 已整体取消，见 4.18）。
  - **整体 `undefined` = 模板不存在**（元素级不存在"解析失败"）。
- **`sectionsOf` 只在 `validateForCreate` 那一次被调**（建卡）。**不需要"高频友好"**。**fork 补缺章时取该章 `default`**（没有 ⇒ 报错，不猜）。
- **`deriveStatus` 供计算态重算链用**：**每层只算一层**（用户 02:25「所有任务卡都是监听自己的监听对象」），**递归由 ⑧ 在外层循环做**。
  - **⚠️ 递归必须带 `visited`（防环 + 去重）**：`validateRelations` 只校验形状、**不查全局成环**，**损坏数据里 `A.parent=B` / `B.parent=A` 可达**。
- **`usedIds` 必须含墓碑**（编号永不复用）。
- **core 侧不写 `status` 字面量**，只 import ③ 的常量。**状态字面量单源在 ③**（⑦ 同守）。
- **core 在 fork 路径上不是纯转发层**：它组合 ⑦ 的 `droppedSections` / `missingSections` 与 ② 的 `hasUserContent`。**但这属"编排 + 消费判定"，不是"在 core 里写业务 if"** —— "允许丢弃 + 留痕"是已裁策略，core 不需要每次判断可接受性。
- **`derive` 的校验归 ⑧ 的 YAML 解析层**（③ 宽收、忽略）：`derive` 只剩 `label` / `description` / `template`；**旧 YAML 若还带 `title` / `relations` / `{{ }}` 变量，应由 ⑧ 拒绝，不是静默忽略。**

### 6.2 与 ② action
- **③ 不持 action schema、不持 `$type` 名单**。② 是唯一来源（`taskboard2Actions.list() → string[]`）。
- **`accepts` 概念已整个取消** ⇒ **③ 不再向 ② 传任何"允许哪些 action"的信息**（见 4.18）。
- **`sectionsOf` 元素形状**：`{ id: string; default?: unknown }`；**整体 `undefined` = 模板不存在**。
- **`default` 的合法性由 ② 判**（③ 不校验 `$type` 是否已注册 —— 拼错到建卡时才由 ② 报）。
- ② 侧需提供：**`splitPayload`**（⑧ 判 `hadContent`）。**`emptyPayloadFor` ⑧ 已不用**（fork 补缺章改走章节的 `default`）。

### 6.3 与 ⑦ taskcard
- ③ 供给 ⑦：**`DRAFT` / `type Kind` / `initialStatus(kind)` / `canTransition(kind, from, to, actor, ctx)` / `resolve(ref)`**。
- **⚠️ `actor` 的取值类型变了（用户 13:30）**：③ 的 `Actor` 是 **`'user' | 'agentMessageLoop' | 'host'`**；⑦ 的 `Principal` 是 **`{ type: 'user' } | { type: 'agentMessageLoop'; id: string }`**（`packages/taskcard/src/types.ts:106`，**已改，我核过**）。
  - **⇒ ⑦ 调 `canTransition` 时要传 `principal.type`**（`'user'` / `'agentMessageLoop'`），**不能传整个 `Principal` 对象**。
  - **⇒ ⑦ 侧没有 `'host'`** —— `host` 只存在于 ③ 的类型里，⑦ 不会传。
- ⑦ **不需要** `sectionsOf` / `templateMeta`（⑦ 对 `sections` 内容零参与；`sectionId` 只做键集比较）。
- **依赖完成度判定不归 ⑦**：⑦ 的 `planClaim` 只做单卡准入 + `actorHasActiveWork` 非空校验；**「提交→处理中」的合法性（含 `depsAllEnded`）归 ③ 的 `canTransition`**，`depsAllEnded` 由 ⑧ 算好传入。
- **卡形状 `template: { ref, kind }`**；`ref` 的值 = 模板 `name`；`kind` 存英文 id。
- **「草稿期不得删除已有 `sectionId` 键」归 ⑦**（`planChange` 校验 `next.sections` 键集 ⊇ `current.sections` 键集）。**⑦ 只保证"不缺键"，不保证"新增键是模板里真实存在的章节"** —— 后者靠 ② 的 `SECTION_NOT_IN_TEMPLATE`。
- **fork 两个方向**：⑦ 产 `fork-discarded` / `fork-filled` 事件（**仅 `sectionId[]`，不读 payload**），⑧ 落盘并决定事件名。

### 6.4 与 ① store / ④ relation / ⑤ search / ⑩ ui
- **① store：零耦合。** ③ 不调 store、不读文件、不写任何东西。`readAll` 返回全量含墓碑是 ① 的义务，**但"`usedIds` 含墓碑"是 ⑧ 的义务**。
- **④ relation：零接触面。** ④ 不认识状态、不认识分类、不调 ③。
- **⑤ search：零调用。** ⑤ 的条件里状态 / 分类 / 模板都是**字符串**；`card.template.kind` 与 `card.template.ref` 是它唯一需要的字段路径。**⑤ 不读章节、不读正文/备注。**
- **⑩ ui：只取 `templateMeta`**（`displayName` / `usage` / `description` / 章节的 `id,label,hint,default`）。**core 的取数面不含展示字段**。三栏筛选（领域/类别/模板）= **③ 注册表数据 + ⑩ 渲染**，⑤ 不参与。
  - **⑩ 的预填用 `templateMeta.sections[].default`** —— 与 ⑧ 的 `sectionsOf` 取自同一处，**两条路各自完整，不互相依赖**。

### 6.5 中文与文案
- **③ 不持有任何中文**（用户 06:43「9态的中文只在终端」）。`displayName` 字段由 ③ 定义，但**不落中文**。
- **`domain` 是例外**：它是**中文字面量、纯展示、不校验语言**（用户 12:48）。**与 `kind` 强校验英文的不对称是刻意且已裁的**，不是妥协。

---

## 附：待验证

- **【待验证】模板的运行期来源未定** —— 仓库 `templates/` 安装到别的机器上不存在（打进包内 / 复制到 `<dshHome>` / 可配置路径）。**影响 ⑧，不影响 ③ 的接口。**
- **【待验证】YAML 解析器来源未定** —— 当前项目无 `node_modules`，Node 无内置 YAML。**依赖顺序：先定"从哪读"，再定"谁解析"。**
- **【待验证】注册表纯内存不持久化** —— 进程重启后需 ⑧ 重新注册；③ 自身不缓存到磁盘、不缓存到模块级可变变量。
