/**
 * 模板章节解析的自检。
 *
 * v2 格式（当前）：
 *
 * ```yaml
 * body:
 *   - id: want
 *     type:
 *       markdown: 说明
 *       ask: 另一个说明
 *     description: |
 *       块标量
 *     required: true
 * ```
 *
 * v1 格式（旧模板还没迁移）：
 *
 * ```yaml
 * body:
 *   - type: textarea
 *     id: want
 *     attributes:
 *       label: 要什么
 *     validations:
 *       required: true
 * ```
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { parseTemplateSections } from '../parse-template.js';

test('v2：type 是 map，key 是行动名，value 是说明', () => {
	const sections = parseTemplateSections(`body:
  - id: want
    type:
      markdown: 这一份只写用户要什么
      ask: 这个路径很明确
      tab: 可以有多种回答方式
`);
	assert.equal(sections.length, 1);
	assert.deepEqual(Object.keys(sections[0].type), ['markdown', 'ask', 'tab']);
	assert.equal(sections[0].type.markdown, '这一份只写用户要什么');
	assert.equal(sections[0].type.tab, '可以有多种回答方式');
});

test('v2：description 块标量被正确读取，公共缩进去掉', () => {
	const sections = parseTemplateSections(`body:
  - id: want
    type:
      textarea: 写点什么
    description: |
      用户原话优先。不要改写。
      如果说了好几句，就按顺序抄下来。
`);
	assert.equal(sections[0].description, '用户原话优先。不要改写。\n如果说了好几句，就按顺序抄下来。');
});

test('v2：required 从缩进 4 读', () => {
	const sections = parseTemplateSections(`body:
  - id: a
    type:
      textarea: x
    required: true
  - id: b
    type:
      textarea: y
`);
	assert.equal(sections[0].required, true);
	assert.equal(sections[1].required, false);
});

test('v2：多个章节按顺序读，不串字段', () => {
	const sections = parseTemplateSections(`body:
  - id: notice
    type:
      markdown: 说明文字
  - id: want
    type:
      textarea: 用户要什么
    required: true
  - id: split
    type:
      textarea: 拆成哪些
      derive: 派生子任务
`);
	assert.deepEqual(sections.map((s) => s.id), ['notice', 'want', 'split']);
	assert.deepEqual(Object.keys(sections[0].type), ['markdown']);
	assert.deepEqual(Object.keys(sections[1].type), ['textarea']);
	assert.deepEqual(Object.keys(sections[2].type), ['textarea', 'derive']);
	assert.equal(sections[0].required, false);
	assert.equal(sections[1].required, true);
});

test('v1 兼容：单个 type', () => {
	const sections = parseTemplateSections(`body:
  - type: textarea
    id: want
    attributes:
      label: 要什么
    validations:
      required: true
`);
	assert.equal(sections.length, 1);
	assert.deepEqual(Object.keys(sections[0].type), ['textarea']);
	assert.equal(sections[0].label, '要什么');
	assert.equal(sections[0].required, true);
});

test('v1 兼容：数组 type', () => {
	const sections = parseTemplateSections(`body:
  - type: [textarea, derive]
    id: split
`);
	assert.deepEqual(Object.keys(sections[0].type), ['textarea', 'derive']);
});

test('没有 body 时返回空数组', () => {
	assert.deepEqual(parseTemplateSections('name: X\nkind: goal\n'), []);
	assert.deepEqual(parseTemplateSections(''), []);
	assert.deepEqual(parseTemplateSections(null), []);
});

test('body 在同一文件中间也能读到（后面还有别的顶层字段）', () => {
	const sections = parseTemplateSections(`name: X
body:
  - id: a
    type:
      textarea: x
hints:
  create: |
    一些提示
`);
	assert.equal(sections.length, 1);
	assert.equal(sections[0].id, 'a');
});

test('没有 id 的章节被丢掉（没法索引正文）', () => {
	const sections = parseTemplateSections(`body:
  - type: markdown
    attributes:
      value: 只读说明，没有 id
  - id: real
    type:
      textarea: x
`);
	assert.deepEqual(sections.map((s) => s.id), ['real']);
});

test('label 默认等于 id', () => {
	const sections = parseTemplateSections(`body:
  - id: want
    type:
      textarea: x
`);
	assert.equal(sections[0].label, 'want');
});

test('注释行和空行不影响解析', () => {
	const sections = parseTemplateSections(`body:
  # 这一行是注释
  - id: want

    type:
      # 里面也有注释
      textarea: x
`);
	assert.equal(sections.length, 1);
	assert.deepEqual(Object.keys(sections[0].type), ['textarea']);
});
