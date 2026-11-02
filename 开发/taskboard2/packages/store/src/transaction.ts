/**
 * 事务。
 *
 * 契约（与 ⑧ core 已对齐，见 `docs/01-store.md` 2.4）：
 *   · `transaction(wsId, fn)` 里，`fn` 拿到的是**绑定该事务**的 `tx` 对象；
 *   · `fn` 内**只能**用 `tx.*`；调 public 面方法会**直接抛错** ——
 *     不能静默降级，那会把原子性 bug 藏起来；
 *   · `fn` **必须同步**，不能 `await`（同步事务让出事件循环会跨请求）。
 */

import type { DbHandle } from './db.js';
import { purgePhysical, read, readAll, write } from './cards.js';
import type { Card } from './cards.js';

/** 事务内可用的受限接口。 */
export interface Tx {
	readAll(): Card[];
	read(id: string): Card | undefined;
	write(cards: readonly Card[]): void;
	purgePhysical(ids: readonly string[]): void;
}

/**
 * 「当前是否处在事务中」的守卫。
 *
 * 每个 store 实例持有一个；public 面方法在执行前检查它 —— 在事务内调
 * public 面会抛错，而不是悄悄再开一个事务。
 */
export class TransactionGuard {
	private depth = 0;

	/** 是否在事务内。 */
	get active(): boolean {
		return this.depth > 0;
	}

	/** 断言当前不在事务内；在的话抛错。 */
	assertOutside(operation: string): void {
		if (this.depth > 0) {
			throw new Error(
				`${operation}() must not be called inside transaction(); use the tx.* handle instead`,
			);
		}
	}

	/** 进入/离开事务（内部使用）。 */
	enter(): void {
		this.depth += 1;
	}

	leave(): void {
		this.depth = Math.max(0, this.depth - 1);
	}
}

/** 在给定句柄上构造受限的 `Tx`。 */
export function createTx(handle: DbHandle): Tx {
	return {
		readAll: () => readAll(handle),
		read: (id: string) => read(handle, id),
		write: (cards: readonly Card[]) => write(handle, cards),
		purgePhysical: (ids: readonly string[]) => purgePhysical(handle, ids),
	};
}

/**
 * 在一个事务里执行 `fn`。
 *
 * `fn` 抛错 → 回滚；`fn` 返回 → 提交。**`fn` 必须同步。**
 *
 * @param handle - 该工作空间的句柄。
 * @param guard - 当前 store 实例的事务守卫。
 * @param fn - 同步回调，入参是受限的 `tx`。
 * @returns `fn` 的返回值。
 */
export function runTransaction<T>(
	handle: DbHandle,
	guard: TransactionGuard,
	fn: (tx: Tx) => T,
): T {
	if (typeof fn !== 'function') throw new TypeError('transaction() requires a function');
	if (guard.active) {
		throw new Error('transaction() must not be nested; use the existing tx.* handle');
	}
	const tx = createTx(handle);
	guard.enter();
	try {
		return handle.runInTransaction(() => fn(tx));
	} finally {
		guard.leave();
	}
}
