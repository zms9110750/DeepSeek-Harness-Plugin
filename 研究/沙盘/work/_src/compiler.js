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
 * 把 options 归一成 { label, description, recommended }。
 *
 * 兼容两种旧写法：
 *   'A'                             纯字符串
 *   { title: 'A', placeholder: 'x' } 旧字段名
 *
 * @param {unknown} options
 * @returns {Array<{label: string, description: string, recommended: boolean}>}
 */
function normalizeOptions(options) {
  if (!Array.isArray(options)) return [];
  return options.map(function (o) {
    if (typeof o === 'string') return { label: o, description: '', recommended: false };
    return {
      label: String(o.label || o.title || ''),
      description: String(o.description || o.placeholder || ''),
      recommended: o.recommended === true
    };
  });
}

/**
 * ask —— 单选或多选，同一个行为。
 *
 * multi: true 时用 picked_multi（数组），否则用 picked（字符串）。
 *
 * @param {object} raw
 * @returns {string}
 */
function compileAsk(raw) {
  const options = normalizeOptions(raw.options);
  const multi = raw.multi === true;

  /* 单选支持 picked，多选支持 picked_multi；两个都给时按 multi 取 */
  /*
   * 默认 '未选择'（没看这张卡片）。
   *
   * 用户原话：
   *   > "未选择"，应该是默认选择，并且点击才激活。
   *   > 然后未选择，应该改名为"未选择"
   */
  const single = String(raw.picked === undefined || raw.picked === null ? '未选择' : raw.picked);
  const list = Array.isArray(raw.picked_multi)
    ? raw.picked_multi.map(String)
    : (Array.isArray(raw.picked) ? raw.picked.map(String) : []);

  return '<Ask'
    + attr('header', raw.header)
    + attr('question', raw.question)
    + attr('options', options)
    + attr('multi', multi ? true : undefined)
    + attr('picked', multi ? undefined : single)
    + attr('pickedMulti', multi ? list : undefined)
    + attr('allowCustom', raw.allow_custom === false ? false : true)
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
const COMPILER_ALIASES = { textarea: 'text', input: 'text', choose: 'ask', multi: 'ask' };

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
 * 把旧的字符串正文（`## 标题\n内容`）编译成 mdx。
 *
 * ## 为什么不能整段当一个 Markdown
 *
 * 旧正文是：
 *
 *     ## 要定什么
 *
 *     不同模板前缀是否各自独立流水。
 *
 *     ## 选项
 *
 *     - WF-01 和 GU-01 各自从 01 开始
 *     - 全部共用一个流水号
 *
 * 如果整段包成一个 <Markdown>，**章节结构全丢了** ——
 * 「选项」这章本该是 ask，结果变成一段文字。
 *
 * 所以：按 `## ` 切开，拿标题去章节表里查它是什么行为，
 * 再用那个行为编译。
 *
 * ## 标题对不上时
 *
 * 归给 `other` 那一章的行为（通常是 text）。
 * 还不行就当 markdown。
 *
 * @param {object} task
 * @param {string} body
 * @returns {string}
 */
function compileLegacyString(task, body) {
  const sections = sectionsOf(task.type);

  /* 按 `## 标题` 切段 */
  const chunks = [];
  let current = null;
  for (const line of String(body).split(/\r?\n/u)) {
    const m = /^##\s+(.+)$/u.exec(line);
    if (m !== null) {
      if (current !== null) chunks.push(current);
      current = { title: m[1].trim(), lines: [] };
      continue;
    }
    if (current === null) continue;
    current.lines.push(line);
  }
  if (current !== null) chunks.push(current);

  /* 一个 ## 都没有：整段当一个 Markdown */
  if (chunks.length === 0) {
    return '<Markdown value=' + lit(body) + ' />';
  }

  const parts = [];
  for (const chunk of chunks) {
    const text = chunk.lines.join('\n').trim();

    /* 拿标题去章节表里查 —— 按 label 或 id 都认 */
    const section = sections.find(function (s) {
      return s.label === chunk.title || s.id === chunk.title;
    });

    /* 查不到这个标题 = 旧数据里的自由分节。
       这种内容只能当**只读展示** —— 我们不知道它该填什么，也不能编一个输入框出来。
       所以降级成 markdown，不是 text。 */
    const action = section ? section.action : 'markdown';

    const raw = { action: action, value: text, label: chunk.title };
    /* 章节表里有 placeholder 就带上 */
    if (section && section.placeholder) raw.placeholder = section.placeholder;

    /* ask / rank / derive 这类要结构的，旧数据里没有 —— 降级成 markdown。
       标题放到 label 上（由外部渲染器画），value 里不留 ##。 */
    if (action === 'ask' || action === 'rank' || action === 'derive') {
      parts.push('<Markdown value=' + lit(text) + ' label=' + lit(chunk.title) + ' />');
      continue;
    }

    parts.push(compileSection(section ? section.id : chunk.title, raw));
  }
  return parts.join('\n');
}

/**
 * 编译整份正文。
 *
 * @param {object} task
 * @returns {string} mdx
 */
function compileBody(task) {
  const body = task.body;

  /* 旧格式字符串：按 `## 标题` 切开，每段按章节表匹配它的行为 */
  if (typeof body === 'string') {
    if (body.trim() === '') return '';
    return compileLegacyString(task, body);
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
