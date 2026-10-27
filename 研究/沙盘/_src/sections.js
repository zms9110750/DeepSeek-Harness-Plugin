/* ══════════════════════════════════════════════════════════════
   模板章节表 —— 每章用哪个行动、什么标题、什么灰字

   ## 这张表是干什么的

   真实插件的模板是 YAML，章节这么写：

     - id: want
       type:
         text: 用户原话优先，不要改写
       required: true

   沙盘不需要完整的 YAML 解析，但要能演示「章节 → 行动」的对应关系。
   所以这里用紧凑的数组表达同样的信息：

     ['字段 id', '标题', '行动', '灰字', 必填]

   ## 为什么每个模板的章节不同

   模板决定「这一条要填哪些东西」。
    GU（用户任务）问「要什么、什么算做到了」；
    WF（修复）问「怎么复现、根因是什么」。

   同一个行动可以用在不同章节里 —— 比如 `text` 到处都在用，
   `ask` 只在需要用户拍板的地方出现。
   ══════════════════════════════════════════════════════════════ */

/**
 * 模板 → 章节表。
 *
 * 每项：[id, 标题, 行动, 灰字, 必填]
 *
 * 行动是五个之一：text / markdown / ask / rank / derive
 */
const SECTIONS = {
  /* ── 目标 ── */
  GU: [
    ['notice', '说明', 'markdown', '', false],
    ['want', '要什么', 'text', '用户原话优先。不要改写、不要提炼', true],
    ['done', '什么算做到了', 'text', '一句话一个判据，能验证的', true],
    ['bounds', '边界', 'text', '明确不做什么、什么时候必须停下来问', false],
    ['split', '怎么拆', 'derive', '拆完就派出去，别在这一条里写方案', false],
    ['other', '其他', 'text', '装不下的东西写这里', false]
  ],
  GO: [
    ['symptom', '现象', 'text', '哪里觉得不对？', true],
    ['measure', '怎么衡量', 'text', '现在是什么数，想变成什么数', true],
    ['enough', '什么算够', 'text', '到哪一步就停', false],
    ['split', '怎么拆', 'derive', '', false],
    ['other', '其他', 'text', '', false]
  ],
  GA: [
    ['want', '要什么', 'text', '用户说得含糊的地方，先问清', true],
    ['done', '什么算做到了', 'text', '', true],
    ['risk', '风险', 'text', '理解错了会怎样', false],
    ['split', '怎么拆', 'derive', '', false],
    ['other', '其他', 'text', '', false]
  ],
  GV: [
    ['want', '验证什么', 'text', '哪个假设要被证明或推翻', true],
    ['done', '什么算成立', 'text', '', true],
    ['bounds', '边界', 'text', '', false],
    ['split', '怎么拆', 'derive', '', false],
    ['other', '其他', 'text', '', false]
  ],

  /* ── 设计 ── */
  DP: [
    ['problem', '问题', 'text', '要解决的是什么', true],
    ['plan', '方案', 'text', '怎么写，为什么这么写', true],
    ['cost', '代价', 'text', '要放弃什么', false],
    ['alternative', '别的选择', 'ask', '', false],
    ['risk', '风险', 'text', '', false],
    ['other', '其他', 'text', '', false]
  ],
  DB: [
    ['pain', '痛点', 'text', '', true],
    ['scenario', '场景', 'text', '', true],
    ['fitness', '合不合适', 'text', '', false],
    ['precedent', '先例', 'text', '', false],
    ['other', '其他', 'text', '', false]
  ],
  DC: [
    ['question', '要定什么', 'text', '一句话说清要拍板的是哪件事', true],
    ['options', '选项', 'ask', '每个选项后面写清代价', true],
    ['unknown', '我还不知道什么', 'text', '', false],
    ['recommend', '我的建议', 'text', '', true],
    ['other', '其他', 'text', '', false]
  ],
  DI: [
    ['goal', '目标', 'text', '', true],
    ['contract', '接口', 'text', '函数签名 / 协议 / 数据结构', true],
    ['errors', '错误', 'text', '出错时返回什么', false],
    ['breaking', '破坏性', 'text', '哪些调用方要改', false],
    ['other', '其他', 'text', '', false]
  ],
  DQ: [
    ['ask', '问什么', 'text', '一个问题。两个问号就拆成两条', true],
    ['why', '为什么要问', 'text', '没有这个信息，我只能做 X 或 Y 的假设', true],
    ['guess', '我的猜测', 'text', '给出一个假设答案，用户只要说对不对', false],
    ['other', '其他', 'text', '', false]
  ],
  DT: [
    ['setup', '前置', 'text', '', true],
    ['persp', '视角', 'rank', '排一下从哪个角度先想', false],
    ['style', '风格', 'text', '', false],
    ['check', '检查点', 'text', '', false],
    ['cost', '代价', 'text', '', false],
    ['other', '其他', 'text', '', false]
  ],

  /* ── 记录 ── */
  RR: [
    ['conclusion', '结论', 'text', '先说结论', true],
    ['evidence', '依据', 'text', '凭什么这么说', true],
    ['limits', '局限', 'text', '什么情况下这个结论不成立', false],
    ['deliver', '交付', 'text', '', false],
    ['other', '其他', 'text', '', false]
  ],
  RB: [
    ['where', '卡在哪', 'text', '具体到哪一步过不去', true],
    ['why', '为什么', 'text', '', true],
    ['next', '下一步', 'derive', '绕过去 / 换条路 / 找人', false],
    ['bypass', '绕过', 'text', '如果要带债关闭，债是什么', false],
    ['reason', '原因', 'text', '', false],
    ['deliver', '交付', 'text', '', false],
    ['other', '其他', 'text', '', false]
  ],
  RD: [
    ['what', '是什么', 'text', '一句话说清坏在哪', true],
    ['repro', '复现', 'text', '按步骤能重现', true],
    ['expect', '预期', 'text', '', true],
    ['actual', '实际', 'text', '', true],
    ['scope', '范围', 'text', '影响哪些用户 / 功能', false],
    ['accept', '验收', 'text', '', false],
    ['deliver', '交付', 'text', '', false],
    ['other', '其他', 'text', '', false]
  ],
  RF: [
    ['outcome', '结果', 'text', '成了还是败了', true],
    ['root', '根因', 'text', '真正的原因是什么', true],
    ['lesson', '教训', 'text', '', true],
    ['apply', '怎么用', 'text', '下次什么情况该想起来', false],
    ['deliver', '交付', 'text', '', false],
    ['other', '其他', 'text', '', false]
  ],

  /* ── 工作 ── */
  WI: [
    ['goal', '目标', 'text', '改完之后什么样', true],
    ['change', '改什么', 'text', '具体到文件 / 函数', true],
    ['verify', '怎么验', 'text', '跑什么命令、看什么结果', true],
    ['magic', '魔法数字', 'text', '写死的值为什么是这个值', false],
    ['other', '其他', 'text', '', false]
  ],
  WF: [
    ['repro', '复现', 'text', '', true],
    ['expect', '预期', 'text', '', true],
    ['root', '根因', 'text', '不是「哪里错了」，是「为什么会错」', true],
    ['fix', '修法', 'text', '', true],
    ['regression', '回归', 'text', '加什么测试防止再来一次', false],
    ['other', '其他', 'text', '', false]
  ],
  WR: [
    ['target', '调研什么', 'text', '', true],
    ['how', '怎么查', 'rank', '排一下先查哪个', false],
    ['conclusion', '结论', 'text', '', true],
    ['evidence', '依据', 'text', '', true],
    ['other', '其他', 'text', '', false]
  ],
  WX: [
    ['reader', '读者', 'text', '写给人看的，先想清是谁', true],
    ['path', '读法', 'text', '从头读还是跳着查', false],
    ['must', '必须有', 'text', '', true],
    ['skip', '可以跳过', 'text', '', false],
    ['verify', '校验', 'text', '', false],
    ['deliver', '交付', 'text', '', false],
    ['other', '其他', 'text', '', false]
  ],
  WD: [
    ['target', '目标', 'text', '画出来要让人看到什么', true],
    ['approach', '手法', 'text', '', false],
    ['scene', '场景', 'text', '', false],
    ['leave', '留白', 'text', '', false],
    ['verify', '怎么验', 'text', '', false],
    ['other', '其他', 'text', '', false]
  ],
  WC: [
    ['setup', '前置', 'text', '', true],
    ['order', '顺序', 'rank', '先写哪段', false],
    ['check', '检查点', 'text', '', false],
    ['leave', '留白', 'text', '', false],
    ['other', '其他', 'text', '', false]
  ]
};

