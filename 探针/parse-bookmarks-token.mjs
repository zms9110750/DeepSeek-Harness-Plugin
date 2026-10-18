import { readFileSync, writeFileSync } from 'node:fs';

const SRC = 'C:\\Users\\16229\\Desktop\\收藏20261018-221510.html';
const OUT = 'X:\\temp\\dsh\\研究\\收藏解析-标签版.json';

const decode = (s) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');

const makeNode = (name) => ({ name, entries: [] });

/**
 * Scan the export by tags instead of by lines or a DOM: the three things that
 * matter are "a folder opened", "a folder closed", and "a link".
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

    if (raw[0] === '<' && /^<DL\b/i.test(raw)) {
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
        const title = decode(match[3]).trim() || href;
        (pending ?? stack[stack.length - 1]).entries.push({ kind: 'item', title, url: href });
      }
      continue;
    }

    if (match[1] !== undefined) {
      const node = makeNode(decode(match[1]).trim() || '未命名');
      stack[stack.length - 1].entries.push({ kind: 'child', node });
      pending = node;
    }
  }

  return root;
}

const root = parseNetscape(readFileSync(SRC, 'utf8'));

const count = (n) => n.entries.reduce((s, e) => s + (e.kind === 'item' ? 1 : count(e.node)), 0);

const flatten = (node, path, out) => {
  for (const entry of node.entries) {
    if (entry.kind === 'item') out.push({ path, title: entry.title, url: entry.url });
    else flatten(entry.node, path ? `${path} / ${entry.node.name}` : entry.node.name, out);
  }
  return out;
};

const rows = flatten(root, '', []);
const urls = new Set(rows.map((r) => r.url));

const folders = [];
const summarise = (node, path) => {
  if (node.name) folders.push({ path, total: count(node) });
  for (const entry of node.entries) {
    if (entry.kind === 'child') summarise(entry.node, node.name ? `${path} / ${entry.node.name}` : entry.node.name);
  }
};
summarise(root, '');

writeFileSync(
  OUT,
  JSON.stringify(
    {
      source: SRC,
      totals: { items: rows.length, unique: urls.size, duplicates: rows.length - urls.size, folders: folders.length },
      topLevel: root.entries
        .filter((e) => e.kind === 'child')
        .map((e) => ({ name: e.node.name, total: count(e.node) })),
      rootOrder: root.entries.map((e) => (e.kind === 'item' ? `item:${e.title}` : `dir:${e.node.name}`)),
      firstFolderEntries: (() => {
        const first = root.entries.find((e) => e.kind === 'child');
        return first ? first.node.entries.slice(0, 6).map((e) => (e.kind === 'item' ? `item:${e.title}` : `dir:${e.node.name}`)) : [];
      })(),
      folders,
      sample: rows.slice(0, 5),
    },
    null,
    2,
  ),
  'utf8',
);

console.log('items      ', rows.length);
console.log('unique     ', urls.size);
console.log('duplicates ', rows.length - urls.size);
console.log('folders    ', folders.length);
console.log('--- top level (in file order) ---');
for (const e of root.entries) {
  console.log(e.kind === 'item' ? `  item: ${e.title}` : `${String(count(e.node)).padStart(5)} ${e.node.name}`);
}
console.log('wrote', OUT);
