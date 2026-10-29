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
 * schema 校验；过不了就拒绝整个提案，任务根本不进任务板。
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
	 * 每个行动都自动带上五个公共字段。
	 *
	 * 用户定的原则：
	 *   > 你的一个架构，就要描述掉一个渲染里的所有可能。
	 *   > 而渲染是有灰色字的，所以你的架构里面就要保留这个字段的可能性，
	 *   > 进行描述出来。
	 *
	 * 所以凡是渲染器会画的**位置**，schema 里必须有字段：
	 *
	 *   placeholder  灰字（输入框里 / 选项下方）
	 *   label        标题（这一章上方那行）
	 *   row          高度（多行控件）
	 *   description  详细说明（控件下方的小字）
	 *   required     必填（星号 + 提交时拦）
	 *
	 * 统一注入而不是每个行动各写一遍：这五个对每个行动的含义都一样，
	 * 漏写一个就会在文档里显得不一致。
	 */
	const COMMON = {
		placeholder: { type: 'string', description: '灰字提示（输入框里 / 选项下方）' },
		label: { type: 'string', description: '这一章上方的标题' },
		row: { type: 'integer', minimum: 1, maximum: 40, description: '高度；1 = 单行' },
		description: { type: 'string', description: '控件下方的详细说明' },
		required: { type: 'boolean', description: '必填（画星号 + 提交时拦）' },
	};
	for (const [key, spec] of Object.entries(COMMON)) {
		if (!(key in properties)) properties[key] = spec;
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
	const key = String(name ?? '').trim();
	const direct = ACTIONS.get(key);
	if (direct !== undefined) return direct;
	/* 别名：textarea → text，choose → ask 之类 */
	const target = ALIASES[key];
	return target === undefined ? undefined : ACTIONS.get(target);
}

