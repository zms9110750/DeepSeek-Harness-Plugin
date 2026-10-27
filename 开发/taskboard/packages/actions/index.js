/**
 * 行动库 —— 每种行动一份 JSON Schema。
 *
 * ## 这一层是什么
 *
 * 「行动」回答的是**一个 object 该有哪几个字段**。
 * 能描述这件事的只能是架构（JSON Schema），不能是代码 —— 代码只能校验，
 * 而校验规则本身还得再描述一遍，那就是两处真相。
 *
 * 所以这里每个行动只有三样东西：
 *
 *   name    唯一标识（章节里 `type:` 引用的就是它）
 *   schema  JSON Schema 的 properties 部分 + required
 *   render  渲染器标识（告诉 UI 用哪个组件画，**不含代码**）
 *
 * ## 为什么不含渲染代码
 *
 * 宿主跑在 Node，UI 跑在浏览器，两者跨进程。渲染函数（React 组件）
 * 过不去；能过去的只有数据。所以这里只给「用哪个渲染器」的名字，
 * 真正的组件在客户端按名字查。
 *
 * 好处是：这个包**零依赖、可在任何一侧 import** ——
 * 宿主拿它做校验，客户端拿它做兜底提示，测试拿它跑用例。
 *
 * ## 和「模板」的关系
 *
 * 正交。模板的 `body` 里写 `type: [textarea, choose]`，那是**引用**行动名，
 * 不是说模板定义了行动。模板不知道 `choose` 有哪些字段，
 * 它只知道「这一章可以是 choose」。
 *
 * ## 和「传参」的关系
 *
 * 传参是工具调用面的事。工具面收到参数后，按章节声明的 action 取这里的
 * schema 校验；过不了就拒绝整个提案，计划根本不进任务板。
 *
 * @module @local/taskboard-actions
 */

/**
 * 行动定义表。
 *
 * 每项形如：
 * ```js
 * {
 *   name: 'choose',
 *   summary: '一句话说明（给人和模型看，别写长文）',
 *   render: 'Choose',
 *   schema: {
 *     required: ['options'],
 *     properties: { ... },
 *   },
 * }
 * ```
 *
 * `schema` 用的是 JSON Schema 的一个子集（够用就行，不追求完整）：
 *   type / properties / required / items / enum / minItems / maxItems
 *   / minimum / maximum / additionalProperties
 */
const ACTIONS = new Map();

/**
 * 注册一个行动。
 *
 * @param {object} action
 * @param {string} action.name    唯一标识，同时也是章节 `type:` 里写的名字
 * @param {string} action.summary 一句话说明
 * @param {string} action.render  渲染器标识（客户端按它查组件）
 * @param {object} action.schema  { required?: string[], properties: object }
 * @returns {void}
 */
export function defineAction(action) {
	if (action === null || typeof action !== 'object') throw new TypeError('defineAction: 需要对象');
	const name = String(action.name ?? '').trim();
	if (name === '') throw new TypeError('defineAction: name 不能为空');
	if (!/^[a-z][a-z0-9_]*$/u.test(name)) {
		throw new TypeError(`defineAction: name 只能是小写字母开头、字母数字下划线，收到「${name}」`);
	}
	const schema = action.schema;
	if (schema === null || typeof schema !== 'object') throw new TypeError(`defineAction(${name}): schema 必须是对象`);
	const properties = schema.properties;
	if (properties === null || typeof properties !== 'object') {
		throw new TypeError(`defineAction(${name}): schema.properties 必须是对象`);
	}
	/*
	 * required 里写的字段必须真的在 properties 里。
	 * 这个错很常见（改名后忘了同步），而且只在运行时校验才会暴露，
	 * 所以在注册时就挡住。
	 */
	for (const key of Array.isArray(schema.required) ? schema.required : []) {
		if (!(key in properties)) {
			throw new TypeError(`defineAction(${name}): required 里的「${key}」不在 properties 中`);
		}
	}
	ACTIONS.set(name, {
		name,
		summary: String(action.summary ?? '').trim(),
		render: String(action.render ?? name),
		schema: {
			type: 'object',
			/*
			 * 只有**明确写 `false`** 才拦多余字段。
			 *
			 * 原来写的是 `schema.additionalProperties === true`，
			 * 于是没声明的行动会变成 `false`，等于默认不许带额外字段 ——
			 * 这和 JSON Schema 的默认行为相反（默认是允许）。
			 *
			 * 保留 `undefined` 而不是归一成布尔，是为了让"没声明"和
			 * "声明了允许"可区分：前者以后加字段不用改所有行动的定义。
			 */
			...(schema.additionalProperties === undefined ? {} : { additionalProperties: schema.additionalProperties }),
			required: Array.isArray(schema.required) ? schema.required.slice() : [],
			properties,
		},
	});
}

/** 取一个行动（未注册返回 undefined）。 */
export function getAction(name) {
	return ACTIONS.get(String(name ?? '').trim());
}

/** 是否认识这个行动名。 */
export function hasAction(name) {
	return ACTIONS.has(String(name ?? '').trim());
}

