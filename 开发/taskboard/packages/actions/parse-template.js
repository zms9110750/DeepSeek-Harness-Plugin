/**
 * 从模板 YAML 里读出章节。
 *
 * ## 为什么单独写，不复用 parseTemplateMeta
 *
 * `parseTemplateMeta` 是「只读顶层字段」的极简解析器 ——
 * 它**主动跳过所有缩进行**，所以嵌套的 `body:` 它一个字都读不到。
 *
 * `body` 是「列表套对象」，必须处理缩进。但也不需要完整 YAML 解析器 ——
 * 模板是我们自己写的，结构固定。
 *
 * ## 格式（v2）
 *
 * ```yaml
 * body:
 *   - id: want
 *     type:
 *       markdown: 这一份只写"用户要什么"，方案和执行都派生出去。
 *       ask: 用户要什么？
 *     description: 用户原话优先。
 *     required: true
 *
 *   - id: split
 *     type:
 *       textarea: 拆成哪些设计 / 工作
 *       derive: 从这一条派生子任务
 * ```
 *
 * `type` 是一个 **map**：key 是行动名，value 是这一章用该行动时的说明。
 *
 * 用户原话：
 *
 *   > body里面写type，里面写object。string:string。左边string是模板名字。
 *   > 右边string是描述。也就是说，这样写。
 *   > type:
 *   >   markdown: 这一份只写用户要什么
 *   >   ask: 这个路径很明确，把选项让用户决策
 *   >   tab: 可以有多种回答方式。
 *
 * ### 为什么说明写在 type 里面
 *
 *   > 行为的架构里面也一定要写能放说明的地方。因为基于行为进行渲染。
 *   > 所以这个模板怎么用的是肯定与参数无关了。
 *
 * 同一章用 `markdown` 画和用 `tab` 画，要给的说明不一样，
 * 所以说明必须跟着行动走，不能挂在章节上。
 *
 * ## 还兼容旧写法
 *
 *   type: textarea          （v1）
 *   type: [textarea, derive]（v1 数组）
 *
 * 旧模板还没迁移，读的时候归一成 v2 的形状（`{ textarea: '' }`）。
 *
 * @module @local/taskboard-actions/parse-template
 */

/**
 * 一个章节。
 *
 * @typedef {object} TemplateSection
 * @property {string} id        字段名（正文里按它索引）
 * @property {string} label     显示标题（没写就用 id）
 * @property {Record<string, string>} type  允许的行动 → 说明
 * @property {boolean} required 是否必填
 * @property {string} description 章节级说明（type 里没给说明时的兜底）
 */

/**
 * 读模板 YAML 里的章节。
 *
 * @param {string} source 模板 YAML 全文
 * @returns {TemplateSection[]}
 */
