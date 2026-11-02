# ⑧ core —— 核心

> 唯一编排入口。事务边界、调用顺序、对外门面。

**状态：接口已与 ①②③④⑤⑦ 对齐，待用户裁 3 项后开工。本文中凡标【实现判断】者均为我的选择，可被推翻。**

---

## 〇、本文的标注纪律

| 标记 | 含义 |
|---|---|
| `【用户指令，YYYY-MM-DD HH:MM】` | 用户原话。**只有我直接收到的逐字文本才用此标记** |
| 〔经 X 转达〕 | 我未亲收逐字原文，由某成员/lLead 转述。**不伪装成原话** |
| `【推断】` | 我从原话或已定前提推出来的，**不是用户说的** |
| `【实现判断】` | 我为落地做的技术取舍，可被推翻 |
| `【事实·已查实】` | 在仓库里读到的当前代码/文件事实，给文件与行号 |
| `【待验证】` | 技术前提，未实测 |

**没有代码。** 全仓库有效代码只有 `packages/types/src/status.ts`（59 行），其余包是空壳。
⇒ 本文所有结论都是**纸面契约**，没有一行被实现验证过。

---

## 一、用户原话（带时间锚点）

### 1.1 core 的定位与耦合

> 【用户指令，2026-11-01 04:39】
> 先把刚刚进行设计的。让他们把内容写docs里面去。……
> 负责关系的，把搜索的给一起负责。
> **然后让负责搜索的，改为去负责core。**
> 然后让负责关系的和负责储存的，有问题问我。**负责core的，现在没有职责指派给他。他的一切行为是统筹拟合其他的模块。而现在其他的模块没有设计完毕。他先不管。**

【推断】这条把「统筹拟合」定义为 core 的职责，同时**明确当时不设计**。现在的设计是在其它模块收敛后才开始的。

> 【用户指令，2026-11-01 12:19】
> **包括 core 也参与进来。因为模板要用到任务卡的字段。而模板是不认识任务卡的。这点要 core 提供耦合。**

【推断】这是 core 存在的第二个理由（第一个是事务与顺序）：**只有 core 同时认识模板与卡**。模板拿不到卡字段，卡不认识模板。

### 1.2 建卡与「提交」的含义（术语撞车）

> 【用户指令，2026-11-01 06:43】
> **提交，是从内存到持久化，从想法到可观看的步骤。是"新建任务"的 ui 上面的按钮。**
> **建卡是提交时发号。**
> **我没说过什么"视图"的概念。**
> **所有任务都可以创建子任务。任务图是一个像科技树的东西。**
> **模板可以改。**
> **墓碑只有草稿才能进去。而草稿是不能被指的。**
> **设计和记录也有 fork。他们是为了实现简单，而不是存在这个语义。所以 fork 了以后发生什么，是非目标的。**

【事实·用户直述】由此确定：

- **「提交」是动作**（面板按钮），产出 = **落库 + 发号 + 状态 `UNSPECIFIED`**；
- **发号点 = 建卡那一刻**，不是采纳；
- **草稿期存在**。

> 【用户指令，2026-11-01 07:05】〔经 Lead 转达〕
> **草稿不能 fork。fork 和编辑，是一个按钮。**

【推断】「一个按钮」是 **UI 事实**，所以「编辑权与 fork 权互斥」不是我们选的一条规则。⇒ 编辑权 ⟺ `DRAFT`；fork 权 ⟺ 非 `DRAFT`。

> 【用户指令，2026-11-01 07:05】〔经 Lead 转达〕
> 问：fork 出来的新卡，也要按"建卡时所有章节必须齐"来校验吗？
> **是。fork 也要求全章齐。**

> 【用户指令，2026-11-01 12:48】〔经 Lead/② 转达〕
> **章节是可选行为的，而提交的时候必须要有行为。**
> 〔另一句经 ② 转达〕**不能丢失数据，不能用户输入一大堆然后没了。**

【推断】「提交时必须有行为」= **有 payload 且 `$type` 合法**；**内容可为空**。

### 1.3 取代、失效与级联

> 【用户指令，2026-11-01 06:43】
> **被取代后，如果没有完成，那么直接归为取消。如果完成了，不动状态。仍然参与，但是因为已经处于取消，大部分问题都不存在。**
> **搁置不成立以后，重新计算那个计算优先级表。**

【事实·用户直述】取代不再引入「失效」这个派生概念：**旧卡在采纳事务里被写成真实状态**。⇒ 计算态直接读状态。

### 1.4 草稿与关系方向

> 【用户指令，2026-11-01 06:13】〔经 ⑦ 转达，我未亲收〕
> **查询出来的详情、ui 上的卡片详情，关系这一栏，都不包括任何"草稿"状态的任务卡。**
> **草稿卡自己的关系栏可以看到对别人的边。但是也不包含草稿。只有采纳了（非草稿的、冻结了的卡），才能出现在关系候选里。也就是说，草稿的关系也不能写草稿。**

> 【用户指令，2026-11-01 06:03】〔经 ⑦ 转达，我未亲收〕
> **采纳了，那些关系才能在对方身上看到。**

【推断】正确判据是**「另一端点是否草稿」**（出边看目标、入边看源），**不是**「边的目标是否草稿」—— 因为草稿不能被指，合法边不存在草稿目标。

### 1.5 空间、存储与查询

> 【用户指令，2026-11-01 05:39】〔经 04-relation.md 1.11 转引，我未亲收〕
> ui 有一个搜索框。agent 工具有一个搜索方法。所以，至少 core 已经存在了。当前工作空间已经在内存了。
> 搜索提供的是口径。是让 dsh 命令和 ai tool 有相同的文本。和 dsh 命令、ai tool、ui 搜索框，有相同的筛选结果。
> ui 方面只能在当前打开页面进行搜索。所以 agent tool 方面，可以理解为，打开一个空间，然后 **core 把所有任务的内存形式给他，然后他搜索**。

> 【用户指令，2026-11-01 05:28】〔经 04-relation.md 1.9 转引〕
> 一个卡只能属于一个空间。要查看，必须在卡的备注什么的地方，或者用户命令去看。**一个卡连关系都无法跨工作区去联系。**

> 【用户指令，2026-11-01 04:25】〔经 01-store.md 1.9 转引〕
> 那就走sqlite。 jsonl.zstd 也不是明文可读的。我也是解压以后才能看内容的。而且正好，备注，历史。这些字段要频繁改写。
> 〔同批〕**不做列。因为给储存成员的要求是支持任意的类型。所以储存就按照 json 进行存储。**

> 【用户指令，2026-11-01 01:29】〔经 01-store.md 1.3 转引〕
> **srore的事务，格式版本，锁，事务，都他自己写。** 历史，折叠，迁移，备份，没有考虑。现在不做。**接口我不管。** 只要能支持全类型就可以了。接口问题他们让成员之间互相汇报提问。

【推断】事务的**原语**在 ①（`BEGIN/COMMIT/ROLLBACK`），**事务的边界与顺序**在 ⑧。两者不冲突。

### 1.6 领取与释放

> 【用户指令，2026-11-01 06:43】〔经 ④ 转达，我未亲收〕
> **可以释放。** 并且对"工作"，**一个 ai（一个消息循环，如果是一个会话的子消息，也可以另外领取）只能让一个工作处于自己的"处理中"**。已经处理的不能再领取别的。**必须先放下。**

【事实·用户直述，原话明确的部分】**一个 AI 同时只能占 1 个工作。**
【推断】**占用主体 = 消息循环**（依据：括号里「子消息也可以另外领取」）；原话没有直述这一点。

### 1.7 草稿期能否编辑内容

> 【用户指令，2026-11-01 03:00】〔经 ⑦ 转述，我未亲收〕
> 在草稿阶段，内容是可以肆意编辑（包括删除），并且**不能进行填写内容的**（可以选择，编辑模板。模板会提供用户输入。**这个时候还不能进行用户输入**。但卡面的备注此刻已经可以填写了并且持久化，不随着采纳而清空）

