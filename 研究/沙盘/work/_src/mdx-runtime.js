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
/**
 * 只存，不重绘。
 *
 * 用于「用户正在输入」这种场景 —— 重绘会打断打字。
 *
 * @param {object} props
 * @param {object} patch
 */
function commitQuiet(props, patch) {
  if (renderCtx.taskId === '') return;
  const task = taskOf(renderCtx.taskId);
  if (task === undefined) return;
  const key = props.__key;
  if (key === '' || typeof task.body !== 'object' || task.body === null) return;
  const section = task.body[key];
  if (section === undefined) return;
  Object.assign(section, patch);
  scheduleSave();
}

function repaintBody() {
  const holder = document.querySelector('.d-body');
  if (holder === null) { renderAll(); return; }

  /*
   * ① 记滚动 —— 用「锚点元素」而不是 scrollTop 数字。
   *
   * 用户原话：
   *   > 第一次切换单选的时候，重新刷新。跳到了这个单选在详情页面顶的位置。
   *
   * 原因：重绘时用 scrollTop 还原，但内容高度变了（比如「未选择」那行
   * 换成真实选项后高度不同），同一个数字指向的位置就变了。
   *
   * 改成记「视口顶端第一个章节的 id + 它相对视口的偏移」，
   * 重绘后按这个把那一章放回原来的位置。
   */
  const scroll = holder.scrollTop;

  /*
   * 找一个锚点：视口顶端往下第一个 .sec。
   *
   * 用 getBoundingClientRect 而不是 offsetTop —— 因为
   * .d-body 里的元素 offsetParent 是外层 .detail，不是 .d-body，
   * offsetTop 和 holder.scrollTop 不在一个坐标系里。
   */
  /*
   * 记一串锚点。
   *
   * 只记一个不够 —— 如果那一个自身的渲染高度变了，补偿就错了。
   * 所以把视口里看得见的章节全记下来（id + 相对偏移），
   * 还原时从上往下找第一个还存在的，用偏���差补偿。
   */
  const holderRect = holder.getBoundingClientRect();
  const anchors = [];
  for (const sec of holder.querySelectorAll('.sec')) {
    const rect = sec.getBoundingClientRect();
    const top = rect.top - holderRect.top;
    /* 只记和视口有交集的 */
    if (top + rect.height > 0 && top < holderRect.height) {
      anchors.push({ key: sec.getAttribute('data-sec') || '', top });
    }
  }

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

  /*
   * ④ 还原滚动。
   *
   * 有锚点就按锚点还原（内容高度变了也不会跳），
   * 没有锚点才退回 scrollTop 数字。
   *
   * 必须等下一帧：刚插进去时内容还没布局，scrollHeight 是旧的。
   */
  /*
   * 用 rAF + setTimeout 双保险。
   *
   * requestAnimationFrame 在页面不可见（后台标签、无头模式、CDP 抓图时）
   * 会被浏览器暂停 —— 只挂 rAF 的话，滚动还原根本不会执行。
   * 所以再挂一个 setTimeout 兜底，两者谁先到用谁，只跑一次。
   */
  let restored = false;
  const restore = function () {
    if (restored) return;
    restored = true;
    /*
     * 从上往下，找第一个「key 存在」的锚点，按它补偿。
     *
     * ## 公式为什么不能写成 `holder.scrollTop + delta`
     *
     * 因为上面刚做过 `holder.innerHTML = ''` —— 这一下会把
     * scrollTop 重置成 0。所以这里的 holder.scrollTop 不是我记下的
     * 那个值，直接拿它当基准会算错（第一次点单选时跳到顶部就是这么来的）。
     *
     * 正确做法：先把元素的**文档坐标**还原出来，再减去目标偏移。
     *
     *   E = (元素当前相对视口的 top) + (当前 scrollTop)      ← 文档坐标
     *   scrollTop = E - 目标偏移
     */
    const cur = holder.scrollTop;
    for (const anchor of anchors) {
      if (anchor.key === '') continue;
      const again = holder.querySelector('.sec[data-sec="' + anchor.key + '"]');
      if (again === null) continue;
      const nowTop = again.getBoundingClientRect().top - holder.getBoundingClientRect().top;
      const want = (nowTop + cur) - anchor.top;
      holder.scrollTop = want;
      return;
    }
    holder.scrollTop = scroll;
  };
  requestAnimationFrame(restore);
  setTimeout(restore, 0);
  setTimeout(restore, 32);

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
  /* data-sec 是给 repaintBody 用的滚动锚点 */
  const sec = el('div', {class:'sec', 'data-sec': props.__key || ''});
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
  /* 没 label 也包一层 —— 需要 data-sec 做滚动锚点 */
  return sectionShell(props, [d]);
}

