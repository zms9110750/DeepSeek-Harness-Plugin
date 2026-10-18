import { readFileSync, writeFileSync } from 'node:fs';
import { DOMParser } from 'linkedom';

const SRC = 'C:\\Users\\16229\\Desktop\\收藏20261018-221510.html';
const OUT = 'X:\\temp\\dsh\\研究\\收藏解析-DOM版.json';

const makeNode = (name) => ({ name, entries: [] });

const text = readFileSync(SRC, 'utf8');
const doc = new DOMParser().parseFromString(text, 'text/html');
const root = makeNode('');

/** The exact walk the Client half uses. */
const walk = (dl, node) => {
  let pending = null;

  for (const child of Array.from(dl.children)) {
    if (child.tagName === 'DT') {
      const anchor = child.querySelector(':scope > a');
      const folder = child.querySelector(':scope > h3');

      if (anchor) {
        const href = anchor.getAttribute('href') || '';
        if (href) {
          node.entries.push({
            kind: 'item',
            title: (anchor.textContent || '').trim() || href,
            url: href,
          });
        }
      }

      if (folder) {
        pending = makeNode((folder.textContent || '').trim() || '未命名');
        node.entries.push({ kind: 'child', node: pending });
        const inner = child.querySelector(':scope > dl');
        if (inner) {
          walk(inner, pending);
          pending = null;
        }
      }
    } else if (child.tagName === 'DL') {
      walk(child, pending || node);
      pending = null;
    }
  }
};

const top = doc.querySelector('dl');
if (top) walk(top, root);

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

const summarise = (node, path, out) => {
  if (node.name) out.push({ path, total: count(node), children: node.entries.filter((e) => e.kind === 'child').length });
  for (const entry of node.entries) {
    if (entry.kind === 'child') summarise(entry.node, node.name ? `${path} / ${entry.node.name}` : entry.node.name, out);
  }
  return out;
};

const folders = summarise(root, '', []);

writeFileSync(
  OUT,
  JSON.stringify(
    {
      source: SRC,
      totals: { items: rows.length, unique: urls.size, duplicates: rows.length - urls.size, folders: folders.length },
      topLevel: root.entries
        .filter((e) => e.kind === 'child')
        .map((e) => ({ name: e.node.name, total: count(e.node) })),
      firstEntries: root.entries.slice(0, 8).map((e) => (e.kind === 'item' ? `item:${e.title}` : `dir:${e.node.name}`)),
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
console.log('--- top level ---');
for (const t of root.entries.filter((e) => e.kind === 'child')) console.log(String(count(t.node)).padStart(5), t.node.name);
console.log('wrote', OUT);
