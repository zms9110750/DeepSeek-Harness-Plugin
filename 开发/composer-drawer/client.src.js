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

    /* 注：早期这里有个 DEFAULT_COLLAPSED（默认折叠二级以下），但 TechTree
       从来没读过它，等于死代码。T-020 换成「视图切换 + 组过滤 + 搜索」
       之后彻底删掉——折叠这件事交给按组过滤做，不需要每个节点自己记状态。 */

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

    /**
     * 计划库与模板的路径。
     *
     * ⚠️ 这里连踩两次坑，写死教训：
     *
     * 第一次：把「读文件」换成「走命令通道」+ 5 秒轮询 → 每秒 21 条系统消息刷屏。
     *
     * 第二次：加了 `/task-paths` 命令去问宿主路径，但**Host 侧插件不重载就不会有
     * 这条命令**（客户端是页面级加载、刷新即生效，Host 不是）。于是每次开面板
     * `/task-paths` 都失败 → 走兜底 → 兜底又是 1 + 52 条 `/task-get` → 再次刷屏。
     *
     * 所以现在的规矩是：**面板一个命令都不主动发**。
     *   1. 先用宿主给的路径（如果宿主已重载、`/task-paths` 存在，最多只问一次）
     *   2. 问不到就用下面这几个兜底路径直接读文件
     *
     * 另外记一条常被搞错的前提（用户明确指出）：
     * **沙箱只管「工具调用」，不管工具内部的实现；而且 Windows 上本来就没有沙箱机制。**
     * 所以「工作区外的文件读不到」这个担心从一开始就不成立 —— workspaceFiles RPC
     * 跑在宿主进程里，读 `~/.dsh/**` 和读工作区内的文件没有任何区别。
     * 以前正是这个错误前提，才促使我把读文件换成了走命令通道，进而刷屏。
     */
    /**
     * 计算计划库与模板的路径 —— **一条命令都不发**。
     *
     * 之前这里会跑 `/task-paths` 命令问宿主。现在去掉，原因：
     * 沙箱只管工具调用，不管工具内部实现；Windows 也没有沙箱机制。
     * 所以面板（跑在宿主进程里的客户端半边）读 `~/.dsh/**` 毫无障碍，
     * 根本不需要为了"绕过限制"去问宿主，更不需要发命令。
     *
     * 路径按宿主的同一套规则推导（`dsh-home-paths`）：
     *   显式配置 > $DSH_HOME > ~/.dsh
     */
    let PATHS = null;

    /** 推导用户主目录：优先宿主给的 cwd 里的盘符，否则用已知环境。 */
    function guessHomeDirs() {
      const homes = [];
      /* Electron 渲染进程里通常有这些全局量。 */
      try {
        if (typeof window !== 'undefined' && window.__DSH_BOOT__) {
          const boot = window.__DSH_BOOT__;
          if (boot && typeof boot.dshHome === 'string' && boot.dshHome !== '') homes.push(boot.dshHome);
        }
      } catch (failure) {
        /* 没有就算了 */
      }
      /* 本机常见位置兜底。 */
      homes.push('C:\\Users\\16229\\.dsh');
      return homes;
    }

    function templateDirCandidates() {
      return ['X:\\temp\\dsh\\开发\\taskboard\\templates'];
    }

    /** 初始化路径：纯本地推导，不发任何命令。 */
    async function ensurePaths() {
      if (PATHS !== null) return PATHS;
      const home = guessHomeDirs()[0] || 'C:\\Users\\16229\\.dsh';
      PATHS = {
        store: home + '\\taskboard\\plans.jsonl',
        templates: templateDirCandidates()[0] || '',
      };
      return PATHS;
    }

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
    /**
     * 类型 → 显示名。**不再自己维护**（T-021 的教训：面板不该硬编码宿主的语义）。
     *
     * 以前这里写死了 A–F + H1–H8，宿主改成四类别 + 双字母编号后全部失效。
     * 现在：四类别名来自宿主的 kind 字段，模板名来自 /task-templates 返回的 YAML。
     * 这个表只留作**旧数据兜底**（宿主没给 kind 时）。
     */
    const KIND_LABELS = {
      goal: '目标',
      design: '设计',
      record: '记录',
      work: '工作',
    };
    /** 旧单字母 type 的兜底名（只有老数据会走到）。 */
    const LEGACY_TYPE_LABELS = {
      A: '问题',
      B: '设计',
      C: '接口',
      D: '实现',
      R: '研究',
      F: '复盘',
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
        /* 原始类型码：编辑时回填表单要用它。宿主的 /tasks 已经归一成双字母编号。 */
        typeCode: type,
        title: row.title || row.id,
        /* kind 优先用宿主给的（四类别模型）；没有才按旧 type 兜底。 */
        kindKey: String(row.kind || '').trim(),
        kind:
          KIND_LABELS[String(row.kind || '').trim()] ||
          LEGACY_TYPE_LABELS[type] ||
          type ||
          '事项',
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

    /**
     * 列表视图（T-020）。
     *
     * 计划一多，树就没法看：没有边的节点会被 dagre 一字排开，
     * 30 张要滚 3 屏。列表视图按组分区、一行一张，密度高得多，
     * 而且在这里做「未读/待办」标记最容易读。
     */
    function TaskList(props) {
      const tasks = props.tasks;
      const byGroup = [
        { id: '进行', label: '进行' },
        { id: '搁置', label: '搁置' },
        { id: '完成', label: '完成' },
        { id: '', label: '草稿' },
      ];
      const bucket = function (node) {
        if (node.status === '未指定') return '';
        const groups = groupsOf(node.status);
        /* 同时属于「进行」和「搁置」的，优先归「搁置」——用户更关心在等他的。 */
        if (groups.indexOf('搁置') !== -1) return '搁置';
        if (groups.indexOf('进行') !== -1) return '进行';
        return '完成';
      };

      return h(
        'div',
        { style: { height: 336, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 10, paddingRight: 4 } },
        byGroup.map(function (group) {
          const rows = tasks.filter(function (node) {
            return bucket(node) === group.id;
          });
          if (rows.length === 0) return null;
          return h(
            'div',
            { key: 'grp-' + (group.id || 'draft'), style: { display: 'flex', flexDirection: 'column', gap: 4 } },
            h(
              'div',
              {
                style: {
                  fontSize: 11,
                  fontWeight: 600,
                  color: 'var(--dsw-alias-label-secondary)',
                  paddingBottom: 2,
                  borderBottom: '1px solid var(--dsw-alias-border-l1)',
                },
              },
              group.label + '（' + rows.length + '）',
            ),
            rows.map(function (node) {
              return h(
                'div',
                {
                  key: 'row-' + node.id,
                  onClick: function () {
                    props.onSelect(node.id);
                  },
                  style: clickableStyle({
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '5px 8px',
                    borderRadius: 8,
                    cursor: 'pointer',
                    background:
                      props.selected === node.id ? 'var(--dsw-alias-bg-layer-2)' : 'var(--dsw-alias-bg-layer-1)',
                    border:
                      '3px solid ' +
                      (props.selected === node.id ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-border-l2)'),
                  }),
                },
                h('span', { style: idChipStyle }, node.id),
                h('span', { style: kindChipStyle }, node.kind),
                h(
                  'span',
                  {
                    style: {
                      flex: 1,
                      minWidth: 0,
                      fontSize: 12,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      color: 'var(--dsw-alias-label-primary)',
                    },
                  },
                  node.title,
                ),
                h(
                  'span',
                  { style: { fontSize: 11, flex: 'none', color: statusTone(node.status) } },
                  node.status + ' · ' + groupLabel(node.status),
                ),
              );
            }),
          );
        }),
        tasks.length === 0
          ? h('div', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)' } }, '没有符合条件的事项。')
          : null,
      );
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
              ? h(
                  'div',
                  { style: { marginTop: 10, color: 'var(--dsw-alias-label-primary)' } },
                  renderMarkdown(props.body),
                )
              : null,
          ),
        ),
        section(
          '历史',
          props.history && props.history.length > 0
            ? h(
                'div',
                { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
                props.history
                  .slice()
                  .reverse()
                  .map(function (entry, index) {
                    const when = entry.ts ? entry.ts.replace('T', ' ').replace(/\..*$/u, '') : '—';
                    const who = entry.actor || '—';
                    const move = entry.from && entry.to ? entry.from + ' → ' + entry.to : '状态=' + entry.status;
                    return h(
                      'div',
                      {
                        key: 'hist-' + index,
                        style: {
                          display: 'flex',
                          gap: 8,
                          fontSize: 11,
                          lineHeight: '18px',
                          color: 'var(--dsw-alias-label-secondary)',
                          borderLeft: '2px solid var(--dsw-alias-border-l1)',
                          paddingLeft: 8,
                        },
                      },
                      h('span', { style: { flex: 'none', width: 128 } }, when),
                      h('span', { style: { flex: 'none', width: 90, overflow: 'hidden', textOverflow: 'ellipsis' } }, who),
                      h('span', { style: { color: 'var(--dsw-alias-label-primary)' } }, move),
                    );
                  }),
              )
            : h('div', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)' } }, '没有可读的历史事件。'),
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
    /**
     * 极简 Markdown 渲染器（**零依赖**）。
     *
     * 为什么自己写而不装 marked / markdown-it：
     *   · 这个插件是 link 进 profile 的，多一个依赖就多一次"装不上"的风险；
     *   · 只需要渲染**事项正文**这一种场景，不需要完整 CommonMark；
     *   · 不用 dangerouslySetInnerHTML —— 全部走 React 元素，天然免疫 XSS。
     *
     * 支持的语法（够用就行，不追求完整）：
     *   # 标题（1–4 级）、- / * / 1. 列表、> 引用、**粗体**、`行内代码`、
     *   ```代码块```、--- 分隔线、| 表格 |、[链接](url)
     *
     * 不支持：嵌套列表、HTML 内联、脚注、任务列表。遇到不认识的原样显示。
     */
    function renderInline(text, keyPrefix) {
      /* 行内元素：粗体、行内代码、链接。逐个切，不做嵌套。 */
      const out = [];
      const pattern = /(\*\*[^*]+\*\*)|(`[^`]+`)|(\[[^\]]+\]\([^)]+\))/gu;
      let last = 0;
      let match;
      let index = 0;
      while ((match = pattern.exec(text)) !== null) {
        if (match.index > last) out.push(text.slice(last, match.index));
        const token = match[0];
        const key = keyPrefix + '-i' + index;
        index += 1;
        if (token.startsWith('**')) {
          out.push(h('strong', { key, style: { color: 'var(--dsw-alias-label-primary)' } }, token.slice(2, -2)));
        } else if (token.startsWith('`')) {
          out.push(
            h(
              'code',
              {
                key,
                style: {
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  fontSize: 12,
                  padding: '1px 4px',
                  borderRadius: 4,
                  background: 'var(--dsw-alias-bg-layer-2)',
                },
              },
              token.slice(1, -1),
            ),
          );
        } else {
          const linkMatch = /^\[([^\]]+)\]\(([^)]+)\)$/u.exec(token);
          out.push(
            h(
              'a',
              {
                key,
                href: linkMatch ? linkMatch[2] : '#',
                target: '_blank',
                rel: 'noreferrer',
                style: { color: 'var(--dsw-alias-brand-primary)', textDecoration: 'underline' },
              },
              linkMatch ? linkMatch[1] : token,
            ),
          );
        }
        last = match.index + token.length;
      }
      if (last < text.length) out.push(text.slice(last));
      return out;
    }

    function renderMarkdown(source) {
      const lines = String(source || '').split(/\r?\n/u);
      const blocks = [];
      let index = 0;

      const flushParagraph = function (buffer, key) {
        if (buffer.length === 0) return;
        blocks.push(
          h(
            'p',
            { key: 'p-' + key, style: { margin: '0 0 8px', lineHeight: 1.75 } },
            renderInline(buffer.join(' '), 'p' + key),
          ),
        );
        buffer.length = 0;
      };

      let paragraph = [];
      while (index < lines.length) {
        const line = lines[index];
        const trimmed = line.trim();

        /* 空行：结束当前段落 */
        if (trimmed === '') {
          flushParagraph(paragraph, index);
          index += 1;
          continue;
        }

        /* 代码块 ``` */
        if (trimmed.startsWith('```')) {
          flushParagraph(paragraph, index);
          const body = [];
          index += 1;
          while (index < lines.length && !lines[index].trim().startsWith('```')) {
            body.push(lines[index]);
            index += 1;
          }
          index += 1;
          blocks.push(
            h(
              'pre',
              {
                key: 'code-' + index,
                style: {
                  margin: '0 0 10px',
                  padding: '8px 10px',
                  borderRadius: 8,
                  background: 'var(--dsw-alias-bg-layer-2)',
                  overflow: 'auto',
                  fontSize: 12,
                  lineHeight: 1.6,
                },
              },
              h('code', { style: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' } }, body.join('\n')),
            ),
          );
          continue;
        }

        /* 标题 # */
        const heading = /^(#{1,4})\s+(.*)$/u.exec(trimmed);
        if (heading !== null) {
          flushParagraph(paragraph, index);
          const level = heading[1].length;
          const size = [15, 14, 13, 13][level - 1];
          blocks.push(
            h(
              'div',
              {
                key: 'h-' + index,
                style: {
                  fontSize: size,
                  fontWeight: 600,
                  margin: index === 0 ? '0 0 8px' : '14px 0 6px',
                  color: 'var(--dsw-alias-label-primary)',
                },
              },
              renderInline(heading[2], 'h' + index),
            ),
          );
          index += 1;
          continue;
        }

        /* 分隔线 */
        if (/^(-{3,}|\*{3,}|_{3,})$/u.test(trimmed)) {
          flushParagraph(paragraph, index);
          blocks.push(
            h('div', {
              key: 'hr-' + index,
              style: { margin: '10px 0', borderTop: '1px solid var(--dsw-alias-border-l1)' },
            }),
          );
          index += 1;
          continue;
        }

        /* 引用 > */
        if (trimmed.startsWith('>')) {
          flushParagraph(paragraph, index);
          const quoted = [];
          while (index < lines.length && lines[index].trim().startsWith('>')) {
            quoted.push(lines[index].trim().replace(/^>\s?/u, ''));
            index += 1;
          }
          blocks.push(
            h(
              'div',
              {
                key: 'q-' + index,
                style: {
                  margin: '0 0 10px',
                  paddingLeft: 10,
                  borderLeft: '2px solid var(--dsw-alias-border-l1)',
                  color: 'var(--dsw-alias-label-secondary)',
                  lineHeight: 1.7,
                },
              },
              renderInline(quoted.join(' '), 'q' + index),
            ),
          );
          continue;
        }

        /* 表格：|---| 那种 */
        if (trimmed.startsWith('|') && index + 1 < lines.length && /^\|[\s:|-]+\|$/u.test(lines[index + 1].trim())) {
          flushParagraph(paragraph, index);
          const cellsOf = function (row) {
            return row
              .trim()
              .replace(/^\|/u, '')
              .replace(/\|$/u, '')
              .split('|')
              .map(function (cell) {
                return cell.trim();
              });
          };
          const header = cellsOf(lines[index]);
          index += 2;
          const rows = [];
          while (index < lines.length && lines[index].trim().startsWith('|')) {
            rows.push(cellsOf(lines[index]));
            index += 1;
          }
          blocks.push(
            h(
              'div',
              { key: 'tbl-' + index, style: { overflow: 'auto', margin: '0 0 10px' } },
              h(
                'table',
                { style: { borderCollapse: 'collapse', fontSize: 12, width: '100%' } },
                h(
                  'thead',
                  null,
                  h(
                    'tr',
                    null,
                    header.map(function (cell, cellIndex) {
                      return h(
                        'th',
                        {
                          key: 'th-' + cellIndex,
                          style: {
                            textAlign: 'left',
                            padding: '4px 8px',
                            borderBottom: '1px solid var(--dsw-alias-border-l1)',
                            fontWeight: 600,
                            color: 'var(--dsw-alias-label-primary)',
                            whiteSpace: 'nowrap',
                          },
                        },
                        renderInline(cell, 'th' + cellIndex),
                      );
                    }),
                  ),
                ),
                h(
                  'tbody',
                  null,
                  rows.map(function (row, rowIndex) {
                    return h(
                      'tr',
                      { key: 'tr-' + rowIndex },
                      row.map(function (cell, cellIndex) {
                        return h(
                          'td',
                          {
                            key: 'td-' + cellIndex,
                            style: {
                              padding: '4px 8px',
                              borderBottom: '1px solid var(--dsw-alias-border-l2)',
                              verticalAlign: 'top',
                            },
                          },
                          renderInline(cell, 'td' + rowIndex + '-' + cellIndex),
                        );
                      }),
                    );
                  }),
                ),
              ),
            ),
          );
          continue;
        }

        /* 列表：- * 1. */
        if (/^([-*]|\d+\.)\s+/u.test(trimmed)) {
          flushParagraph(paragraph, index);
          const items = [];
          const ordered = /^\d+\./u.test(trimmed);
          while (index < lines.length && /^([-*]|\d+\.)\s+/u.test(lines[index].trim())) {
            items.push(lines[index].trim().replace(/^([-*]|\d+\.)\s+/u, ''));
            index += 1;
          }
          blocks.push(
            h(
              ordered ? 'ol' : 'ul',
              {
                key: 'list-' + index,
                style: { margin: '0 0 10px', paddingLeft: 20, lineHeight: 1.75 },
              },
              items.map(function (item, itemIndex) {
                return h('li', { key: 'li-' + itemIndex }, renderInline(item, 'li' + itemIndex));
              }),
            ),
          );
          continue;
        }

        paragraph.push(trimmed);
        index += 1;
      }
      flushParagraph(paragraph, lines.length);
      return blocks;
    }

    /**
     * 从模板 YAML 里抠出「编号 / 名称」，给下拉用。
     *
     * ⚠️ 名称里**不再拼编号**：模板的 `name` 本身已经是 `GD · 实现` 这种形式，
     * 再拼一次就成了 `GD · GD · 实现`（用户截图里就是这个毛病）。
     * 这里只取 `·` 后面的部分，编号由调用方决定怎么显示。
     */
    function templateLabelSet(templates) {
      const out = [];
      const seen = Object.create(null);
      Object.keys(templates || {}).forEach(function (type) {
        const yaml = String(templates[type] || '');
        const match = /^name:\s*(.+)$/mu.exec(yaml);
        let label = match ? match[1].trim() : '';
        /* 去掉已有的 `XX · ` 前缀，只留中文名。 */
        label = label.replace(/^[A-Z]{1,2}\s*[·・.]\s*/u, '').trim();
        if (label === '') label = type;
        if (seen[type]) return;
        seen[type] = true;
        out.push([type, label]);
      });
      out.sort(function (left, right) {
        return left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0;
      });
      return out;
    }

    /** 模板 YAML 里声明的大类。 */
    function kindOfTemplate(yaml) {
      const match = /^(?:default_)?kind:\s*(\w+)$/mu.exec(String(yaml || ''));
      return match ? match[1] : '';
    }

    /** 模板 YAML 里声明的领域；没写按 general。 */
    function templateDomain(yaml) {
      const match = /^domain:\s*(\w+)$/mu.exec(String(yaml || ''));
      return match ? match[1] : 'general';
    }

    /**
     * 这个模板要不要分槽位（每个章节一个输入框）。
     *
     * `framed: false` 的是**用户自己写的那种**（`GU 用户任务`）——
     * 用户想到什么写什么，加框架等于逼他先学我们的分类法。
     *
     * 其余 `framed: true`：多半是 AI 写的，需要条条框框才写得稳，
     * 每节的 description 就是**教 LLM 怎么分析的提示词**。
     *
     * ⚠️ **字段缺失时按 false 处理**（不分槽位，退回单个正文框）。
     *
     * 这是刻意选的方向，不是随便定的：
     *   · 缺失默认 true → 一个本想"空白框"的模板会被渲染成十几个槽位，
     *     语义**静默反转**，而且不报错（这个坑真踩过：27 个模板全部缺 framed，
     *     于是 `GU 用户任务` 差点被拆成十几个框）。
     *   · 缺失默认 false → 最多是"该分槽位的模板没分"，用户看到一个大框，
     *     内容不会丢，也不会误导。
     *
     * 宁可少分，不可错分。
     */
    function isFramed(yaml) {
      const match = /^framed:\s*(\w+)$/mu.exec(String(yaml || ''));
      if (match) return match[1] !== 'false';
      return false;
    }

    /**
     * 把模板章节拼成 Markdown 骨架，**每节带上提示语**。
     *
     * 提示语用引用块跟在标题下面：
     *   · LLM 读到就知道这一节该分析什么
     *   · 人也能直接看到，不用去翻模板文件
     */
    function skeletonOf(yaml) {
      const parsed = parseTemplateYaml(String(yaml || ''));
      if (!parsed || !Array.isArray(parsed.items)) return '';
      const blocks = [];
      parsed.items.forEach(function (item) {
        if (item.type === 'markdown') return;
        const label = item.label || item.id || '';
        if (label === '') return;
        const hint = String(item.description || '')
          .split(/\r?\n/u)
          .map(function (line) {
            return line.trim();
          })
          .filter(function (line) {
            return line !== '';
          })
          .join('\n> ');
        blocks.push('## ' + label + (hint ? '\n\n> ' + hint + '\n' : '\n'));
      });
      return blocks.join('\n');
    }

    /**
     * 领域选项。这是**固定枚举**，不是自由标签（用户明确：不做 tag）。
     *
     * 作用只有一个：筛选模板下拉。用户原话——
     * 「我写程序的时候不想看到小说的模板。」
     */
    const DOMAIN_OPTIONS = [
      ['code', '代码'],
      ['art', '绘画'],
      ['writing', '写作'],
      ['general', '通用'],
      ['', '全部领域'],
    ];

    /** 上次选的领域记在内存里（刷新页面就重置，够用）。 */
    let REMEMBERED_DOMAIN = 'code';
    function rememberDomain(value) {
      REMEMBERED_DOMAIN = value;
    }

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
      /* 新建时默认「MG · 用户任务」——用户原话：
         「让他常态下默认在"用户任务"，而不是默认用空模板页面。
          虽然架构长得一样。但是用户任务以后可能要放行为。」

         编辑时用事项本身的 type。 */
      const initialType = typeof init.type === 'string' && init.type !== '' ? init.type : 'GU';
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
      /* 大类（kind）：四类别模型的核心字段，决定"谁能标完成"。
         不选时跟模板推断（宿主会按 type 推），但用户能显式改——
         例如把一张工作升级成目标。
         **默认是目标**（用户要求）。 */
      const kindState = React.useState(init.kind === undefined ? 'goal' : init.kind);
      const kind = kindState[0];
      const setKind = kindState[1];
      /* 领域（domain）：只用来筛模板，不影响已存在的事项。沿用上次选的。 */
      const domainState = React.useState(init.domain || REMEMBERED_DOMAIN || 'code');
      const domain = domainState[0];
      const setDomain = domainState[1];
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
      /* T-035 兜底：选了类型但模板没加载出来（例如只读档下读不到模板文件），
         且这张计划本来有正文 → 退回纯文本编辑，并把原因说出来。
         以前这种情况是静默失败：字段一个都不显示，也不知道为什么。 */
      const templateMissing = type !== '' && template === null;
      const fallbackToPlainText = templateMissing && String(init.body || '').trim() !== '';

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
        /* **有框架的模板：每个槽位一个框，提交时按 `## 标题` 拼起来。**
         *
         * 口径（用户纠正过两次）：
         *   · `framed: false`（MG 用户任务）→ 一个空白正文框，用户想到什么写什么
         *   · `framed: true`   → 分槽位，每个槽位一个输入框，
         *     提示语是**输入框里的灰字占位符**，不是写进正文的内容
         *
         * 也就是说：模板决定"有几个格子"，
         * 格子的提示语决定"这一格该写什么"，
         * 而**正文本身永远是用户打出来的字**，不含任何注入的骨架。
         */
        if (isFramed(templates[type]) && fields.length > 0) {
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
          text = parts.length > 0 ? parts.join('\n\n') : body;
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
          /* 空串 = 让宿主按模板推断；非空则显式指定大类。 */
          kind: kind,
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
            /* 标题独占一行（用户要求）。 */
            h('input', {
              value: title,
              placeholder: '标题（一句话）',
              onChange: function (event) {
                setTitle(event.target.value);
              },
              style: Object.assign({}, formInputStyle, { width: '100%', flex: 'none' }),
            }),
            h(
              'div',
              { style: { display: 'flex', gap: 8 } },
              /* 领域在**最左**：它是筛选器，先排除"我现在不想看到的东西"。
                 用户原话：「左边再放一个领域。作为筛选。我写程序的时候不想看到小说的模板。」
                 领域记在内存里，下次打开沿用上次选的。 */
              h(
                'select',
                {
                  value: domain,
                  onChange: function (event) {
                    const next = event.target.value;
                    setDomain(next);
                    rememberDomain(next);
                    /* 换领域后当前模板可能不在新领域里 → 清空。 */
                    if (type !== '' && templateDomain(templates[type]) !== next) setType('');
                  },
                  title: '领域：只影响模板下拉显示什么，不影响已存在的事项',
                  style: Object.assign({}, formInputStyle, { width: 96, flex: 'none' }),
                },
                DOMAIN_OPTIONS.map(function (pair) {
                  return h('option', { key: 'domain-' + pair[0], value: pair[0] }, pair[1]);
                }),
              ),
              /* 大类：先决定"这是哪一类"，模板列表跟着被筛。
                 用户原话：「大类在左边，而且大类是筛选。大类下拉框在目标的时候只能显示类别为目标的模板。」

                 模板编号是 `大类前缀 + 模板字母`（MG / SQ / JB / GR…），
                 所以按首字母就能筛，不用额外查表。 */
              h(
                'select',
                {
                  value: kind,
                  onChange: function (event) {
                    const next = event.target.value;
                    setKind(next);
                    /* 换了大类，当前模板可能不合法 → 清空，让用户重选。
                       留着会让人以为选上了，实际提交时被宿主按新 kind 覆盖。 */
                    if (type !== '' && next !== '') {
                      /* 大类前缀是**英文首字母**：Goal/Design/Record/Work。 */
                      const prefix = { goal: 'G', design: 'D', record: 'R', work: 'W' }[next];
                      if (prefix && type.charAt(0) !== prefix) setType('');
                    }
                  },
                  title: '大类决定谁能标完成：目标由子事项推导、设计等你点头、记录写完即完、工作由 AI 做出来',
                  style: Object.assign({}, formInputStyle, { width: 104, flex: 'none' }),
                },
                [['', '全部大类']].concat(
                  Object.keys(KIND_LABELS).map(function (key) {
                    return [key, KIND_LABELS[key]];
                  }),
                ).map(function (pair) {
                  return h(
                    'option',
                    { key: 'kind-' + (pair[0] || 'all'), value: pair[0] },
                    pair[0] === '' ? pair[1] : pair[0] + ' · ' + pair[1],
                  );
                }),
              ),
              /* 模板：只列「所选大类」下的。大类为空时列全部。 */
              h(
                'select',
                {
                  value: type,
                  onChange: function (event) {
                    const next = event.target.value;
                    setType(next);
                    if (next === '') return;
                    /* 选了模板就同步大类（模板自带 kind），避免两处不一致。
                       不再往正文里注入骨架：有框架的模板是**分槽位输入**，
                       正文只放用户自己打的字。 */
                    const declared = kindOfTemplate(templates[next]);
                    if (declared !== '') setKind(declared);
                  },
                  style: Object.assign({}, formInputStyle, { flex: 1, minWidth: 0 }),
                },
                [['', '空模板']]
                  .concat(
                    templateLabelSet(templates).filter(function (pair) {
                      /* 领域先筛，再按大类筛。
                       *
                       * ⚠️ `general` 的模板**在任何领域下都显示**。
                       * 之前是严格相等，结果「代码 + 目标」筛出 0 个模板——
                       * 因为目标类四个模板分别是 general/general/art/writing，
                       * 没有一个是 code。用户看到的就是只有「空模板」。
                       *
                       * 语义上 general 就是"不分领域，谁都能用"，不该被筛掉。 */
                      const own = templateDomain(templates[pair[0]]);
                      if (domain !== '' && own !== domain && own !== 'general') return false;
                      if (kind === '') return true;
                      return kindOfTemplate(templates[pair[0]]) === kind;
                    }),
                  )
                  .map(function (pair) {
                    return h(
                      'option',
                      { key: 'type-' + (pair[0] || 'blank'), value: pair[0] },
                      /* 不重复拼编号：模板名已去掉前缀，这里补上编号一次。 */
                      pair[0] === '' ? pair[1] : pair[0] + ' · ' + pair[1],
                    );
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
            /* 模板的一句话说明留在顶部：让人知道"这一类该写什么"，但不占输入框。 */
            template && type !== '' ? h('div', { style: lineStyle }, template.name + '：' + template.description) : null,
            /* **两种形态**（用户两次纠正后的最终口径）：
             *
             *   `framed: false`（MG 用户任务）→ 一个空白正文框。
             *     用户想到什么写什么，加框架等于逼他先学我们的分类法。
             *
             *   `framed: true` → **每个槽位一个输入框**，写死的那种。
             *     提示语放在**输入框的 placeholder**（没字时的灰字），
             *     不是写进正文。正文只放用户自己打的字。
             */
            isFramed(templates[type]) && fields.length > 0
              ? h(
                  'div',
                  { style: { display: 'flex', flexDirection: 'column', gap: 10, flex: 1, minHeight: 0, overflow: 'auto' } },
                  fields.map(function (item, index) {
                    const key = item.id || item.label || 'field-' + index;
                    /* 占位符 = 模板的提示语（description），压成一行。 */
                    const hint = String(item.description || '')
                      .split(/\r?\n/u)
                      .map(function (line) {
                        return line.trim();
                      })
                      .filter(function (line) {
                        return line !== '';
                      })
                      .join(' ');
                    return h(
                      'label',
                      { key: 'f-' + key, style: { display: 'flex', flexDirection: 'column', gap: 3 } },
                      h(
                        'span',
                        { style: { fontSize: 12, color: 'var(--dsw-alias-label-primary)' } },
                        (item.label || item.id) + (item.required ? ' *' : ''),
                      ),
                      item.type === 'input'
                        ? h('input', {
                            value: values[key] || '',
                            placeholder: hint,
                            onChange: function (event) {
                              const next = Object.assign({}, values);
                              next[key] = event.target.value;
                              setValues(next);
                            },
                            style: formInputStyle,
                          })
                        : h('textarea', {
                            value: values[key] || '',
                            placeholder: hint,
                            rows: item.id === 'other' ? 2 : 3,
                            onChange: function (event) {
                              const next = Object.assign({}, values);
                              next[key] = event.target.value;
                              setValues(next);
                            },
                            style: Object.assign({}, formInputStyle, { resize: 'vertical' }),
                          }),
                    );
                  }),
                )
              : h('textarea', {
                  value: body,
                  placeholder:
                    type === ''
                      ? '正文（Markdown）——空模板，从零写'
                      : '正文（Markdown）——想到什么写什么',
                  onChange: function (event) {
                    setBody(event.target.value);
                  },
                  style: Object.assign({}, formInputStyle, { flex: 1, minHeight: 200, resize: 'vertical' }),
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
      /* 事件历史（T-019）：选中计划时拉一次，只读。 */
      const historyState = React.useState({ id: '', entries: [] });
      const historyInfo = historyState[0];
      const setHistoryInfo = historyState[1];
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

      /**
       * 【已删除】loadViaCommands
       *
       * 这里曾经有一个「文件读不到就改走命令通道」的兜底。删掉它，因为它
       * 两次把界面刷屏了：
       *
       *   第一次：命令通道 + 5 秒轮询 → 每秒 21 条系统消息。
       *   第二次：加了 /task-paths 问宿主路径，但 Host 侧插件必须重载才有这条命令
       *          （客户端是页面级加载，刷新页面就生效，Host 不是）。于是每次开面板
       *          /task-paths 都 404 → 走兜底 → 兜底是 1 条 /tasks + 52 条 /task-get
       *          → 一打开面板就刷屏。
       *
       * 根本原因是：**宿主对每条命令都写 command/run + command/done 两条会话事件**，
       * 而且不进 turn、直接渲染成对话流里的系统消息（见 dsh-commands
       * appendLifecycle，注释原文 "direct log-only appends — no turn wraps them"）。
       *
       * 所以规矩定死：**面板永远不主动发命令读数据**。
       * 读文件用 workspaceFiles RPC，它只读、不写会话日志。
       */

      /** 兜底：直接读 JSONL（路径来自 /task-paths，不硬编码）。 */
      const loadViaFiles = function (paths) {
        const files = fileRpc();
        if (files === null) throw new Error('没有文件 RPC（workspaceFiles）');
        return Promise.resolve(files.read(sessionId, paths.store, { limit: 5000 }, undefined)).then(function (result) {
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
          return { rows: rows, bodies: bodies };
        });
      };

      const load = React.useCallback(function () {
        if (typeof sessionId !== 'string' || sessionId === '') return;
        setBusy(true);
        /* **只读文件**。命令通道已彻底从读取路径上移除：
         * 宿主对每条命令写两条会话事件并渲染成系统消息，一开面板就刷屏。
         * 文件读不到就如实报错，不再"换条路试试"——那条路是灾难。 */
        ensurePaths()
          .then(function (paths) {
            return loadViaFiles(paths);
          })
          .then(function (result) {
            setData({ tasks: result.rows.map(fromApi), bodies: result.bodies, live: true, error: '' });
          })
          .catch(function (error) {
            /* 不再静默降级成样例数据冒充真数据：说清楚读不到，并保留样例做视觉占位。 */
            setData({
              tasks: SAMPLE_TASKS,
              bodies: {},
              live: false,
              error: '读不到计划库：' + String((error && error.message) || error) + '（下面显示的是样例数据）',
            });
          })
          .then(function () {
            setBusy(false);
          });
      }, [sessionId]);
      React.useEffect(
        function () {
          load();
        },
        [load],
      );
      /* 自动轮询已移除。
       *
       * 原来这里每 5 秒调一次 load()。配上「命令通道读数据」后，每次刷新要发
       * 53 条命令（1 次 /tasks + 每张一次 /task-get），而宿主对每条命令写两条
       * 会话事件且会渲染成系统消息 —— 界面被刷屏。
       *
       * 现在文件优先、不写日志，轮询本身无害，但仍然是「每 5 秒读一遍全库」，
       * 52 张计划时没必要。改成「手动刷新 + 操作后自动刷新」：
       *   · 顶栏「刷新」按钮
       *   · 任何写操作（改状态 / 存备注 / 新建 / 编辑）成功后各刷一次
       * 这样既不会漏更新，也不会空转。真的需要看别人会话的改动时，点一下刷新即可。
       */

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

      /**
       * 加载模板（新建与编辑共用）。
       *
       * 以前只在 openCreate 里加载，导致「直接点编辑」时 templates 是空的，
       * CreateForm 解析不出字段 → 界面显示「模板无法加载」（T-024 / T-035）。
       * 现在抽出来，两条路径都调；加载失败时返回空表，由 CreateForm 走纯文本兜底。
       */
      const loadTemplates = function (onError) {
        /* **从宿主拿模板清单**，不再硬编码。
           以前这里写死 A–F + H1–H8，宿主改成双字母编号 + 四类别后，
           那些文件全不存在 → 下拉只剩「空模板」，右侧显示"模板还没加载出来"。
           宿主的 /task-templates 是唯一真源（它遍历内核的 TYPES）。 */
        runCommand('/task-templates', sessionId)
          .then(function (settled) {
            const text = commandText(settled);
            const list = JSON.parse(text);
            if (!Array.isArray(list)) throw new Error('/task-templates 没返回数组');
            const map = {};
            list.forEach(function (item) {
              if (item && typeof item.type === 'string' && item.type !== '' && item.yaml) {
                map[item.type] = item.yaml;
              }
            });
            if (Object.keys(map).length === 0) {
              if (onError) onError('宿主返回了 0 个模板（检查 templates 目录）');
              return;
            }
            setTemplates(map);
          })
          .catch(function (error) {
            if (onError) onError(String((error && error.message) || error));
          });
      };


      const openCreate = function () {
        setEditId('');
        setCreate({ open: true, busy: false, error: '' });
        if (Object.keys(templates).length > 0) return;
        loadTemplates(function (message) {
          setCreate({ open: true, busy: false, error: message });
        });
      };

      /** 打开编辑 / 分支：和新建一样要先把模板准备好（T-035 的修法）。 */
      const openEdit = function (node, mode) {
        setSelected(node.id);
        setEditMode(mode);
        setEditId(node.id);
        if (Object.keys(templates).length > 0) return;
        loadTemplates(function (message) {
          setCreate({ open: false, busy: false, error: message });
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

      /* 视图与过滤（T-020）。
         「树糊成一团」的根因不是布局算法，是**一次全画出来**：
         30 张要滚 3 屏、100 张 9.5 屏，而且没有折叠、没有过滤。
         所以这里加三样真正生效的东西：视图切换、按组过滤、搜索。 */
      const viewState = React.useState('tree');
      const view = viewState[0];
      const setView = viewState[1];
      const filterState = React.useState('');
      const groupFilter = filterState[0];
      const setGroupFilter = filterState[1];
      const searchState = React.useState('');
      const search = searchState[0];
      const setSearch = searchState[1];

      const allTasks = data.tasks;

      /** 过滤：按组（进行/搁置/完成/草稿）+ 搜索（id 或标题）。 */
      const tasks = React.useMemo(
        function () {
          const needle = search.trim().toLowerCase();
          return allTasks.filter(function (node) {
            if (groupFilter !== '') {
              const groups = groupsOf(node.status);
              if (node.status === '未指定') {
                if (groupFilter !== '草稿') return false;
              } else if (groups.indexOf(groupFilter) === -1) {
                return false;
              }
            }
            if (needle !== '') {
              const hay = (node.id + ' ' + node.title).toLowerCase();
              if (hay.indexOf(needle) === -1) return false;
            }
            return true;
          });
        },
        [allTasks, groupFilter, search],
      );

      const graph = React.useMemo(
        function () {
          return buildGraph(tasks);
        },
        [tasks],
      );
      const activeNode = selected && graph.byId[selected] ? graph.byId[selected].node : null;
      const activeId = activeNode ? activeNode.id : '';
      const activeNodeId = activeId;

      /* 选中变化时拉一次历史（T-019）。
       *
       * 走**文件**，不走命令：历史本来就藏在 plans.jsonl 的每一行里，
       * 文件里一行一个事件，直接解析就够。用命令的话每次点开详情都会往
       * 会话日志写一对 command/run + command/done，点几十张就刷屏。
       * 这一步是纯读，不写任何东西。 */
      React.useEffect(
        function () {
          if (activeNodeId === '') return undefined;
          if (historyInfo.id === activeNodeId) return undefined;
          let canceled = false;
          ensurePaths()
            .then(function (paths) {
              const files = fileRpc();
              if (paths === null || files === null) throw new Error('没有文件通道');
              return Promise.resolve(files.read(sessionId, paths.store, { limit: 5000 }, undefined));
            })
            .then(function (result) {
              if (!result || result.ok !== true) throw new Error('读不到计划库');
              const entries = [];
              String(result.value.text || '')
                .split(/\r?\n/u)
                .filter(function (line) {
                  return line.trim() !== '';
                })
                .forEach(function (line) {
                  let event = null;
                  try {
                    event = JSON.parse(line);
                  } catch (failure) {
                    return;
                  }
                  if (!event || event.op !== 'upsert' || !event.task) return;
                  if (String(event.task.id) !== activeNodeId) return;
                  entries.push({
                    ts: event.ts || '',
                    actor: event.actor || '',
                    from: event.from || '',
                    to: event.to || '',
                    status: event.task.status || '',
                  });
                });
              if (canceled) return;
              setHistoryInfo({ id: activeNodeId, entries: entries.slice(-30) });
            })
            .catch(function () {
              if (canceled) return;
              setHistoryInfo({ id: activeNodeId, entries: [] });
            });
          return function () {
            canceled = true;
          };
        },
        [activeNodeId, historyInfo.id, sessionId],
      );

      const editNode = editId && graph.byId[editId] ? graph.byId[editId].node : null;
      const editInitial = editNode
        ? {
            id: editNode.id,
            title: editMode === 'fork' ? editNode.title + '（分支）' : editNode.title,
            type: editNode.typeCode || '',
            /* 回填大类：编辑时能看到当前是目标/设计/记录/工作，也能改（升级）。 */
            kind: editNode.kindKey || '',
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
          /* 视图切换（T-020）：树看关系，列表看密度。 */
          h(
            'button',
            {
              type: 'button',
              onClick: function () {
                setView(view === 'tree' ? 'list' : 'tree');
              },
              style: buttonBase(false),
            },
            view === 'tree' ? t('board.list') : t('board.tree'),
          ),
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
        /* 过滤条（T-020）：按组 + 搜索。 */
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: 6 } },
          ['', '进行', '搁置', '完成', '草稿'].map(function (key) {
            const label = key === '' ? '全部' : key;
            const active = groupFilter === key;
            return h(
              'button',
              {
                key: 'filter-' + (key || 'all'),
                type: 'button',
                onClick: function () {
                  setGroupFilter(key);
                },
                style: Object.assign({}, buttonBase(active), {
                  padding: '2px 10px',
                  opacity: active ? 1 : 0.75,
                }),
              },
              label,
            );
          }),
          h('span', { style: { flex: 1 } }),
          h('input', {
            value: search,
            placeholder: '搜 id 或标题…',
            onChange: function (event) {
              setSearch(event.target.value);
            },
            style: Object.assign({}, formInputStyle, { width: 180, flex: 'none' }),
          }),
          h(
            'span',
            { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)', flex: 'none' } },
            tasks.length + ' / ' + allTasks.length,
          ),
        ),
        h(
          'div',
          { style: { display: 'flex', minHeight: 0, flex: 1, position: 'relative' } },
          h(
            'div',
            { style: { flex: 1, minWidth: 0 } },
            view === 'tree'
              ? h(TechTree, { graph: graph, selected: selected, onSelect: setSelected })
              : h(TaskList, { tasks: tasks, selected: selected, onSelect: setSelected }),
          ),
        ),
        editNode
          ? h(CreateForm, {
              initial: editInitial,
              title: editMode === 'fork' ? '分支计划（取代原计划）' : '编辑计划',
              /* T-035：编辑也要拿到模板，否则字段渲染不出来。 */
              templates: templates,
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
                openEdit(activeNode, activeNode.status === '未指定' ? 'edit' : 'fork');
              },
              /* 备注草稿：切到另一张计划时自动换成那张的备注。 */
              noteDraft: note.id === activeNode.id ? note.draft : activeNode.note || '',
              noteError: note.id === activeNode.id ? note.error : '',
              history: historyInfo.id === activeNode.id ? historyInfo.entries : [],
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

    /**
     * 右侧栏里的任务板（T-028）。
     *
     * 与输入框上方抽屉**共用同一个 TaskBoard**，区别只有两点：
     *   · 这里不画那 30×30 的箭头按钮（右侧栏本来就有 tab）；
     *   · 高度用满，不套「浮起面板」的绝对定位。
     *
     * 用户原话：「除了这个箭头的入口以外，右侧的工作区面板应该也加一个计划的UI。
     * 他们拥有相同的视图。」——所以视图是同一个组件，不是抄一份。
     */
    function RightbarPanel(props) {
      const state = React.useState(false);
      const open = state[0];
      const setOpen = state[1];
      useLocaleRevision();
      /* 只在 tab 真正挂上时渲染任务板，避免右侧栏没打开也去拉数据。 */
      React.useEffect(function () {
        setOpen(true);
      }, []);
      return h(
        'div',
        {
          style: {
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
            minHeight: 0,
            padding: '10px 12px',
            boxSizing: 'border-box',
            background: 'var(--dsw-alias-bg-layer-1)',
          },
        },
        open ? h(TaskBoard, { sessionId: props.sessionId }) : null,
      );
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

        /* ── 右侧栏 tab（T-028）───────────────────────────────────────────
           两步走，与官方 sidebar-files / ui-plan 插件同一个套路：
             1. 往 `sidebarRightTabs` 注册一个 tab **类型**（id + kind + 标题）
             2. 往 `sidebar.right.pane.tab` 与 `.title` 注册该 type 的**内容**
           两者都用 key，且都必须包在 ctx.effect 里才不会泄漏。 */
        const RIGHT_TAB_ID = '@local/composer-drawer:taskboard';
        const RIGHT_TAB_KIND = 'taskboard';

        const tabsFace = (function () {
          try {
            return typeof ctx.get === 'function' ? ctx.get('sidebarRightTabs') : undefined;
          } catch (failure) {
            return undefined;
          }
        })();

        if (tabsFace && typeof tabsFace.register === 'function') {
          try {
            ctx.effect(function () {
              return tabsFace.register({
                id: RIGHT_TAB_ID,
                kind: RIGHT_TAB_KIND,
                priority: 'extension',
                title: function () {
                  return t('panel.title');
                },
              });
            }, 'composer-drawer: 注册右侧栏 tab 类型');
          } catch (failure) {
            /* 注册失败不影响抽屉那一半 */
          }

          ctx.slots.inject('sidebar.right.pane.tab', function () {
            return ctx.slots.register(
              { name: 'sidebar.right.pane.tab', key: RIGHT_TAB_KIND },
              RightbarPanel,
            );
          });
          ctx.slots.inject('sidebar.right.pane.tab.title', function () {
            return ctx.slots.register(
              { name: 'sidebar.right.pane.tab.title', key: RIGHT_TAB_KIND },
              function () {
                return h('span', null, t('panel.title'));
              },
            );
          });
        }
      },
    };
  },
});
