/* ══════════════════════════════════════════════════════════════
   外部渲染器 —— mdx 字符串 → 真正的界面

   ## 在管道里的位置

     参数（json）
        ↓  compiler.js
     mdx 字符串
        ↓  **本文件**
     DOM + 行为

   用户原话：

      > 最后外部渲染器渲染 mdx，就是 .net。

   ## 为什么这里不接 @mdx-js/mdx

   真实的包是 `@mdx-js/mdx` + `@mdx-js/react`（见 RR-10）。

   沙盘是两份独立的静态 HTML，不打包、不带 node_modules。
   所以这里实现一个**子集编译器**，只认我们自己编译器产出的那几种形状：

     <Text value="…" row={3} placeholder="…" />
     <Ask options={[{…}]} picked="…" />
     <Markdown value="…" />
     <Rank items={[{…}]} />
     <Derive templates={["WR"]} mode="ask" />
     <Unknown name="…" value={{…}} />

   这不是「另一种 mdx」，是 mdx 的受限子集 —— 解析规则和真 mdx 一致
   （标签、字符串属性、`{}` 表达式），只是表达式只允许字面量。

   ## 换成真包要改什么

   只改 `renderMdx()` 这一个函数：

     const { default: Content } = await evaluate(mdx, {
       ...runtime,
       useMDXComponents: () => COMPONENTS,
     });
     return Content;

   组件表（COMPONENTS）原样可用。
   ══════════════════════════════════════════════════════════════ */

/**
 * 解析一个 mdx 属性串。
 *
 * 支持三种形态：
 *   name="字符串"
 *   name={字面量}
 *   name
 *
 * @param {string} source
 * @returns {Record<string, unknown>}
 */
function parseAttrs(source) {
  const out = {};
  let i = 0;

  while (i < source.length) {
    /* 跳过空白 */
    while (i < source.length && /\s/u.test(source[i])) i += 1;
    if (i >= source.length) break;

    /* 属性名 */
    const nameStart = i;
    while (i < source.length && /[A-Za-z_$]/u.test(source[i])) i += 1;
    const name = source.slice(nameStart, i);
    if (name === '') { i += 1; continue; }

    /* 等号 */
    while (i < source.length && /\s/u.test(source[i])) i += 1;
    if (source[i] !== '=') {
      out[name] = true;
      continue;
    }
    i += 1;
    while (i < source.length && /\s/u.test(source[i])) i += 1;

    if (source[i] === '"' || source[i] === "'") {
      /* 字符串字面量 */
      const quote = source[i];
      i += 1;
      let text = '';
      while (i < source.length && source[i] !== quote) {
        if (source[i] === '\\') {
          /* 还原转义：\\n → 换行，\\t → tab，\\" → 引号 */
          const next = source[i + 1];
          if (next === 'n') text += '\n';
          else if (next === 't') text += '\t';
          else if (next === 'r') text += '\r';
          else text += next;
          i += 2;
          continue;
        }
        text += source[i];
        i += 1;
      }
      i += 1;
      out[name] = text;
      continue;
    }

    if (source[i] === '{') {
      /* 表达式：只吃一个平衡的 {...}，然后按字面量求值 */
      const start = i;
      let depth = 0;
      let inStr = null;
      while (i < source.length) {
        const c = source[i];
        if (inStr !== null) {
          if (c === '\\') { i += 2; continue; }
          if (c === inStr) inStr = null;
          i += 1;
          continue;
        }
        if (c === '"' || c === "'") { inStr = c; i += 1; continue; }
        if (c === '{') depth += 1;
        else if (c === '}') {
          depth -= 1;
          if (depth === 0) { i += 1; break; }
        }
        i += 1;
      }
      const expr = source.slice(start + 1, i - 1);
      out[name] = evalLiteral(expr);
      continue;
    }

    /* 其它：跳到下一个空白 */
    const skipStart = i;
    while (i < source.length && !/\s/u.test(source[i])) i += 1;
    out[name] = source.slice(skipStart, i);
  }

  return out;
}

/**
 * 求值一个「只允许字面量」的表达式。
 *
 * 不 eval。只认 JSON 能表达的形态（字符串、数字、布尔、数组、对象）。
 * 认不出就原样返回字符串 —— 这样参数里的代码永远不会被执行。
 *
 * @param {string} expr
 * @returns {unknown}
 */
