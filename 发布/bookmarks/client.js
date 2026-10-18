window.__ModuleLoader__.load({
  id: '@local/bookmarks-tab10',
  factory(require) {
    const React = require('react');

    const h = React.createElement;

    const TYPE_ID = '@local/bookmarks-tab10';
    const KIND = 'bookmarks';
    const STORAGE_KEY = 'local.bookmarks.v8';
    const UNGROUPED = '未分组';

    /** A node keeps one ordered list: items and subfolders interleaved as in the source. */
    const makeNode = (name) => ({ name, entries: [] });

    const myGroup = () => {
      const group = makeNode('我的收藏');
      group.entries.push({ kind: 'item', title: 'DeepSeek 聊天', url: 'https://chat.deepseek.com' });
      group.entries.push({ kind: 'item', title: 'DeepSeek 平台', url: 'https://platform.deepseek.com' });
      group.entries.push({ kind: 'item', title: 'GitHub', url: 'https://github.com' });
      return group;
    };

    const defaults = () => {
      const root = makeNode('');
      const group = makeNode(UNGROUPED);
      group.entries.push({ kind: 'item', title: 'DeepSeek 聊天', url: 'https://chat.deepseek.com' });
      group.entries.push({ kind: 'item', title: 'DeepSeek 平台', url: 'https://platform.deepseek.com' });
      group.entries.push({ kind: 'item', title: 'GitHub', url: 'https://github.com' });
      root.entries.push({ kind: 'child', node: group });
      return root;
    };

    function count(node) {
      let total = 0;
      for (const entry of node.entries) {
        total += entry.kind === 'item' ? 1 : count(entry.node);
      }
      return total;
    }

    /** Document-order rows: folder path plus the bookmark. */
    function flatten(node, path, out) {
      for (const entry of node.entries) {
        if (entry.kind === 'item') out.push({ path, title: entry.title, url: entry.url });
        else flatten(entry.node, path ? path + ' / ' + entry.node.name : entry.node.name, out);
      }
      return out;
    }

    function buildTree(rows) {
      const root = makeNode('');
      const dirs = new Map();

      for (const row of rows) {
        const parts = String(row.path || '')
          .split(' / ')
          .map((part) => part.trim())
          .filter(Boolean);

        let node = root;
        let key = '';

        for (const part of parts) {
          key = key ? key + ' / ' + part : part;
          let child = dirs.get(key);
          if (!child) {
            child = makeNode(part);
            dirs.set(key, child);
            node.entries.push({ kind: 'child', node: child });
          }
          node = child;
        }

        node.entries.push({ kind: 'item', title: row.title, url: row.url });
      }

      return root;
    }

    function load() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem('local.bookmarks.v6');
        if (raw) {
          const tree = JSON.parse(raw);
          const list = Array.isArray(tree.entries) ? tree.entries : [];
          const mine = list.some((e) => e.kind === 'child' && e.node && e.node.name === '我的收藏');
          if (!mine) list.push({ kind: 'child', node: myGroup() });
          tree.entries = list;
          return tree;
        }
      } catch {
        /* fall through */
      }
      return defaults();
    }

    function persist(root) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(root));
      } catch {
        /* keep the working copy */
      }
    }

    function hostOf(url) {
      try {
        return new URL(url).hostname.replace(/^www\./, '');
      } catch {
        return url;
      }
    }

        const decodeEntities = (s) =>
      s
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, '&');

    /**
     * Scan the export by tags instead of by lines or a DOM: only three things
     * matter — a folder opened, a folder closed, and a link — in that order.
     */
    function parseNetscape(text) {
      const root = makeNode('');
      const stack = [root];
      let pending = null;

      const token =
        /<DL\b[^>]*>|<\/DL>|<H3\b[^>]*>([\s\S]*?)<\/H3>|<A\b[^>]*?\bHREF\s*=\s*"([^"]*)"[^>]*>([\s\S]*?)<\/A>/gi;

      let match;
      while ((match = token.exec(text)) !== null) {
        const raw = match[0];

        if (/^<DL\b/i.test(raw)) {
          if (pending) {
            stack.push(pending);
            pending = null;
          } else {
            stack.push(stack[stack.length - 1]);
          }
          continue;
        }

        if (/^<\/DL>/i.test(raw)) {
          if (stack.length > 1) stack.pop();
          pending = null;
          continue;
        }

        if (match[3] !== undefined) {
          const href = match[2] || '';
          if (href) {
            const title = decodeEntities(match[3]).trim() || href;
            (pending ?? stack[stack.length - 1]).entries.push({ kind: 'item', title, url: href });
          }
          continue;
        }

        if (match[1] !== undefined) {
          const node = makeNode(decodeEntities(match[1]).trim() || '未命名');
          stack[stack.length - 1].entries.push({ kind: 'child', node });
          pending = node;
        }
      }

      return root;
    }
    function BookmarksPage(props) {
      const info = typeof props.useTabInfo === 'function' ? props.useTabInfo() : undefined;
      const tab = (info && info.tab) || props.tab;

      const [root, setRoot] = React.useState(load);
      const [expanded, setExpanded] = React.useState(() => new Set());
      const [filter, setFilter] = React.useState('');
      const [adding, setAdding] = React.useState(false);
      const [title, setTitle] = React.useState('');
      const [url, setUrl] = React.useState('');
      const [note, setNote] = React.useState('');
      const [hover, setHover] = React.useState('');

      const fileRef = React.useRef(null);
      const query = filter.trim().toLowerCase();

      const commit = (next) => {
        setRoot(next);
        persist(next);
      };

      const open = (target) => {
        if (tab && tab.actions) tab.actions.openTab('browser', { params: { url: target } });
      };

      const add = () => {
        const trimmed = url.trim();
        if (!trimmed) return;
        const finalUrl = /^https?:\/\//i.test(trimmed) ? trimmed : 'https://' + trimmed;
        const name = title.trim() || hostOf(finalUrl);
        const rows = flatten(root, '', []);
        rows.push({ path: UNGROUPED, title: name, url: finalUrl });
        commit(buildTree(rows));
        setTitle('');
        setUrl('');
        setAdding(false);
      };

      const removeBookmark = (target) => {
        commit(buildTree(flatten(root, '', []).filter((row) => row.url !== target)));
      };

            const importFile = async (event) => {
        const file = event.target.files && event.target.files[0];
        event.target.value = '';
        if (!file) return;

        try {
          const text = await file.text();
          const parsed = parseNetscape(text);
          const total = count(parsed);

          if (total === 0) {
            setNote('文件里没有读到书签');
            return;
          }

          // The file is the source of truth: replace wholesale, keep duplicates
          // and the source order untouched.
          parsed.entries.push({ kind: 'child', node: myGroup() });
          commit(parsed);
          setNote('已导入 ' + total + ' 条');
        } catch (failure) {
          setNote('导入失败：' + String((failure && failure.message) || failure));
        }
      };
const matches = (entry) =>
        entry.kind === 'item' &&
        (!query ||
          entry.title.toLowerCase().includes(query) ||
          entry.url.toLowerCase().includes(query));

      const subtreeMatches = (node) =>
        node.entries.some((entry) =>
          entry.kind === 'item' ? matches(entry) : subtreeMatches(entry.node),
        );

      const inputStyle = {
        boxSizing: 'border-box',
        height: 26,
        padding: '0 8px',
        borderRadius: 7,
        border: '0.5px solid var(--dsw-alias-border-l2)',
        background: 'var(--dsw-alias-bg-layer-1)',
        color: 'var(--dsw-alias-label-primary)',
        font: 'inherit',
        fontSize: 12,
      };

      const buttonStyle = {
        height: 26,
        padding: '0 9px',
        borderRadius: 7,
        border: '1px solid var(--dsw-alias-border-l1)',
        background: 'transparent',
        color: 'var(--dsw-alias-label-secondary)',
        font: 'inherit',
        fontSize: 12,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
      };

      const renderNode = (node, depth, pathKey) => {
        if (query && !subtreeMatches(node)) return [];

        const id = pathKey + '/' + node.name;
        const isRoot = node.name === '';
        const isOpen = isRoot || query.length > 0 || expanded.has(id);
        const rows = [];

        if (!isRoot) {
          rows.push(
            h(
              'div',
              {
                key: 'dir:' + id,
                onClick: () => {
                  const next = new Set(expanded);
                  if (next.has(id)) next.delete(id);
                  else next.add(id);
                  setExpanded(next);
                },
                style: {
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                  marginLeft: depth * 12,
                  padding: '4px 6px',
                  borderRadius: 7,
                  cursor: 'pointer',
                  userSelect: 'none',
                },
              },
              h('span', { style: { fontSize: 9, opacity: 0.65, width: 9, flex: 'none' } }, isOpen ? '▾' : '▸'),
              h(
                'span',
                {
                  style: {
                    fontSize: 12,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  },
                },
                node.name,
              ),
              h(
                'span',
                { style: { fontSize: 10, color: 'var(--dsw-alias-label-tertiary)', flex: 'none' } },
                String(count(node)),
              ),
            ),
          );
        }

        if (!isOpen) return rows;

        const itemDepth = isRoot ? depth : depth + 1;

        let itemIndex = 0;
        for (const entry of node.entries) {
          if (entry.kind === 'child') {
            rows.push(...renderNode(entry.node, itemDepth, id));
            continue;
          }

          itemIndex += 1;
          if (!matches(entry)) continue;

          const itemId = id + '::' + itemIndex;
          rows.push(
            h(
              'div',
              {
                key: itemId,
                onClick: () => open(entry.url),
                onMouseEnter: () => setHover(itemId),
                onMouseLeave: () => setHover(''),
                title: entry.url,
                style: {
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  marginLeft: itemDepth * 12 + 8,
                  padding: '3px 6px',
                  borderRadius: 6,
                  background: hover === itemId ? 'var(--dsw-alias-interactive-bg-hover)' : 'transparent',
                  cursor: 'pointer',
                },
              },
              h(
                'span',
                {
                  style: {
                    fontSize: 12,
                    flex: 1,
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  },
                },
                entry.title,
              ),
              h(
                'span',
                {
                  style: {
                    fontSize: 10,
                    color: 'var(--dsw-alias-label-tertiary)',
                    flex: 'none',
                    maxWidth: 88,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  },
                },
                hostOf(entry.url),
              ),
              h(
                'button',
                {
                  type: 'button',
                  title: '删除',
                  onClick: (event) => {
                    event.stopPropagation();
                    removeBookmark(entry.url);
                  },
                  style: {
                    border: 0,
                    background: 'transparent',
                    color: 'var(--dsw-alias-label-tertiary)',
                    cursor: 'pointer',
                    fontSize: 13,
                    lineHeight: '14px',
                    flex: 'none',
                  },
                },
                '×',
              ),
            ),
          );
        }

        return rows;
      };

      return h(
        'div',
        {
          style: {
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            height: '100%',
            padding: 10,
            boxSizing: 'border-box',
            overflowY: 'auto',
            color: 'var(--dsw-alias-label-primary)',
            fontSize: 13,
          },
        },

        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' } },
          h('span', { style: { fontSize: 12, fontWeight: 500 } }, '收藏夹'),
          h('span', { style: { fontSize: 10, color: 'var(--dsw-alias-label-tertiary)' } }, count(root) + ' 条'),
          h('span', { style: { flex: 1 } }),
          h('button', { type: 'button', style: buttonStyle, onClick: () => {
              const all = new Set();
              const walk = (node, pathKey) => {
                const id = pathKey + '/' + node.name;
                if (node.name) all.add(id);
                for (const entry of node.entries) if (entry.kind === 'child') walk(entry.node, id);
              };
              walk(root, '');
              setExpanded(all);
            } }, '全展开'),
          h('button', { type: 'button', style: buttonStyle, onClick: () => setExpanded(new Set()) }, '全收起'),
          h('input', {
            style: { ...inputStyle, width: 84 },
            placeholder: '搜索',
            value: filter,
            onChange: (event) => setFilter(event.target.value),
          }),
          h(
            'button',
            { type: 'button', onClick: () => fileRef.current && fileRef.current.click(), style: buttonStyle },
            '导入',
          ),
          h(
            'button',
            { type: 'button', onClick: () => setAdding((value) => !value), style: buttonStyle },
            adding ? '取消' : '+',
          ),
          h('input', {
            ref: fileRef,
            type: 'file',
            accept: '.html,.htm,text/html',
            style: { display: 'none' },
            onChange: importFile,
          }),
        ),

        note ? h('div', { style: { fontSize: 10, color: 'var(--dsw-alias-label-tertiary)' } }, note) : null,

        adding &&
          h(
            'div',
            { style: { display: 'flex', gap: 5 } },
            h('input', {
              style: { ...inputStyle, width: 76 },
              placeholder: '名称',
              value: title,
              onChange: (event) => setTitle(event.target.value),
            }),
            h('input', {
              style: { ...inputStyle, flex: 1, minWidth: 0 },
              placeholder: 'https://…',
              value: url,
              onChange: (event) => setUrl(event.target.value),
              onKeyDown: (event) => {
                if (event.key === 'Enter') add();
                if (event.key === 'Escape') setAdding(false);
              },
            }),
            h('button', { type: 'button', onClick: add, style: buttonStyle }, '存'),
          ),

        ...renderNode(root, 0, ''),
      );
    }

    return {
      inject: ['slots', 'sidebarRightTabs'],
      apply(ctx) {
        ctx.effect(() =>
          ctx.sidebarRightTabs.register({
            id: TYPE_ID,
            kind: KIND,
            title: () => '收藏',
            guide: [
              {
                id: 'bookmarks',
                order: 40,
                title: () => '收藏',
                description: () => '自己管理的书签，可导入浏览器收藏',
              },
            ],
          }),
        );

        ctx.slots.inject('sidebar.right.pane.tab', () =>
          ctx.slots.register({ name: 'sidebar.right.pane.tab', key: TYPE_ID }, BookmarksPage),
        );
      },
    };
  },
});