/** 全部行动名（按注册顺序）。 */
export function listActionNames() {
	return [...ACTIONS.keys()];
}

/** 全部行动定义（深拷贝，调用方改了不影响表）。 */
export function listActions() {
	return [...ACTIONS.values()].map((action) => ({
		...action,
		schema: {
			...action.schema,
			required: action.schema.required.slice(),
			properties: { ...action.schema.properties },
		},
	}));
}

/**
 * 给模型看的行动词表（**多行字符串**，一行一个）。
 *
 * 直接拼进工具参数描述里用，和 `typeCatalog()` 同一招：
 * 模型不需要读代码就知道有哪些行动。
 *
 * 返回字符串而不是数组，是因为唯一的用途就是拼进 description ——
 * 让调用方再 `join('\n')` 一次是多余的。
 *
 * 格式：`name(field*, optional, …)`，星号标必填。
 */
export function actionCatalog() {
	return [...ACTIONS.values()]
		.map((action) => {
			const fields = Object.keys(action.schema.properties);
			const req = action.schema.required;
			const mark = fields.map((key) => (req.includes(key) ? `${key}*` : key)).join(', ');
			return `  ${action.name}(${mark})`;
		})
		.join('\n');
}

/* ─────────────────────────────────────────────────────────────
 * 内置行动
 * ───────────────────────────────────────────────────────────── */

/*
 * 前三个是**现在就有**的（模板里已经在用，客户端已经能渲染），
 * 只是以前没有成体系。把它们收进注册表，不改变任何现有行为。
 */

defineAction({
	name: 'markdown',
	summary: '只读的一段说明，不收集数据',
	render: 'Markdown',
	schema: {
		required: ['value'],
		properties: {
			value: { type: 'string', description: 'Markdown 文本' },
		},
	},
});

defineAction({
	name: 'textarea',
	summary: '多行文本输入',
	render: 'Textarea',
	schema: {
		required: ['value'],
		properties: {
			value: { type: 'string', description: '填进去的文字' },
			placeholder: { type: 'string', description: '输入框的灰字提示' },
			rows: { type: 'integer', minimum: 1, maximum: 20, description: '初始行数' },
		},
	},
});

defineAction({
	name: 'input',
	summary: '单行文本输入',
	render: 'Input',
	schema: {
		required: ['value'],
		properties: {
			value: { type: 'string', description: '填进去的文字' },
			placeholder: { type: 'string', description: '输入框的灰字提示' },
		},
	},
});

/*
 * 下面三个是新的 —— 需要结构，纯文本表达不了。
 */

defineAction({
	name: 'choose',
	summary: '从几个互斥选项里挑一个',
	render: 'Choose',
	schema: {
		required: ['options'],
		properties: {
			options: {
				type: 'array',
				minItems: 2,
				items: { type: 'string' },
				description: '候选项，至少两个',
			},
			picked: {
				type: 'string',
				description: '已选中的那一项；没选就是空',
			},
			allow_custom: {
				type: 'boolean',
				description: '允许「都不是，我自己写一句」',
			},
			allow_defer: {
				type: 'boolean',
				description: '允许「先不选，要更多信息」',
			},
		},
	},
});

defineAction({
	name: 'rank',
	summary: '给一组东西排先后顺序',
	render: 'Rank',
	schema: {
		required: ['items'],
		properties: {
			items: {
				type: 'array',
				minItems: 1,
				items: { type: 'string' },
				description: '条目，顺序就是当前排出的先后',
			},
			keep: {
				type: 'array',
				items: { type: 'string' },
				description: '本轮要做的那些；不在其中的进「搁置」',
			},
		},
	},
});

defineAction({
	name: 'derive',
	summary: '从这一条派生子任务',
	render: 'Derive',
	schema: {
		required: ['templates'],
		properties: {
			templates: {
				type: 'array',
				minItems: 1,
				items: { type: 'string' },
				description: '可以派生的模板编号，如 ["WR","DP"]',
			},
			mode: {
				type: 'string',
				enum: ['ask', 'auto', 'manual'],
				description: '授权档：ask=问你（默认）/ auto=直接建 / manual=只能你建',
			},
		},
	},
});

/* 内置行动在模块加载时注册完毕，不需要 apply()。 */

/* ─────────────────────────────────────────────────────────────
 * 校验：只执行 schema，不写行动专属逻辑
 * ───────────────────────────────────────────────────────────── */

/**
 * 一条校验错误。
 *
 * @typedef {object} ValidationIssue
 * @property {string} path 出错的字段路径，如 `options.0` 或 `picked`
 * @property {string} message 给人看的一句话
 */

/**
 * 校验一个值是否符合 schema。
 *
 * **不抛异常** —— 返回错误数组。调用方决定怎么处置（工具面是拒绝并报错，
 * UI 是不渲染）。
 *
 * @param {object} schema
 * @param {unknown} value
 * @param {string} [path] 起始路径（递归用）
 * @returns {ValidationIssue[]} 空数组 = 通过
 */
function validate(schema, value, path = '') {
	/** @type {ValidationIssue[]} */
	const issues = [];
	walk(schema, value, path, issues);
	return issues;
}