function evalLiteral(expr) {
  const text = expr.trim();
  if (text === '') return null;
  try {
    return JSON.parse(text);
  } catch {
    /* 不是 JSON：可能是 true / false / null 之外的裸词，原样当字符串 */
    if (text === 'true') return true;
    if (text === 'false') return false;
    if (text === 'null') return null;
    return text;
  }
}

/**
 * 把一个自闭合标签（或成对标签）解析出来。
 *
 * @param {string} source
 * @returns {Array<{name: string, attrs: object}>}
 */
function parseTags(source) {
  const out = [];
  const re = /<([A-Z][A-Za-z0-9]*)((?:\s[^>]*?)?)\s*\/?>/gu;
  let m;
  while ((m = re.exec(source)) !== null) {
    out.push({ name: m[1], attrs: parseAttrs(m[2] || '') });
  }
  return out;
}

/* ══════════════════════════════════════════════════════════════
   组件表

   这就是「程序集」—— mdx 里的 <Ask> 对应这里的 Ask。
   名字对不上 = 未注册组件 = 灰卡。
   ══════════════════════════════════════════════════════════════ */

const MDX_COMPONENTS = {
  Text: function Text(props) {
    return renderTextComponent(props);
  },
  Markdown: function Markdown(props) {
    return renderMarkdownComponent(props);
  },
  Ask: function Ask(props) {
    return renderAskComponent(props);
  },
  Multi: function Multi(props) {
    return renderMultiComponent(props);
  },
  Rank: function Rank(props) {
    return renderRankComponent(props);
  },
  Derive: function Derive(props) {
    return renderDeriveComponent(props);
  },
  Unknown: function Unknown(props) {
    return renderUnknownComponent(props);
  }
};

/**
 * 渲染一段 mdx 成 DOM。
 *
 * @param {string} mdx
 * @returns {HTMLElement|null}
 */
function renderMdx(mdx) {
  const tags = parseTags(mdx);
  if (tags.length === 0) return null;

  const box = el('div', {class:'mdx'});
  for (const tag of tags) {
    const Component = MDX_COMPONENTS[tag.name];
    if (Component === undefined) {
      /* 未注册 = 程序集里没有这个类型。运行时才发现，画灰卡。 */
      box.appendChild(renderUnknownComponent({ name: tag.name, value: tag.attrs }));
      continue;
    }
    const node = Component(tag.attrs);
    if (node !== null) box.appendChild(node);
  }
  return box;
}

/* ══════════════════════════════════════════════════════════════
   组件实现

   它们只接收 props（来自 mdx），不再接收 raw。
   ══════════════════════════════════════════════════════════════ */

function sectionShell(props, body) {
  const sec = el('div', {class:'sec'});
  const label = String(props.label || '');
  if (label !== '') {
    sec.appendChild(el('div', {class:'sec-title'},
      label,
      props.required === true ? el('span', {class:'req'}, ' *') : null));
  }
  body.forEach(function (node) {
    if (node !== null && node !== undefined) sec.appendChild(node);
  });
  if (props.description) {
    sec.appendChild(el('div', {class:'sec-desc'}, String(props.description)));
  }
  return sec;
}

function renderTextComponent(props) {
  const row = Number(props.row) > 0 ? Number(props.row) : 3;
  const value = String(props.value || '');
  const placeholder = String(props.placeholder || '');

  const box = el('div', {class:'inter'});
  if (row <= 1) {
    box.appendChild(el('input', {
      type:'text', value, placeholder, class:'text-input'
    }));
  } else {
    const ta = el('textarea', {class:'text-input', rows:String(row), placeholder});
    ta.value = value;
    box.appendChild(ta);
  }
  return sectionShell(props, [box]);
}

function renderMarkdownComponent(props) {
  const text = String(props.value || '');
  const d = el('div', {class:'prose'});
  if (text.trim() === '') {
    d.appendChild(el('span', {class:'muted'}, String(props.placeholder || '（空）')));
  } else {
    d.innerHTML = md(text);
  }
  const label = String(props.label || '');
  if (label === '') return d;
  return sectionShell(props, [d]);
}