【推断】「这个时候」指**面板/创建阶段** ⇒ **面板态也不能填值**，不只是"已持久化草稿卡"。

---

## 二、已确定的语义

### 2.1 core 的职责

| 归 core | 不归 core |
|---|---|
| 编排、事务边界、发号、状态转移调度 | 状态能否转 → ③ |
| 把内存卡集交给 ④⑤，把结果交回消费者 | 关系语义与级联算法 → ④ |
| 可见性投影（按 ③ 的常量做机械比较） | payload 语义与校验 → ② |
| 模板加载编排（读 YAML → 注册 ③） | 筛选 → ⑤ |
| 生成流水（写卡、写历史） | 落盘字节 → ① |
| 拒绝原因的文案翻译（**查表，不写字面量判断**） | 卡的准入判定 → ⑦（词法） |

**核心里的 `if` 形式的业务规则都是错的。** 判断由上游给，core 只按结果走。**常量比较不算业务规则**（知识在 ③，core 只做机械比较）—— 本条为【实现判断】，待与用户确认口径。

### 2.2 建卡三入口共用一个入口

**三入口**（用户 05:52 明说三阶段都走内存）：**面板新建 / fork / AI 工具传参**。

```
assertSectionsComplete(templateRef, payloads)      // 内部写死 requireItems: true，无开关参数
updateBody(cardId, sectionId, payload)             // UI 编辑，内部写死 requireItems: false
```

**「不给开关」是实现要求，不是风格**：`requireItems` 漏传若默认为 `false`，**等于把用户规则「提交时必须要有行为」静默关掉**，且没有任何其它闸门补上（② 的 schema 只管字段形状，不管 `items` 非空）。
⇒ **两个入口各自写死自己的值，无参数、无默认、无公共常量。**

### 2.3 两个校验调用点

| 场景 | 调用 |
|---|---|
| 建卡（三入口） | `② validateForCreate(payloads, sections)` |
| UI 编辑单章 | `② validateForEdit(payload, { sectionId })` |

- `sections` 由 **③ 的 `sectionsOf(templateRef)`** 直接给出，core **不包装、不加工**；
- **`sectionsOf` 返回 `{ id, default? }`**（`accepts` 已彻底移除，见 §3.8）—— 建卡校验只要 `id`，`default` 由建卡预填用（见 2.7b）；
- `sectionsOf` 返回 `undefined` ⇒ **core fail-closed 中止**，不进入校验；
- **`ok = issues.every(i => i.severity === 'warning')`**；**core 只认 `ok`，不数 `issues`**（数了会把 warning 当失败）。

### 2.4 `toIssueForUI` 两处调用

1. **建卡校验返回给 ⑩**；
2. **编辑期校验转发给 ⑩**。

⑩ 拿到的对象里**没有 `diagnostic`**（② 真正删除，不是类型收窄）。

### 2.5 模板加载编排

- **⑧ 在启动期：读 `templates/` → 解析 → 调 ③ 的 `registerTemplate(obj)`**；
- **③ 不读文件、不注册任何东西**（只有纯注册函数 + 注册表）；
- **扫描范围（`【用户指令，2026-11-02 11:26】` 后的目录结构）**：
  1. `templates/` **根目录**下散落的 `.yaml`；
  2. `templates/` 的**一级子目录**（`core/` / `code/` / 将来新增的领域目录），**排除 `actions/`**；
  - **不递归** —— `templates/` 只有两层，递归会把 `actions/` 子层也扫进来；
- **同名模板在两份文件里定义 ⇒ 报错**（不让后者静默覆盖）；
- **`registerTemplate` 单参数** —— `RegisterTemplateOptions` 类型已删（它只剩 `actionTypes`，`accepts` 移除后为空）；
- **模板注册不再依赖 ② 先就绪**（`accepts` 移除后注册期不校验 action 名单）⇒ `bootstrapTemplates(registry)` **单参数**；
- **模板/分类/行为注册表在启动期后不可变** ⇒ **core 不需要任何并发保护**。

### 2.5b `displayName` 必填

`【用户指令，2026-11-02 11:26】` 的派生按钮行为要求「标题 = 父标题-label，**label 缺失就用模板名字**」⇒ core 必须能取到模板的中文名。

- **`displayName` 是模板必填字段**：⑧ 的 YAML 解析层**显式校验非空**，缺了报 `TEMPLATE_PARSE_FAILED`；
- ③ 的 `registerTemplate` **也有运行时非空校验**（YAML 解析来的是 `any`，类型拦不住）⇒ 两道闸门，不是重复：一道在解析层、一道在注册层；
- **`resolve` 的返回值含 `displayName`**（⑧ 拼标题时读它）。

### 2.6 级联计划执行

```ts
type RelationsItem = { kind:'patchRelations'; cardId; relationPatch; reasons: Reason[] }
type StatusItem    = { kind:'setStatus';      cardId; targetStatus;   reasons: Reason[] }

type CascadePlan = {
  relationsPhase: RelationsItem[];   // 按 cardId 升序
  statusPhase:    StatusItem[];      // 按 cardId 升序
}
```

- **跨 phase 全序：先执行完 `relationsPhase`，再执行 `statusPhase`**；
- **core 两个循环、不交错、无 `switch`、不重排、不校验**；
- **排序 = UTF-16 code unit 升序**（`a < b ? -1 : a > b ? 1 : 0`）。**禁用 `localeCompare`** —— locale 差异会让同一份计划在两台机器排序不同，**深比较不相等**，可观测性被打坏；
- **为什么拆 phase 而不是"同卡内排序"**：真正的顺序是**跨卡**的（被转移的依赖方 → 旧卡置取消，两张不同卡）。「同卡内 patch 在 setStatus 之前」**根本不成立**；
- **为什么类型钉死而不是 `PlanItem` 联合**：联合会让 core 里出现 `switch (item.kind)`，那就是"未来顺手加个 case"的位置，与「业务规则不进 core」冲突。**加第三类动作必须新增第三个 phase —— 强制回答"它属于哪个阶段"**；
- `relationsPhase` 的每一项由 **`④ relation.applyRelationsChange(card, { kind:'patch', patches })`** 消费。

### 2.7 fork 流程

```
源卡 + 新模板
  → ⑦ planFork → { newCard, relations, events, droppedSections, missingSections }
      droppedSections: Array<{ sectionId, payload }>     // 源卡有、新模板无；⑦ 只透传，不解释
      missingSections: Array<{ sectionId }>              // 新模板有、源卡无；只给 id
  → core 对 dropped 逐项：② hasUserContent(payload) ⇒ hadContent
  → core 对 missing 逐项：③ sectionsOf 里该章的 default ⇒ 补 payload
      default 缺失 ⇒ EMPTY_PAYLOAD_UNAVAILABLE（文案与 detail 都带 sectionId）
  → assertSectionsComplete(新模板, 过滤并补齐后的 payloads)
  → 事务：发号 + 写卡 + 历史
  → history 记 fork-discarded / fork-filled
```

**为什么过滤旧章节**：② 把 `SECTION_NOT_IN_TEMPLATE` 定为 **error**，不过滤则模板改版后 fork 永久失败。
**为什么补缺章节**：`MISSING_SECTION` 是 **error**，且校验发生在**建卡提交那一刻**（新卡还不存在、面板里也没有那些章节）。
**补章依据 = 该章的 `default`**（`【用户指令，2026-11-02 11:26】` 后 `accepts` 移除）：`accepts` 没了，"从候选 action 里挑一个"的依据不存在 ⇒ `default` 是唯一依据。**没有 `default` 就不猜**（猜 `$type` = 替模板作者做决定），报错并指出章节。
⚠ **实测：17 个模板 52 章里 8 章没有 `default`**（`delivery.yaml` 三章全无、`question.yaml` 的 `blocked` 等）⇒ 这条报错会真的触发，**属模板内容问题**，非实现缺陷。
**`droppedSections` 的 `payload` 只做判空、不持久化**：history 只记 `{ sectionId, hadContent }`，不记内容（否则卡变大、且可能含敏感数据）。core 侧**用完即弃，不保留引用**。

