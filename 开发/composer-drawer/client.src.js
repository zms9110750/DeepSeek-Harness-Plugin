import dagre from '@dagrejs/dagre';
window.__ModuleLoader__.load({
  id: '@local/composer-drawer',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const NS = 'composerDrawer';
    const PANEL_ID = 'composer-drawer-panel';

    /** Built-in copy, used until (or when) the Client locale service answers. */
    const FALLBACK = {
      'button.expand': '展开面板',
      'button.collapse': '收起面板',
      'panel.title': '任务',
      'panel.body': '这里将来放面板内容。',
      'panel.note': '面板会一直保持打开，只有再次点击上面的箭头按钮才会收起。',
      'board.count': '共 {n} 条 · 已启用 {on} 条',
      'board.expandAll': '全部展开',
      'board.collapseAll': '全部收起',
      'board.off': '未启用',
      'board.empty': '还没有任务。',
      'board.tree': '科技树',
      'board.list': '列表',
    };

    const ZH = {
      'button.expand': '展开面板',
      'button.collapse': '收起面板',
      'panel.title': '任务',
      'panel.body': '这里将来放面板内容。',
      'panel.note': '面板会一直保持打开，只有再次点击上面的箭头按钮才会收起。',
      'board.count': '共 {n} 条 · 已启用 {on} 条',
      'board.expandAll': '全部展开',
      'board.collapseAll': '全部收起',
      'board.off': '未启用',
      'board.empty': '还没有任务。',
      'board.tree': '科技树',
      'board.list': '列表',
    };

    const EN = {
      'button.expand': 'Expand panel',
      'button.collapse': 'Collapse panel',
      'panel.title': 'Tasks',
      'panel.body': 'Panel content goes here.',
      'panel.note': 'The panel stays open until you click the arrow button again.',
      'board.count': '{n} tasks · {on} enabled',
      'board.expandAll': 'Expand all',
      'board.collapseAll': 'Collapse all',
      'board.off': 'Disabled',
      'board.empty': 'No tasks yet.',
      'board.tree': 'Tech tree',
      'board.list': 'List',
    };

    /** Captured in apply(): components have no direct access to the plugin context. */
    let localeFace = null;
    let translate = null;
    /** apply() 里抓的 Client 上下文：组件要靠它执行宿主命令。 */
    let pluginRuntime = null;

    function commandSurface() {
      try {
        if (!pluginRuntime) return null;
        const remote = pluginRuntime.remote;
        if (!remote || !remote.commands || typeof remote.commands.execute !== 'function') return null;
        return remote.commands;
      } catch (failure) {
        return null;
      }
    }

    function runCommand(line, sessionId) {
      const commands = commandSurface();
      if (!commands) return Promise.reject(new Error('命令通道不可用'));
      return commands.execute(sessionId, line, []);
    }

    /** 命令结果里找文本：形状不稳定（string / {text} / {result:{text}} / 更深），递归找第一个 text。 */
    function commandText(settled) {
      if (!settled) return '';
      if (typeof settled === 'string') return settled;
      const seen = [];
      const walk = function (value, depth) {
        if (!value || typeof value !== 'object' || depth > 5) return '';
        if (seen.indexOf(value) !== -1) return '';
        seen.push(value);
        if (typeof value.text === 'string' && value.text !== '') return value.text;
        const keys = Object.keys(value);
        for (let i = 0; i < keys.length; i += 1) {
          const found = walk(value[keys[i]], depth + 1);
          if (found !== '') return found;
        }
        return '';
      };
      return walk(settled, 0);
    }

    function t(key) {
      if (translate) {
        try {
          const value = translate(key);
          if (typeof value === 'string' && value.length > 0 && value !== key) return value;
        } catch (failure) {
          /* fall back to the built-in copy */
        }
      }
      return FALLBACK[key] || key;
    }

    /** Re-render on a locale switch so the copy follows the active language. */
    function useLocaleRevision() {
      const pair = React.useState(0);
      const bump = pair[1];
      React.useEffect(
        function () {
          if (!localeFace || typeof localeFace.subscribe !== 'function') return undefined;
          const dispose = localeFace.subscribe(function () {
            bump(function (n) {
              return n + 1;
            });
          });
          return typeof dispose === 'function' ? dispose : undefined;
        },
        [bump],
      );
    }

    /* ---------------------------------------------------------------------
     * 描边 + 阴影：面板里所有「可点物」和「面板本体」都从这几个基元派生，
     * 不再原地手写 border / boxShadow。两档阴影、两档描边，其余一律引用。
     * 放在最前面：下面的样式常量在定义时就会调用它们。
     * ------------------------------------------------------------------- */

    /** 轻投影：小 chip、卡片、输入框。 */
    const shadowLight = '0 2px 8px rgba(0, 0, 0, 0.16)';
    /** 重投影：浮起来的面板（本面板、详情层、表单层）。 */
    const shadowHeavy = '0 8px 24px rgba(0, 0, 0, 0.18)';
    /** 可点物统一的描边（3px，与按钮同口径）。 */
    const edgeClickable = '3px solid var(--dsw-alias-border-l2)';
    /** 面板类容器的描边（1px）。 */
    const edgeSurface = '1px solid var(--dsw-alias-border-l1)';

    /** 浮起的面板：描边 + 重投影。 */
    function surfaceStyle(extra) {
      return Object.assign({ border: edgeSurface, boxShadow: shadowHeavy }, extra || {});
    }

    /** 可点的小块（卡片 / chip / 输入框）：描边 + 轻投影。 */
    function clickableStyle(extra) {
      return Object.assign({ border: edgeClickable, boxShadow: shadowLight }, extra || {});
    }

    /**
     * The dock spans the whole conversation column while the composer card is
     * narrower and centered. Cap this entry at the card's width so the panel
     * lines up with the card; the button then hangs outside the card's left
     * edge through its own negative inset.
     */
    const wrapperStyle = {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'flex-start',
      gap: 8,
      width: '100%',
      maxWidth: 1274,
      /* Bottom margin pulls the row down over the composer card so the button
         hangs at the card's top-left corner and travels with its top edge.
         The stack above the card is painted after this row, so the row is
         lifted to keep the overhanging button clickable. */
      margin: '0 auto -40px',
      boxSizing: 'border-box',
      position: 'relative',
      zIndex: 2,
      /* The overhanging row must not swallow clicks meant for the composer
         area or the other dock rows; only the button and the panel opt in. */
      pointerEvents: 'none',
    };

    /** Flush against the composer card's left border, outside it. */
    const buttonSlotStyle = {
      display: 'inline-flex',
      marginLeft: -32,
      pointerEvents: 'auto',
    };

    /* 面板必须浮起来：dock 那一行被输入框区域的高度夹住，在流里最高只能长到
       ~260px，装不下一张有向无环图。所以脱离流、贴在这一行上方，让图的画布
       有固定高度，展开时不再挤压输入框。 */
    const panelStyle = surfaceStyle({
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 'calc(100% + 44px)',
      maxHeight: 640,
      boxSizing: 'border-box',
      borderRadius: 12,
      background: 'var(--dsw-alias-bg-layer-1)',
      padding: '12px 14px 14px',
      color: 'var(--dsw-alias-label-primary)',
      pointerEvents: 'auto',
      zIndex: 3,
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    });

    const titleStyle = {
      fontSize: 13,
      fontWeight: 600,
      lineHeight: '20px',
      color: 'var(--dsw-alias-label-primary)',
    };

    const bodyStyle = {
      margin: '6px 0 0',
      fontSize: 12,
      lineHeight: 1.6,
      color: 'var(--dsw-alias-label-secondary)',
    };

    const noteStyle = {
      margin: '10px 0 0',
      paddingTop: 10,
      borderTop: '1px solid var(--dsw-alias-border-l1)',
      fontSize: 11,
      lineHeight: 1.5,
      color: 'var(--dsw-alias-label-secondary)',
    };

    /* ---------------------------------------------------------------------
     * Task board — sample rows for the first visual pass. The shape mirrors
     * the proposal header: id / 标题 / 类型 / 状态 / 启用 / 父 / 链接.
     * ------------------------------------------------------------------- */

    const SAMPLE_TASKS = [
      {
        id: '01',
        title: '工作区结构',
        kind: '需求',
        status: '完成',
        on: true,
        parent: '',
        summary: '六格目录 + git 仓库',
        links: [],
      },
      {
        id: '01/A',
        title: '问题：产出物平铺，没有可回退的点',
        kind: '问题',
        status: '提交',
        on: true,
        parent: '01',
        summary: '能用的、写坏的、试验的、文档全混在一起',
        links: [],
      },
      {
        id: '01/B-01',
        title: 'B-01 · 六格 + 单仓库',
        kind: '设计',
        status: '提交',
        on: true,
        parent: '01',
        summary: '一次提交就是一份可交付快照',
        links: [],
      },
      {
        id: '01/B-02',
        title: 'B-02 · 每格一个仓库',
        kind: '设计',
        status: '拒绝',
        on: false,
        parent: '01',
        summary: '引用成本压过回滚收益',
        links: [],
      },
      {
        id: '01/C-01-01',
        title: 'C-01-01 · 六个格子怎么切',
        kind: '接口',
        status: '提交',
        on: true,
        parent: '01/B-01',
        summary: '开发 / 发布 / 探针 / 研究 / todo / 计划',
        links: [],
      },
      {
        id: '01/D-01-01-01',
        title: 'D-01-01-01 · 目录与 git 初始化',
        kind: '实现',
        status: '完成',
        on: true,
        parent: '01/C-01-01',
        summary: '单仓库、主干单一历史',
        links: [],
      },
      {
        id: '03',
        title: '防止外部更改',
        kind: '需求',
        status: '需要授权',
        on: false,
        parent: '',
        summary: '待定：快照存哪',
        links: [],
      },
      {
        id: '04',
        title: '压缩包工具',
        kind: '功能请求',
        status: '需要授权',
        on: false,
        parent: '',
        summary: '归档 / 解包，只动副本',
        links: [{ to: '03', label: '依赖' }],
      },
      {
        id: '04/A',
        title: '问题：现在只能一个个文件拷',
        kind: '问题',
        status: '需要授权',
        on: false,
        parent: '04',
        summary: 'zip / tar 都要，先要能看清单',
        links: [],
      },
      {
        id: '15',
        title: '计划即提案',
        kind: '需求',
        status: '处理中',
        on: true,
        parent: '',
        summary: '父写、用户过、才派发',
        links: [],
      },
      {
        id: '15/C-待议',
        title: '待议：三次否决以后怎么办',
        kind: '待议',
        status: '需要补充',
        on: true,
        parent: '15',
        summary: '可能因此派生出一条新需求',
        links: [{ to: '21', label: '派生' }],
      },
      {
        id: '21',
        title: '双路',
        kind: '预期不符',
        status: '需要授权',
        on: false,
        parent: '',
        summary: '由 15 的待议派生出来',
        links: [{ to: '15/C-待议', label: '来源' }],
      },
    ];

    const TASK_BY_ID = {};
    const TASK_CHILDREN = {};
    SAMPLE_TASKS.forEach(function (node) {
      TASK_BY_ID[node.id] = node;
      const key = node.parent || '';
      if (!TASK_CHILDREN[key]) TASK_CHILDREN[key] = [];
      TASK_CHILDREN[key].push(node);
    });

    function taskDepth(node) {
      let depth = 0;
      let current = node;
      while (current && current.parent) {
        depth += 1;
        current = TASK_BY_ID[current.parent];
      }
      return depth;
    }

    /** Start folded below the first level so the panel opens as an outline. */
    const DEFAULT_COLLAPSED = {};
    SAMPLE_TASKS.forEach(function (node) {
      if ((TASK_CHILDREN[node.id] || []).length > 0 && taskDepth(node) >= 1) {
        DEFAULT_COLLAPSED[node.id] = true;
      }
    });

    /* 计划状态直接复用 A2A 的任务九态（摘要见 计划\19-A2A调研\README.md）：
       未指定 / 已提交 / 处理中 / 需补充(INPUT_REQUIRED) / 需授权(AUTH_REQUIRED) /
       已完成 / 失败 / 已取消 / 已拒绝。

       分组（与 Host 的 GROUP_OF 一致，改动要两边一起改）：
         进行：提交 / 处理中 / 需要补充 / 需要授权
         搁置：需要补充 / 需要授权
         完成：完成 / 失败 / 取消 / 拒绝
       注意「需要补充」「需要授权」**同时属于进行和搁置**——是进行中的暂停，不是终结。 */
    const STATUS_GROUPS = {
      '未指定': [],
      '提交': ['进行'],
      '处理中': ['进行'],
      '需要补充': ['进行', '搁置'],
      '需要授权': ['进行', '搁置'],
      '完成': ['完成'],
      '失败': ['完成'],
      '取消': ['完成'],
      '拒绝': ['完成'],
    };

    const A2A_STATES = {
      '未指定': {
        code: 'UNSPECIFIED',
        tone: 'label-secondary',
        desc: '没有采纳。写出来但还没被用户认可的计划停在这里。',
      },
      '提交': {
        code: 'SUBMITTED',
        tone: 'state-idle-primary',
        desc: '已采纳，等待被接取。只有这个状态能被领取。',
      },
      '处理中': {
        code: 'WORKING',
        tone: 'state-warn-primary',
        desc: '已接取，正在做。',
      },
      '需要补充': {
        code: 'INPUT_REQUIRED',
        tone: 'state-warn-primary',
        desc: '搁置：需要研究，或者需要更多信息才能继续。',
      },
      '需要授权': {
        code: 'AUTH_REQUIRED',
        tone: 'state-warn-primary',
        desc: '搁置：代价比较大、不一定合适。先确认别的计划，或确认就走这条路；等确认期间需要授权，也可以先转去做别的。',
      },
      '完成': {
        code: 'COMPLETED',
        tone: 'state-success-primary',
        desc: '交付完成。',
      },
      '失败': {
        code: 'FAILED',
        tone: 'state-error-primary',
        desc: '确认不能继续。',
      },
      '取消': {
        code: 'CANCELED',
        tone: 'label-secondary',
        desc: '父任务终结后，仍停在进行态的下游被取消。',
      },
      '拒绝': {
        code: 'REJECTED',
        tone: 'state-error-primary',
        desc: '用户主动否决，这个方案不再继续。',
      },
    };

    function statusA2A(status) {
      return A2A_STATES[status] || A2A_STATES['未指定'];
    }

    /** 状态属于哪些组（多组状态返回多个）。 */
    function groupsOf(status) {
      return STATUS_GROUPS[status] || [];
    }

    /** 组的短标签：多组时用 / 连接，草稿返回「草稿」。 */
    function groupLabel(status) {
      const groups = groupsOf(status);
      return groups.length > 0 ? groups.join('/') : '草稿';
    }

    function statusTone(status) {
      return 'var(--dsw-alias-' + statusA2A(status).tone + ')';
    }

    /** 计划模板目录（GitHub issue forms 的 YAML）。 */
    const TEMPLATE_DIR = 'X:\\temp\\dsh\\开发\\taskboard\\templates';

    /** 计划库：单个 JSONL 文件（用户目录）。 */
    const STORE_FILE = 'C:\\Users\\16229\\.dsh\\taskboard\\plans.jsonl';

    /** 只读文件 RPC：读不写会话日志（命令通道会写）。 */
    function fileRpc() {
      try {
        const remote = pluginRuntime && pluginRuntime.remote;
        const files = remote && remote.workspaceFiles;
        if (files && typeof files.list === 'function' && typeof files.read === 'function') return files;
      } catch (failure) {
        return null;
      }
      return null;
    }

    /** 计划文件 → 头 + 正文。 */
    function parseTaskText(text, name) {
      const lines = String(text || '').split(/\r?\n/u);
      const head = {};
      let index = 0;
      if (lines[0] === '---') {
        for (index = 1; index < lines.length; index += 1) {
          if (lines[index] === '---') {
            index += 1;
            break;
          }
          const match = /^([A-Za-z_]+):[ \t]?(.*)$/u.exec(lines[index]);
          if (match) head[match[1]] = match[2].trim();
        }
      }
      const body = lines.slice(index).join('\n').trim();
      const summary = (body
        .split(/\r?\n/u)
        .map(function (line) {
          return line.replace(/^[#>\-\s]+/u, '').trim();
        })
        .filter(function (line) {
          return line !== '';
        })[0] || '').slice(0, 80);
      return Object.assign({}, head, {
        id: String(head.id || name || '').replace(/\.md$/u, ''),
        summary: summary,
        body: body,
      });
    }
    const TYPE_TO_KIND = {
      A: '问题',
      B: '设计',
      C: '接口',
      D: '实现',
      R: '研究',
      F: '复盘',
      H1: '搁置·授权',
      H2: '搁置·授权',
      H3: '搁置·授权',
      H4: '搁置·补充',
      H5: '搁置·补充',
      H6: '搁置·授权',
      H7: '搁置·授权',
      H8: '搁置·补充',
    };

    /** 宿主 /tasks 的一行 → 卡片节点。 */
    function fromApi(row) {
      const type = String(row.type || '').toUpperCase();
      const status = Object.prototype.hasOwnProperty.call(A2A_STATES, row.status) ? row.status : '未指定';
      const links = String(row.links || '')
        .split(/[,，]/u)
        .map(function (part) {
          return part.trim();
        })
        .filter(function (part) {
          return part !== '';
        })
        .map(function (part) {
          const cut = part.split(/[:：]/u);
          return { label: (cut[0] || '链接').trim(), to: (cut[1] || '').trim() };
        })
        .filter(function (link) {
          return link.to !== '';
        });
      return {
        id: row.id,
        /* 原始类型码：编辑时回填表单要用它，不能从 kind 反推（搁置模板 H1..H8 反推不出来）。 */
        typeCode: type,
        title: row.title || row.id,
        kind: TYPE_TO_KIND[type] || '计划',
        status: status,
        on: status === '提交' || status === '处理中',
        parent: row.parent || '',
        summary: row.summary || '',
        links: links,
        workspace: row.workspace || '',
        workspaces: row.workspaces || '',
        permission: row.permission || '',
        note: row.note || '',
      };
    }
    const cardStyle = clickableStyle({
      display: 'flex',
      alignItems: 'flex-start',
      gap: 8,
      padding: '8px 10px',
      borderRadius: 10,
      background: 'var(--dsw-alias-bg-layer-1)',
      transition: 'border-color 120ms ease, background 120ms ease, box-shadow 120ms ease',
    });

    const cardActiveStyle = {
      border: '3px solid var(--dsw-alias-brand-primary)',
    };

    const idChipStyle = {
      flex: 'none',
      marginTop: 1,
      padding: '0 5px',
      borderRadius: 5,
      background: 'var(--dsw-alias-bg-layer-2)',
      color: 'var(--dsw-alias-label-secondary)',
      fontSize: 10.5,
      lineHeight: '16px',
      whiteSpace: 'nowrap',
    };

    const kindChipStyle = clickableStyle({
      flex: 'none',
      padding: '0 6px',
      borderRadius: 999,
      color: 'var(--dsw-alias-label-secondary)',
      fontSize: 10.5,
      lineHeight: '16px',
      whiteSpace: 'nowrap',
    });

    const linkChipStyle = clickableStyle({
      padding: '0 7px',
      borderRadius: 999,
      background: 'var(--dsw-alias-bg-layer-2)',
      color: 'var(--dsw-alias-brand-primary)',
      fontSize: 10.5,
      lineHeight: '17px',
      cursor: 'pointer',
      font: 'inherit',
      whiteSpace: 'nowrap',
    });

    /** 面板按钮统一外观：3px 描边 + 投影；primary 用品牌色。 */
    function buttonBase(primary, disabled) {
      return {
        padding: '4px 14px',
        borderRadius: 10,
        font: 'inherit',
        fontSize: 12,
        lineHeight: '20px',
        whiteSpace: 'nowrap',
        cursor: disabled === true ? 'default' : 'pointer',
        opacity: disabled === true ? 0.6 : 1,
        border: '3px solid ' + (primary ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-border-l2)'),
        background: primary ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-bg-layer-1)',
        color: primary ? 'var(--dsw-alias-bg-base)' : 'var(--dsw-alias-label-primary)',
        boxShadow: shadowLight,
      };
    }
    const childBoxStyle = {
      display: 'flex',
      flexDirection: 'column',
      gap: 6,
      marginTop: 6,
      marginLeft: 14,
      paddingLeft: 10,
      borderLeft: '1px dashed var(--dsw-alias-border-l1)',
    };

    const caretStyle = clickableStyle({
      flex: 'none',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: 20,
      height: 20,
      marginTop: 1,
      padding: 0,
      borderRadius: 6,
      background: 'var(--dsw-alias-bg-layer-1)',
      color: 'var(--dsw-alias-label-secondary)',
      cursor: 'pointer',
      font: 'inherit',
    });

    function Caret(props) {
      return h(
        'svg',
        {
          viewBox: '0 0 16 16',
          width: 13,
          height: 13,
          'aria-hidden': true,
          focusable: false,
          style: {
            display: 'block',
            transform: props.open ? 'rotate(90deg)' : 'none',
            transition: 'transform 120ms ease',
          },
        },
        h('path', {
          d: 'M6 3.5 L10.5 8 L6 12.5',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.7,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
      );
    }

    /* ---------------------------------------------------------------------
     * Tech tree：把计划铺成有向无环图。
     * 布局交给 dagre（Sugiyama：分层 → 交叉最小化 → 紧凑排列），不再自己算行列。
     * 同一批计划 + 同一套边，永远排成同一张图（dagre 是确定性的）。
     * ------------------------------------------------------------------- */

    const NODE_W = 168;
    const NODE_H = 52;

    function buildGraph(tasks) {
      const taskById = {};
      tasks.forEach(function (item) {
        taskById[item.id] = item;
      });

      const layout = new dagre.graphlib.Graph();
      layout.setGraph({ rankdir: 'LR', nodesep: 14, ranksep: 46, marginx: 4, marginy: 4 });
      layout.setDefaultEdgeLabel(function () {
        return {};
      });

      tasks.forEach(function (node) {
        layout.setNode(node.id, { width: NODE_W, height: NODE_H });
      });

      /* 边的方向一律归一成「先决 → 依赖方」，并按无向对去重：
         同一段关系常常两边各写一次（一边写"派生 21"，另一边写"来源 待议"），
         不去重就会画出两条方向相反的边——反向那条会绕过整张图。 */
      const edges = [];
      const drawEdge = function (src, dst, kind, label) {
        edges.push({ src: src, dst: dst, kind: kind, label: label });
        layout.setEdge(src, dst);
      };

      const seenLinks = {};
      tasks.forEach(function (node) {
        if (node.parent && taskById[node.parent]) drawEdge(node.parent, node.id, 'parent', '');
        (node.links || []).forEach(function (link) {
          if (!taskById[link.to]) return;
          let src = node.id;
          let dst = link.to;
          /* 依赖：我依赖它 → 它是先决；派生：我派生它 → 我是先决；
             来源：我来自它 → 它是先决；其余（对接等）按依赖处理。 */
          if (link.label === '派生') {
            src = node.id;
            dst = link.to;
          } else if (link.label === '来源') {
            src = link.to;
            dst = node.id;
          } else {
            src = link.to;
            dst = node.id;
          }
          const key = src < dst ? src + '\u0000' + dst : dst + '\u0000' + src;
          if (seenLinks[key]) return;
          seenLinks[key] = true;
          drawEdge(src, dst, 'link', link.label);
        });
      });

      dagre.layout(layout);

      const byId = {};
      tasks.forEach(function (node) {
        const point = layout.node(node.id);
        byId[node.id] = { node: node, x: point.x - NODE_W / 2, y: point.y - NODE_H / 2 };
      });

      const box = layout.graph();
      return {
        byId: byId,
        nodes: tasks.map(function (node) {
          return byId[node.id];
        }),
        edges: edges,
        width: Math.max(NODE_W + 8, box.width || 0),
        height: Math.max(NODE_H + 8, box.height || 0),
      };
    }



    function TechTree(props) {
      const graph = props.graph;
      const hoverState = React.useState('');
      const hovered = hoverState[0];
      const setHovered = hoverState[1];

      return h(
        'div',
        { style: { height: 336, overflow: 'auto', paddingRight: 4 } },
        h(
          'div',
          { style: { position: 'relative', width: graph.width, height: graph.height, margin: '4px 0' } },
          h(
            'svg',
            {
              width: graph.width,
              height: graph.height,
              style: { position: 'absolute', left: 0, top: 0, pointerEvents: 'none' },
            },
            h(
              'defs',
              null,
              h(
                'marker',
                {
                  id: 'tt-arrow',
                  viewBox: '0 0 8 8',
                  refX: 7,
                  refY: 4,
                  markerWidth: 7,
                  markerHeight: 7,
                  orient: 'auto',
                },
                h('path', { d: 'M0 0 L8 4 L0 8 Z', fill: 'var(--dsw-alias-border-l2)' }),
              ),
            ),
            graph.edges.map(function (edge) {
              /* 箭头永远从「先决」指向「依赖方」：父 → 子、被依赖 → 依赖。
                 列是按依赖深度排的，所以这样画总是从左往右。 */
              const from = graph.byId[edge.src];
              const to = graph.byId[edge.dst];
              if (!from || !to) return null;
              const x1 = from.x + NODE_W;
              const y1 = from.y + NODE_H / 2;
              const x2 = to.x - 6;
              const y2 = to.y + NODE_H / 2;
              const dx = Math.max(28, Math.abs(x2 - x1) / 2);
              const active = hovered === edge.src || hovered === edge.dst;
              return h('path', {
                key: 'edge-' + edge.src + '-' + edge.dst + '-' + edge.kind,
                d:
                  'M' + x1 + ' ' + y1 +
                  ' C' + (x1 + dx) + ' ' + y1 + ' ' + (x2 - dx) + ' ' + y2 + ' ' + x2 + ' ' + y2,
                fill: 'none',
                stroke: edge.kind === 'link' ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-border-l2)',
                strokeWidth: active ? 2 : 1.2,
                strokeDasharray: edge.kind === 'link' ? '4 3' : 'none',
                opacity: hovered === '' ? 0.5 : active ? 1 : 0.14,
                markerEnd: 'url(#tt-arrow)',
              });
            }),
          ),
          graph.nodes.map(function (placed) {
            const node = placed.node;
            const isHovered = hovered === node.id;
            return h(
              'div',
              {
                key: 'tt-' + node.id,
                onMouseEnter: function () {
                  setHovered(node.id);
                },
                onMouseLeave: function () {
                  setHovered('');
                },
                onClick: function () {
                  props.onSelect(node.id);
                },
                style: clickableStyle({
                  position: 'absolute',
                  left: placed.x,
                  top: placed.y,
                  width: NODE_W,
                  height: NODE_H,
                  boxSizing: 'border-box',
                  padding: '7px 9px',
                  cursor: 'pointer',
                  border:
                    '3px solid ' +
                    (isHovered || props.selected === node.id ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-border-l2)'),
                  borderRadius: 10,
                  background: 'var(--dsw-alias-bg-layer-1)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 3,
                  opacity: node.on ? 1 : 0.62,
                  transition: 'border-color 120ms ease, box-shadow 120ms ease',
                }),
              },
              h(
                'div',
                { style: { display: 'flex', alignItems: 'center', gap: 5 } },
                h('span', { style: idChipStyle }, node.id),
                h('span', { style: kindChipStyle }, node.kind),
                h('span', { style: { marginLeft: 'auto', fontSize: 11, color: statusTone(node.status) } }, '●'),
              ),
              h(
                'div',
                {
                  style: {
                    fontSize: 12,
                    fontWeight: 600,
                    color: 'var(--dsw-alias-label-primary)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  },
                },
                node.title,
              ),
            );
          }),
        ),
      );
    }


    function DetailPane(props) {
      const node = props.node;
      const state = statusA2A(node.status);

      const children = props.tasks.filter(function (item) {
        return item.parent === node.id;
      }).map(function (item) {
        return item.id;
      });
      const outLinks = (node.links || []).map(function (link) {
        return { label: link.label, id: link.to };
      });
      const inLinks = [];
      props.tasks.forEach(function (item) {
        (item.links || []).forEach(function (link) {
          if (link.to === node.id) inLinks.push({ label: link.label, id: item.id });
        });
      });

      /* 用户能点的状态转移（AI 那边用 task_state 工具做同样的事）。
         与 Host 的 transitionBlocker 口径一致：
           · 草稿 → 处理中 禁止（必须先采纳）
           · 提交 → 完成 / 失败 / 取消 / 拒绝 都允许（T-037 第 1 条）
           · 处理中 → 取消 允许（T-038 第 2 条：失败 ≠ 取消）
           · 终态 → 提交 = 重开（用户专属，T-030） */
      const TRANSITIONS = {
        '未指定': [{ to: '提交', label: '采纳', primary: true }, { to: '拒绝', label: '拒绝' }],
        '提交': [
          { to: '处理中', label: '领取', primary: true },
          { to: '完成', label: '直接完成' },
          { to: '取消', label: '取消' },
          { to: '拒绝', label: '拒绝' },
        ],
        '处理中': [
          { to: '完成', label: '完成', primary: true },
          { to: '失败', label: '失败' },
          { to: '取消', label: '取消' },
          { to: '需要补充', label: '需要补充' },
          { to: '需要授权', label: '需要授权' },
        ],
        '需要补充': [
          { to: '处理中', label: '继续', primary: true },
          { to: '取消', label: '取消' },
          { to: '拒绝', label: '拒绝' },
        ],
        '需要授权': [
          { to: '处理中', label: '继续', primary: true },
          { to: '取消', label: '取消' },
          { to: '拒绝', label: '拒绝' },
        ],
        /* 终态：只有「重开」一条路（T-030）。重开回到「提交」，要重新领。 */
        '完成': [{ to: '提交', label: '重开', primary: true }],
        '失败': [{ to: '提交', label: '重开', primary: true }],
        '取消': [{ to: '提交', label: '重开', primary: true }],
        '拒绝': [{ to: '提交', label: '重开', primary: true }],
      };
      const actions = TRANSITIONS[node.status] || [];
      const chip = function (label, target) {
        return h(
          'button',
          {
            key: 'rel-' + label + '-' + target,
            type: 'button',
            onClick: function () {
              props.onJump(target);
            },
            style: clickableStyle({
              padding: '2px 10px',
              borderRadius: 8,
              font: 'inherit',
              fontSize: 11,
              lineHeight: '20px',
              whiteSpace: 'nowrap',
              cursor: 'pointer',
              background: 'var(--dsw-alias-bg-layer-1)',
              color: 'var(--dsw-alias-brand-primary)',
            }),
          },
          '↗ ' + label + ' · ' + target,
        );
      };

      const section = function (title, body) {
        return h(
          'div',
          { style: { borderTop: '1px solid var(--dsw-alias-border-l1)', paddingTop: 10 } },
          h('div', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)', marginBottom: 6 } }, title),
          body,
        );
      };

      const relationRows = [
        ['父计划', node.parent ? [chip('父', node.parent)] : []],
        ['子计划', children.map(function (id) { return chip('子', id); })],
        ['指向', outLinks.map(function (link) { return chip(link.label, link.id); })],
        ['被指向', inLinks.map(function (link) { return chip(link.label, link.id); })],
      ];

      return h(
        'div',
        {
          style: surfaceStyle({
            position: 'absolute',
            top: 0,
            right: 0,
            bottom: 0,
            /* 占据整个面板的一侧：从面板最上沿到最后下沿，
               把标题栏（任务 / 计数 / 图例 / 新建 / 刷新）一起盖住。 */
            width: 'min(600px, 100%)',
            boxSizing: 'border-box',
            borderLeft: '1px solid var(--dsw-alias-border-l1)',
            background: 'var(--dsw-alias-bg-layer-1)',
            padding: '12px 14px 14px 16px',
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            overflow: 'auto',
            minHeight: 0,
            zIndex: 3,
          }),
        },
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: 8 } },
          h('span', { style: idChipStyle }, node.id),
          h('span', { style: kindChipStyle }, node.kind),
          h(
            'span',
            { style: { fontSize: 11, color: statusTone(node.status) } },
            '● ' + node.status + ' · ' + state.code + ' · ' + groupLabel(node.status),
          ),
          h('span', { style: { flex: 1 } }),
          h(
            'button',
            {
              type: 'button',
              onClick: props.onEdit,
              style: Object.assign({}, buttonBase(false), { padding: '2px 12px', marginRight: 8 }),
            },
            props.canEdit === true ? '编辑' : '分支',
          ),
          h(
            'button',
            {
              type: 'button',
              onClick: props.onClose,
              style: Object.assign({}, buttonBase(false), { padding: '2px 12px' }),
            },
            '关闭',
          ),
        ),
        h(
          'div',
          { style: { fontSize: 17, fontWeight: 600, lineHeight: 1.35, color: 'var(--dsw-alias-label-primary)' } },
          node.title,
        ),
        h(
          'div',
          {
            style: {
              fontSize: 12,
              lineHeight: 1.6,
              color: 'var(--dsw-alias-label-secondary)',
              background: 'var(--dsw-alias-bg-layer-2)',
              borderRadius: 8,
              padding: '6px 10px',
            },
          },
          h(
            'span',
            { style: { color: statusTone(node.status), fontWeight: 600 } },
            node.status + '（' + state.code + ' · ' + groupLabel(node.status) + '）',
          ),
          '　' + state.desc,
        ),
        actions.length > 0 || props.error
          ? h(
              'div',
              { style: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 } },
              actions.map(function (item) {
                return h(
                  'button',
                  {
                    key: 'action-' + item.to,
                    type: 'button',
                    disabled: props.busy === true,
                    onClick: function () {
                      props.onState(item.to);
                    },
                    style: buttonBase(item.primary, props.busy),

                  },
                  item.label,
                );
              }),
              props.error
                ? h(
                    'span',
                    {
                      style: {
                        fontSize: 11,
                        color: 'var(--dsw-alias-state-error-primary)',
                        maxWidth: 320,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      },
                    },
                    props.error,
                  )
                : null,
            )
          : null,
        h(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: 3, fontSize: 12, lineHeight: '20px' } },
          h(
            'div',
            null,
            h('span', { style: { color: 'var(--dsw-alias-label-secondary)' } }, '启用　'),
            node.on ? '是（可被领取）' : '否（草稿/关闭，不可领取）',
          ),
          h(
            'div',
            null,
            h('span', { style: { color: 'var(--dsw-alias-label-secondary)' } }, '子工作空间　'),
            node.workspace || '（未指定，按会话目录）',
          ),
          h(
            'div',
            null,
            h('span', { style: { color: 'var(--dsw-alias-label-secondary)' } }, '额外工作区　'),
            node.workspaces || '（无）',
          ),
          h(
            'div',
            null,
            h('span', { style: { color: 'var(--dsw-alias-label-secondary)' } }, '权限　'),
            node.permission || '（未指定）',
          ),
        ),
        section(
          '关系',
          h(
            'div',
            { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
            relationRows.map(function (row) {
              return h(
                'div',
                { key: 'relrow-' + row[0], style: { display: 'flex', gap: 8, alignItems: 'flex-start' } },
                h(
                  'span',
                  { style: { width: 56, flex: 'none', fontSize: 11, lineHeight: '24px', color: 'var(--dsw-alias-label-secondary)' } },
                  row[0],
                ),
                h(
                  'div',
                  { style: { display: 'flex', flexWrap: 'wrap', gap: 6, flex: 1 } },
                  row[1].length ? row[1] : h('span', { style: { fontSize: 11, lineHeight: '24px', color: 'var(--dsw-alias-label-secondary)' } }, '—'),
                ),
              );
            }),
          ),
        ),
        section(
          '备注 / 搁置理由',
          h(
            'div',
            { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
            h(
              'div',
              {
                style: {
                  fontSize: 12,
                  lineHeight: 1.6,
                  whiteSpace: 'pre-wrap',
                  color: node.note ? 'var(--dsw-alias-label-primary)' : 'var(--dsw-alias-label-secondary)',
                },
              },
              node.note || '（还没有备注）',
            ),
            !node.note && (node.status === '需要授权' || node.status === '需要补充')
              ? h(
                  'div',
                  { style: { fontSize: 11, color: 'var(--dsw-alias-state-warn-primary)' } },
                  '这张计划停在「' + node.status + '」，但没有写为什么——建议补一句。',
                )
              : null,
            h(
              'div',
              { style: { display: 'flex', gap: 6, alignItems: 'flex-start' } },
              h('textarea', {
                value: props.noteDraft === undefined ? '' : props.noteDraft,
                placeholder: '写清为什么停在这里：在等谁、等什么、什么时候能继续。',
                onChange: function (event) {
                  props.onNoteDraft(event.target.value);
                },
                rows: 3,
                style: Object.assign({}, formInputStyle, {
                  flex: 1,
                  resize: 'vertical',
                  fontFamily: 'inherit',
                  lineHeight: 1.6,
                }),
              }),
              h(
                'div',
                { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
                h(
                  'button',
                  {
                    type: 'button',
                    disabled: props.busy === true,
                    onClick: function () {
                      props.onSaveNote(props.noteDraft === undefined ? '' : props.noteDraft);
                    },
                    style: buttonBase(true, props.busy),
                  },
                  '保存备注',
                ),
                props.noteError
                  ? h(
                      'span',
                      {
                        style: {
                          fontSize: 11,
                          color: 'var(--dsw-alias-state-error-primary)',
                          maxWidth: 160,
                        },
                      },
                      props.noteError,
                    )
                  : null,
              ),
            ),
          ),
        ),
        section(
          '正文',
          h(
            'div',
            { style: { fontSize: 13, lineHeight: 1.7, color: 'var(--dsw-alias-label-secondary)' } },
            node.summary,
            props.body
              ? h('div', { style: { marginTop: 10, whiteSpace: 'pre-wrap', color: 'var(--dsw-alias-label-primary)' } }, props.body)
              : null,
          ),
        ),
      );
    }
    /** GitHub issue forms 的 YAML 子集：name / description / body[].type,id,attributes.*,validations.required */
    function parseTemplateYaml(saw) {
      const lines = String(saw || '').split(/\r?\n/u);
      const out = { name: '', description: '', items: [] };
      let item = null;
      let section = '';
      let blockKey = '';
      let blockLines = [];
      const flushBlock = function () {
        if (item && blockKey) item[blockKey] = blockLines.join('\n').trim();
        blockKey = '';
        blockLines = [];
      };
      lines.forEach(function (raw) {
        if (blockKey) {
          if (raw.trim() === '' || /^\s{4,}/u.test(raw)) {
            blockLines.push(raw.replace(/^\s{4}/u, ''));
            return;
          }
          flushBlock();
        }
        const trimmed = raw.trim();
        if (trimmed === '' || trimmed.charAt(0) === '#') return;
        let match = /^name:\s*(.+)$/u.exec(trimmed);
        if (match && item === null) {
          out.name = match[1].replace(/^["']|["']$/gu, '');
          return;
        }
        match = /^description:\s*(.+)$/u.exec(trimmed);
        if (match && item === null) {
          out.description = match[1].replace(/^["']|["']$/gu, '');
          return;
        }
        match = /^-\s+type:\s*(.+)$/u.exec(trimmed);
        if (match) {
          item = { type: match[1].trim(), required: false };
          out.items.push(item);
          section = '';
          return;
        }
        if (item === null) return;
        if (/^attributes:/u.test(trimmed)) {
          section = 'attributes';
          return;
        }
        if (/^validations:/u.test(trimmed)) {
          section = 'validations';
          return;
        }
        match = /^([a-z-]+):\s*(.*)$/u.exec(trimmed);
        if (!match) return;
        const key = match[1];
        const value = match[2];
        if (value === '|') {
          blockKey = key;
          blockLines = [];
          return;
        }
        if (key === 'required') {
          item.required = value === 'true';
          return;
        }
        if (key === 'id') {
          item.id = value;
          return;
        }
        if (section === 'attributes' && (key === 'label' || key === 'description' || key === 'placeholder' || key === 'value')) {
          item[key] = value.replace(/^["']|["']$/gu, '');
        }
      });
      flushBlock();
      return out;
    }

    /** 把已有正文按「## 标题」切成 {标签: 内容}，用于编辑/分支时回填模板字段。 */
    function parseSections(body) {
      const out = {};
      const lines = String(body || '').split(/\r?\n/u);
      let label = '';
      let buffer = [];
      const flush = function () {
        if (label !== '') out[label.trim()] = buffer.join('\n').trim();
        label = '';
        buffer = [];
      };
      lines.forEach(function (line) {
        const match = /^##\s+(.+)$/u.exec(line);
        if (match) {
          flush();
          label = match[1];
          return;
        }
        if (label !== '') buffer.push(line);
      });
      flush();
      return out;
    }
    /* 模板下拉：先「这是什么活」，再「为什么停下来等人」。
       代码只认 type 字符串，H* 不改变任何状态语义，只是正文骨架。 */
    const TYPE_LABELS = [
      ['A', '问题'],
      ['B', '设计'],
      ['C', '接口'],
      ['D', '实现'],
      ['R', '研究'],
      ['F', '复盘'],
      ['H1', '搁置 · 授权-代价过大'],
      ['H2', '搁置 · 授权-用户转移话题'],
      ['H3', '搁置 · 授权-方案缺陷过大'],
      ['H4', '搁置 · 补充-缺用户信息'],
      ['H5', '搁置 · 补充-需要先调研'],
      ['H6', '搁置 · 授权-资源被占用'],
      ['H7', '搁置 · 授权-缺权限/环境'],
      ['H8', '搁置 · 补充-子任务未回收'],
    ];

    const formInputStyle = clickableStyle({
      width: '100%',
      boxSizing: 'border-box',
      padding: '5px 8px',
      borderRadius: 8,
      background: 'var(--dsw-alias-bg-layer-2)',
      color: 'var(--dsw-alias-label-primary)',
      font: 'inherit',
      fontSize: 12,
      lineHeight: '20px',
      outline: 'none',
    });

    function CreateForm(props) {
      const init = props.initial || {};
      const templates = props.templates || {};
      const plans = props.plans || [];
      const initialType = typeof init.type === 'string' ? init.type : 'C';
      const initialTemplate = initialType !== '' && templates[initialType] ? parseTemplateYaml(templates[initialType]) : null;
      const initialValues = {};
      if (init.body && initialTemplate) {
        const sections = parseSections(init.body);
        initialTemplate.items.forEach(function (item) {
          const key = item.id || item.label || '';
          const found = sections[item.label || ''];
          if (key !== '' && found !== undefined) initialValues[key] = found;
        });
      }
      const titleState = React.useState(init.title || '');
      const title = titleState[0];
      const setTitle = titleState[1];
      const typeState = React.useState(initialType);
      const type = typeState[0];
      const setType = typeState[1];
      const valuesState = React.useState(initialValues);
      const values = valuesState[0];
      const setValues = valuesState[1];
      const workspaceState = React.useState(init.workspace || '');
      const workspace = workspaceState[0];
      const setWorkspace = workspaceState[1];
      const workspacesState = React.useState(init.workspaces || '');
      const workspaces = workspacesState[0];
      const setWorkspaces = workspacesState[1];
      const permissionState = React.useState(init.permission || '');
      const permission = permissionState[0];
      const setPermission = permissionState[1];
      const bodyState = React.useState(init.body || '');
      const body = bodyState[0];
      const setBody = bodyState[1];
      const parentState = React.useState(init.parent || '');
      const parent = parentState[0];
      const setParent = parentState[1];
      const linksState = React.useState(Array.isArray(init.links) ? init.links : []);
      const links = linksState[0];
      const setLinks = linksState[1];
      const errorState = React.useState('');
      const error = errorState[0];
      const setError = errorState[1];

      const template = type !== '' && templates[type] ? parseTemplateYaml(templates[type]) : null;
      const fields = template
        ? template.items.filter(function (item) {
            return item.type !== 'markdown';
          })
        : [];

      const updateLink = function (index, patch) {
        const next = links.slice();
        next[index] = Object.assign({}, next[index], patch);
        setLinks(next);
      };

      const submit = function () {
        if (title.trim() === '') {
          setError('标题不能为空');
          return;
        }
        let text = '';
        if (type !== '') {
          const parts = [];
          let missing = '';
          fields.forEach(function (item) {
            const key = item.id || item.label || 'field';
            const value = String(values[key] || '').trim();
            if (value === '') {
              if (item.required && missing === '') missing = item.label || item.id;
              return;
            }
            parts.push('## ' + (item.label || item.id) + '\n\n' + value);
          });
          if (missing !== '') {
            setError(missing + ' 是必填');
            return;
          }
          if (parts.length === 0) {
            if (init.body) {
              text = init.body;
            } else {
              setError('模板字段至少填一项');
              return;
            }
          } else {
            text = parts.join('\n\n');
          }
        } else {
          text = body;
        }
        setError('');
        const seen = {};
        const linkText = links
          .filter(function (link) {
            if (link.to === '') return false;
            const key = link.label + ':' + link.to;
            if (seen[key]) return false;
            seen[key] = true;
            return true;
          })
          .map(function (link) {
            return link.label + ':' + link.to;
          })
          .join(', ');
        props.onSubmit({
          title: title.trim(),
          type: type,
          body: text,
          parent: parent,
          links: linkText,
          workspace: workspace.trim(),
          workspaces: workspaces.trim(),
          permission: permission,
        });
      };

      const optionsFor = function (placeholder) {
        return [{ id: '', title: placeholder }].concat(plans).map(function (item) {
          return h('option', { key: 'opt-' + (item.id || 'none'), value: item.id }, item.id === '' ? item.title : item.id + ' · ' + item.title);
        });
      };

      const lineStyle = { fontSize: 12, color: 'var(--dsw-alias-label-secondary)' };

      return h(
        'div',
        {
          style: surfaceStyle({
            position: 'absolute',
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
            boxSizing: 'border-box',
            background: 'var(--dsw-alias-bg-layer-1)',
            borderRadius: 12,
            padding: '10px 14px 12px',
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
            zIndex: 4,
          }),
        },
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: 8, padding: '10px 0 8px' } },
          h('span', { style: titleStyle }, props.title || '新建计划'),
          h('span', { style: { flex: 1 } }),
          h('button', { type: 'button', onClick: props.onCancel, style: Object.assign({}, buttonBase(false), { padding: '2px 12px' }) }, '取消'),
        ),
        h(
          'div',
          { style: { display: 'flex', gap: 18, flex: 1, minHeight: 0 } },
          h(
            'div',
            { style: { width: 440, flex: 'none', display: 'flex', flexDirection: 'column', gap: 8, minHeight: 0, overflow: 'auto', paddingRight: 6 } },
            h(
              'div',
              { style: { display: 'flex', gap: 8 } },
              h('input', {
                value: title,
                placeholder: '标题（一句话）',
                onChange: function (event) {
                  setTitle(event.target.value);
                },
                style: Object.assign({}, formInputStyle, { flex: 1 }),
              }),
              h(
                'select',
                {
                  value: type,
                  onChange: function (event) {
                    setType(event.target.value);
                  },
                  style: Object.assign({}, formInputStyle, { width: 132, flex: 'none' }),
                },
                [['', '空模板']].concat(TYPE_LABELS).map(function (pair) {
                  return h('option', { key: 'type-' + (pair[0] || 'blank'), value: pair[0] }, pair[0] === '' ? pair[1] : pair[0] + ' · ' + pair[1]);
                }),
              ),
            ),
            h(
              'div',
              { style: { display: 'flex', gap: 8, alignItems: 'center' } },
              h('span', { style: Object.assign({ width: 48, flex: 'none' }, lineStyle) }, '父计划'),
              h(
                'select',
                {
                  value: parent,
                  onChange: function (event) {
                    setParent(event.target.value);
                  },
                  style: Object.assign({}, formInputStyle, { flex: 1 }),
                },
                optionsFor('（无，顶层）'),
              ),
            ),
            h(
              'div',
              { style: { display: 'flex', gap: 8, alignItems: 'center' } },
              h('span', { style: Object.assign({ width: 48, flex: 'none' }, lineStyle) }, '工作空间'),
              h('input', {
                value: workspace,
                placeholder: '子工作空间绝对路径（空 = 会话目录）',
                onChange: function (event) {
                  setWorkspace(event.target.value);
                },
                style: Object.assign({}, formInputStyle, { flex: 1 }),
              }),
            ),
            h(
              'div',
              { style: { display: 'flex', gap: 8, alignItems: 'center' } },
              h('span', { style: Object.assign({ width: 48, flex: 'none' }, lineStyle) }, '额外'),
              h('input', {
                value: workspaces,
                placeholder: '额外工作区，逗号分隔的绝对路径（要读写的其它目录，可空）',
                onChange: function (event) {
                  setWorkspaces(event.target.value);
                },
                style: Object.assign({}, formInputStyle, { flex: 1 }),
              }),
            ),
            h(
              'div',
              { style: { display: 'flex', gap: 8, alignItems: 'center' } },
              h('span', { style: Object.assign({ width: 48, flex: 'none' }, lineStyle) }, '权限'),
              h(
                'select',
                {
                  value: permission,
                  onChange: function (event) {
                    setPermission(event.target.value);
                  },
                  style: Object.assign({}, formInputStyle, { flex: 1 }),
                },
                ['', '仅可查看', '工作区内修改', '完全权限', '工具全关'].map(function (value) {
                  return h('option', { key: 'perm-' + (value || 'none'), value: value }, value === '' ? '（不指定，按会话档位）' : value);
                }),
              ),
            ),            h('span', { style: lineStyle }, '关联（箭头从先决指向依赖方）'),
            links.map(function (link, index) {
              return h(
                'div',
                { key: 'link-row-' + index, style: { display: 'flex', gap: 6, alignItems: 'center' } },
                h(
                  'select',
                  {
                    value: link.label,
                    onChange: function (event) {
                      updateLink(index, { label: event.target.value });
                    },
                    style: Object.assign({}, formInputStyle, { width: 128, flex: 'none' }),
                  },
                  [['依赖', '依赖（它完成我才能领）'], ['派生', '派生（我派生它）'], ['取代', '取代（替代它）'], ['来源', '来源（我来自它）']].map(function (pair) {
                    return h('option', { key: 'kind-' + pair[0], value: pair[0] }, pair[1]);
                  }),
                ),
                h(
                  'select',
                  {
                    value: link.to,
                    onChange: function (event) {
                      updateLink(index, { to: event.target.value });
                    },
                    style: Object.assign({}, formInputStyle, { flex: 1 }),
                  },
                  optionsFor('（选择目标）'),
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    onClick: function () {
                      const next = links.slice();
                      next.splice(index, 1);
                      setLinks(next);
                    },
                    style: Object.assign({}, buttonBase(false), { padding: '2px 10px' }),
                  },
                  '删除',
                ),
              );
            }),
            h(
              'button',
              {
                type: 'button',
                onClick: function () {
                  setLinks(links.concat([{ label: '依赖', to: '' }]));
                },
                style: Object.assign({}, buttonBase(false), { alignSelf: 'flex-start' }),
              },
              '＋ 添加关联',
            ),
          ),
          h(
            'div',
            { style: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8, minHeight: 0, overflow: 'auto', paddingRight: 6, borderLeft: '1px solid var(--dsw-alias-border-l1)', paddingLeft: 16 } },
            template && type !== '' ? h('div', { style: lineStyle }, template.name + '：' + template.description) : null,
            type !== ''
              ? h(
                  'div',
                  { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
                  template
                    ? template.items.map(function (item, index) {
                        if (item.type === 'markdown') {
                          return h('div', { key: 'md-' + index, style: { fontSize: 11, lineHeight: 1.6, color: 'var(--dsw-alias-label-secondary)', whiteSpace: 'pre-wrap' } }, item.value || '');
                        }
                        const key = item.id || item.label || 'field-' + index;
                        const common = {
                          value: values[key] || '',
                          placeholder: item.placeholder || '',
                          onChange: function (event) {
                            const next = Object.assign({}, values);
                            next[key] = event.target.value;
                            setValues(next);
                          },
                        };
                        return h(
                          'label',
                          { key: 'f-' + key, style: { display: 'flex', flexDirection: 'column', gap: 3 } },
                          h('span', { style: { fontSize: 12, color: 'var(--dsw-alias-label-primary)' } }, (item.label || item.id) + (item.required ? ' *' : '')),
                          item.description ? h('span', { style: lineStyle }, item.description) : null,
                          item.type === 'input'
                            ? h('input', Object.assign({}, common, { style: formInputStyle }))
                            : h('textarea', Object.assign({}, common, { rows: 3, style: Object.assign({}, formInputStyle, { resize: 'vertical' }) })),
                        );
                      })
                    : h('div', { style: lineStyle }, '模板还没加载出来（检查宿主插件是否在跑）'),
                )
              : h('textarea', {
                  value: body,
                  placeholder: '正文（Markdown）——空模板，从零写',
                  onChange: function (event) {
                    setBody(event.target.value);
                  },
                  style: Object.assign({}, formInputStyle, { flex: 1, minHeight: 160, resize: 'vertical' }),
                }),
          ),
        ),
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderTop: '1px solid var(--dsw-alias-border-l1)' } },
          h('button', { type: 'button', disabled: props.busy === true, onClick: submit, style: buttonBase(true, props.busy) }, props.busy === true ? '提交中…' : '提交'),
          error || props.error ? h('span', { style: { fontSize: 11, color: 'var(--dsw-alias-state-error-primary)' } }, error || props.error) : null,
        ),
      );
    }


    function TaskBoard(props) {
      const selectedState = React.useState('');
      const selected = selectedState[0];
      const setSelected = selectedState[1];
      const dataState = React.useState({ tasks: SAMPLE_TASKS, bodies: {}, live: false, error: '' });
      const data = dataState[0];
      const setData = dataState[1];
      const busyState = React.useState(false);
      const busy = busyState[0];
      const setBusy = busyState[1];
      const actionState = React.useState({ busy: false, error: '' });
      const action = actionState[0];
      const setAction = actionState[1];
      /* 备注草稿：选中计划时初始化成它的 note，保存后回到服务端值。 */
      const noteState = React.useState({ id: '', draft: '', error: '' });
      const note = noteState[0];
      const setNote = noteState[1];
      const createState = React.useState({ open: false, busy: false, error: '' });
      const create = createState[0];
      const setCreate = createState[1];
      const editState = React.useState('');
      const editId = editState[0];
      const setEditId = editState[1];
      const editModePair = React.useState('edit');
      const editMode = editModePair[0];
      const setEditMode = editModePair[1];
      const templatesState = React.useState({});
      const templates = templatesState[0];
      const setTemplates = templatesState[1];

      const sessionId = props.sessionId;

      const load = React.useCallback(function () {
        if (typeof sessionId !== 'string' || sessionId === '') return;
        setBusy(true);
        const files = fileRpc();
        if (files === null) {
          setData({ tasks: SAMPLE_TASKS, bodies: {}, live: false, error: '没有文件 RPC（workspaceFiles），读不到计划库' });
          setBusy(false);
          return;
        }
        Promise.resolve(files.read(sessionId, STORE_FILE, { limit: 5000 }, undefined))
          .then(function (result) {
            if (!result || result.ok !== true) {
              throw new Error('读取计划库失败：' + String((result && result.error && result.error.message) || '未知错误'));
            }
            const text = result.value.text || '';
            const map = {};
            text.split(/\r?\n/u).forEach(function (line) {
              if (line.trim() === '') return;
              let event = null;
              try {
                event = JSON.parse(line);
              } catch (failure) {
                return;
              }
              if (!event) return;
              if (event.op === 'upsert' && event.task && event.task.id) {
                map[event.task.id] = event.task;
              } else if (event.op === 'patch' && event.id && map[event.id]) {
                map[event.id] = Object.assign({}, map[event.id], event.patch);
              }
            });
            const rows = Object.keys(map)
              .sort()
              .map(function (id) {
                return map[id];
              });
            const bodies = {};
            rows.forEach(function (row) {
              bodies[row.id] = row.body || '';
            });
            setData({ tasks: rows.map(fromApi), bodies: bodies, live: true, error: '' });
          })
          .catch(function (error) {
            setData({ tasks: SAMPLE_TASKS, bodies: {}, live: false, error: String((error && error.message) || error) });
          })
          .then(function () {
            setBusy(false);
          });      }, [sessionId]);
      React.useEffect(
        function () {
          load();
        },
        [load],
      );

      const runState = function (next) {
        if (!activeNodeId) return;
        setAction({ busy: true, error: '' });
        runCommand('/task-state ' + activeNodeId + ' ' + next, sessionId)
          .then(function (settled) {
            const text = commandText(settled);
            if (text.indexOf('状态改为') === -1) setAction({ busy: false, error: text || '状态没改成' });
            else setAction({ busy: false, error: '' });
            load();
          })
          .catch(function (error) {
            setAction({ busy: false, error: String((error && error.message) || error) });
          });
      };

      /** 保存备注：不受「只有未指定可改」限制，进行中的计划也能补理由。 */
      const saveNote = function (value) {
        if (!activeNodeId) return;
        setNote({ id: activeNodeId, draft: value, error: '', busy: true });
        /* /task-note 只按第一个空格切出 id，其余整段都是备注，换行可以原样保留。 */
        runCommand('/task-note ' + activeNodeId + ' ' + String(value || ''), sessionId)
          .then(function (settled) {
            const text = commandText(settled);
            let saved = null;
            try {
              saved = JSON.parse(text);
            } catch (failure) {
              saved = null;
            }
            if (saved && typeof saved.note === 'string') {
              setNote({ id: activeNodeId, draft: saved.note, error: '' });
            } else {
              setNote({ id: activeNodeId, draft: value, error: text || '备注没保存上' });
            }
            load();
          })
          .catch(function (error) {
            setNote({ id: activeNodeId, draft: value, error: String((error && error.message) || error) });
          });
      };

      const openCreate = function () {
        setEditId('');
        setCreate({ open: true, busy: false, error: '' });
        if (Object.keys(templates).length > 0) return;
        const files = fileRpc();
        if (files === null) {
          setCreate({ open: true, busy: false, error: '读不到模板：没有文件 RPC' });
          return;
        }
        /* A–F 是「这是什么活」；H1–H8 是「为什么停下来等人」（搁置模板）。 */
        const types = [
          'A',
          'B',
          'C',
          'D',
          'R',
          'F',
          'H1',
          'H2',
          'H3',
          'H4',
          'H5',
          'H6',
          'H7',
          'H8',
        ];
        Promise.all(
          types.map(function (type) {
            return Promise.resolve(files.read(sessionId, TEMPLATE_DIR + '\\' + type + '.yml', { limit: 400 }, undefined))
              .then(function (result) {
                return result && result.ok === true ? [type, result.value.text] : [type, ''];
              })
              .catch(function () {
                return [type, ''];
              });
          }),
        )
          .then(function (pairs) {
            const map = {};
            pairs.forEach(function (pair) {
              if (pair[1]) map[pair[0]] = pair[1];
            });
            setTemplates(map);
          })
          .catch(function (error) {
            setCreate({ open: true, busy: false, error: String((error && error.message) || error) });
          });
      };

      const submitCreate = function (payload) {
        setCreate({ open: true, busy: true, error: '' });
        runCommand('/task-create ' + JSON.stringify(payload), sessionId)
          .then(function (settled) {
            const text = commandText(settled);
            let id = '';
            try {
              id = JSON.parse(text).id || '';
            } catch (failure) {
              id = '';
            }
            setCreate({ open: false, busy: false, error: '' });
            load();
            if (id) setSelected(id);
          })
          .catch(function (error) {
            setCreate({ open: true, busy: false, error: String((error && error.message) || error) });
          });
      };

      const submitUpdate = function (payload) {
        if (!editId) return;
        setCreate({ open: false, busy: true, error: '' });
        const forking = editMode === 'fork';
        const line = forking
          ? '/task-create ' + JSON.stringify(Object.assign({}, payload, { status: '未指定' }))
          : '/task-update ' + JSON.stringify(Object.assign({ id: editId }, payload));
        runCommand(line, sessionId)
          .then(function (settled) {
            setEditId('');
            if (forking) {
              try {
                const created = JSON.parse(commandText(settled));
                if (created && created.id) setSelected(created.id);
              } catch (failure) {
                /* 解析不到就只刷新 */
              }
            }
            load();
          })
          .catch(function (error) {
            setCreate({ open: false, busy: false, error: String((error && error.message) || error) });
          });
      };

      const tasks = data.tasks;
      const graph = React.useMemo(
        function () {
          return buildGraph(tasks);
        },
        [tasks],
      );
      const activeNode = selected && graph.byId[selected] ? graph.byId[selected].node : null;
      const activeId = activeNode ? activeNode.id : '';
      const activeNodeId = activeId;
      const editNode = editId && graph.byId[editId] ? graph.byId[editId].node : null;
      const editInitial = editNode
        ? {
            id: editNode.id,
            title: editMode === 'fork' ? editNode.title + '（分支）' : editNode.title,
            type: editNode.typeCode || '',
            body: data.bodies[editNode.id] || '',
            parent: editNode.parent || '',
            workspace: editNode.workspace || '',
            workspaces: editNode.workspaces || '',
            permission: editNode.permission || '',
            links: (editNode.links || []).map(function (link) {
              return { label: link.label, to: link.to };
            }).concat(editMode === 'fork' ? [{ label: '取代', to: editNode.id }] : []),
          }
        : null;



      let enabledCount = 0;
      tasks.forEach(function (node) {
        if (node.on) enabledCount += 1;
      });

      const legendItem = function (key, dashed, label) {
        return h(
          'span',
          {
            key: 'legend-' + key,
            style: { display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--dsw-alias-label-secondary)' },
          },
          h(
            'svg',
            { width: 18, height: 8, style: { display: 'block' } },
            h('line', {
              x1: 0,
              y1: 4,
              x2: 18,
              y2: 4,
              stroke: dashed ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-border-l2)',
              strokeWidth: 1.5,
              strokeDasharray: dashed ? '4 3' : 'none',
            }),
          ),
          label,
        );
      };

      return h(
        'div',
        {
          style: {
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            minHeight: 0,
            flex: 1,
            /* 覆盖层（详情 / 新建 / 编辑）挂在这一层上，才能盖住上面的标题栏；
               它们需要 absolute 定位，所以这一层必须是定位祖先。 */
            position: 'relative',
          },
        },
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: 8 } },
          h('span', { style: titleStyle }, t('panel.title')),
          h(
            'span',
            { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)' } },
            t('board.count').replace('{n}', String(tasks.length)).replace('{on}', String(enabledCount)),
          ),
          data.live
            ? null
            : h(
                'span',
                {
                  style: clickableStyle({
                    fontSize: 10.5,
                    padding: '0 6px',
                    borderRadius: 999,
                    color: 'var(--dsw-alias-label-secondary)',
                  }),
                },
                '样例数据' + (data.error ? '：' + data.error : ''),
              ),
          legendItem('parent', false, '父子'),
          legendItem('link', true, '链接'),
          h('span', { style: { flex: 1 } }),
          h(
            'button',
            { type: 'button', onClick: openCreate, style: buttonBase(false) },
            '新建',
          ),
          h(
            'button',
            { type: 'button', onClick: load, style: buttonBase(false, busy), disabled: busy },
            busy ? '刷新中…' : '刷新',
          ),
        ),
        h(
          'div',
          { style: { display: 'flex', minHeight: 0, flex: 1, position: 'relative' } },
          h('div', { style: { flex: 1, minWidth: 0 } }, h(TechTree, { graph: graph, selected: selected, onSelect: setSelected })),
        ),
        editNode
          ? h(CreateForm, {
              initial: editInitial,
              title: editMode === 'fork' ? '分支计划（取代原计划）' : '编辑计划',
              plans: tasks,
              busy: create.busy,
              error: create.error,
              onCancel: function () {
                setEditId('');
              },
              onSubmit: submitUpdate,
            })
          : create.open
          ? h(CreateForm, {
              templates: templates,
              plans: tasks,
              busy: create.busy,
              error: create.error,
              onCancel: function () {
                setCreate({ open: false, busy: false, error: '' });
              },
              onSubmit: submitCreate,
            })
          : activeNode
          ? h(DetailPane, {
              node: activeNode,
              tasks: tasks,
              body: (data.bodies[activeId] || ''),
              busy: action.busy,
              error: action.error,
              onState: runState,
              onClose: function () {
                setSelected('');
              },
              onJump: setSelected,
              canEdit: activeNode.status === '未指定',
              onEdit: function () {
                setEditMode(activeNode.status === '未指定' ? 'edit' : 'fork');
                setEditId(activeNode.id);
              },
              /* 备注草稿：切到另一张计划时自动换成那张的备注。 */
              noteDraft: note.id === activeNode.id ? note.draft : activeNode.note || '',
              noteError: note.id === activeNode.id ? note.error : '',
              onNoteDraft: function (value) {
                setNote({ id: activeNode.id, draft: value, error: '' });
              },
              onSaveNote: saveNote,
            })
          : null,
      );
    }
    function buttonStyle(open, hover) {
      return clickableStyle({
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 30,
        height: 30,
        padding: 0,
        borderRadius: 9,
        background:
          open || hover ? 'var(--dsw-alias-bg-layer-2)' : 'var(--dsw-alias-bg-layer-1)',
        color: open ? 'var(--dsw-alias-label-primary)' : 'var(--dsw-alias-label-secondary)',
        cursor: 'pointer',
        font: 'inherit',
        transition: 'background 120ms ease, color 120ms ease, border-color 120ms ease, box-shadow 120ms ease',
      });
    }

    function Chevron(props) {
      const open = props.open;
      return h(
        'svg',
        {
          viewBox: '0 0 16 16',
          width: 16,
          height: 16,
          'aria-hidden': true,
          focusable: false,
          style: {
            display: 'block',
            transform: open ? 'rotate(180deg)' : 'none',
            transition: 'transform 160ms ease',
          },
        },
        h('path', {
          d: 'M3.6 10.2 L8 5.8 L12.4 10.2',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.7,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
      );
    }

    /** 面板的错误边界：渲染抛错时只显示错误，不让整个 slot entry 被卸载。 */
    class PanelBoundary extends React.Component {
      constructor(props) {
        super(props);
        this.state = { error: '' };
      }

      static getDerivedStateFromError(error) {
        return { error: String((error && error.message) || error) };
      }

      render() {
        if (this.state.error !== '') {
          return h(
            'div',
            {
              style: {
                padding: '10px 12px',
                fontSize: 12,
                lineHeight: 1.6,
                color: 'var(--dsw-alias-state-error-primary)',
              },
            },
            '面板渲染出错：' + this.state.error,
          );
        }
        return this.props.children;
      }
    }
    function ComposerDrawer(props) {
      const state = React.useState(false);
      const open = state[0];
      const setOpen = state[1];
      const hoverPair = React.useState(false);
      const hover = hoverPair[0];
      const setHover = hoverPair[1];

      useLocaleRevision();

      const toggle = React.useCallback(function () {
        setOpen(function (current) {
          return !current;
        });
      }, [setOpen]);

      const label = open ? t('button.collapse') : t('button.expand');

      const panel = open
        ? h(
            'section',
            {
              key: 'panel',
              id: PANEL_ID,
              role: 'region',
              'aria-label': t('panel.title'),
              style: panelStyle,
            },
            h(PanelBoundary, null, h(TaskBoard, { sessionId: props.sessionId })),
          )
        : null;

      const button = h(
        'button',
        {
          key: 'button',
          type: 'button',
          onClick: toggle,
          onMouseEnter: function () {
            setHover(true);
          },
          onMouseLeave: function () {
            setHover(false);
          },
          'aria-expanded': open,
          'aria-controls': PANEL_ID,
          'aria-label': label,
          style: buttonStyle(open, hover),
        },
        h(Chevron, { open: open }),
      );

      return h('div', { style: wrapperStyle }, panel, h('div', { style: buttonSlotStyle }, button));
    }

    return {
      inject: ['slots', 'remote', 'remote.commands', 'remote.workspaceFiles'],
      apply(ctx) {
        pluginRuntime = ctx;
        try {
          localeFace = typeof ctx.get === 'function' ? ctx.get('locale') : null;
        } catch (failure) {
          localeFace = null;
        }

        if (
          localeFace &&
          typeof localeFace.register === 'function' &&
          typeof localeFace.bind === 'function'
        ) {
          try {
            ctx.effect(function () {
              return localeFace.register(NS, 'en', EN);
            });
            ctx.effect(function () {
              return localeFace.register(NS, 'zh', ZH);
            });
            translate = localeFace.bind(NS);
          } catch (failure) {
            translate = null;
          }
        }

        ctx.effect(function () {
          return function () {
            translate = null;
            localeFace = null;
          };
        });

        ctx.slots.inject('conversation.input.dock', function () {
          return ctx.slots.register(
            {
              name: 'conversation.input.dock',
              id: 'composer-drawer',
              /* Last row of the dock: rows above it (todo / goal / queue) then
                 grow upward without pushing the button off the card's corner. */
              order: 999,
            },
            ComposerDrawer,
          );
        });
      },
    };
  },
});
