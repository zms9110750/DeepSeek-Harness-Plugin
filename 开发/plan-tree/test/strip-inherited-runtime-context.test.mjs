/**
 * 单测：stripInheritedRuntimeContext()（dispatch.js 的 fork 种子过滤）。
 *
 * 覆盖三件事，正是根因修复的三个必要条件：
 *   1. 运行时上下文快照被剔除，system/message、working-directory 通知、tool/result 原样保留；
 *   2. 剔除后 seq 从 0 连续（dsh-session 构造器校验 `event.seq === index`），
 *      surfaceOp 的 startSeq/endSeq 与 sourceEventSeqs 全部重映射到新位置；
 *   3. 替换事件的区间端点就是快照本身时，该替换被级联丢弃（过滤后它已无目标）。
 *
 * 运行：node --test 开发/plan-tree/test/strip-inherited-runtime-context.test.mjs
 * （node >= 20 自带 node:test；也可用 node 本文件，末尾有直接断言汇总。）
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { isRuntimeContextEvent, stripInheritedRuntimeContext } from '../src/dispatch.js';

/** 造一条最小事件：seq 连续由调用方保证；surfaceOp 传 undefined 表示非 surface 事件。 */
function event(seq, type, data, surfaceOp = 'append', sourceEventSeqs) {
	return {
		seq,
		type,
		time: 1_700_000_000_000 + seq,
		data,
		...(surfaceOp === undefined ? {} : { surfaceOp }),
		...(sourceEventSeqs === undefined ? {} : { sourceEventSeqs }),
	};
}

const textBlock = (text) => [{ type: 'text', text }];

/** 运行时上下文快照：user/message + source.kind === 'runtime-context'。 */
function snapshot(seq, cwd) {
	return event(seq, 'user/message', {
		role: 'user',
		id: `msg-${seq}`,
		content: textBlock(`Current runtime context. This snapshot supersedes earlier runtime-context snapshots.\n\nCurrent working directory: ${JSON.stringify(cwd)}.`),
		source: { kind: 'runtime-context', form: 'snapshot', sections: [] },
	});
}

/** 普通用户消息。 */
function userMessage(seq, text, surfaceOp = 'append', sourceEventSeqs) {
	return event(seq, 'user/message', { role: 'user', id: `msg-${seq}`, content: textBlock(text), source: { kind: 'user' } }, surfaceOp, sourceEventSeqs);
}

/** 一条覆盖 [startSeq, endSeq] 的替换事件（surfaceOp 为对象，不是 'append'）。 */
function replaceEvent(seq, startSeq, endSeq, sourceEventSeqs) {
	return event(
		seq,
		'user/message',
		{ role: 'user', id: `msg-${seq}`, content: textBlock('(replacement)'), source: { kind: 'user' } },
		{ op: 'replace', startSeq, endSeq },
		sourceEventSeqs,
	);
}

/** 整份父日志前缀：快照 append + 覆盖快照区间的 replace + 目标就是快照的 replace + 引用旧 seq 的事件。 */
function fixture() {
	return [
		event(0, 'turn/start', { turn: 1 }, undefined),
		event(1, 'system/message', { role: 'system', id: 'msg-1', content: textBlock('SYSTEM PROMPT'), source: { kind: 'system-prompt' } }, 'append'),
		snapshot(2, 'X:\\temp\\dsh'),
		event(3, 'user/message', { role: 'user', id: 'msg-3', content: textBlock('The working directory changed from "A" to "B".'), source: { kind: 'working-directory' } }, 'append'),
		userMessage(4, '做 T4'),
		event(5, 'assistant/message', { role: 'assistant', id: 'msg-5', content: textBlock('好的'), source: { kind: 'model', provider: 'p', model: 'm' }, turn: 1, step: 1, stream: [] }, 'append'),
		replaceEvent(6, 1, 4, [1, 2, 3, 4]), // 区间覆盖快照(2)：端点 1、4 都保留 → 替换保留、区间收缩
		replaceEvent(7, 2, 2, [2]), // 区间就是快照本身 → 过滤后无目标 → 应被级联丢弃
		event(8, 'tool/result', { message: { role: 'tool', id: 'msg-8', content: textBlock('ok') } }, 'append'),
		snapshot(9, 'X:\\temp\\dsh'), // 再来一条快照
		userMessage(10, '继续', 'append', [5, 9]), // 引用旧 seq 5 与旧的快照 9
	];
}