### 2.7b 建卡时的章节预填

**建卡不给 `sections` ⇒ 用各章的 `default` 预填**（`sectionsFromDefaults`）。

- **只铺有 `default` 的章**，没有的留空 —— "该补什么"由建卡面板决定；**core 不猜**；
- `default` 来自 ③ 的注册表 ⇒ **深拷贝**后再放进卡（注册表那份不能被调用方改动）；
- **为什么复用 `default` 而不是硬编码"空 payload"**：`default` 是模板作者为该章声明的合法初值，core 自造一个空值等于绕过模板意图。

### 2.7c 派生按钮的初始化（`deriveDefaults`）

`【用户指令，2026-11-02 11:26】`：

> **派生按钮的行为一律携带：选择派生提供的模板，把关系里面设置对方为父任务，标题用父任务的标题，加上 -，然后加上父任务对这个派生按钮写的 label。如果没有 label，就加模板名字。这只是初始化的行为，如果中途改变了模板，标题不会附随自动更改。**

⇒ 实现在 `create.ts` 的**纯函数**里（不碰存储、不产生计划、不取时钟）：

```ts
deriveDefaults(parentCard, derive: DeriveButton, templateDisplayName)
  → { templateRef, title, relations }
title = `${parentCard.title}-${derive.label || templateDisplayName}`
```

- **`templateRef` = 按钮的 `template`**；
- **`relations.parent` = 当前卡 id**，`links: []`；
- **`title`**：`label` 缺失或空串 ⇒ 回落到模板的 **`displayName`**（中文显示名，**不是** `name` 英文标识）；
- ⚠ **只是初始化**：产物是**建卡面板的预填值**，用户随后可改模板/标题/删关系；**中途改模板，标题不跟着自动改** —— 标题一旦预填就是普通字段，**⑧ 不再回算**。
- ⚠ **`derive` 不进 `planCreate`**：⑦ 只见最终字段，不需要认识 derive。

**`parseDerive` 拒绝已删字段**：`derive[]` 里出现 **`title` / `relations` ⇒ 报错**。这两个字段已从语法删除（行为改成写死），接受它们等于"字段已删但被静默忽略"——有人写了会以为生效。
⚠ **③ 拦不住这个**：它的 `TemplateDef` 没有 `derive`，且 `registerTemplate` **不拒多余字段**（宽收）⇒ **结构错误只能在 ⑧ 的 YAML 解析层拦**。

### 2.8 事务边界

- **校验在事务前**：② 与 ③ 都是纯内存判定，不写盘、不读库 ⇒ 放事务内只拉长事务，不增加正确性；模板注册表启动期后不可变 ⇒ **不存在"校验通过 → 落库"之间模板变更的窗口**；
- **事务内 = 发号 + 写卡 + 历史**（fork 另加取代边）；
- **领取/释放必须原子**：状态与 `claimedBy` 一次写入（见 2.13）。

### 2.9 当前空间

```ts
resolveCurrent(sessionId) →
  | { status:'none' }
  | { status:'ok',    workspaceId }
  | { status:'stale', lastWorkspaceId }
```

- **机制在 ⑥，策略在 core**：⑥ 只返回状态、**不抛业务错、不出文案**；
- **`stale` 可重复出现**（⑥ 读时顺手幂等清理，清理失败也返回 `stale`）⇒ **core 的文案必须可重复展示**，不得写成一次性提示；
- **「无当前空间则报错」归 core**（用户 05:39 口径；⑤ 不接收空间参数、不报此错）。

### 2.10 业务删除

**业务删除 = 写一张 `deleted: true` 的整卡覆写（墓碑），墓碑继续占号。**
**core 中不存在任何业务路径调用 `① purgePhysical`**（物理删除会让编号可复用 ⇒ 撞主键）。

### 2.11 `kindOverride?: never`

建卡入口预留参数位，类型 `never`：
- **形状留在、但传任何值都是编译错误**；
- 将来支持多分类时把 `never` 改成 `Kind`，**签名不变**；
- 必须带注释：`// 形状预留：目前多分类不支持；放开时把 never 改为 Kind`；
- **不得改成"可选 `Kind`"**：常量空壳只是类型撒谎，**可选参数是路径撒谎**——调用方会真的走进去。

### 2.12 ⑤ = 宿主侧纯函数

- ⑤ **随包 import**，**不是 core 的 service 方法**；
- ⑩ 的搜索框：**条件序列化 → 宿主桥 → ⑤ 在宿主跑 → 结果回传浏览器**；
- 依据：**条件之所以必须可序列化，是因为它要跨"浏览器 → 宿主"这条边界**（用户 05:39「ui 只能当前页面搜索」「core 把内存形式给他」）。

### 2.13 占用（领取）

```ts
OCCUPYING_STATES = { 处理中, 搁置 }   // claimedBy 非空的状态集合（含搁置）
QUOTA_STATES     = { 处理中 }         // 计入「一个 AI 只能占 1 个」配额的状态集合（不含搁置）
```

- **两个集合已取定值，不再等裁决**（U7 已裁：`【用户指令，2026-11-01 06:55】`「搁置不算处理中」⇒ **搁置占持有、不占配额**）；
- **不变量 ②′**：`claimedBy` 非空 **⟺** `status ∈ OCCUPYING_STATES`；
- **清空原因白名单**：`release` / 转终态 / 删除。**其它任何状态变化都不清占用**（黑名单 `status !== 处理中` 会误伤搁置态）；
- **四条事务要求**：① 领卡原子（状态 + `claimedBy` 一次写）；② `release` 原子；③ **任何使卡离开 `OCCUPYING_STATES` 的转移（含级联转终态）必须同事务清空 `claimedBy`**；④ 采纳事务四样原子；
- **因两集合不同，core 必须算两个量**：`claimedBy`（事实）/ `quotaUsed`（度量）。**禁止用一个布尔表达两件事**；
- **读取侧断言**：core 读卡时若 `claimedBy` 与 `status` 不匹配 ⇒ **告警 + 标记待人工处置**，不改变判定值。
  ⚠ 能力边界：**它只能发现"字段间不一致"，不能发现"两者一起被改错的一致脏数据"；且不是定期体检，是"路过时检查"——脏卡不被读到就永不发现。不得声称覆盖率。**
- **`actor` 消失 ≠ 释放**：占用清空只能由「离开 `OCCUPYING_STATES`」或显式 `release` 触发。
- **孤儿占用（`claimedBy` 指向已消失的 actor）不是缺口**：`【用户指令，2026-11-01 07:00】`「用户可以释放（持有者消失时）」⇒ **由用户强制释放解决**（`principal: {type:'user'}` 走 `planRelease`）。
  ⚠ **脏卡标记不自动解锁**（标记不猜），**解锁 = 用户显式释放** —— 两者不冲突：**标记负责"让人知道"，用户释放负责"解决"**。

### 2.14 同词两义（命名分离，必须写死）

| 概念 | 判据 | `ask.picked = []` | `text.value = ""` | `ask.items = []` |
|---|---|---|---|---|
| **`isEmptyForValidity`** | 合法性（用户 12:48 把三者并列为"内容为空"） | 空 | 空 | 空 |
| **`hasUserContent`** | 是否有用户表达（丢失判定） | **有内容** | 无 | 无 |

**`hasUserContent` 由 ② 的 `splitPayload(payload).answer` 提供，契约必须写死 `ask.picked === [] ⇒ hasUserContent = true`。**
**否则 fork 会静默丢掉用户的「都不要」表态。**

同类「同词两义」还有两处，均以命名分离处置：
1. 面板「提交」（动作，产出 `UNSPECIFIED`） vs 状态值 `SUBMITTED`（采纳结果）—— core 内部一律用 `create/建卡` 指前者；
2. 「持有」(`claimedBy` 非空) vs 「占配额」(`QUOTA_STATES`)。

