/**
 * 章节校验的自检 —— 串起「模板章节」和「行动库」的那一层。
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { validateSection, validateDocument, normalizeTypes } from '../section.js';

/* ─────────── 单章 ─────────── */

test('合法的一章通过，value 里去掉了 action', () => {
	const result = validateSection(
		{ label: '怎么做', type: ['ask'] },
		{ action: 'ask', options: [{ title: 'A' }, { title: 'B' }], picked: 'A' },
	);
	assert.equal(result.ok, true, result.reason);
	assert.equal(result.action, 'ask');
	assert.deepEqual(result.value, { options: [{ title: 'A' }, { title: 'B' }], picked: 'A' });
	assert.ok(!('action' in result.value), 'action 不该出现在 value 里');
});

test('章节不接受这个行动时拒绝，并列出可选', () => {
	const result = validateSection(
		{ label: '怎么做', type: ['text'] },
		{ action: 'ask', options: [{ title: 'A' }, { title: 'B' }] },
	);
	assert.equal(result.ok, false);
	assert.match(result.reason, /「怎么做」/u);
	assert.match(result.reason, /不接受 action「ask」/u);
	assert.match(result.reason, /只接受：text/u);
});

test('缺失 action 字段时拒绝，并提示可选值', () => {
	const result = validateSection({ label: '下一步', type: ['derive', 'text'] }, { templates: ['WR'] });
	assert.equal(result.ok, false);
	assert.match(result.reason, /缺少 action 字段/u);
	assert.match(result.reason, /derive \/ text/u);
});

test('传进来的不是对象时拒绝', () => {
	for (const bad of [null, 'ask', 42, ['a', 'b']]) {
		const result = validateSection({ label: 'x', type: ['ask'] }, bad);
		assert.equal(result.ok, false, `应该拒绝 ${JSON.stringify(bad)}`);
	}
});

test('字段不合法时拒绝，理由里带字段路径', () => {
	const result = validateSection(
		{ label: '怎么做', type: ['ask'] },
		{ action: 'ask', options: 'A,B' },
	);
	assert.equal(result.ok, false);
	assert.match(result.reason, /字段不合法/u);
	assert.match(result.reason, /options/u);
});

test('章节没声明 type 时，明确说是模板配置问题', () => {
	const result = validateSection({ label: '空章', type: [] }, { action: 'text' });
	assert.equal(result.ok, false);
	assert.match(result.reason, /没有声明任何 type/u);
	assert.match(result.reason, /模板配置有问题/u);
});

test('章节用了行动库里没有的行动时，指向部署问题而不是模型用错', () => {
	const result = validateSection({ label: 'x', type: ['nope'] }, { action: 'nope' });
	assert.equal(result.ok, false);
	assert.match(result.reason, /未注册的行动「nope」/u);
	assert.match(result.reason, /模板与行动库版本不匹配/u);
});

/* ─────────── 整份文档 ─────────── */

test('整份文档：所有章节都合法就通过', () => {
	const sections = [
		{ label: '要什么', type: ['text'] },
		{ label: '怎么做', type: ['text', 'ask'] },
	];
	const result = validateDocument(sections, {
		要什么: { action: 'text', value: '把任务板修好' },
		怎么做: { action: 'ask', options: [{ title: 'A' }, { title: 'B' }] },
	});
	assert.equal(result.ok, true, result.reason);
	assert.deepEqual(Object.keys(result.values), ['要什么', '怎么做']);
	assert.equal(result.values['怎么做'].action, 'ask');
});

test('整份文档：任何一章不合法就整体拒绝', () => {
	const sections = [
		{ label: '要什么', type: ['text'] },
		{ label: '怎么做', type: ['ask'] },
	];
	const result = validateDocument(sections, {
		要什么: { action: 'text', value: 'x' },
		怎么做: { action: 'ask' }, /* 缺 options */
	});
	assert.equal(result.ok, false);
	assert.match(result.reason, /怎么做/u);
});

test('整份文档：没给的章节跳过，不报错', () => {
	const sections = [
		{ label: '要什么', type: ['text'] },
		{ label: '可选补充', type: ['text'] },
	];
	const result = validateDocument(sections, { 要什么: { action: 'text', value: 'x' } });
	assert.equal(result.ok, true, result.reason);
	assert.deepEqual(Object.keys(result.values), ['要什么']);
});

test('整份文档：模板没声明章节时拒绝', () => {
	const result = validateDocument([], {});
	assert.equal(result.ok, false);
	assert.match(result.reason, /没有声明任何章节/u);
});

test('整份文档：payloads 是垃圾值时当成空', () => {
	const sections = [{ label: '要什么', type: ['text'] }];
	for (const bad of [null, undefined, 'x', 42]) {
		const result = validateDocument(sections, bad);
		assert.equal(result.ok, true, `${JSON.stringify(bad)} 应该当成空`);
	}
});

/* ─────────── type 的两种写法 ─────────── */

test('normalizeTypes：字符串和数组都接受', () => {
  assert.deepEqual(normalizeTypes('text'), ['text']);
  assert.deepEqual(normalizeTypes(['text']), ['text']);
  assert.deepEqual(normalizeTypes(['text', 'ask']), ['text', 'ask']);
});

test('normalizeTypes：去空白、去重、挡垃圾', () => {
	assert.deepEqual(normalizeTypes('  textarea  '), ['textarea']);
  assert.deepEqual(normalizeTypes(['text', 'text']), ['text']);
  assert.deepEqual(normalizeTypes(['', '  ', 'ask']), ['ask']);
  assert.deepEqual(normalizeTypes(null), []);
  assert.deepEqual(normalizeTypes(undefined), []);
  assert.deepEqual(normalizeTypes(42), []);
  assert.deepEqual(normalizeTypes(['ask', 42, null]), ['ask']);
});

test('type 写单个字符串时，章节校验照常工作', () => {
  const result = validateSection({ label: '正文', type: 'text' }, { action: 'text', value: 'x' });
  assert.equal(result.ok, true, result.reason);
  assert.equal(result.action, 'text');
});

test('type 写单个字符串时，用错行动仍被拒', () => {
  const result = validateSection({ label: '正文', type: 'text' }, { action: 'ask', options: ['A','B'] });
  assert.equal(result.ok, false);
	assert.match(result.reason, /只接受：text/u);
});

test('字符串形态不会被当成字符数组（经典的 JS 坑）', () => {
	/* 如果实现里直接对 string 做 includes，'text'.includes('tex') 会是 true，
	   那么传 action='tex'（不存在的行动）会被意外放行。
	   这里锁住这个行为：按数组查，不按子串查。 */
	const result = validateSection({ label: '正文', type: 'text' }, { action: 'tex', value: 'x' });
	assert.equal(result.ok, false, 'action=tex 不该被 "text" 放行');
	assert.match(result.reason, /不接受 action「tex」/u);
});

test('整份文档用字符串形态的 type 也能跑', () => {
  const result = validateDocument([{ label: '正文', type: 'text' }], {
    正文: { action: 'text', value: 'x' },
  });
  assert.equal(result.ok, true, result.reason);
});