function renderAskComponent(props) {
  const options = Array.isArray(props.options) ? props.options : [];
  const picked = String(props.picked || '');
  const box = el('div', {class:'inter'});

  if (props.placeholder) {
    box.appendChild(el('div', {class:'inter-cap'}, String(props.placeholder)));
  }

  for (const opt of options) {
    const title = typeof opt === 'string' ? opt : String(opt.title || '');
    const sub = typeof opt === 'string' ? '' : String(opt.placeholder || '');
    const on = title === picked;
    box.appendChild(el('button', {
      class:'choice' + (on ? ' on' : ''), type:'button'
    },
      el('span', {class:'radio'}),
      el('span', {class:'choice-body'},
        el('span', {class:'choice-title'}, title),
        sub === '' ? null : el('span', {class:'choice-sub'}, sub))));
  }

  if (props.allowCustom === true) {
    box.appendChild(el('input', {
      type:'text', class:'text-input', placeholder:'都不是，我自己写一句',
      value: picked
    }));
  }
  if (props.allowDefer === true && picked !== '') {
    box.appendChild(el('button', {class:'link-btn', type:'button'}, '先不选，要更多信息'));
  }

  return sectionShell(props, [box]);
}

/**
 * Multi —— 多选。
 *
 * 和 Ask 的区别：Ask 是单选（互斥），Multi 是集合。
 * 视觉上也不同：单选是圆点，多选是方框 ✓。
 */
function renderMultiComponent(props) {
  const options = Array.isArray(props.options) ? props.options : [];
  const picked = Array.isArray(props.picked) ? props.picked.map(String) : [];
  const box = el('div', {class:'inter'});

  if (props.placeholder) {
    box.appendChild(el('div', {class:'inter-cap'}, String(props.placeholder)));
  }

  for (const opt of options) {
    const title = typeof opt === 'string' ? opt : String(opt.title || '');
    const sub = typeof opt === 'string' ? '' : String(opt.placeholder || '');
    const on = picked.includes(title);

    box.appendChild(el('button', {
      class:'choice multi' + (on ? ' on' : ''), type:'button'
    },
      el('span', {class:'checkbox'}, on ? el('span', {class:'tick'}, '✓') : null),
      el('span', {class:'choice-body'},
        el('span', {class:'choice-title'}, title),
        sub === '' ? null : el('span', {class:'choice-sub'}, sub))));
  }

  if (picked.length > 0) {
    box.appendChild(el('div', {class:'multi-count'}, '已选 ' + picked.length + ' 项'));
  }

  return sectionShell(props, [box]);
}

function renderRankComponent(props) {
  const items = Array.isArray(props.items) ? props.items : [];
  const box = el('div', {class:'inter'});

  if (props.placeholder) {
    box.appendChild(el('div', {class:'inter-cap'}, String(props.placeholder)));
  }

  items.forEach(function (item, index) {
    const title = typeof item === 'string' ? item : String(item.title || '');
    const sub = typeof item === 'string' ? '' : String(item.placeholder || '');
    box.appendChild(el('div', {class:'rank-row'},
      el('span', {class:'no'}, String(index + 1)),
      el('span', {class:'rank-body'},
        el('span', {class:'rank-title'}, title),
        sub === '' ? null : el('span', {class:'rank-sub'}, sub)),
      el('span', {class:'rank-btns'},
        el('button', {type:'button'}, '↑'),
        el('button', {type:'button'}, '↓'))));
  });

  return sectionShell(props, [box]);
}

function renderDeriveComponent(props) {
  const templates = Array.isArray(props.templates) ? props.templates : [];
  const mode = String(props.mode || 'ask');
  const modeLabel = mode === 'auto' ? '直接建' : mode === 'manual' ? '只能你建' : '问你';

  const box = el('div', {class:'inter'});
  if (props.placeholder) {
    box.appendChild(el('div', {class:'inter-cap'}, String(props.placeholder)));
  }

  const row = el('div', {class:'derive-row'});
  for (const code of templates) {
    const tpl = (typeof TEMPLATES !== 'undefined' ? TEMPLATES : []).find(function (x) {
      return x.code === code;
    });
    row.appendChild(el('button', {class:'quick-task', type:'button'},
      el('span', {class:'code'}, String(code)),
      tpl ? tpl.name : '派生任务',
      el('span', {class:'mode'}, modeLabel)));
  }
  box.appendChild(row);

  return sectionShell(props, [box]);
}

function renderUnknownComponent(props) {
  const name = String(props.name || '?');
  return el('div', {class:'sec'},
    el('div', {class:'unknown'},
      '未注册的交互类型「' + name + '」',
      el('pre', null, JSON.stringify(props.value || {}, null, 2))));
}