### 2.15 建卡校验归属（两条不同的事，不重复）

| 校验 | 归属 | 依据 |
|---|---|---|
| `取代` 不许手写进 relations（词法规则） | **⑦** | fork 才产生取代 |
| 目标存在 / 非草稿 / 同空间 | **core** | **⑦ 不知道"空间"这个概念**，判不了 |

**core 校验范围**：**`relations.parent` 与每条 `links[].to` 一视同仁**，在**事务前**做。

### 2.16 状态字面量单源

**core 永不写 status 字符串**，只用 ③ 导出的常量（`TaskState.WORKING` 等）。③ 的 `status.ts` 用 A2A 全名（【事实·已查实】`packages/types/src/status.ts:16-26`）。⑦ 已确认同用全名。

### 2.17 「完成」是一个**状态组**，不是「成功」

【事实·已查实】用户此前已明确：「**完成**」是一个状态组 = **{成功, 失败, 取消, 拒绝}**，即 ③ 的 `EndedStatus`（【事实·已查实】`packages/types/src/status.ts:49-53`）。

⇒ **用户 06:43「被取代后，如果没有完成，那么直接归为取消」中的「完成」指状态组，不是"成功"。**
⇒ **「没有完成」= 不在「完成」组 = `DRAFT` / `SUBMITTED` / `WORKING` / `INPUT_REQUIRED` / `AUTH_REQUIRED`。**
⇒ **失败 / 取消 / 拒绝 都在「完成」组里 ⇒ 不会被抹成「取消」。**

⚠ **我曾误把「完成」读成「成功」**，并据此推出「失败会被抹成取消 ⇒ 使『失败必须有记录子任务』『每 3 个失败配 1 个复盘』失效」，还把它列为待裁。**该推断与待裁项一并作废。**

### 2.18 模板 ↔ 卡的耦合（**已从变量改成写死的派生行为**）

> 【用户指令，2026-11-01 12:19】
> **包括 core 也参与进来。因为模板要用到任务卡的字段。而模板是不认识任务卡的。这点要 core 提供耦合。**

> 【用户指令，2026-11-02 11:26】
> **派生按钮的行为一律携带：选择派生提供的模板，把关系里面设置对方为父任务，标题用父任务的标题，加上 -，然后加上父任务对这个派生按钮写的 label。如果没有 label，就加模板名字。这只是初始化的行为，如果中途改变了模板，标题不会附随自动更改。**

**⇒ `{{ }}` 变量体系整条作废**（11:26 裁决）。耦合的形态从「模板里写占位符、由渲染方替换」变成「**core 里写死一个纯函数**」：

- **`derive` 只剩 `{ template, label?, description? }` 三个字段**；
- **三个初始值的来源**：模板 = `derive.template`、父任务 = 当前卡、标题 = `父标题-label`（label 缺 ⇒ 模板 `displayName`）；
- **实现在 `create.ts` 的 `deriveDefaults`**（见 2.7c），**core 自己算，不交给模板**；
- **`derive` 不进 `planCreate`**：面板预填之后用户可改模板/删关系，`planCreate` 只见最终字段 ⇒ **⑦ 不需要认识 `derive`**；
- ⚠ **中途改模板，标题不跟着变** —— "只是初始化"，⑧ 不回算。

**耦合面仍然很窄**：**只有"点派生按钮 → 预填建卡字段"这一个时刻需要卡字段**，不是建卡时、不是校验时。

---

## 三、我的判断与实现选择

### 3.1 YAML 解析器来源 —— 【待用户裁决】，倾向 core 加依赖

【事实·已查实】`taskboard2` 全仓库**没有任何 `node_modules`**；Node 无内置 YAML 解析。

| 方案 | 代价 |
|---|---|
| **(甲) core 加 `yaml` 依赖** | core 是**唯一允许有依赖的编排层**（② 的 `schemastery` 已是 peerDependency 先例）；风险 = 项目首次引入运行时第三方依赖 |
| (乙) 手写受限解析器 | 须支持 mapping / sequence / **`|` 块标量**（`usage`/`description` 都在用）；会变成一个**自有 YAML 子集规格**，长期无人维护 |
| (丙) 模板改 JSON | **排除**：推翻用户刚落的形状 |

**我方按 (甲) 落笔，但实现前必须拿到裁决。**

### 3.2 拒绝原因 → 文案必须查表

⑦ 是纯函数、**返回拒绝原因不抛错**。core 的 `assert*` **只取结果、自己不判、不抛**；抛错只发生在 core 的对外门面；**`reason.kind` → 文案必须是查表映射，不得写 `if (reason.kind === …)`**（否则业务规则又漏进 core）。

### 3.3 core 对外门面不做自动重试

**建卡失败即失败**，不自动补章节、不自动改模板、不自动重发。理由：**每一种"自动修"都是替用户做决定**，而建卡是用户主动动作，失败信息足以让用户改。

### 3.4 空间切换 = 丢弃旧内存 → `readAll` 新空间

core **在激活空间时 `readAll(wsId)` 一次并长期持有**；**不在循环里重复调**（① 每次 `readAll` 都是全量 `JSON.parse`）。
**内存真值归 core，① 只做「字节 ↔ 值」。**

### 3.5 不做「读取缓存层」

不缓存 ③ 的 `sectionsOf` 结果、不缓存 ⑤ 的结果。

**唯一允许的缓存**：**编辑会话内**缓存当前模板的 `sections`（供 ⑩ 单章编辑时知道有哪些章节）—— 该缓存的作用域是**一次编辑会话**，不跨调用保留。
**跨调用缓存一律禁止**（尤其「源卡是否草稿」这类可推导量：缓存即第三种真值）。

### 3.6 缺章没有 `default` ⇒ 报错，不猜

`【用户指令，2026-11-02 11:26】` 之后 `accepts` 移除，"从候选 action 里挑一个"的依据不存在 ⇒ **`default` 是补章的唯一依据**。

| 情形 | 处置 |
|---|---|
| 该章有 `default` | 深拷贝后作为 payload |
| 该章**没有** `default` | **`EMPTY_PAYLOAD_UNAVAILABLE`**，文案与 `detail` **都带 `sectionId`** |

**不猜**：替模板作者选一个 `$type`，等于让 core 承担模板语义 —— 而 core 是**不认识 payload 的**。
⚠ **这不是预留分支**：17 个模板 52 章里 8 章没有 `default`（`delivery.yaml` 三章全无、`question.yaml` 的 `blocked` 等）⇒ 会真的触发。**属模板内容问题**。

### 3.7 `default` 由 ③ 给，core 只搬运

`default` 是**模板声明的一部分**，与 `id` 同级 ⇒ ③ 的 `sectionsOf` / `templateMeta` 都带它。
- **core 不解释 `default` 的形状**（那是 payload，schema 校验归 ②、且只在创建时）；
- **core 只做深拷贝 + 放进 `sections`** —— 注册表那份是共享的，调用方会改手上的副本。
- **`emptyPayloadFor` 已不再用于 fork**（② 侧签名也改成 `emptyPayloadFor(preferredType?: string)`，⑧ 不用它）。

### 3.8 `accepts` 彻底移除

`【用户指令，2026-11-02 11:26】`：章节不再声明"接受哪些 action"。

- ③ 的 `sectionsOf` 返回 `{ id, default? }`，**无 `accepts`**；
- 注册期**不再校验 `accepts ⊆ actionTypes`** ⇒ 模板注册**不再依赖 ② 就绪**（见 2.5）；
- `validateForEdit(payload, { sectionId })` —— **只剩 `sectionId`**；
- `missingSections` 只剩 `{ sectionId }`（不再带 `accepts`）；
- ② 的 `validateForCreate(payloads, sections)` 仍收 `sections`，但其中的 `accepts` 字段不再被 ② 使用（**② 侧的收窄由它自己声明**）。

### 3.8b 模板注册不再依赖 ② 就绪

