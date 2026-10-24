const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(process.argv[2] ?? 'tasks.db');
const views = db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'view' ORDER BY name").all();
for (const view of views) {
	console.log(`-- ${view.name}`);
	console.log(view.sql.split('\n').slice(0, 4).map((line) => `   ${line}`).join('\n'));
}
