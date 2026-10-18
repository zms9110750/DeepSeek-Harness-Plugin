import { readFileSync, writeFileSync } from 'node:fs';

const SRC = 'C:\\Users\\16229\\Desktop\\收藏20261018-221510.html';
const OUT = 'X:\\temp\\dsh\\研究\\收藏解析-结果.json';

const decode = (s) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');

const root = { name: '', items: [], children: [] };
const stack = [root];
let pending = null;

const text = readFileSync(SRC, 'utf8');
const lines = text.split(/\r?\n/);

const openRe = /<DL[^>]*>/i;
const closeRe = /<\/DL>/i;
const h3Re = /<H3[^>]*>([\s\S]*?)<\/H3>/i;
const aRe = /<A\s[^>]*HREF="([^"]*)"[^>]*>([\s\S]*?)<\/A>/i;

for (const line of lines) {
  const h3 = line.match(h3Re);
  if (h3) {
    const node = { name: decode(h3[1]).trim() || '未命名', items: [], children: [] };
    stack[stack.length - 1].children.push(node);
    pending = node;
    continue;
  }

  const a = line.match(aRe);
  if (a) {
    const target = pending ?? stack[stack.length - 1];
    target.items.push({ title: decode(a[2]).trim(), url: a[1] });
    continue;
  }

  if (openRe.test(line)) {
    if (pending) {
      stack.push(pending);
      pending = null;
    } else {
      stack.push(stack[stack.length - 1]);
    }
    continue;
  }

  if (closeRe.test(line)) {
    if (stack.length > 1) stack.pop();
    pending = null;
  }
}

const count = (n) => n.items.length + n.children.reduce((s, c) => s + count(c), 0);

const walk = (node, path, out) => {
  if (node.name) out.push({ path, own: node.items.length, total: count(node), children: node.children.length });
  for (const child of node.children) walk(child, node.name ? `${path}/${child.name}` : child.name, out);
};

const groups = [];
walk(root, '', groups);

const all = [];
const collect = (node, path) => {
  for (const item of node.items) all.push({ path, ...item });
  for (const child of node.children) collect(child, node.name ? `${path}/${child.name}` : child.name);
};
collect(root, '');

const urls = new Set(all.map((row) => row.url));

const report = {
  source: SRC,
  parsedAt: new Date().toISOString(),
  totals: {
    items: all.length,
    uniqueUrls: urls.size,
    duplicateUrls: all.length - urls.size,
    folders: groups.length,
    maxDepth: Math.max(...groups.map((g) => g.path.split('/').length)),
    rootItems: root.items.length,
    rootChildren: root.children.length,
  },
  topLevel: root.children.map((child) => ({ name: child.name, total: count(child) })),
  groups,
  sample: all.slice(0, 5),
};

writeFileSync(OUT, JSON.stringify(report, null, 2), 'utf8');

console.log('items       ', report.totals.items);
console.log('uniqueUrls  ', report.totals.uniqueUrls);
console.log('duplicates  ', report.totals.duplicateUrls);
console.log('folders     ', report.totals.folders);
console.log('maxDepth    ', report.totals.maxDepth);
console.log('rootItems   ', report.totals.rootItems);
console.log('--- top level ---');
for (const t of report.topLevel) console.log(String(t.total).padStart(5), t.name);
console.log('--- deepest paths ---');
for (const g of [...groups].sort((a, b) => b.path.split('/').length - a.path.split('/').length).slice(0, 5)) {
  console.log(g.path, '| own', g.own, '| total', g.total);
}
console.log('wrote', OUT);