`accepts` 移除前，注册期要校验 `accepts ⊆ actionTypes`，所以**必须先等 ② 的 action 注册表就绪**。
`accepts` 移除后**没有这道校验** ⇒ **⑧ 的 `bootstrapTemplates(registry)` 只依赖 ③**。

⚠ **代价**：注册期对"章节该用什么 action"**零校验** ⇒ 模板写了个不存在的 `$type`，注册照样成功，**要到建卡 / 渲染时才炸**（见 7.3）。
⇒ 这是 `accepts` 移除的**必然代价**，不是遗漏：`accepts` 本来就是"注册期唯一能碰 action 名单的钩子"。

### 3.9 可见性 = 投影，不是入参变换

**core 交给 ④⑤ 的卡集与边集一律全量（保留草稿、只剔墓碑）；可见性在出结果时按谓词投影。**

- **禁止在数据层删边/过滤集合**：否则「依赖是否已转移」这类业务判定会静默放宽；
- **禁止用「过滤后集合 + 事后补回」模拟**：补回会产生两种来源的边，比裁剪更难查；
- 谓词：**渲染某卡关系时丢掉「另一端点卡是草稿」的边**（出边看目标、入边看源）；
- **准入（写入拒绝，fail-closed）与可见性（渲染投影，fail-open）是两条独立代码，不得合并**：合并会产生「因为看不见所以不能写」的假因果。

### 3.10 墓碑与边

【事实·用户直述 06:43】「墓碑只有草稿才能进去。而草稿是不能被指的。」
⇒ **墓碑 ⊂ 草稿 ⇒ 墓碑不可能成为边目标**。

- 给 ④⑤ 的输入：**当前空间全量非墓碑卡**（不分页、保留草稿）；
- **`tombstones` 集合不再需要传**（哑边类目不可达）；
- 只剩 **「坏引用」**（边指向不存在的裸 id）；因用户 05:52「没有 0.1.0 的发布，没有数据可以破坏」⇒ **空库起步 ⇒ 坏引用是纯 bug 信号**，**告警、不静默丢弃**。

### 3.11 取代执行的事务内顺序

**采纳事务四样原子**：新卡状态 / 依赖转移 / **旧卡终止** / 历史。
- **顺序**：**先转移依赖，再置旧卡取消** —— 反序会让旧卡一取消就触发级联，把还没转移的依赖方误收；
- **旧卡终止语义**：未完成 → `取消`；已完成 → 不动（用户 06:43）；
- **传递性**：无需从取代边推导闭包 —— **取代不递归，每条只处理自己的直接前驱**。
  ⚠ 但它**依赖"每次取代的处理是自洽的"**，不依赖任何未确认的时序前提。

### 3.12 派发不校验

【事实·用户直述 06:43】「所有任务都可以创建子任务。任务图是一个像科技树的东西。」
⇒ **core 不实现派发规则校验**（旧版「工作不能派工作」已作废）。

### 3.13 模板章节的存在性只由 ② 判，core 不造 issue

`MISSING_SECTION` / `SECTION_NOT_IN_TEMPLATE` **全部由 ② 造**；core 只传两侧集合。
**core 不循环造 issue** —— 否则 issue 有两份来源。

### 3.16 未注册 `$type`：**校验拒，渲染不拒**

> 【用户指令，2026-11-01 13:26】
> **action要做一个兜底渲染器，用来渲染没有注册的架构。效果是一个按钮，写着未注册的动作。点击以后展开，展示原始json。**

**两条路径的答案不同，必须分开写**：

| 路径 | 未注册的 `$type` | 归属 |
|---|---|---|
| **建卡校验**（`validateForCreate`） | **拒**（`UNKNOWN_TYPE`，`severity: 'error'` ⇒ `ok: false`） | ② |
| **渲染**（`render` / `view` / `edit`） | **不拒** —— 走**兜底渲染器**：按钮「未注册的动作」+ 展开显示原始 JSON | ② |

**理由**：
- **校验拒**：建卡时必须是**已注册**的 action，否则存进去的东西**没有编辑能力**（渲染器是 action 的一部分，没有 action 就没有编辑通道）—— 而用户 12:48「不能用户输入一大堆然后没了」正要求"存进去的东西可再编辑"；
- **渲染不拒**：模板可改、注册表可变（虽然只在启动期）⇒ **旧卡上可能留着当前未注册的 `$type`**。此时**能看、不能改**，比"整卡打不开"好。⇒ 兜底渲染器是**读路径的兼容层**，不是校验的放宽。

**⇒ core 侧的三条**：
1. **不得因为"有兜底渲染"就跳过 `UNKNOWN_TYPE`** —— 校验路径照拒；
2. **不得假定"每个 payload 的 `$type` 都能渲染/编辑"** —— 编辑入口遇到未注册 `$type` 必须走兜底（只读展示），**不得自行构造编辑控件**；
3. **core 不产兜底渲染的任何文案或结构** —— 「未注册的动作」这句文案与展开行为都在 ② 的渲染器里。

⚠ **曾误判**：我原先把"未注册 `$type` ⇒ `UNKNOWN_TYPE` 是错误"当成一条规则，**漏了它在渲染路径上不是错误**。**判据是"这条路径上缺了它还能不能继续"**：校验缺了就存不进去（继续不了 ⇒ 拒）；渲染缺了还能显示原始 JSON（能继续 ⇒ 不拒）。

### 3.14 「提交之后章节被删空」**不构成缺口**

> 【用户指令，2026-11-01 12:48】〔经 Lead 转达〕
> **提交时必须有。编辑期间可以是内存状态。但只要上了草稿就必须有行为了。**

**拆成两件不同的事，各自由已有的闸门处理**：

| 动作 | 是否违反「每章有行为」 | 由谁拦 |
|---|---|---|
| **删掉整个 section 键** | **违反** | **⑦ 的 `planChange`**：`DRAFT` 时要求 `next.sections` 键集 ⊇ `current.sections` 键集（禁删键） |
| **把内容删空**（`items: []` / `value: ""`，`$type` 仍在） | **不违反** | 无需拦 —— 用户 12:48 已明确「内容为空合法」：「每章有行为」= **有 payload 且 `$type` 合法** |

⇒ **「已采纳的卡带空章节」是允许且正确的状态，不是缺口。**
**「上了草稿就必须每章有行为」由 ⑦ 的禁删键守卫落实；core 不额外加闸门**（加就是第四处实现同一规则）。
⚠ **曾被误判为缺口**：我原以为"草稿期删空 → 采纳 → 带空章节落库"违反用户规则；**错在把「删内容」当成了「删行为」**。行为是 `$type`（payload 存在），不是内容是否为空。

### 3.15 其它实现约束

| 项 | 选择 |
|---|---|
| core 的包依赖 | `inject` 七个服务（①store ②action ③types ④relation ⑤search ⑥workgroup ⑦taskcard）——【事实·已查实】`packages/core/src/index.ts:12-20` |
| 空间切换 | 丢弃旧内存 → `readAll` 新空间；**不做增量 diff** |
| 历史写入 | core 在事务内盖章时间戳与 `reasons`；**不产自然语言文案**（文案归 ⑨⑪） |
| `history` 内容 | **只记结构化数据**（`{at, action, detail}`），**不记被丢弃的 payload** |

---

## 四、作废与被推翻的方案

