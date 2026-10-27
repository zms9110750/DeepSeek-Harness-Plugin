/**
 * 行动库自检。
 *
 * 跑：node test/actions.test.mjs
 *
 * 这个文件只测行动库本身，不碰 taskboard 的其它包 ——
 * 行动库是零依赖的，应该能单独跑起来。
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
	actionCatalog,
	defineAction,
	getAction,
	hasAction,
	listActionNames,
	validate,
	formatIssues,
} from '../index.js';

/* ─────────── 注册表 ─────────── */

test('内置六个行动都在', () => {
	const names = listActionNames();
	for (const name of ['markdown', 'textarea', 'input', 'choose', 'rank', 'derive']) {
		assert.ok(names.includes(name), `缺少内置行动 ${name}`);
	}
});

test('getAction 拿得到定义，字段齐全', () => {
	const choose = getAction('choose');
	assert.ok(choose, 'choose 应该已注册');
	assert.equal(choose.name, 'choose');
	assert.equal(choose.render, 'Choose');
	assert.ok(choose.summary.length > 0, 'summary 不能为空');
	assert.deepEqual(choose.schema.required, ['options']);
	assert.ok('options' in choose.schema.properties);
});

test('未注册的行动返回 undefined，不抛错', () => {
	assert.equal(getAction('nope'), undefined);
	assert.equal(getAction(''), undefined);
	assert.equal(getAction(null), undefined);
	assert.equal(hasAction('nope'), false);
	assert.equal(hasAction('choose'), true);
});

test('注册时挡住三类别名和坏 schema', () => {
	/* 名字不合规 */
	assert.throws(() => defineAction({ name: 'BadName', schema: { properties: {} } }), /只能是小写/);
	assert.throws(() => defineAction({ name: '', schema: { properties: {} } }), /不能为空/);
	/* 没 schema / 没 properties */
	assert.throws(() => defineAction({ name: 'x1' }), /schema 必须是对象/);
	assert.throws(() => defineAction({ name: 'x1', schema: {} }), /properties 必须是对象/);
	/* required 里的字段不在 properties 中 —— 这个错很隐蔽，必须在注册时就挡 */
	assert.throws(
		() => defineAction({ name: 'x1', schema: { required: ['a'], properties: { b: { type: 'string' } } } }),
		/required 里的「a」不在 properties 中/,
	);
});

test('同一个名字重复注册会覆盖，不报错', () => {
	defineAction({ name: 'temp_thing', summary: '第一次', schema: { properties: { a: { type: 'string' } } } });
	defineAction({ name: 'temp_thing', summary: '第二次', schema: { properties: { b: { type: 'string' } } } });
	const got = getAction('temp_thing');
	assert.equal(got.summary, '第二次');
	assert.ok('b' in got.schema.properties);
	assert.ok(!('a' in got.schema.properties), '旧字段应该被整份替换');
});

/* ─────────── 校验 ─────────── */

test('合法数据通过', () => {
	const issues = validate(getAction('choose').schema, {
		options: ['A', 'B'],
		picked: 'A',
	});
	assert.deepEqual(issues, [], formatIssues(issues));
});

test('必填缺失被指出', () => {
	const issues = validate(getAction('choose').schema, { picked: 'A' });
	assert.equal(issues.length, 1);
	assert.equal(issues[0].path, 'options');
	assert.match(issues[0].message, /必填/);
});

test('null 和 undefined 都算没给', () => {
	const a = validate(getAction('choose').schema, { options: null });
	const b = validate(getAction('choose').schema, {});
	assert.equal(a.length, 1);
	assert.equal(b.length, 1);
});

test('类型不对被指出，且不做后续判断', () => {
	const issues = validate(getAction('choose').schema, { options: 'A,B' });
	assert.equal(issues.length, 1);
	assert.match(issues[0].message, /应该是 数组，实际是 文本/);
});