/**
 * 「未选择」这个按钮的文字。
 *
 * 用户原话：
 *   > 然后跳过，应该改名为"未选择"
 *
 * 它是「我没看这张卡片」，不是「都不要」——
 * 所以不能叫跳过，那听起来像已经看过并跳过了。
 */
const UNSET_LABEL = '未选择';

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
function optionCard(props, list, skipActive, onSkip) {
  /* 包一层 sectionShell。
     不然这张卡在文档里没有 data-sec 锚点，重绘时滚动位置就补不回来。 */
  const card = el('div', {class:'oc'});

  const head = el('div', {class:'oc-head'});

  /* 上面一行：灰色小字（header）+ 右边的「跳过」 */
  const top = el('div', {class:'oc-top'});
  if (props.header) top.appendChild(el('span', {class:'oc-sub'}, String(props.header)));
  top.appendChild(el('span', {class:'oc-spacer'}));
  top.appendChild(el('button', {
    class: 'oc-skipbtn' + (skipActive ? ' on' : ''),
    type: 'button',
    title: '我没看这张卡片',
    onclick: onSkip
  }, UNSET_LABEL));
  head.appendChild(top);

  if (props.question) head.appendChild(el('div', {class:'oc-title'}, String(props.question)));
  else if (props.placeholder) head.appendChild(el('div', {class:'oc-title'}, String(props.placeholder)));

  card.appendChild(head);
  card.appendChild(list);
  return sectionShell(props, [card]);
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
 * 自己填的那一行。和普通选项长得一样，只是里面是输入框。
 *
 * @param {object} props
 * @param {string} current
 * @param {boolean} active
 * @returns {HTMLElement}
 */
function customRow(props, current, active, multi) {
  const input = el('input', {
    type: 'text',
    class: 'oc-input',
    placeholder: '自己填一个……',
    value: current,
    /*
     * oninput 而不是 onchange：
     *   onchange 要等失焦才触发，而失焦会重绘 —— 打字打到一半
     *   如果点了别处，重绘时 value 还是旧值，刚打的字就吞了。
     *
     * 而且这里用 commitQuiet：只存不重绘。
     * 输入框不用重画（用户正在里面打字），重画反而会打断。
     */
    oninput(e) {
      commitQuiet(props, multi
        ? { picked_multi: mergeCustom(props.pickedMulti, e.target.value) }
        : { picked: e.target.value });
      /* 打了字就把这行标成选中 */
      const row = e.target.closest('.oc-row');
      if (row !== null && e.target.value !== '') row.classList.add('on');
    },
    onblur(e) {
      /* 失焦时把「跳过」和其它选项的选中态刷新一下 */
      repaintBody();
    }
  });
  return el('div', {class:'oc-row oc-custom' + (active ? ' on' : '')},
    el('span', {class:'oc-no'}, '✎'),
    input);
}

/**
 * 多选时把自定义文字并进 picked 数组（保留序号项）。
 *
 * @param {unknown} picked
 * @param {string} text
 * @returns {string[]}
 */
function mergeCustom(picked, text) {
  const list = Array.isArray(picked) ? picked.filter(function (x) {
    return /^\d+$/u.test(String(x));
  }) : [];
  const trimmed = String(text || '').trim();
  if (trimmed !== '') list.push(trimmed);
  return list;
}

/**
 * ask —— 单选。
 *
 * @param {object} props
 * @returns {HTMLElement}
 */
/**
 * ask —— 单选或多选，同一个组件。
 *
 * ## 单选和多选怎么分
 *
 *   multi: true   picked 是数组（从 pickedMulti 来），点了加入/移出
 *   multi: false  picked 是字符串，点了替换
 *
 * 其余完全一样：卡片头、选项、自定义行、跳过行。
 *
 * ## 默认是「跳过」
 *
 * 用户原话：
 *   > 没看这个卡片应该是默认选择的。
 *
 * 所以没给 picked 时，按「跳过」渲染 —— 那一行是选中的。
 *
 * @param {object} props
 * @returns {HTMLElement}
 */
function renderAskComponent(props) {
  const options = Array.isArray(props.options) ? props.options : [];
  const multi = props.multi === true;

  /* 单选：字符串；多选：数组 */
  const single = String(props.picked === undefined || props.picked === null ? '' : props.picked);
  const list = Array.isArray(props.pickedMulti) ? props.pickedMulti.map(String) : [];

  /*
   * 「跳过」的定义收窄了。
   *
   * 用户原话（GU-06 第 3 条）：
   *   > "跳过"，应该是默认选择，并且点击才激活。
   *   > 没选择不自动等于没看见。
   *   > 因为多选有可能是看见了并且一个都不选。
   *
   * 所以「没选」不再等于「没看」：
   *
   *   picked === '跳过'      明确点了跳过
   *   其它（含空）           没跳过
   *
   * 但**默认要给 '跳过'** —— 那是初值。用户一旦动了选项就离开跳过。
   */
  /*
   * 多选也要能「未选择」。
   *
   * 之前写成 `!multi && ...` —— 多选的跳过按钮永远点不亮，
   * 因为 isSkip 恒为 false，点它只是清空数组，按钮没反应。
   *
   * 多选的两个独立状态：
   *   pickedMulti 是空数组 + 其它选项都没选   不一定是未选择
   *   点了「未选择」                          才是未选择
   *
   * 用 pickedMulti = ['未选择'] 这个哨兵值表示。
   */
  const UNSET = '未选择';
  const isSkip = multi ? list.length === 1 && list[0] === UNSET : single === UNSET;

  /* 单选时：序号 / 自定义文字 */
  const pickedIndex = !multi && /^\d+$/u.test(single) ? Number(single) : -1;
  const isCustom = !multi && !isSkip && pickedIndex < 0;

  const listBox = el('div', {class:'oc-list'});

  options.forEach(function (opt, i) {
    const key = String(i + 1);
    const active = multi ? list.includes(key) : pickedIndex === i + 1;
    listBox.appendChild(optionRow(opt, i, active, function () {
      if (multi) toggleMultiPick(props, key);
      else commit(props, { picked: key });
    }));
  });

  /* 自定义行 */
  const customText = multi
    ? list.filter(function (x) { return !/^\d+$/u.test(x); }).join('、')
    : (isCustom ? single : '');
  const hasCustom = multi
    ? list.some(function (x) { return !/^\d+$/u.test(x); })
    : isCustom;

  if (props.allowCustom !== false) {
    listBox.appendChild(customRow(props, customText, hasCustom, multi));
  }

  const card = optionCard(props, listBox, isSkip, function () {
    if (isSkip) {
      /* 再点一次取消「未选择」 */
      commit(props, multi ? { picked_multi: [] } : { picked: '' });
      return;
    }
    /* 选中「未选择」：多选要清掉其它选择 */
    commit(props, multi ? { picked_multi: ['未选择'] } : { picked: '未选择' });
  });

  /*
   * 不画「已选 N 项」。
   *
   * 用户原话：
   *   > 选中了有"已选 1 项"，没选中没有。
   *   > 这导致是否跳过的文档流高度不一样，会跳一下
   *
   * 那一行只在有选中时出现，卡片高度就变了 —— 下面所有内容
   * 跟着挪，看起来像「跳一下」。
   *
   * 而且它也没必要：选了几项，选项行自己就是高亮的，一眼能看出来。
   * 卡片的任何状态都不该改变它的高度。
   */
  return card;
}

/**
 * 多选：加/删一项。
 *
 * @param {object} props
 * @param {string} key
 */
function toggleMultiPick(props, key) {
  const current = Array.isArray(props.pickedMulti) ? props.pickedMulti.map(String) : [];
  const i = current.indexOf(key);
  if (i >= 0) current.splice(i, 1);
  else current.push(key);
  commit(props, { picked_multi: current });
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