/**
 * 取某模板的章节表。
 *
 * @param {string} type 模板编号
 * @returns {Array<{id: string, label: string, action: string, placeholder: string, required: boolean}>}
 */
function sectionsOf(type) {
  const rows = SECTIONS[String(type || '').toUpperCase()] || [];
  return rows.map(function (row) {
    return {
      id: row[0],
      label: row[1],
      action: row[2],
      placeholder: row[3] || '',
      required: row[4] === true
    };
  });
}

/**
 * 某模板用到的行动（去重，按出现顺序）。
 *
 * 新建时用它给用户看「选了这个模板，正文会问你要哪些东西」。
 *
 * @param {string} type
 * @returns {string[]}
 */
function actionsOf(type) {
  const out = [];
  for (const s of sectionsOf(type)) {
    if (s.action && !out.includes(s.action)) out.push(s.action);
  }
  return out;
}

/* ══════════════════════════════════════════════════════════════
   行动的中文名和一句话说明
   ══════════════════════════════════════════════════════════════ */
const ACTION_LABEL = {
  text: '文本',
  markdown: '说明',
  ask: '选一个',
  rank: '排序',
  derive: '派生'
};

const ACTION_HINT = {
  text: '一段可输入的文本',
  markdown: '只读的一段说明',
  ask: '从几个选项里挑一个',
  rank: '排先后顺序',
  derive: '从这一条派生子任务'
};

