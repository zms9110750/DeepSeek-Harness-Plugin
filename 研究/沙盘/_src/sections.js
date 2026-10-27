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
