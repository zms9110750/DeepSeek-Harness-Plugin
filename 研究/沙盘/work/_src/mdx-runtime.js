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
      /* 字符串字面量。
         注意：**只认起始那个引号**，中途出现的 ' 和 ` 都是普通字符。
         以前是遇到任何引号都当边界，导致 `console.log('x')` 被截断。 */
      const quote = source[i];
      i += 1;
      let text = '';
      while (i < source.length && source[i] !== quote) {
        /* 同类引号才结束 —— 其它引号是内容 */
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
  const text = String(source);
  let i = 0;

  while (i < text.length) {
    /* 找一个 < 后面紧跟大写字母的位置 */
    if (text[i] !== '<' || !/[A-Z]/u.test(text[i + 1] || '')) { i += 1; continue; }

    /* 标签名 */
    const nameStart = i + 1;
    let j = nameStart;
    while (j < text.length && /[A-Za-z0-9]/u.test(text[j])) j += 1;
    const name = text.slice(nameStart, j);

    /* 扫属性，直到真正的 > */
    const attrStart = j;
    let depth = 0;
    let quote = null;
    let closed = -1;
    for (; j < text.length; j += 1) {
      const c = text[j];
      if (quote !== null) {
        if (c === '\\') { j += 1; continue; }
        if (c === quote) quote = null;
        continue;
      }
      if (c === '"' || c === "'") { quote = c; continue; }
      if (c === '{') { depth += 1; continue; }
      if (c === '}') { depth -= 1; continue; }
      /* 只有在 {} 外面、引号外面的 > 才是标签结束 */
      if (c === '>' && depth === 0) { closed = j; break; }
    }

    if (closed < 0) break;

    const attrText = text.slice(attrStart, closed).replace(/\/\s*$/u, '');
    out.push({ name, attrs: parseAttrs(attrText) });
    i = closed + 1;
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
/**
 * 当前正在渲染的那条事项 + 它每章的 action。
 *
 * 为什么要这个：组件只拿到 props（值），不知道自己在哪。
 * 但改值要写回 —— 得知道「哪条事项的哪一章」。
 *
 * 用模块级变量而不是往下传，是因为组件表是按名字查的，
 * 签名统一是 (props) => HTMLElement，塞不进额外参数。
 */
let renderCtx = { taskId: '', keys: [], index: 0 };

/**
 * 渲染一段 mdx 成 DOM。
 *
 * @param {string} mdx
 * @param {{taskId?: string, keys?: string[]}} [ctx]
 * @returns {HTMLElement|null}
 */
function renderMdx(mdx, ctx) {
  const tags = parseTags(mdx);
  if (tags.length === 0) return null;

  renderCtx = {
    taskId: (ctx && ctx.taskId) || '',
    keys: (ctx && ctx.keys) || [],
    index: 0
  };

  const box = el('div', {class:'mdx'});
  for (const tag of tags) {
    const Component = MDX_COMPONENTS[tag.name];
    const key = renderCtx.keys[renderCtx.index] || '';
    renderCtx.index += 1;

    if (Component === undefined) {
      /* 未注册 = 程序集里没有这个类型。运行时才发现，画灰卡。 */
      box.appendChild(renderUnknownComponent({ name: tag.name, value: tag.attrs }));
      continue;
    }
    const node = Component({ ...tag.attrs, __key: key });
    if (node !== null) box.appendChild(node);
  }
  return box;
}

/* ══════════════════════════════════════════════════════════════
   写回

   行为在这里 —— mdx 里只写 <Ask options={...} picked="A" />，
   点了怎么变、改哪条数据，都是渲染器给的。
   ══════════════════════════════════════════════════════════════ */

/**
 * 改一章的值。支持部分字段更新。
 *
 * @param {object} props    组件 props（带 __key）
 * @param {object} patch    要改的字段
 */
function commit(props, patch) {
  if (renderCtx.taskId === '') return;
  const task = taskOf(renderCtx.taskId);
  if (task === undefined) return;

  const key = props.__key;
  if (key === '' || typeof task.body !== 'object' || task.body === null) return;

  const section = task.body[key];
  if (section === undefined) return;

  Object.assign(section, patch);
  scheduleSave();
  repaintBody();
}

/**
 * 只重绘正文，保住滚动位置和焦点。
 *
 * 用户原话：
 *
 *   > 我一旦失去焦点。这个东西就整个重新绘制。回到了顶端
 *
 * 之前 commit 调的是 renderAll()，整页重建 —— 正文区滚到哪、
 * 光标在哪个输入框，全丢。
 *
 * 现在只重绘 .d-body 里面，并且：
 *   · 记下滚动位置，重绘后还原
 *   · 记下焦点在哪个输入框、光标在第几个字符，重绘后还原
 */
function repaintBody() {
  const holder = document.querySelector('.d-body');
  if (holder === null) { renderAll(); return; }

  /* ① 记滚动 */
  const scroll = holder.scrollTop;

  /* ② 记焦点：哪个输入框、光标位置 */
  const active = document.activeElement;
  let focusInfo = null;
  if (active !== null && holder.contains(active) && (active.tagName === 'TEXTAREA' || active.tagName === 'INPUT')) {
    const all = [...holder.querySelectorAll('textarea, input[type="text"]')];
    focusInfo = { index: all.indexOf(active), start: active.selectionStart, end: active.selectionEnd };
  }

  /* ③ 重绘 */
  const task = taskOf(renderCtx.taskId);
  if (task === undefined) return;
  const fresh = renderBody(task);
  holder.innerHTML = '';
  if (fresh !== null) holder.appendChild(fresh);

  /* ④ 还原滚动。
     必须等下一帧：刚插进去时内容还没布局，scrollHeight 是旧的，
     直接 set 会被浏览器 clamp 到旧的高度。 */
  requestAnimationFrame(function () {
    holder.scrollTop = scroll;
  });

  /* ⑤ 还原焦点 */
  if (focusInfo !== null && focusInfo.index >= 0) {
    const all = [...holder.querySelectorAll('textarea, input[type="text"]')];
    const el2 = all[focusInfo.index];
    if (el2 !== undefined) {
      el2.focus();
      try { el2.setSelectionRange(focusInfo.start, focusInfo.end); } catch { /* 某些 input 不支持 */ }
    }
  }
}

/**
 * 单选：选中/取消。
 *
 * @param {object} props
 * @param {string} title
 */
function toggleAsk(props, title) {
  const current = String(props.picked || '');
  commit(props, { picked: current === title ? '' : title });
}

/**
 * 多选：加/删一项。
 *
 * @param {object} props
 * @param {string} title
 */
function toggleMulti(props, title) {
  const current = Array.isArray(props.picked) ? props.picked.slice() : [];
  const i = current.indexOf(title);
  if (i >= 0) current.splice(i, 1);
  else current.push(title);
  commit(props, { picked: current });
}

/**
 * 排序：上移/下移一项。
 *
 * @param {object} props
 * @param {number} index
 * @param {number} delta
 */
function moveItem(props, index, delta) {
  const items = Array.isArray(props.items) ? props.items.slice() : [];
  const target = index + delta;
  if (target < 0 || target >= items.length) return;
  const [moved] = items.splice(index, 1);
  items.splice(target, 0, moved);
  commit(props, { items });
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
      type:'text', value, placeholder, class:'text-input',
      onchange(e) { commit(props, { value: e.target.value }); }
    }));
  } else {
    const ta = el('textarea', {class:'text-input', rows:String(row), placeholder,
      onchange(e) { commit(props, { value: e.target.value }); }});
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

/* ══════════════════════════════════════════════════════════════
   选项卡 —— 照宿主那个 ask 的样式

   用户截图的要点：

     > 主标题，副标题，手动输入。
     > 他们没有选项点和选项框。选中了就是框框有焦点。
     > 自己填写的那个也是合法的选项框。
     > 渲染器给的渲染应该始终包含一个"未选择"或"跳过"。

   所以：
     · 不画圆点/方框，选中 = 整行加边框
     · 自定义输入框和选项长得一样
     · 「跳过」始终有
   ══════════════════════════════════════════════════════════════ */

/**
 * 一张选项卡的外壳：副标题（小字）+ 主标题（大字）。
 *
 * @param {object} props
 * @param {HTMLElement} list 选项列表
 * @returns {HTMLElement}
 */
function optionCard(props, list) {
  const card = el('div', {class:'oc'});

  const head = el('div', {class:'oc-head'});
  if (props.header) head.appendChild(el('div', {class:'oc-sub'}, String(props.header)));
  if (props.question) head.appendChild(el('div', {class:'oc-title'}, String(props.question)));
  else if (props.placeholder) head.appendChild(el('div', {class:'oc-title'}, String(props.placeholder)));
  if (head.childElementCount > 0) card.appendChild(head);

  card.appendChild(list);
  return card;
}

/**
 * 一行选项。编号 + 粗体标题 + 灰字说明 + 可选「推荐」。
 *
 * @param {object} opt      { label, description, recommended }
 * @param {number} index    从 0 开始
 * @param {boolean} active  是否选中
 * @param {Function} onClick
 * @returns {HTMLElement}
 */
function optionRow(opt, index, active, onClick) {
  return el('button', {
    class: 'oc-row' + (active ? ' on' : ''),
    type: 'button',
    onclick: onClick
  },
    el('span', {class:'oc-no'}, String(index + 1)),
    el('span', {class:'oc-label'}, opt.label),
    opt.recommended ? el('span', {class:'oc-rec'}, '推荐') : null,
    opt.description ? el('span', {class:'oc-desc'}, opt.description) : null
  );
}

/**
 * 「跳过」那行。
 *
 * 用户原话：
 *   > 渲染器给的渲染应该始终包含一个"未选择"或"跳过"。
 *   > 表示你查这个情况，而我实际上都没看这个卡片。
 *
 * @param {boolean} active
 * @param {Function} onClick
 * @returns {HTMLElement}
 */
function skipRow(active, onClick) {
  return el('button', {
    class: 'oc-row oc-skip' + (active ? ' on' : ''),
    type: 'button',
    onclick: onClick
  },
    el('span', {class:'oc-no'}, '·'),
    el('span', {class:'oc-label'}, '跳过（我没看这张卡片）'));
}

/**
 * 自己填的那一行。和普通选项长得一样，只是里面是输入框。
 *
 * @param {object} props
 * @param {string} current
 * @param {boolean} active
 * @returns {HTMLElement}
 */
function customRow(props, current, active) {
  const input = el('input', {
    type: 'text',
    class: 'oc-input',
    placeholder: '自己填一个……',
    value: current,
    onchange(e) { commit(props, { picked: e.target.value }); }
  });
  return el('div', {class:'oc-row oc-custom' + (active ? ' on' : '')},
    el('span', {class:'oc-no'}, '✎'),
    input);
}

/**
 * ask —— 单选。
 *
 * @param {object} props
 * @returns {HTMLElement}
 */
function renderAskComponent(props) {
  const options = Array.isArray(props.options) ? props.options : [];
  const picked = String(props.picked || '');

  /* picked 的三种形态：'' / '跳过' / 序号 / 自定义文字 */
  const isSkip = picked === '跳过';
  const pickedIndex = /^\d+$/u.test(picked) ? Number(picked) : -1;
  const isCustom = picked !== '' && !isSkip && pickedIndex < 0;

  const list = el('div', {class:'oc-list'});

  options.forEach(function (opt, i) {
    list.appendChild(optionRow(opt, i, pickedIndex === i + 1, function () {
      commit(props, { picked: String(i + 1) });
    }));
  });

  if (props.allowCustom !== false) {
    list.appendChild(customRow(props, isCustom ? picked : '', isCustom));
  }

  list.appendChild(skipRow(isSkip, function () {
    commit(props, { picked: isSkip ? '' : '跳过' });
  }));

  return optionCard(props, list);
}

/**
 * multi —— 多选。
 *
 * @param {object} props
 * @returns {HTMLElement}
 */
function renderMultiComponent(props) {
  const options = Array.isArray(props.options) ? props.options : [];
  const picked = Array.isArray(props.picked) ? props.picked.map(String) : [];

  const list = el('div', {class:'oc-list'});
  const customs = picked.filter(function (x) { return !/^\d+$/u.test(x) && x !== '跳过'; });

  options.forEach(function (opt, i) {
    const key = String(i + 1);
    list.appendChild(optionRow(opt, i, picked.includes(key), function () {
      toggleMulti(props, key);
    }));
  });

  if (props.allowCustom !== false) {
    list.appendChild(customRow(props, customs.join('、'), customs.length > 0));
  }

  list.appendChild(skipRow(picked.length === 0, function () {
    commit(props, { picked: [] });
  }));

  const card = optionCard(props, list);
  if (picked.length > 0) {
    card.appendChild(el('div', {class:'oc-foot'}, '已选 ' + picked.length + ' 项'));
  }
  return card;
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
        el('button', {type:'button', disabled: index === 0,
          onclick() { moveItem(props, index, -1); }}, '↑'),
        el('button', {type:'button', disabled: index === items.length - 1,
          onclick() { moveItem(props, index, 1); }}, '↓'))));
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
    row.appendChild(el('button', {class:'quick-task', type:'button',
      onclick() { openCreator({ type: String(code) }); }},
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
