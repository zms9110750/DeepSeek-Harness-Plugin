/* 内置样本（首次打开或服务没起时用）。 */
const TASKS = [
  {
    id:'GU-01', title:'用户任务：剩下没做完的 5 条', type:'GU', kind:'goal', status:'提交',
    parent:'', links:'', tags:[],
    body:'## 这是什么\n\n这是 T-054 / T-056 的下一次重写。旧的都已取消，但**它们里面真正没做完的部分还在**，所以重新立一张。\n\n12 条要求里 7 条已做完，2 条半成品，3 条没动。这一张只装没做完的那些。\n\n## 没做完的 5 条\n\n① 失败必须有理由\n② dispatch 字段要有消费者\n③ 详情层派发按钮\n④ behavior 要影响界面\n⑤ 日志',
    note:''
  },
  {
    id:'GU-02', title:'用户任务5', type:'GU', kind:'goal', status:'提交',
    parent:'', links:'', tags:[],
    body:'1. GU01 仍然有领取、直接完成、取消、拒绝。说明「目标」大类现在还不是根据状态自动算的。\n\n2. 一个包里面可以有多个插件。以下内容放在一个包里，分插件：箭头面板、计划面板、「按计划」的权限状态、「子工作空间」、额外工作空间。\n\n3. 归档、分组。这个需要设计。否则之前用户任务提出来的任务，占据了太多竖向高度。\n\n4. 考虑给关联新增更多内容。例如一期、二期意味着他们是一件事情，那么是否除了兄弟节点的联系以外，还需要「相关」的关系？然后还要有「约束」「参考」之类的关系。',
    note:''
  },
  {
    id:'WI-01', title:'失败必须有理由', type:'WI', kind:'work', status:'完成',
    parent:'GU-01', links:'', tags:[],
    body:'## 要做什么\n\n转「失败」时强制填理由，不填不让改。\n\n## 用户原话\n\n> 进行失败状态一定要回报原因的。但是点击失败只是点击了，没有说明处。\n\n## 具体做什么\n\n1. `setState` 里加一条检查\n2. 报错文案要写出出路\n3. 允许理由里引用别的事项 id',
    note:'已完成，按你的备注改成「失败 → 派一条阻碍」，不是「填一段 note」。'
  },
  {
    id:'WI-02', title:'dispatch 字段要有消费者', type:'WI', kind:'work', status:'完成',
    parent:'GU-01', links:'', tags:['dispatch','模板系统'],
    body:'## 要做什么\n\n模板 YAML 里的 `dispatch` 字段现在没人读，等于装饰。要让界面真的按它收窄可派发范围。',
    note:''
  },
  {
    id:'WI-03', title:'详情层派发按钮', type:'WI', kind:'work', status:'完成',
    parent:'GU-01', links:'', tags:[],
    body:'## 要做什么\n\n详情页要有「派发」区，按钮列表来自宿主的 `task_dispatch`。\n\n判定三层（大类规则 / 父模板 dispatch / 子模板 default_kind）全在宿主做，面板只管显示。',
    note:''
  },
  {
    id:'DP-04', title:'归档与分组：老任务占了太多竖向高度', type:'DP', kind:'design', status:'完成',
    parent:'GU-02', links:'', tags:[],
    body:'## 问题\n\n老任务太多，列表一屏装不下。\n\n## 方案\n\n归档直接对分组归档。归档以后界面不显示，但索引还在，可以「显示已归档」。',
    note:''
  },
  {
    id:'DB-01', title:'record 的状态集要不要按 kind 收窄', type:'DB', kind:'design', status:'未指定',
    parent:'', links:'', tags:[],
    body:'## 说不清的地方\n\n九态是为拟合 A2A 硬套的。记录类说「搁置」不成立 —— 写出来就完了，没有搁置这回事。\n\n## 用户原话\n\n> 只有任务会派发出去。记录、决策、去问，是不是搁置了。这不成立。\n> 所以这 4 个类别应该有他们的状态。比如阻碍只有绕过、解决。成功和失败是什么含义呢？不知道。',
    note:''
  },
  {
    id:'DC-01', title:'【验证】不同前缀独立编号', type:'DC', kind:'design', status:'取消',
    parent:'', links:'', tags:[],
    body:'## 要定什么\n\n不同模板前缀是否各自独立流水。\n\n## 选项\n\n- WF-01 和 GU-01 各自从 01 开始\n- 全部共用一个流水号',
    note:''
  },
  {
    id:'WF-01', title:'【验证】编号应带模板前缀', type:'WF', kind:'work', status:'取消',
    parent:'', links:'', tags:[],
    body:'## 验证点\n\n编号形式应为 `前缀-流水`，例如 WF-01。',
    note:''
  }
];