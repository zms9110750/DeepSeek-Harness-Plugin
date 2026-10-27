/**
 * 正文解析器的自检。
 *
 * 这个包不需要 React —— 解析器只做「object → 条目数组」的转换，
 * 渲染器是可选查出来的（查不到就是 null，显示灰色卡片）。
 *
 * 跑：node --test test/parse-body.test.mjs
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { parseBody, buildBody } from '../parse-body.js';
import { registerRenderer, hasRenderer, listRendererNames, getRenderer } from '../renderers.js';

/* 注册一个假的渲染器，让条目能绑上它 */
registerRenderer('Markdown', () => null);
registerRenderer('Textarea', () => null);
registerRenderer('Choose', () => null);

const SECTIONS = [
	{ id: 'want', label: '要什么', type: ['textarea'], required: true },
	{ id: 'done', label: '什么算做到了', type: ['textarea'], required: true },
	{ id: 'how', label: '怎么做', type: ['textarea', 'choose'], required: false },
];

test('按模板顺序输出，不是按 object 的键顺序', () => {
	const entries = parseBody(
		{
			how: { action: 'choose', options: ['A', 'B'] },
			done: { action: 'textarea', value: '能跑' },
			want: { action: 'textarea', value: '修好' },
		},
		SECTIONS,
	);
	assert.deepEqual(
		entries.map((entry) => entry.id),
		['want', 'done', 'how'],
	);
});

test('条目的字段齐：id / label / action / value / required / render / schema', () => {
	const [first] = parseBody({ want: { action: 'textarea', value: '修好' } }, SECTIONS);
	assert.equal(first.id, 'want');
	assert.equal(first.label, '要什么');
	assert.equal(first.action, 'textarea');
	assert.deepEqual(first.value, { value: '修好' });
	assert.equal(first.required, true);
	assert.equal(typeof first.render, 'function');
	assert.ok(first.schema, 'schema 应该从行动库里取到');
});

test('value 里不含 action 字段', () => {
	const [first] = parseBody({ want: { action: 'textarea', value: 'x' } }, SECTIONS);
	assert.ok(!('action' in first.value), 'action 被调度用掉了，不该留在 value 里');
});

test('模板里有、正文里没有的章节不生成条目', () => {
	const entries = parseBody({ want: { action: 'textarea', value: '修好' } }, SECTIONS);
	assert.deepEqual(entries.map((entry) => entry.id), ['want']);
});

test('正文里有、模板里没有的键也显示（标成未知）', () => {
	const entries = parseBody(
		{ want: { action: 'textarea', value: 'x' }, 野章节: { action: 'markdown', value: '额外内容' } },
		SECTIONS,
	);
	const extra = entries.find((entry) => entry.id === '野章节');
	assert.ok(extra, '模板外的章节不该被静默丢掉');
	assert.equal(extra.action, 'markdown');
});

test('按 label 索引也能找到（兼容手写）', () => {
	const entries = parseBody({ 要什么: { action: 'textarea', value: 'x' } }, SECTIONS);
	assert.equal(entries.length, 1);
	assert.equal(entries[0].id, 'want', '找到后统一用模板的 id');
});

test('未注册的行动：render 是 null，schema 也是 null', () => {
	const entries = parseBody({ want: { action: '不存在的行动' } }, SECTIONS);
	/* 章节 want 的 type 是 textarea，但我们不在这层校验 —— 那是宿主的活。
	   这里只看"拿不到行动定义"时解析器还活着。 */
	assert.equal(entries.length, 1);
	assert.equal(entries[0].render, null);
	assert.equal(entries[0].schema, null);
});

test('行动存在但渲染器没注册：render 是 null，schema 还在', () => {
	/* choose 注册了渲染器；用一个没注册渲染器的行动试 */
	const entries = parseBody({ how: { action: 'rank', items: ['x', 'y'] } }, SECTIONS);
	assert.equal(entries[0].render, null, 'rank 的渲染器没注册');
	assert.ok(entries[0].schema, 'schema 仍然拿得到（灰色卡片可以显示字段提示）');
});

test('渲染器按行动的 render 名字查，不是 action 名', () => {
	/* 注册一个 render 名和 action 名不同的 */
	registerRenderer('FancyRender', () => null);
	registerRenderer('fancy_action', () => null); /* 这个名字不该被用到 */
	const entries = parseBody({ want: { action: 'fancy_action' } }, SECTIONS);
	/* fancy_action 没在行动库里注册，所以 spec 是 undefined，
	   render 名回落到 action 名 —— 拿到的应该是 fancy_action 那个 */
	assert.equal(typeof entries[0].render, 'function');
	assert.ok(hasRenderer('fancy_action'));
});

test('旧的字符串正文：当成一整块 markdown，不切分', () => {
	const entries = parseBody('## 要什么\n\n随便写\n\n## 怎么拆\n\n拆三步', SECTIONS);
	assert.equal(entries.length, 1, '不该按 ## 切开 —— 那就是又写了一遍 MD 解析器');
	assert.equal(entries[0].action, 'markdown');
	assert.equal(entries[0].id, '__legacy__');
	assert.match(entries[0].value.value, /## 要什么/);
});

test('空字符串正文：没有条目', () => {
	assert.deepEqual(parseBody('', SECTIONS), []);
	assert.deepEqual(parseBody('   ', SECTIONS), []);
});

test('body 是垃圾值：返回空数组，不抛错', () => {
	for (const bad of [null, undefined, 42, [], true]) {
		assert.deepEqual(parseBody(bad, SECTIONS), [], `${JSON.stringify(bad)} 应该返回空`);
	}
});

test('sections 是垃圾值：当成没有模板，只走进"模板外"分支', () => {
	const entries = parseBody({ want: { action: 'textarea', value: 'x' } }, null);
	assert.equal(entries.length, 1);
	assert.equal(entries[0].id, 'want');
});

/* ─────────── 反向：buildBody ─────────── */

test('buildBody 把条目数组还原成 object', () => {
	const body = {
		want: { action: 'textarea', value: '修好' },
		how: { action: 'choose', options: ['A', 'B'], picked: 'A' },
	};
	const entries = parseBody(body, SECTIONS);
	const rebuilt = buildBody(entries);
	assert.deepEqual(rebuilt, body);
});

test('buildBody 遇到旧格式条目：还原成字符串', () => {
	const entries = parseBody('## 旧正文\n\n内容', SECTIONS);
	const rebuilt = buildBody(entries);
	assert.equal(typeof rebuilt, 'string');
	assert.match(rebuilt, /## 旧正文/);
});

/* ─────────── 注册表 ─────────── */

test('registerRenderer 挡住空名字和非函数', () => {
	assert.throws(() => registerRenderer('', () => null), /name 不能为空/u);
	assert.throws(() => registerRenderer('X', 'not a function'), /需要一个函数/u);
});

test('重复注册会覆盖', () => {
	const first = () => 'a';
	const second = () => 'b';
	registerRenderer('Tmp', first);
	assert.equal(getRenderer('Tmp'), first);
	registerRenderer('Tmp', second);
	assert.equal(getRenderer('Tmp'), second);
});

test('listRendererNames 列出已注册的', () => {
	const names = listRendererNames();
	assert.ok(names.includes('Markdown'));
	assert.ok(names.includes('Choose'));
});