export function parseTemplateSections(source) {
	const lines = String(source ?? '').split(/\r?\n/u);
	const sections = [];

	/* 先找到 `body:` 这一行 —— 它必须是顶格。 */
	let start = -1;
	for (let index = 0; index < lines.length; index += 1) {
		if (/^body:\s*$/u.test(lines[index])) {
			start = index + 1;
			break;
		}
	}
	if (start === -1) return sections;

	/** @type {TemplateSection | null} */
	let current = null;
	/** 当前是否在读 `type:` 的子映射。 */
	let inTypeBlock = false;

	const flush = () => {
		if (current !== null && current.id !== '') sections.push(current);
		current = null;
		inTypeBlock = false;
	};

	for (let index = start; index < lines.length; index += 1) {
		const line = lines[index];

		/* 空行和注释跳过，但不结束 body 区（`type:` 块里也可能有空行）。 */
		if (line.trim() === '' || line.trim().startsWith('#')) continue;

		/* 缩进 0 的下一行 = body 结束（比如后面的 `hints:`）。 */
		if (!/^\s/u.test(line)) break;

		/* `  - id: xxx` 或 `  - type: xxx` —— 新的一项。 */
		const itemMatch = /^(\s+)-\s+([a-z_]+):\s*(.*)$/u.exec(line);
		if (itemMatch !== null) {
			flush();
			current = { id: '', label: '', type: {}, required: false, description: '' };
			inTypeBlock = false;
			const key = itemMatch[2];
			const value = unquote(itemMatch[3].trim());
			if (key === 'id') current.id = value;
			else if (key === 'type') applyType(current, value);
			else if (key === 'required') current.required = value === 'true';
			else if (key === 'description') current.description = value;
			continue;
		}

		if (current === null) continue;

		/*
		 * `type:` 后面没有同行值 → 接下来缩进更深的行是它的 map。
		 * 这里不能靠固定缩进判断（不同模板可能缩进不同），
		 * 用「比当前行的 `- ` 深」来判。
		 */
		const typeStartMatch = /^\s+type:\s*$/u.exec(line);
		if (typeStartMatch !== null) {
			inTypeBlock = true;
			continue;
		}

		/* type 块里的 `      markdown: 说明` —— key 是行动名 */
		if (inTypeBlock) {
			const entryMatch = /^\s{6,}([a-z][a-z0-9_]*):\s*(.*)$/u.exec(line);
			if (entryMatch !== null) {
				current.type[entryMatch[1]] = unquote(entryMatch[2].trim());
				continue;
			}
			/* 缩进退回 4 格 = type 块结束，落到其它字段 */
			if (/^\s{4}[a-z_]+:/u.test(line)) inTypeBlock = false;
			else continue;
		}

		/* v1 兼容：attributes.label / validations.required 都在缩进 6 那一层 */
		const attrMatch = /^\s{6}label:\s*(.*)$/u.exec(line);
		if (attrMatch !== null && current.label === '') {
			current.label = unquote(attrMatch[1].trim());
			continue;
		}
		const reqMatch = /^\s{6}required:\s*(true|false)\s*$/u.exec(line);
		if (reqMatch !== null) {
			current.required = reqMatch[1] === 'true';
			continue;
		}

		/* 章节级字段（缩进 4） */
		const fieldMatch = /^\s{4}([a-z_]+):\s*(.*)$/u.exec(line);
		if (fieldMatch !== null) {
			const key = fieldMatch[1];
			let value = unquote(fieldMatch[2].trim());
			/*
			 * 块标量：`description: |` 后面缩进更深的若干行是正文。
			 * 不处理的话值会变成字面量 "|"，正文整段丢掉。
			 */
			if (value === '|' || value === '>') {
				const collected = [];
				let cursor = index + 1;
				while (cursor < lines.length && /^\s{6,}\S/u.test(lines[cursor])) {
					collected.push(lines[cursor].replace(/^\s{4}/u, ''));
					cursor += 1;
				}
				/* 去掉公共缩进（最小缩进），保留相对缩进 */
				const indents = collected.filter((l) => l.trim() !== '').map((l) => /^\s*/.exec(l)[0].length);
				const common = indents.length > 0 ? Math.min(...indents) : 0;
				value = collected.map((l) => l.slice(common)).join('\n');
				index = cursor - 1;
			}
			if (key === 'id') current.id = value;
			else if (key === 'required') current.required = value === 'true';
			else if (key === 'label') current.label = value;
			else if (key === 'description') current.description = value;
			else if (key === 'type') applyType(current, value);
			continue;
		}
	}

	flush();

	/* 没有 id 的章节没法索引，丢掉更安全（渲染时由调用方决定怎么提示）。 */
	for (const section of sections) {
		if (section.label === '') section.label = section.id;
	}
	return sections;
}

/**
 * 把 `type:` 的三种写法归一成 map。
 *
 * ```yaml
 * type: textarea                 → { textarea: '' }
 * type: [textarea, derive]       → { textarea: '', derive: '' }
 * type:                          → 由后续行填充
 *   markdown: 说明
 * ```
 *
 * @param {TemplateSection} section
 * @param {string} raw
 */
function applyType(section, raw) {
	const text = String(raw ?? '').trim();
	if (text === '') return; /* 多行写法，后续行填 */

	const inner = /^\[(.*)\]$/u.exec(text);
	if (inner !== null) {
		for (const part of inner[1].split(',')) {
			const name = unquote(part.trim());
			if (name !== '') section.type[name] = '';
		}
		return;
	}

	const single = unquote(text);
	if (single !== '') section.type[single] = '';
}

/**
 * 去掉 YAML 里的引号。
 *
 * @param {string} text
 * @returns {string}
 */
function unquote(text) {
	const trimmed = String(text ?? '').trim();
	if (
		trimmed.length >= 2 &&
		(trimmed[0] === '"' || trimmed[0] === "'") &&
		trimmed[trimmed.length - 1] === trimmed[0]
	) {
		return trimmed.slice(1, -1);
	}
	return trimmed;
}