test('剔除运行时上下文快照，其余事件与各种上下文贡献原样保留', () => {
	const events = fixture();
	const result = stripInheritedRuntimeContext(events);

	// 1) 不再有任何 runtime-context
	assert.equal(result.some(isRuntimeContextEvent), false);

	// 2) 非快照的事件一条不少：turn/start、system/message、working-directory 通知、user、assistant、tool/result
	const types = result.map((item) => item.type);
	assert.equal(types.filter((type) => type === 'system/message').length, 1);
	assert.equal(types.filter((type) => type === 'tool/result').length, 1);
	assert.equal(types.filter((type) => type === 'assistant/message').length, 1);
	assert.equal(types.filter((type) => type === 'turn/start').length, 1);
	assert.equal(result.filter((item) => item.data?.source?.kind === 'working-directory').length, 1);
	assert.equal(result.length, events.length - 3); // 两条快照 + 一条目标为快照的替换
});

test('过滤后 seq 从 0 连续，surfaceOp 区间与 sourceEventSeqs 全部重映射到新位置', () => {
	const events = fixture();
	const result = stripInheritedRuntimeContext(events);

	// 1) seq 连续
	result.forEach((item, index) => assert.equal(item.seq, index, `seq 不连续：index ${index} 上写着 ${item.seq}`));

	// 2) 旧的 seq → 新的 seq：原 0,1,3,4,5,6,8,10 保留（2、7、9 被丢）
	const replace = result.find((item) => item.surfaceOp !== undefined && typeof item.surfaceOp === 'object');
	assert.ok(replace, '覆盖快照区间的替换事件应当保留');
	assert.deepEqual({ startSeq: replace.surfaceOp.startSeq, endSeq: replace.surfaceOp.endSeq }, { startSeq: 1, endSeq: 3 });
	// 它原来引用 [1,2,3,4]，旧 2 被丢弃后应变成 [1,2,3]
	assert.deepEqual(replace.sourceEventSeqs, [1, 2, 3]);

	// 4) 引用旧 seq 5 与旧快照 9 的那条消息：引用应变成 [4]（旧 5 → 新 4；旧 9 已被丢弃）
	const last = result.at(-1);
	assert.deepEqual(last.sourceEventSeqs, [4]);

	// 5) 所有区间端点与引用都指向存在的节点（重放时不会悬空）
	for (const item of result) {
		if (item.surfaceOp !== undefined && typeof item.surfaceOp === 'object') {
			assert.ok(item.surfaceOp.startSeq >= 0 && item.surfaceOp.startSeq < result.length, 'startSeq 越界');
			assert.ok(item.surfaceOp.endSeq >= 0 && item.surfaceOp.endSeq < result.length, 'endSeq 越界');
			assert.ok(item.surfaceOp.startSeq <= item.surfaceOp.endSeq, 'startSeq > endSeq');
		}
		for (const seq of item.sourceEventSeqs ?? []) {
			assert.ok(Number.isSafeInteger(seq) && seq >= 0 && seq < result.length, `sourceEventSeqs 悬空：${seq}`);
		}
	}

	// 6) 目标就是快照的那条替换被级联丢弃：结果里只剩一条替换事件
	assert.equal(result.filter((item) => item.surfaceOp !== undefined && typeof item.surfaceOp === 'object').length, 1);
});

test('不修改入参，且对没有快照的输入原样返回同一个数组', () => {
	const events = fixture();
	const before = JSON.stringify(events);
	stripInheritedRuntimeContext(events);
	assert.equal(JSON.stringify(events), before, '入参必须保持不变');

	const clean = events.filter((item) => !isRuntimeContextEvent(item));
	assert.equal(stripInheritedRuntimeContext(clean), clean, '没有快照时应原样返回入参');
});

test('幂等：过滤一次与过滤两次结果相同', () => {
	const once = stripInheritedRuntimeContext(fixture());
	const twice = stripInheritedRuntimeContext(once);
	assert.equal(JSON.stringify(twice), JSON.stringify(once));
});
