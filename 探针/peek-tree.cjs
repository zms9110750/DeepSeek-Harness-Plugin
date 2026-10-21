/**
 * 看树库里到底有什么：表、行、meta。
 * 用法：node peek-tree.cjs <rootId 或库文件名>
 */
const { DatabaseSync } = require('node:sqlite');
const { join } = require('node:path');
const { readdirSync } = require('node:fs');

const DIR = join(process.env.USERPROFILE, '.dsh', 'plan-tree', 'trees');
const needle = process.argv[2] ?? '';
const name = readdirSync(DIR).filter((entry) => entry.endsWith('.db') && entry.includes(needle)).sort().pop();
if (name === undefined) {
  console.log('没有匹配的库：' + DIR);
  process.exit(1);
}
const file = join(DIR, name);
console.log('库：' + file + '\n');

const db = new DatabaseSync(file, { readOnly: true });
console.log('--- 表 ---');
for (const row of db.prepare("select name, sql from sqlite_master where type='table' order by name").all()) {
  console.log(row.name + ': ' + String(row.sql).replace(/\s+/g, ' '));
}
console.log('\n--- 行 ---');
for (const table of ['sessions', 'events']) {
  const count = db.prepare('select count(*) as c from ' + table).get().c;
  console.log(table + ' = ' + count + ' 行');
  if (count > 0) console.log(JSON.stringify(db.prepare('select * from ' + table + ' limit 5').all(), null, 1));
}
console.log('\n--- meta ---');
console.log(JSON.stringify(db.prepare('select * from meta').all(), null, 1));
db.close();