/** 是否认识这个行动名。 */
export function hasAction(name) {
	const key = String(name ?? '').trim();
	return ACTIONS.has(key) || ALIASES[key] !== undefined;
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
 *
 * ## 设计原则（用户定的）
 *
 *   > 你的一个架构，就要描述掉一个渲染里的所有可能。
 *   > 而渲染是有灰色字的，所以你的架构里面就要保留这个字段的可能性，
 *   > 进行描述出来。
 *
 * 也就是说：**渲染器画出来的每一个可见位置，schema 里都得有对应的字段**。
 * 画了灰字就必须有 placeholder；画了标题就必须有 label；
 * 能调高度就必须有 row。
 *
 * 不写「给 AI 看的说明」—— 那种东西不该进 schema（AI 从字段名就能懂）。
 * 写进 schema 的每一条，都是界面上真实存在的一个位置。
 *
 * ## 公共字段
 *
 * 下面每个行动都带这五个（由 defineAction 自动注入）：
 *
 *   placeholder   灰字。输入框里 / 选项下方的次要文字
 *   label         标题。这一章上方那行字
 *   row           高度。多行控件生效
 *   description   详细说明。画在控件下方的小字
 *   required      必填。画星号 + 提交时拦
 * ───────────────────────────────────────────────────────────── */

/*
 * text —— 一段可输入的文本。
 *
 * 不再分 input / textarea：两者只差一个 row，分成两个行动
 * 只会让模板作者多记一个名字。row: 1 就是单行。
 */
defineAction({
	name: 'text',
	summary: '一段可输入的文本',
	render: 'Text',
	schema: {
		required: ['value'],
		properties: {
			value: { type: 'string', description: '存下来的内容' },
			row: { type: 'integer', minimum: 1, maximum: 40, description: '高度；1 = 单行' },
			/*
			 * aiWritable —— 这一章 AI 能不能写。
			 *
			 * 默认 false：任务一被采纳，整个正文就锁死，谁都不能改。
			 *
			 * 置 true 之后它变成「进展」：
			 *   · AI 能写
			 *   · 用户也能写
			 *   · **任务采纳之后照样能写，终结之后也能写**
			 *
			 * ## 为什么是 text 的一个属性，不是一个新 action
			 *
			 * 因为文本框前面本来就要有 label / description 说清"这是啥"。
			 * 新开一个 action 只是换个名字，其余全一样 —— 白白多一个名字要记。
			 *
			 * ## 什么时候用
			 *
			 * 这一章的内容是**随时间变化的**，而不是"填一次就定"。
			 * 比如：AI 自己定的阶段目标、阶段性进展记录、卡住时的临时说明。
			 *
			 * 判断标准：这件事在任务被采纳之后还会变吗？
			 * 会 → 置 true。不会 → 保持默认。
			 */
			aiWritable: {
				type: 'boolean',
				description: 'AI 能不能写这一章（true = 采纳后仍可写，终结态也可写）',
			},
		},
	},
});

/*
 * markdown —— 只读的一段富文本。
 *
 * 没有输入框，所以不需要 placeholder；但可能需要 label（章节标题）。
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

/*
 * ask —— 让用户从几个选项里挑，选一个或多个。
 *
 * ## 架构里只描述「能给什么」，不描述「选了什么」
 *
 * 用户原话：
 *
 *   > 1.架构里面不应该允许选定初始值。
 *   > 2.架构里面不允许关闭那个自填按钮。
 *   > 3.架构里面对这个东西接受的应该是数组。
 *   >
 *   > 所以渲染应该总是初始未选择，总是有自定义框。
 *   > 并且模板让你填一个选择，你可以列出来很多选择。
 *
 * 三条合起来是一件事：schema 描述「这一章能让用户从哪些选项里挑」，
 * 不参与「他挑了哪个」—— 后者是运行时的用户输入，不属于架构。
 *
 * 所以去掉了两个字段：
 *
 *   picked / picked_multi   用户的答案，不是架构的一部分
 *   allow_custom            自填按钮永远在，不是可开关的
 *
 * 也把 multi 从「单选/多选的开关」改成「最多能选几个」：
 *
 *   max_picks 不写或 1   单选
 *   max_picks > 1        多选（最多这么多个）
 *
 * 用户答案存在这一章的 picked 里，**永远是数组**，不管单选多选：
 *
 *   []              未选择（初始态）
 *   ['1']           选了第 1 项
 *   ['1','3']       选了第 1、3 项
 *   ['我自己写的']   自填
 *
 * 单选时数组长度最多 1 —— 由运行时保证，不需要 schema 管。
 */
defineAction({
	name: 'ask',
	summary: '让用户从几个选项里挑，可以多选',
	render: 'Ask',
	schema: {
		required: ['options'],
		properties: {
			header: { type: 'string', description: '任务副标题（小字）' },
			question: { type: 'string', description: '任务主标题（大字）' },

			/*
			 * 候选项。
			 *
			 * 「模板让你填一个选择，你可以列出来很多选择」——
			 * 这里列的就是这一个选择里允许的答案。
			 */
			options: {
				type: 'array',
				minItems: 2,
				items: {
					type: 'object',
					required: ['label'],
					properties: {
						label: { type: 'string', description: '选项标题（粗体那行）' },
						description: { type: 'string', description: '选项说明（后面的灰字）' },
						recommended: { type: 'boolean', description: '标一个「推荐」' },
					},
				},
				description: '候选项，至少两个',
			},

			/*
			 * 最多能选几个。不写或 1 = 单选。
			 *
			 * 这取代了原来的 multi 布尔值 —— 布尔值说不出「最多 3 个」。
			 */
			max_picks: {
				type: 'integer',
				minimum: 1,
				description: '最多能选几个；不写或 1 = 单选',
			},
		},
	},
});

/*
 * rank —— 给一组东西排先后顺序。
 */
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
				items: {
					type: 'object',
					required: ['title'],
					properties: {
						title: { type: 'string', description: '条目的主标题' },
						placeholder: { type: 'string', description: '条目下方的灰字' },
					},
				},
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

/*
 * derive —— 从这一条派生子任务。
 */
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

/*
 * 兼容别名。
 *
 * 27 个模板里还在用 textarea / input / choose 三个旧名字。
 * 与其改 27 个 YAML（一次改错就全坏），不如在行动库里留别名。
 *
 * textarea 和 input 都是 text，只是默认行高不同；
 * choose 是 ask 的旧名。
 *
 * 用户说「不存在不指定时的类别」那套逻辑同样适用于这里：
 * 能少一个名字就少一个。所以这三个**不单独列在文档里**，
 * 只在 getAction 查不到时兜底。
 */
const ALIASES = { textarea: 'text', input: 'text', choose: 'ask' };

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
			if (field === undefined || field === null) continue; /* 可选字段没给就未选择 */
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
