/* ══════════════════════════════════════════════════════════════
   模板章节表 —— 只为了显示章节标题和顺序

   正文存成 { want: {...}, done: {...} }，键是 id。
   但界面上要显示「要什么」「什么算做到了」—— 那是模板里 type 的说明
   或者章节的 label。沙盘不需要完整模板，能对上标题就行。
   ══════════════════════════════════════════════════════════════ */
const SECTION_LABELS = {
  GU: [['want','要什么'],['done','什么算做到了'],['bounds','边界'],['split','怎么拆'],['other','其他']],
  GA: [['want','要什么'],['done','什么算做到了'],['risk','风险'],['split','怎么拆'],['other','其他']],
  GO: [['symptom','现象'],['measure','怎么衡量'],['enough','什么算够'],['split','怎么拆'],['other','其他']],
  GV: [['want','要什么'],['done','什么算做到了'],['bounds','边界'],['split','怎么拆'],['other','其他']],
  DP: [['problem','问题'],['plan','方案'],['cost','代价'],['alternative','别的选择'],['risk','风险'],['other','其他']],
  DB: [['pain','痛点'],['scenario','场景'],['fitness','合不合适'],['precedent','先例'],['other','其他']],
  DC: [['question','要定什么'],['options','选项'],['unknown','我还不知道什么'],['recommend','我的建议'],['other','其他']],
  DI: [['goal','目标'],['contract','接口'],['errors','错误'],['breaking','破坏性'],['other','其他']],
  DQ: [['ask','问什么'],['why','为什么要问'],['guess','我的猜测'],['other','其他']],
  DT: [['setup','前置'],['persp','视角'],['style','风格'],['check','检查点'],['cost','代价'],['other','其他']],
  RR: [['conclusion','结论'],['evidence','依据'],['limits','局限'],['deliver','交付'],['other','其他']],
  RB: [['where','卡在哪'],['why','为什么'],['next','下一步'],['bypass','绕过'],['reason','原因'],['deliver','交付'],['other','其他']],
  RD: [['what','是什么'],['repro','复现'],['expect','预期'],['actual','实际'],['scope','范围'],['accept','验收'],['deliver','交付'],['other','其他']],
  RF: [['outcome','结果'],['root','根因'],['lesson','教训'],['apply','怎么用'],['deliver','交付'],['other','其他']],
  WI: [['goal','目标'],['change','改什么'],['verify','怎么验'],['magic','魔法数字'],['other','其他']],
  WF: [['repro','复现'],['expect','预期'],['root','根因'],['fix','修法'],['regression','回归'],['other','其他']],
  WR: [['target','调研什么'],['how','怎么查'],['conclusion','结论'],['evidence','依据'],['other','其他']],
  WX: [['reader','读者'],['path','读法'],['must','必须有'],['skip','可以跳过'],['verify','校验'],['deliver','交付'],['other','其他']],
  WD: [['target','目标'],['approach','手法'],['scene','场景'],['leave','留白'],['verify','怎么验'],['other','其他']],
  WC: [['setup','前置'],['order','顺序'],['check','检查点'],['leave','留白'],['other','其他']]
};

/** 取某模板的章节表；没有就返回空（渲染时回退成键名）。 */
function sectionsOf(type) {
  const rows = SECTION_LABELS[String(type || '').toUpperCase()] || [];
  return rows.map(function (row) {
    return { id: row[0], label: row[1], type: ['textarea'], required: false };
  });
}

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
