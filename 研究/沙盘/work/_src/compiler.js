/* ══════════════════════════════════════════════════════════════
   编译器层 —— 参数（json）→ mdx 字符串

   ## 管道

   用户原话：

     > 参数就是 .cs。然后渲染器给 mdx 就是 IL。
     > 最后外部渲染器渲染 mdx，就是 .net。

   对照：

     .cs 源码    →  参数（JSON）
     IL          →  mdx
     CLR         →  外部渲染器
     程序集/BCL  →  组件库（Ask / Rank / …）
     编译器      →  **本文件**

   ## 每个行动两个方向

     form(schema)   创建时：画控件，让用户填 → 产出 json
     render(json)   展示时：json → mdx

   ## 唯一的安全边界

   参数**只当字面量**嵌入，走 `JSON.stringify`：

     对：`<Ask case={${JSON.stringify(raw.case)}} />`
     错：`<Ask case={[${raw.case.join(',')}]} />`

   第二种会让参数里长得像代码的字符串变成真代码。

   这不是安全检查，是**类型保证**：schema 说 string，它就只能是 string。

   ## 为什么渲染器不碰 React

   它只生成文本。所以可以跑在宿主侧（Node），也可以在浏览器里。
   真正把 mdx 变成界面的是外部渲染器（见 mdx-runtime.js）。
   ══════════════════════════════════════════════════════════════ */

/**
 * 把一个值编成 mdx 表达式里的**字面量**。
 *
 * @param {unknown} value
 * @returns {string}
 */
function lit(value) {
  return JSON.stringify(value === undefined ? null : value);
}

/**
 * 编一个属性。值是字符串就走 `"..."`，其它走 `{...}`。
 *
 * @param {string} name
 * @param {unknown} value
 * @returns {string}
 */
function attr(name, value) {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value === 'string') return ' ' + name + '=' + lit(value);
  if (typeof value === 'number') return ' ' + name + '={' + String(value) + '}';
  if (typeof value === 'boolean') return ' ' + name + '={' + String(value) + '}';
  return ' ' + name + '={' + lit(value) + '}';
}

/* ══════════════════════════════════════════════════════════════
   五个行动的编译器
   ══════════════════════════════════════════════════════════════ */

/**
 * text —— 一段可输入的文本。
 *
 * @param {object} raw
 * @returns {string}
 */
function compileText(raw) {
  const row = Number(raw.row) > 0 ? Number(raw.row) : 3;
  return '<Text'
    + attr('value', String(raw.value || ''))
    + attr('row', row)
    + attr('placeholder', raw.placeholder)
    + attr('label', raw.label)
    + attr('description', raw.description)
    + attr('required', raw.required === true ? true : undefined)
    + ' />';
}

/**
 * markdown —— 只读富文本。
 *
 * @param {object} raw
 * @returns {string}
 */
function compileMarkdown(raw) {
  return '<Markdown'
    + attr('value', String(raw.value || ''))
    + attr('placeholder', raw.placeholder)
    + attr('label', raw.label)
    + ' />';
}

/**
 * ask —— 从几个选项里挑一个。
 *
 * options 每项 { title, placeholder }。
 *
 * @param {object} raw
 * @returns {string}
 */
function compileAsk(raw) {
  const options = Array.isArray(raw.options)
    ? raw.options.map(function (o) {
        if (typeof o === 'string') return { title: o, placeholder: '' };
        return { title: String(o.title || ''), placeholder: String(o.placeholder || '') };
      })
    : [];

  return '<Ask'
    + attr('options', options)
    + attr('picked', String(raw.picked || ''))
    + attr('allowCustom', raw.allow_custom === true ? true : undefined)
    + attr('allowDefer', raw.allow_defer === true ? true : undefined)
    + attr('placeholder', raw.placeholder)
    + attr('label', raw.label)
    + attr('description', raw.description)
    + attr('required', raw.required === true ? true : undefined)
    + ' />';
}

/**
 * rank —— 排先后顺序。
 *
 * @param {object} raw
 * @returns {string}
 */
function compileRank(raw) {
  const items = Array.isArray(raw.items)
    ? raw.items.map(function (o) {
        if (typeof o === 'string') return { title: o, placeholder: '' };
        return { title: String(o.title || ''), placeholder: String(o.placeholder || '') };
      })
    : [];

  return '<Rank'
    + attr('items', items)
    + attr('placeholder', raw.placeholder)
    + attr('label', raw.label)
    + attr('description', raw.description)
    + ' />';
}

/**
 * derive —— 从这一条派生子任务。
 *
 * @param {object} raw
 * @returns {string}
 */
function compileDerive(raw) {
  const templates = Array.isArray(raw.templates) ? raw.templates.map(String) : [];
  return '<Derive'
    + attr('templates', templates)
    + attr('mode', String(raw.mode || 'ask'))
    + attr('placeholder', raw.placeholder)
    + attr('label', raw.label)
    + attr('description', raw.description)
    + ' />';
}

/* ══════════════════════════════════════════════════════════════
   注册表
   ══════════════════════════════════════════════════════════════ */

/** 行为名 → 编译器。 */
const ACTION_COMPILERS = {
  text: compileText,
  markdown: compileMarkdown,
  ask: compileAsk,
  rank: compileRank,
  derive: compileDerive
};

/** 别名：旧模板还在用这些名字。 */
const COMPILER_ALIASES = { textarea: 'text', input: 'text', choose: 'ask' };

/**
 * 编译一章。
 *
 * @param {string} key   章节 id
 * @param {object} raw   这一章的值
 * @returns {string} mdx 片段；不认识的行为返回灰卡
 */
function compileSection(key, raw) {
  if (raw === null || typeof raw !== 'object') return '';

  const given = String(raw.action || raw.type || '').trim();
  if (given === '') return '';

  const action = COMPILER_ALIASES[given] || given;
  const compile = ACTION_COMPILERS[action];

  if (compile === undefined) {
    /* 不认识这个行为：输出一个灰卡组件。
       外部渲染器如果也不认识 Unknown，它自己会兜底。 */
    return '<Unknown name=' + lit(given) + ' value={' + lit(raw) + '} />';
  }

  return compile(raw);
}

/**
 * 编译整份正文。
 *
 * @param {object} task
 * @returns {string} mdx
 */
function compileBody(task) {
  const body = task.body;

  /* 旧格式字符串：整段 Markdown，包成 <Markdown> */
  if (typeof body === 'string') {
    if (body.trim() === '') return '';
    return '<Markdown value=' + lit(body) + ' />';
  }

  if (body === null || typeof body !== 'object') return '';

  /* 按模板章节顺序；模板里没有的键排后面 */
  const sections = sectionsOf(task.type);
  const order = [];
  for (const s of sections) {
    if (body[s.id] !== undefined) order.push([s.id, body[s.id]]);
  }
  for (const [key, value] of Object.entries(body)) {
    if (!sections.some((s) => s.id === key)) order.push([key, value]);
  }

  const parts = [];
  for (const [key, raw] of order) {
    const mdx = compileSection(key, raw);
    if (mdx !== '') parts.push(mdx);
  }
  return parts.join('\n');
}