test('数组元素逐个校验，路径带下标', () => {
	const issues = validate(getAction('choose').schema, { options: ['A', 42] });
	assert.equal(issues.length, 1);
	assert.equal(issues[0].path, 'options.1');
	assert.match(issues[0].message, /文本/);
});

test('minItems 生效', () => {
	const issues = validate(getAction('choose').schema, { options: ['只有一个'] });
	assert.equal(issues.length, 1);
	assert.match(issues[0].message, /至少 2 项/);
});

test('enum 生效', () => {
	const issues = validate(getAction('derive').schema, {
		templates: ['WR'],
		mode: 'sometimes',
	});
	assert.equal(issues.length, 1);
	assert.equal(issues[0].path, 'mode');
	assert.match(issues[0].message, /只能是/);
});

test('可选字段没给不报错', () => {
	const issues = validate(getAction('textarea').schema, { value: '写点什么' });
	assert.deepEqual(issues, []);
});

test('额外的字段：只有 additionalProperties=false 才拦', () => {
	/* textarea 没声明 additionalProperties，所以多余字段放过 */
	const loose = validate(getAction('textarea').schema, { value: 'x', extra: 1 });
	assert.deepEqual(loose, []);

	/* 显式 false 时拦住 */
	const strict = validate(
		{ type: 'object', additionalProperties: false, properties: { a: { type: 'string' } } },
		{ a: 'x', b: 2 },
	);
	assert.equal(strict.length, 1);
	assert.equal(strict[0].path, 'b');
	assert.match(strict[0].message, /不在这份架构里/);
});

test('整数和小数的区分', () => {
	const schema = { type: 'object', properties: { n: { type: 'integer' } } };
	assert.deepEqual(validate(schema, { n: 3 }), []);
	const bad = validate(schema, { n: 3.5 });
	assert.equal(bad.length, 1);
	assert.match(bad[0].message, /整数/);
});

test('数字范围', () => {
	const schema = { type: 'object', properties: { n: { type: 'number', minimum: 0, maximum: 10 } } };
	assert.deepEqual(validate(schema, { n: 5 }), []);
	assert.equal(validate(schema, { n: -1 }).length, 1);
	assert.equal(validate(schema, { n: 11 }).length, 1);
});

test('布尔和对象的基本类型判断', () => {
	assert.deepEqual(validate({ type: 'boolean' }, true), []);
	assert.equal(validate({ type: 'boolean' }, 'true').length, 1);
	assert.deepEqual(validate({ type: 'object' }, {}), []);
	assert.equal(validate({ type: 'object' }, []).length, 1, '数组不是对象');
});

test('多条错误一次性全给，不是遇到第一条就停', () => {
	const issues = validate(getAction('choose').schema, {
		options: 'not-array',
		allow_custom: 'yes',
	});
	assert.equal(issues.length, 2, formatIssues(issues));
	const paths = issues.map((issue) => issue.path).sort();
	assert.deepEqual(paths, ['allow_custom', 'options']);
});

test('formatIssues 把错误打成一行', () => {
	const text = formatIssues([
		{ path: 'options', message: '必填，但没给' },
		{ path: 'mode', message: '只能是 "ask" / "auto"' },
	]);
	assert.equal(text, 'options：必填，但没给；mode：只能是 "ask" / "auto"');
});

/* ─────────── 词表 ─────────── */

test('actionCatalog 给出每个行动的字段清单，必填带星号', () => {
	const text = actionCatalog();
	assert.match(text, /^\s*textarea\(value\*, placeholder, rows\)$/mu);
	assert.match(text, /^\s*choose\(options\*, picked, allow_custom, allow_defer\)$/mu);
	assert.match(text, /^\s*derive\(templates\*, mode\)$/mu);
});

test('词表每条一个行动，数量对得上', () => {
	const lines = actionCatalog().split('\n');
	assert.equal(lines.length, listActionNames().length);
});
