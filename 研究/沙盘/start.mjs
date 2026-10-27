/**
 * 同时启动两个沙盘服务。
 *
 * ## 为什么要有这个
 *
 * 两个服务是独立的（不同进程、不同端口），
 * 但每次都开两个终端太麻烦。这个脚本只是把它们一起拉起来，
 * 不改变任何隔离性 —— 任意一个挂了，另一个照常跑。
 *
 * 用法：node start.mjs
 */
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

const services = [
	{ name: '收件箱', dir: join(HERE, 'inbox'), port: 52311 },
	{ name: '工作区', dir: join(HERE, 'work'), port: 52312 },
];

const children = [];

for (const service of services) {
	const child = spawn(process.execPath, ['server.mjs', String(service.port)], {
		cwd: service.dir,
		stdio: 'inherit',
	});
	children.push(child);
	child.on('exit', (code) => {
		process.stdout.write(`[${service.name}] 退出（code ${code}）\n`);
	});
}

process.stdout.write('\n');
process.stdout.write('  收件箱  http://127.0.0.1:52311/\n');
process.stdout.write('  工作区  http://127.0.0.1:52312/\n');
process.stdout.write('\n按 Ctrl+C 全部停止。\n');

/* Ctrl+C 时一起停 */
process.on('SIGINT', () => {
	for (const child of children) child.kill();
	process.exit(0);
});
