const { DatabaseSync } = require('node:sqlite');
const files = ['X:/temp/dsh/探针/sqlite-store/tasks.db', 'X:/temp/dsh/探针/tree-chain.db'];
for (const file of files) {
	const db = new DatabaseSync(file);
	const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map((row) => row.name);
	console.log(`== ${file}`);
	console.log(`   tables (${tables.length}): ${tables.join(', ')}`);
	for (const name of tables) {
		const count = db.prepare(`SELECT COUNT(*) AS n FROM "${name}"`).get().n;
		const columns = db.prepare(`PRAGMA table_info("${name}")`).all().map((column) => column.name).join(',');
		console.log(`   ${name}  rows=${count}  cols=${columns}`);
	}
	db.close();
}
