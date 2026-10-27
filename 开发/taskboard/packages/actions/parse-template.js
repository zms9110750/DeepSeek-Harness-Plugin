/**
 * 从模板 YAML 里读出 `body` 的章节。
 *
 * ## 为什么单独写，不复用 parseTemplateMeta
 *
 * `parseTemplateMeta` 是「只读顶层字段」的极简解析器 ——
 * 它**主动跳过所有缩进行**（`if (/^\s/u.test(line)) continue;`），
 * 所以嵌套的 `body:` 它一个字都读不到。那是刻意的：顶层字段不需要
 * 处理缩进，写起来最稳。
 *
 * `body` 是「列表套对象」，必须处理缩进。但也不需要完整 YAML 解析器 ——
 * 模板是我们自己写的，结构固定：
 *
 * ```yaml
 * body:
 *   - type: textarea          ← 缩进 2，`- ` 开头，新的一项
 *     id: want                ← 缩进 4
 *     label: 要什么            ← 缩进 4
 *     validations:
 *       required: true        ← 缩进 6（嵌套，这里不关心）
 * ```
 *
 * 所以策略是：**只在 `body:` 之后、遇到缩进 0 的行之前**扫，
 * 收集 `- type:` 开头的项，以及每个项下缩进 4 的 `id:` / `label:`。
 * 更深缩进（`validations:` 之类）整块忽略。
 *
 * ## 支持的 type 写法
 *
 * ```yaml
 * type: textarea              单个
 * type: [textarea, choose]    多个
 * ```
 *
 * @module @local/taskboard-actions/parse-template
 */

/**
 * 一个章节。
 *
 * @typedef {object} TemplateSection
 * @property {string} label    章节标题（正文里就是 `## <label>`）
 * @property {string} id       字段名（模板没写 id 时等于 label）
 * @property {string[]} type   允许的行动名
 * @property {boolean} required 是否必填
 */

/**
 * 读模板 YAML 里的章节。
 *
 * @param {string} source 模板 YAML 全文
 * @returns {TemplateSection[]} 章节列表（按出现顺序）；没有 body 时返回空数组
 */
export function parseTemplateSections(source) {
	const lines = String(source ?? '').split(/\r?\n/u);
	const sections = [];

	/* 先找到 `body:` 这一行 —— 它必须是顶格（缩进 0）。 */
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
	const flush = () => {
		if (current !== null && current.label !== '') sections.push(current);
		current = null;
	};

	for (let index = start; index < lines.length; index += 1) {
		const line = lines[index];

		/* 空行和注释跳过，但**不结束** body 区 */
		if (line.trim() === '' || line.trim().startsWith('#')) continue;

		/* 缩进 0 的下一行 = body 结束（比如后面的 `hints:`） */
		if (!/^\s/u.test(line)) break;

		/* `  - type: xxx` —— 新的一项 */
		const itemMatch = /^\s+-\s+type:\s*(.+)$/u.exec(line);
		if (itemMatch !== null) {
			flush();
			current = { label: '', id: '', type: parseTypeValue(itemMatch[1]), required: false };
			continue;
		}

		if (current === null) continue;

		/*
		 * 项内的字段，注意两处缩进不同：
		 *
		 * ```yaml
		 *   - type: textarea
		 *     id: want              ← 缩进 4，直接挂在项上
		 *     attributes:
		 *       label: 要什么          ← 缩进 6，在 attributes 里面
		 * ```
		 *
		 * 这是 GitHub issue forms 的格式：`id` / `type` / `validations` 在项上，
		 * 显示用的 `label` / `description` 在 `attributes` 里。
		 */
		const fieldMatch = /^ {4}([a-z_]+):\s*(.*)$/u.exec(line);
		if (fieldMatch !== null) {
			const key = fieldMatch[1];
			const value = unquote(fieldMatch[2].trim());
			if (key === 'id') current.id = value;
			else if (key === 'type') current.type = parseTypeValue(value);
			continue;
		}

		/* 缩进 6：attributes 里的 label，或 validations 里的 required */
		const deepMatch = /^ {6}([a-z_]+):\s*(.*)$/u.exec(line);
		if (deepMatch !== null) {
			const key = deepMatch[1];
			const value = unquote(deepMatch[2].trim());
			if (key === 'label' && current.label === '') current.label = value;
			else if (key === 'required') current.required = value === 'true';
		}
	}

	flush();

	/* 没写 id 的用 label 兜底 —— 正文里两者本来就是同一个名字。 */
	for (const section of sections) {
		if (section.id === '') section.id = section.label;
	}
	return sections;
}

/**
 * 解析 `type:` 的值，接受两种写法。
 *
 * ```yaml
 * type: textarea
 * type: [textarea, choose]
 * type: ["textarea", "choose"]
 * ```
 *
 * @param {string} raw
 * @returns {string[]}
 */
function parseTypeValue(raw) {
	const text = String(raw ?? '').trim();
	const inner = /^\[(.*)\]$/u.exec(text);
	if (inner === null) {
		const single = unquote(text);
		return single === '' ? [] : [single];
	}
	return inner[1]
		.split(',')
		.map((part) => unquote(part.trim()))
		.filter((part) => part !== '');
}

/**
 * 去掉 YAML 里的引号。
 *
 * @param {string} text
 * @returns {string}
 */
function unquote(text) {
	const trimmed = String(text ?? '').trim();
	if (trimmed.length >= 2 && (trimmed[0] === '"' || trimmed[0] === "'") && trimmed[trimmed.length - 1] === trimmed[0]) {
		return trimmed.slice(1, -1);
	}
	return trimmed;
}
