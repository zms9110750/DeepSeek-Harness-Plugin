/**
 * 探针：能不能在**不改内核**的前提下，给 ctx.sessionPersistence 套一层分流？
 *
 * 要回答的问题：
 *   1. ctx.sessionPersistence 拿到的是不是可写的对象（defineProperty 会不会被 Proxy 吞掉）；
 *   2. 把 create/open/stat/list/flush 换成自己的包装函数后，宿主真的会走到包装里吗；
 *   3. 一次 headless 运行会创建/打开几个会话、id 长什么样。
 *
 * 不写任何业务逻辑，只记日志；每次调用都原样转发给原方法。
 * 结果写到本目录 calls.log。
 */
import { appendFileSync } from 'node:fs';

export const name = 'persist-router-probe';

export const inject = ['sessionPersistence'];

const LOG = 'X:\\temp\\dsh\\探针\\persist-router-probe\\calls.log';

function log(line) {
	try {
		appendFileSync(LOG, `${new Date().toISOString()} ${line}\n`, 'utf8');
	} catch {
		// 探针不该让宿主失败
	}
}

export function apply(ctx) {
	const service = ctx.sessionPersistence;
	log(`apply: service=${typeof service} constructor=${service?.constructor?.name}`);
	log(`apply: own create? ${Object.hasOwn(service, 'create')} proto create? ${typeof service?.create}`);

	const methods = ['create', 'open', 'stat', 'list', 'flush'];
	for (const method of methods) {
		const original = service[method];
		if (typeof original !== 'function') {
			log(`apply: ${method} is not a function (${typeof original})`);
			continue;
		}
		const wrapper = function (...args) {
			try {
				const first = args[0];
				const brief =
					method === 'create' || method === 'stat'
						? JSON.stringify(first?.id ?? first)
						: method === 'open'
							? `${String(first)} access=${String(args[1])}`
							: '';
				log(`call ${method}(${brief})`);
			} catch (error) {
				log(`call ${method} (log failed: ${String(error)})`);
			}
			return original.apply(this, args);
		};
		Object.defineProperty(service, method, {
			value: wrapper,
			configurable: true,
			writable: true,
			enumerable: false,
		});
		const desc = Object.getOwnPropertyDescriptor(service, method);
		log(`apply: defined ${method} own=${desc !== undefined} sameFn=${desc?.value === wrapper}`);
	}

	ctx.effect(() => () => {
		for (const method of methods) {
			try {
				delete service[method];
			} catch {
				// ignore
			}
		}
		log('dispose: own methods removed');
	});
}