| # | 作废的方案 | 被什么推翻 |
|---|---|---|
| **1** | **`readAll` 结果缓存（store 侧）** | 内存真值归 core。① 只做「字节 ↔ 值」，每次返回新对象 ⇒ 缓存只会制造两份可变状态 |
| **2** | **接口名 `remove`** | 改名 **`purgePhysical`**：业务删除走墓碑，物理删除会让编号复用 ⇒ 撞主键。**名字比注释有效** |
| **3** | **`globalKv` 不进 public 面**（我曾反对公开） | ⑥ 是独立包、只能经 public 面访问 ① ⇒ 不公开则「当前空间指针」无处存。**key 不透明 ⇒ 公开不会让 ① 认识业务语义**；「谁都能改当前空间」是用的问题，靠约定解决 |
| **4** | **`STATUS_GROUPS` 经 core 转发给 ⑩** | core 只判等/集合判定，不遍历。⑩ 要遍历 **直接 import ③**，否则 core 变成状态词汇的二次分发点 |
| **5** | **平铺 `PlanItem[]`（含"同卡内 patch 先于 setStatus"约束）** | 真正的顺序是**跨卡**的（被转移依赖方 → 旧卡置取消）⇒ 拆 `relationsPhase` / `statusPhase`，**类型钉死** |
| **6** | **fork 时弹窗确认"会丢哪些章节"** | 风险收窄为边角（仅 `hadContent: true`）⇒ **允许丢弃 + history 留痕**，不阻断、不弹窗（先不为此给 `derive` 开行为口子） |
| **7** | **`deriveInactive(cards, supersedeEdges, draftCardIds)` + 传递闭包 + 环剪枝** | 用户 06:43 把失效变成**显式状态「取消」** ⇒ 计算态直接读状态；保留它即第三处真值 |
| **8** | **`view` 上下文 / 三态 A/B/C 作为入参** | 【用户指令 06:43】「我没说过什么"视图"的概念。」⇒ 数据层两态 + 投影一条谓词 |
| **9** | **`tombstones` 入参 + 哑边类目** | 墓碑 ⊂ 草稿 且 草稿不能被指 ⇒ 墓碑不可能成为边目标 |
| **10** | **「采纳时要求 `complete`（L3 内容完整）」** | 采纳是状态转移，不是内容完整性校验；且草稿期禁填值 ⇒ 采纳时答案必然为空。L3/`complete` 已随用户 07:00 一并作废 |
| **11** | **`requireItems` 作为参数（含默认 `false`）** | 默认 `false` = 静默关掉用户规则 ⇒ 改为两个入口各写死、无开关 |
| **12** | **`kindOverride?: Kind`（可选 `Kind`）** | 常量空壳只是类型撒谎，**可选参数是路径撒谎**（调用方会真的走进去）⇒ 改 `never` |
| **13** | **`remove`/`purgePhysical` 用于业务删除（假设）** | 会撞主键。业务删除 = 写 `deleted:true` 的整卡覆写 |
| **14** | **core 在交卡集前裁剪可见性** | 同一批数据不能服务第二个视角；且业务判定需要"边存在"这个事实 ⇒ 改为投影 |
| **15** | **`derive` 进 `planCreate`** | derive 是**面板预填**，用户可改模板/删关系；⑦ 不该把 UI 概念吃进卡层 |
| **16** | **预设模板（`presetOf` / `PRESET_PAYLOADS` / `presetPayloadsOf` / `presets/` 目录扫描）** | 用户 11:26 **整个概念取消**。预设曾是"内容已填好的模板"，其价值（一键建出填好的卡）改由**章节 `default` + 派生按钮**承担。代码删 ~105 行 |
| **17** | **`accepts`（章节"接受哪些 action"）** | 用户 11:26 **彻底移除**。它曾是 `emptyPayloadFor` 挑 action 的依据、注册期校验的对象。替代物是**章节 `default`**（该章初始化 payload）。`Accepts` 类型、`SectionSpec.accepts`、`missingSections[].accepts`、注册期 `actionTypes` 校验**全部删除**；模板注册因此**不再依赖 ② 就绪** |
| **18** | **`{{ title }}` / `{{ parent }}` / `{{ kind }}` / `{{ domain }}` 变量体系** | 用户 11:26 **整条作废**。耦合从「模板写占位符、渲染方替换」改成「**core 里写死的纯函数 `deriveDefaults`**」。`derive[]` 的 `title` / `relations` 字段随之删除 ⇒ ⑧ 的 YAML 解析层**显式拒绝**它们（接受等于静默忽略） |
| **19** | **`RegisterTemplateOptions`（`registerTemplate` 第二参数）** | 它只剩 `actionTypes` 一个字段，`accepts` 移除后为空壳 ⇒ 整个类型删除，`registerTemplate(def)` **单参数** |
| **20** | **`SECTION_ACCEPTS_NOTHING` / `SECTION_NO_EMPTY_PAYLOAD` 两个错误码** | `accepts` 移除后失去依据；fork 补章改由 `default` 决定 ⇒ 合并为单个 **`EMPTY_PAYLOAD_UNAVAILABLE`**（文案与 `detail` 都带 `sectionId`） |
| **21** | **`loadTemplates` 只扫 `templates/` 根目录** | 目录结构改成 `templates/core/` + `templates/code/`（领域分目录）后，**根目录扫描一个模板都扫不到** —— 这是本次改动里最长的硬阻塞。改成「先扫根目录 yaml，再扫排除 `actions/` 的一级子目录」 |

---

## 五、待用户裁决

**仅 2 条**（U1 / U2，且两者有依赖顺序）。其余原本列为待裁的问题已由用户或 Lead 裁掉，见 §2、§3 与本节末尾的「已裁」表。

| # | 问题 | 现状与倾向 |
|---|---|---|
| **U1** | **YAML 解析器从哪来** | **倾向 (甲) core 加 `yaml` 依赖**（core 是唯一允许有依赖的编排层，② 的 `schemastery` 已是 peerDependency 先例）。已报 Lead 等裁。另两条路（手写受限解析器 / 改 JSON）的代价见 3.1 |
| **U2** | **模板运行期来源**：仓库根 `templates/` 安装后是否存在 | 【事实·已查实】模板在仓库根 `templates/`，**不在任何包的 `files` 里**。与 U1 有**依赖顺序**：**先定"从哪读"，再定"谁解析"** |

### 已裁（不再待裁，供追溯）

| 原编号 | 问题 | 结论与出处 |
|---|---|---|
| **U3** | `additionalProperties` 严格 vs 放宽 | **接受严格**。`【Lead 指令，2026-11-01 13:45】`。含义：payload 里多写一个未声明的字段会在**建卡期**被 ② 的 schema 拒；**"注册成功 ≠ 模板可用"**（见 7.3） |
| **U5** | 「所有任务都可以创建子任务」是否含草稿 | **不含草稿**。`【用户指令，2026-11-01 12:48】`。⇒ **写入侧拒绝草稿作为关系目标是对的**，与「草稿不能被指」(06:43)、「草稿不能 fork」(07:05) 一致 |
| **U6** | 提交之后把章节删空是否允许 | **不构成缺口**，见 3.14。删键归 ⑦ 拦；删空内容合法 |
| **U9** | `{{ title }}` 的语义 | **该变量已作废**（`【用户指令，2026-11-02 11:26】` 把派生行为改成写死）。当时裁的是「源卡（当前卡）的标题」—— 这个语义与 `deriveDefaults` 里用 `parentCard.title` 一致，**结论仍成立但变量不再存在**（见 §4.18） |
| **U10** | `domain` 存中文还是英文标识 | **保持纯展示**。`【用户指令，2026-11-01 12:48】`。⇒ **卡形状不变**；`{{ domain }}` 变量连同整个变量体系一并作废（§4.18） |
| **U4** | 「没有完成」是否含 失败/取消/拒绝 | **不是待裁，是我漏了信息** ⇒ 见 §2.17【事实·已查实】 |
| **U7** | **搁置是否计入配额**（`QUOTA_STATES` 是否含搁置） | **不计入**。`【用户指令，2026-11-01 06:55】`：「搁置不算处理中」「占位算工作且处理中；目标的处理中不算；工作被自动转成搁置类别就不算处理中了」。⇒ **`QUOTA_STATES` 只含「处理中」**；`OCCUPYING_STATES` 仍含搁置（两集合从此**分离**，见 2.13） |
| **U8** | **孤儿占用怎么处置** | **不是缺口 —— 已由用户裁决的路径覆盖**。`【用户指令，2026-11-01 07:00】`：「用户可以释放（持有者消失时）」。⇒ **孤儿占用由用户强制释放**（`planRelease` 准入含"用户"，`principal: {type:'user'}`）。⚠ **脏卡标记仍不自动解锁**（标记不猜），**解锁动作是用户显式释放** —— 两者不冲突：**标记负责"让人知道"，用户释放负责"解决"** |