const DOMAIN_LABEL = { code: '代码', writing: '写作', art: '绘画', general: '通用' };

/**
 * 一条事项的领域。
 *
 * 数据里没有单独的 domain 字段 —— 领域由模板决定。
 * 模板归属哪个领域在 TEMPLATES 表里（modal.js），这里按 type 反查。
 * 查不到就归「通用」。
 *
 * @param {object} task
 * @returns {string}
 */
function domainOf(task) {
  const found = (typeof TEMPLATES !== 'undefined' ? TEMPLATES : []).find((x) => x.code === task.type);
  return found ? found.domain : 'general';
}


/* ══════════════════════════════════════════════════════════════
   过滤菜单的三列定义

   用户原话：
     > 过滤栏，应该做二级菜单。点击展开以后才有过滤选项。
     > 一级菜单是"状态"，"类别"，"领域"。
     > 当二级点进去的时候，他还会从旁边展开三级菜单（占文档流）。
     > 例如"搁置"->"需要信息，需要权限"。"完成"-》"成功"，"失败"，"取消"。
     > 而类别，就是这个类别下面的模板。
   ══════════════════════════════════════════════════════════════ */

/** 状态：组 → 具体状态。 */
const STATUS_TREE = [
  { key: '进行', children: ['提交', '处理中'] },
  { key: '搁置', children: ['需要补充', '需要授权'] },
  { key: '完成', children: ['完成', '失败', '取消'] },
  { key: '草稿', children: ['未指定'] }
];

/** 类别。 */
const KIND_TREE = [
  { key: 'goal', label: '目标', children: [] },
  { key: 'design', label: '设计', children: [] },
  { key: 'record', label: '记录', children: [] },
  { key: 'work', label: '工作', children: [] }
];

/** 领域 → 该领域下的模板。 */
const DOMAIN_TREE = [
  { key: 'code', label: '代码', children: [] },
  { key: 'writing', label: '写作', children: [] },
  { key: 'art', label: '绘画', children: [] },
  { key: 'general', label: '通用', children: [] }
];


/* ══════════════════════════════════════════════════════════════
   关系类型 → 颜色

   用户原话：
     > 这个图例只有父子和链接。但既然链接关系不多，那就可以给每个关系都做一种图例。

   真实插件里 links 的 label 有六种（core 的 linkPairs 认这些）：
     依赖 · 派生 · 来源 · 相关 · 约束 · 参考

   每种一个颜色，图例全部列出来。
   ══════════════════════════════════════════════════════════════ */
const LINK_KINDS = [
  { key: 'parent', label: '父子', color: '#9aa0a6', dashed: false },
  { key: '依赖',   label: '依赖', color: '#c98a20', dashed: false },
  { key: '派生',   label: '派生', color: '#3b7dd8', dashed: true },
  { key: '来源',   label: '来源', color: '#7c5cd6', dashed: true },
  { key: '相关',   label: '相关', color: '#2e9e6b', dashed: true },
  { key: '约束',   label: '约束', color: '#c0392b', dashed: false },
  { key: '参考',   label: '参考', color: '#8a9099', dashed: true }
];

/** 取关系类型的颜色（认不出就用「相关」那档）。 */
function linkColor(kind) {
  const found = LINK_KINDS.find((x) => x.key === kind);
  return found ? found.color : '#8a9099';
}
