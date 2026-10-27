/**
 * 从基线生成沙盘两份 HTML。
 *
 * ## 为什么要生成而不是手改
 *
 * 手改 HTML 出过好几次事故：
 *   · 替换一段代码时把「状态模型」整块删了，KIND_COLOR 未定义
 *   · 文件被截断后残片又接在 </html> 后面，出现两个 </script>
 *   · 替换文本里恰好有 `$`，被 String.replace 当成 `$&` 之类的模式展开
 *
 * 根因都是「用文本替换改一整块代码」—— 边界算错就悄悄坏掉。
 *
 * 所以改成：基线 + 独立代码段 + 生成，并且：
 *   · 每一处替换都用 `cut`（按字面量，不解释 `$`）
 *   · 生成后自检标签平衡 + 函数不重复 + 语法可解析，不合格直接抛错
 *
 * 用法：node build-sandbox.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (name) => readFileSync(join(HERE, name), 'utf8');

const BASE = read('../形态快照-可交互.html');
const TREE = read('_src/tree.js');
const MODAL = read('_src/modal.js');
const SECTIONS = read('_src/sections.js');
const STYLES = read('_src/styles.css');
const STORE = read('_src/store.js');
const BOOT = read('_src/boot.js');

/**
 * 按字面量替换（不解释 `$&` / `$1`）。
 *
 * @param {string} text
 * @param {string} search
 * @param {string} replacement
 * @param {boolean} [required]
 * @returns {string}
 */
function cut(text, search, replacement, required = true) {
	const at = text.indexOf(search);
	if (at < 0) {
		if (required) throw new Error('找不到：' + search.slice(0, 60).replace(/\n/gu, '⏎'));
		return text;
	}
	return text.slice(0, at) + replacement + text.slice(at + search.length);
}

/**
 * 替换一个区间（从 from 到 to 之前）。
 *
 * @param {string} text
 * @param {string} from
 * @param {string} to
 * @param {string} replacement
 * @returns {string}
 */
function cutRange(text, from, to, replacement) {
	const start = text.indexOf(from);
	if (start < 0) throw new Error('区间起点找不到：' + from.slice(0, 40));
	const end = text.indexOf(to, start);
	if (end < 0) throw new Error('区间终点找不到：' + to.slice(0, 40));
	return text.slice(0, start) + replacement + text.slice(end);
}