**注**：U1/U2 均与模板加载相关，且有依赖顺序（先 U2 后 U1）。**占用相关的两条（U7/U8）已裁** ⇒ `OCCUPYING_STATES` / `QUOTA_STATES` 两个参数化集合**均已取定值**，2.13 的不变量 ②′ 不再等任何裁决。

---

## 六、需要与其它成员对齐的

### 6.1 ① store（+ ⑥ workgroup）

```ts
readAll(wsId): Card[]                       // 全量含墓碑、不过滤、每次新对象
read(wsId, id): Card | undefined
write(wsId, cards): void                    // 唯一业务写入口，按 id 整卡覆写
purgePhysical(wsId, ids): void              // 物理删除；core 无任何业务路径调用
transaction(wsId, fn): T                    // fn 只拿 tx.*；用 public 面直接抛；无 await
listWorkspaces(includeArchived?): { id: string; archived: boolean }[]   // 默认不含归档
dbPath(wsId, archived: boolean): string
archiveDb(wsId): void
unarchiveDb(wsId): void
readMeta(wsId) / writeMetaKey(wsId, key, value)   // value === undefined ⇒ 删除该键
globalKv: { get(key), set(key, value), delete(key) }
```

- **全同步**（`DatabaseSync`）；core 全链路同步，async 只出现在 ⑨⑪ 边界；
- **`transaction` 的 `fn` 只拿事务绑定句柄 `tx.*`**；用 public 面**直接抛错**（不静默降级）；
- **`listWorkspaces` / `dbPath` / `archiveDb` / `unarchiveDb` 形状已是定稿**（`docs/01-store.md:203-206`，`【Lead 指令，2026-11-01 13:20】`）：
  · **`dbPath` 必须双参** —— 同一个 `wsId` 可能在根目录或 `archive/` 下；
  · **`listWorkspaces()` 默认不含归档**，`listWorkspaces(true)` 才列出；
  · ⚠ **空间名不在 `listWorkspaces` 的返回里**（它扫目录、零开库）⇒ **UI 显示空间名必须走 ⑥ 读空间 `meta`**（会开库）；
- **⑥ 与 core 的分工**：`resolveCurrent(sessionId)` 返回 `none/ok/stale` 三态；**⑥ 不抛业务错、不出文案**，报错出口在 core。

### 6.2 ② action

```ts
validateForCreate(payloads, sections)               // 建卡
validateForEdit(payload, { sectionId })             // UI 编辑单章（accepts 已移除）
toIssueForUI(issue) → IssueForUI                    // 丢 diagnostic
splitPayload(payload) → { declaration, answer }     // core 用它判「有没有用户内容」
hasUserContent(payload) → boolean                   // 用户表达视角的「有内容」
isDeclarationOnlyChange(prev, next) → boolean       // 只答"是否只有答案变了"
emptyPayloadFor(preferredType?) → payload | undefined   // ② 侧保留；**⑧ 已不用于 fork**
```

- **`requireItems` 已彻底删除**；两个校验入口各自写死自己的检查强度；
- **`ok = issues.every(severity === 'warning')`**；**core 只认 `ok`**；
- **`MISSING_SECTION` / `SECTION_NOT_IN_TEMPLATE` 全由 ② 造**，core 不造 issue；
- **`accepts` 已从 ⑧ 侧彻底移除**（`【用户指令，2026-11-02 11:26】`）：`validateForEdit` 只剩 `sectionId`，`sections` 的 `accepts` 字段不再由 ⑧ 提供/校验。**② 侧若仍保留该字段，由 ② 自己的文档声明**；
- **`splitPayload` 的契约必须写死**：`ask.picked === [] ⇒ hasUserContent = true`（见 2.14 的表）；
- **`emptyPayloadFor` ⑧ 不用了**：补章改用模板的 `default`（见 2.7 / 3.6）。
- ② 只提供 `toIssueForUI`；**`assertSectionsComplete` / `updateBody` 是 ⑧ 的函数，不是 ② 的**。

#### 6.2.1 未注册 `$type` 的兜底渲染（用户 13:26）

> 【用户指令，2026-11-01 13:26】
> **action要做一个兜底渲染器，用来渲染没有注册的架构。效果是一个按钮，写着未注册的动作。点击以后展开，展示原始json。**

**⇒ ② 有一条「未注册 `$type`」的兜底渲染路径**（按钮 = 「未注册的动作」，展开 = 原始 JSON）。

**⚠ core 不得假定"每个 payload 的 `$type` 都能渲染"** —— 但**也不得因为"能兜底渲染"就放宽校验**。

**「校验拒、渲染不拒」是两件事，见 3.16。**

#### 6.2.2 搜索排序依据 = 卡的 `history`（用户 13:26）

> 【用户指令，2026-11-01 13:26】
> **卡的"历史"这个字段存了他的状态转变时间。**

⇒ **⑤ 的「按采纳顺序返回」= 读卡的 `history`，取「采纳」那一条的时间戳排序。**

- **core 交给 ⑤ 的卡集本来就含 `history`**（它在卡对象里，见 2.x 卡形状）⇒ **core 不需要额外组装"排序键"、也不需要单独查询**；
- ⚠ **同时间戳的 tie-break 必须确定性**：**用 `id` 比较，且按 UTF-16 code unit（禁用 `localeCompare`）** —— 与 2.6 的 `cardId` 排序同一规则，理由相同（locale 差异会让同一批卡在两台机器排出不同顺序）；
- ⚠ **core 不预排序**：**排序归 ⑤**（它是"口径"的持有者）。core 只保证**卡集完整、`history` 未被裁剪**。

### 6.3 ③ types

```ts
registerTemplate(def)                                       // **单参数**（Options 类型已删）
resolve(ref) → { name, displayName, kind, domain, codePrefix, sections } | undefined
sectionsOf(ref) → Array<{ id, default? }> | undefined        // 无 accepts
templateMeta(ref) → { …, sections: [{ id, label, hint?, default? }] }   // UI 面，core 不碰
TaskState + DRAFT 常量 / isEndedStatus / canTransition / initialStatus
deriveStatus / kindLetter / nextId / parse / normalize / toDisplay
markTemplateRegistryReady
```

- **③ 的 `apply` 不注册任何东西**；**"读 YAML → 注册"整个动作由 core 编排**；
- **③ 已删 `sectionAccepts`、`kindOfInternalTemplate`、`RegisterTemplateOptions`**（同一字段两处取数 / 空壳类型）⇒ core 建卡用 **`resolve(ref).kind`** 填 `card.template.kind`；
- **`displayName` 必填**，且 ③ 的 `registerTemplate` 有**运行时非空校验**（YAML 来的对象是 `any`，类型拦不住）；
- **`resolve` 返回含 `displayName`** —— core 的派生按钮拼标题要它；
- **`sectionsOf` / `templateMeta` 的章节元素含 `default`**（该章初始化 payload），**无 `accepts`**；
- **`sectionId` 只在模板内唯一**（非全局）；
- **`sections` 用数组**（"全章齐"要按清单遍历，object key 顺序不可依赖）；
- ③ 不导出 `STATUS_GROUPS`；
- **`derive` 不在 ③ 的 `TemplateDef` 里** —— ③ **宽收**多余字段（不拒、不使用）⇒ **`derive` 的结构错误 ③ 拦不住，只能 ⑧ 的 YAML 解析层拦**（见 2.7c）。

### 6.4 ④ relation（+ ⑤ search 交接面）

```ts
type RelationsItem = { kind:'patchRelations'; cardId; relationPatch; reasons: Reason[] }
type StatusItem    = { kind:'setStatus';      cardId; targetStatus;   reasons: Reason[] }
type CascadePlan   = { relationsPhase: RelationsItem[]; statusPhase: StatusItem[] }
```

