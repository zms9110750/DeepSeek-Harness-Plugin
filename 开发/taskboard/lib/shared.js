/**
 * 四个插件共用的最小工具。
 *
 * 为什么单独一层：`core` / `panel` / `plan-preset` / `workspace` 都要用这几个，
 * 但它们本身不属于任何一个插件的领域。放这里避免循环依赖
 * （core 依赖 shared，其它三个也依赖 shared；shared 不依赖任何人）。
 */

/** 只认 string，其它一律当空串（避免 undefined 到处跑）。 */
export function text(value) {
	return typeof value === 'string' ? value : '';
}

/*
 * 当前调用的会话 id。
 *
 * 「当前组」要**跟随会话**（用户要求），但工具 execute 拿不到稳定的 sessionId ——
 * 只有守卫那边的 exec.agent 有。所以用和 CURRENT_ACTOR 同样的办法：
 * 守卫在调用工具前把 agent id 记下来，工具执行时读。
 *
 * 不能跨会话共用，所以每次调用都要覆盖写。
 */
export const CURRENT_SESSION = { value: '' };

/** 从执行上下文里抠出会话 id。 */
export function sessionIdOf(exec) {
	const agent = exec?.agent;
	return String(agent?.session?.id ?? agent?.id ?? '').trim();
}

/** 写事件时的 actor 标签。 */
export const CURRENT_ACTOR = { value: '' };

export function actorLabel(agent, byUser) {
	if (byUser === true) return 'user';
	const id = String(agent?.id ?? agent?.session?.id ?? '').trim();
	return id === '' ? 'unknown' : id;
}

/** 「额外工作区」解析：逗号分隔的绝对路径 → 数组（去空、去重、校验绝对路径）。 */
export function splitWorkspaces(raw) {
	if (typeof raw !== 'string') return [];
	const out = [];
	for (const part of raw.split(/[,，]/u)) {
		const value = part.trim();
		if (value === '') continue;
		if (!isAbsolutePath(value)) {
			throw new Error(`额外工作区必须是绝对路径：${value}`);
		}
		if (!out.includes(value)) out.push(value);
	}
	return out;
}

/** Windows / POSIX 都认的绝对路径判定。 */
export function isAbsolutePath(value) {
	const raw = String(value ?? '').trim();
	if (raw === '') return false;
	if (/^[A-Za-z]:[\\/]/u.test(raw)) return true;
	if (raw.startsWith('\\\\')) return true;
	return raw.startsWith('/');
}