/**
 * 内部递归。
 *
 * @param {object} schema
 * @param {unknown} value
 * @param {string} path
 * @param {ValidationIssue[]} issues
 */
function walk(schema, value, path, issues) {
	if (schema === null || typeof schema !== 'object') return;
	const at = path === '' ? '（根）' : path;

	/* ── type ── */
	if (typeof schema.type === 'string') {
		if (!matchesType(schema.type, value)) {
			issues.push({ path: at, message: `应该是 ${typeName(schema.type)}，实际是 ${actualName(value)}` });
			return; /* 类型都不对，后面的判断没有意义 */
		}
	}

	/* ── enum ── */
	if (Array.isArray(schema.enum) && !schema.enum.some((allowed) => allowed === value)) {
		issues.push({
			path: at,
			message: `只能是 ${schema.enum.map((item) => JSON.stringify(item)).join(' / ')}，实际是 ${JSON.stringify(value)}`,
		});
	}

	/* ── 字符串长度 ── */
	if (typeof value === 'string') {
		if (typeof schema.minLength === 'number' && value.length < schema.minLength) {
			issues.push({ path: at, message: `至少要 ${schema.minLength} 个字` });
		}
		if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) {
			issues.push({ path: at, message: `最多 ${schema.maxLength} 个字` });
		}
	}

	/* ── 数字范围 ── */
	if (typeof value === 'number') {
		if (typeof schema.minimum === 'number' && value < schema.minimum) {
			issues.push({ path: at, message: `不能小于 ${schema.minimum}` });
		}
		if (typeof schema.maximum === 'number' && value > schema.maximum) {
			issues.push({ path: at, message: `不能大于 ${schema.maximum}` });
		}
	}

	/* ── 数组 ── */
	if (Array.isArray(value)) {
		if (typeof schema.minItems === 'number' && value.length < schema.minItems) {
			issues.push({ path: at, message: `至少 ${schema.minItems} 项` });
		}
		if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) {
			issues.push({ path: at, message: `最多 ${schema.maxItems} 项` });
		}
		if (schema.items !== null && typeof schema.items === 'object') {
			value.forEach((item, index) => {
				walk(schema.items, item, `${path === '' ? '' : path + '.'}${index}`, issues);
			});
		}
	}

	/* ── 对象 ── */
	if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
		const properties = schema.properties !== null && typeof schema.properties === 'object' ? schema.properties : {};
		const required = Array.isArray(schema.required) ? schema.required : [];

		for (const key of required) {
			const field = value[key];
			/* null 和 undefined 都算没给 —— 「给了个空值」和「没给」在这里没有区别，
			   因为 JSON 里也没有 undefined，null 就是"没有"。 */
			if (field === undefined || field === null) {
				issues.push({ path: join(path, key), message: '必填，但没给' });
			}
		}

		for (const [key, child] of Object.entries(properties)) {
			const field = value[key];
			if (field === undefined || field === null) continue; /* 可选字段没给就跳过 */
			walk(child, field, join(path, key), issues);
		}

		if (schema.additionalProperties === false) {
			for (const key of Object.keys(value)) {
				if (!(key in properties)) {
					issues.push({ path: join(path, key), message: '这个字段不在这份架构里' });
				}
			}
		}
	}
}

/**
 * 拼字段路径。
 *
 * @param {string} parent
 * @param {string} key
 * @returns {string}
 */
function join(parent, key) {
	return parent === '' ? key : `${parent}.${key}`;
}

/**
 * 值是否符合声明的类型。
 *
 * @param {string} type
 * @param {unknown} value
 * @returns {boolean}
 */
function matchesType(type, value) {
	switch (type) {
		case 'object':
			return value !== null && typeof value === 'object' && !Array.isArray(value);
		case 'array':
			return Array.isArray(value);
		case 'string':
			return typeof value === 'string';
		case 'number':
			return typeof value === 'number' && Number.isFinite(value);
		case 'integer':
			return typeof value === 'number' && Number.isInteger(value);
		case 'boolean':
			return typeof value === 'boolean';
		case 'null':
			return value === null;
		default:
			return true; /* 不认识的类型不拦，交给上层 */
	}
}

/**
 * 类型的中文名。
 *
 * @param {string} type
 * @returns {string}
 */
function typeName(type) {
	return {
		object: '对象',
		array: '数组',
		string: '文本',
		number: '数字',
		integer: '整数',
		boolean: '布尔',
		null: '空',
	}[type] ?? type;
}

/**
 * 值的中文类型名（报错用）。
 *
 * @param {unknown} value
 * @returns {string}
 */
function actualName(value) {
	if (value === null) return '空';
	if (Array.isArray(value)) return '数组';
	return typeName(typeof value);
}

/**
 * 把错误数组打成一行（塞进工具返回用）。
 *
 * @param {ValidationIssue[]} issues
 * @returns {string}
 */
function formatIssues(issues) {
	return issues.map((issue) => `${issue.path}：${issue.message}`).join('；');
}

export { validate, formatIssues };