- **`applyRelationsChange(card, { kind:'patch', patches })`** 是 `relationsPhase` 的消费入口（**⑦ 提供**，④ 负责产出 patch）；
- **计划必须**：**显式两阶段、phase 内 `cardId` UTF-16 codeunit 升序、同一张卡在同类项中只出现一次、不可变纯数据、无函数、无 IO**；
- **`reasons` 必须结构化可读**（core 用它写历史），**且允许同一项多条**（同一张卡可能同时命中「子任务」与「依赖方」两条路径）；
- **计划项去重 ≠ reason 去重**；
- **core 输入给 ④⑤**：`{ cards: 当前空间全量非墓碑卡 }`（只读、不分页、保留草稿）；
- ⑤ = **宿主侧纯函数**，core 只负责给卡集，不做筛选。

### 6.5 ⑦ taskcard

```ts
planCreate / planEditOrFork / planAdopt / planDelete / planFork / ...
changeIntent(card) → 封闭枚举（纯查询，结果不回灌 plan —— TOCTOU）
planFork(src, newTemplateSections) → {
  newCard, relations, events,
  droppedSections: Array<{ sectionId, payload }>,   // 只透传，不解释
  missingSections: Array<{ sectionId }>             // 只给 id；补什么由 ⑧ 取 default
}
```

- **⑦ 只出计划，core 执行**；计划项带 `reason`（封闭枚举，禁自由文本）；
- **⑦ 是纯函数、返回拒绝原因不抛错**；core 只取结果；
- **建卡时"目标存在 / 非草稿 / 同空间"由 core 判**（⑦ 没有空间概念）；**"`取代` 不许手写进 relations"由 ⑦ 判**（词法规则）；
- **`planFork` 只报"哪些章丢/缺"，不构造 payload、不判"有没有内容"**（payload 语义在 ②）；
- **`missingSections` 只带 `{ sectionId }`** —— 补什么由 ⑧ 从 ③ 的 `default` 取（`accepts` 已移除，见 2.7 / 3.6）；
- **`droppedSections[].payload` 不得被 core 持久化**（只判空，用完即弃）；
- **⑦ 不认识 `derive`**（derive 是面板预填，产物只是 `planCreate` 的普通输入字段）。

**⚠ core 不是"纯转发层"（③ 与我核对后的口径，两端一致）**：在 fork 路径上，core 承担**编排判断**，不是把数据原样递给某个模块：
1. ⑦ 给出"丢哪些 / 缺哪些"（键集差异），**不判内容**；
2. **core 调 ② 的 `hasUserContent` 判"丢的是否有内容"** —— 这个判断 ② 能算、⑦ 不能算（⑦ 对 payload 零参与），**而"要不要因此阻断"是已裁策略**（允许丢弃 + 留痕），**不是 core 每次运行时做的决定**；
3. **core 从 ③ 的 `sectionsOf` 取该章 `default` 补缺章**，没有则报 `EMPTY_PAYLOAD_UNAVAILABLE`（见 3.6）。
⇒ **core 持有流程，不持有策略**：若将来"是否允许丢弃"改主意，**只改策略/⑦ 的事件，core 的代码不变**。
⚠ 不要把这段写成 `if (hasContent && !allowDiscard) 拒绝` —— **那是业务规则落在 core**，违反 2.1。

### 6.6 ⑨ ai-tool / ⑩ ui / ⑪ dsh-command（下游）

- **⑨⑪ 各自实现「软警告文字」**（用户 05:52）；**内部层不产最终文案** —— core 也不产；
- **⑨ 负责「依赖必须终态才能领取」的判定**（用户 05:52），core 只把卡集与关系数据递给它；
- **⑩ 负责画边与图例**（用户 05:52「连 core 都不负责」）；**关系栏与 `view` 是两条互不调用的渲染路径**，core 只交**纯卡数据**（不交渲染结果/节点描述）；
- **⑩ 的搜索框**：条件序列化 → 宿主桥 → ⑤ 在宿主跑 → 结果回传；
- ⚠ **结构性缺口**：当前成员列表里**没有 ⑨⑩⑪ 三个下游的负责人** ⇒ 上述对齐点尚无人承接。

### 6.7 交付给 ① 的两条语义

1. **业务删除 = 写 `deleted:true` 的整卡覆写**，core 永不调 `purgePhysical`；
2. **当前空间指针的"清理悬空"由 ⑥ 内部完成**，core 只看到 `none/ok/stale` 三态，**不感知清理动作**。

---

## 七、待验证的技术前提

### 7.1 `node:sqlite` 的 JSON 函数支持（方案硬门槛）

【待验证】**整个存储与查询模型依赖此前提，未实测。**

开工后第一条命令：

```sql
SELECT sqlite_version(), json_extract('{"a":1}','$.a');
```

- 返回 `3.4x | 1` ⇒ 方案成立；
- 报 `no such function: json_extract` ⇒ **JSON 路线退回，需重新讨论存储形态**。

### 7.2 `DatabaseSync` 同步阻塞的实测影响

【待验证】`DatabaseSync` 同步阻塞 JS 线程、语句不可中断。
在本模型下**查询不在 SQL 层**（运行时全量在内存），SQL 只承担「加载 / 保存」⇒ 阻塞点集中在**空间激活时的一次 `readAll`**。**实测影响未验证。**

### 7.3 模板注册期的校验边界

【待验证】**预设取消、`accepts` 移除后，注册期能做的校验已经很少**：
- **能做的**：`name` / `kind` / `domain` / `codePrefix` / `displayName` 非空、`sections` 结构、`derive[]` 结构（含拒绝已删字段 `title` / `relations`）、同名模板不重复；
- **做不到的**：**章节 `default` 是否是合法 payload** —— ③ 零依赖、不认识 ② 的 schema，**core 也不在注册期校验 payload 形状**（schema 只在创建时由 ② 校验）。

⇒ **"注册成功 ≠ 该模板能建出卡"**：一个 `default` 形状不合法的模板能注册成功，直到首次建卡 / fork 补章才炸。**必须在文档与 UI 上明确，不可暗示相反。**
⚠ 这也是 `EMPTY_PAYLOAD_UNAVAILABLE` 之外的另一类"延迟失败"，**报错信息必须能定位到模板与章节**。

### 7.4 `default` 覆盖率（**已全满**）

【事实·已查实】**17 个模板、50 个章节，全部有 `default`** —— 缺 `default` 的章数 = **0**。

逐模板核对（`default` 数 = 章节数）：

| 目录 | 模板 | 章节数 | 有 `default` |
|---|---|---|---|
| `core/` | `userNeed` | 1 | 1 |
| | `decision` | 3 | 3 |
| | `question` | 2 | 2 |
| | `research` | 4 | 4 |
| | `blocker` | 2 | 2 |
| | `verify` | 3 | 3 |
| | `delivery` | 3 | 3 |
| | `retro` | 3 | 3 |
| | `archive` | 2 | 2 |
| `code/` | `newFeature` | 4 | 4 |
| | `architecture` | 2 | 2 |
| | `interfaceUi` | 4 | 4 |
| | `lowLevel` | 3 | 3 |
| | `writeCode` | 2 | 2 |
| | `writeTests` | 4 | 4 |
| | `expectedMismatch` | 6 | 6 |
| | `optimize` | 2 | 2 |
| **合计** | **17** | **50** | **50** |

⇒ **`EMPTY_PAYLOAD_UNAVAILABLE` 在当前模板集上是不可达分支** —— 它仍然保留，因为：
- **模板可新增**（用户 11:26「模板可以改」）⇒ 新模板可能漏写 `default`；
- **报错比"猜一个 `$type`"安全**：猜等于让 core 承担模板语义，而 core 不认识 payload。

⚠ **更正我此前的错误统计**：我 12:10 前扫的时候确有 8 章缺（`delivery` 三章、`question` 的 `blocked` 等），**但 lead 在 12:00 左右已补齐**；我上一版文档沿用了旧数据，**「52 章」这个总数也是错的，实际 50 章**。本条以本表为准。
