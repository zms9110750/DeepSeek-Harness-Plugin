/**
 * plan-state · 计划的状态机。
 *
 * 状态**名字与形状借 A2A 的 `TaskState`**（Agent2Agent 1.0.0），不自己发明词汇：
 * 九个值、终结态不可重启、中断态可恢复——这些是标准。**转移规则是我们自己的**
 * （A2A 里没有"用户采纳"、"这一层被否了三次"这些业务）。
 *
 * 两个本地约定（A2A 没有对应值，用"没有 task"来表达，不硬造新状态）：
 *   · 草案（还没采纳）= `status: null` —— 它还不是一个 task；
 *   · 搁置 = `input-required` —— 按"需要输入就是搁置"。
 *
 * 九值一个不加一个不减；本文件是**唯一**的状态词汇表与转移表：
 * 投影（record/tree）、存储（tree-store）、闸门（gate）、界面（client.js）
 * 都从这里取，不再各写一份。改这里 = 改全部。
 *
 * 写者（谁能让状态变）也定义在这里，见 `MODEL_WRITABLE` / `writerOf` / `assertStatusWriter`：
 *   · 派发/结算：宿主与模型都可以写（执行事实）；
 *   · 采纳/否决草案/搁置：**只有用户**（命令或面板）；
 *   · auth-required：**只有用户**（用户提额外要求或嫌代价大）；
 *   · canceled：**只有宿主**在父交付时自动写——模型不可能把节点标成 canceled。
 *
 * @module @local/plan-tree/state
 */

export const name = 'plan-state';

export const inject = [];

/** A2A TaskState 的九个值（原样，小写连字符形式）。 */
export const STATUS = {
	UNSPECIFIED: 'unspecified',
	SUBMITTED: 'submitted',
	WORKING: 'working',
	INPUT_REQUIRED: 'input-required',
	AUTH_REQUIRED: 'auth-required',
	COMPLETED: 'completed',
	FAILED: 'failed',
	CANCELED: 'canceled',
	REJECTED: 'rejected',
};

/** 九个码值的固定顺序（界面、校验、迁移回填都按它）。 */
export const ALL = Object.values(STATUS);

/** 终结态：进去就回不来（A2A 明确规定的硬规则）。 */
export const TERMINAL = new Set([STATUS.COMPLETED, STATUS.FAILED, STATUS.CANCELED, STATUS.REJECTED]);

/** 中断态：可以回到 working（A2A 的 interrupted 语义）。 */
export const INTERRUPTED = new Set([STATUS.INPUT_REQUIRED, STATUS.AUTH_REQUIRED]);

/** 界面文案。状态码给协议与存储，文案给人。 */
export const LABEL = {
	unspecified: '未定',
	submitted: '计划', // 已采纳、还没派发
	working: '进行中',
	'input-required': '搁置',
	'auth-required': '待授权',
	completed: '完成计划',
	failed: '失败计划',
	canceled: '已取消',
	rejected: '否决',
};

/** 结算判定 → 节点状态。`plan_file` 的三个 verdict 正好落三态。 */
export const VERDICT_STATUS = {
	success: STATUS.COMPLETED,
	reject: STATUS.FAILED,
	shelved: STATUS.INPUT_REQUIRED,
};

/** 同一模板累计失败多少次，触发一份复盘任务（F 系列）。累计，不要求连续。 */
export const REVIEW_EVERY = 3;

/** 复盘任务的类型标记与 id 前缀。 */
export const REVIEW_TYPE = 'review';
export const REVIEW_PREFIX = 'F';

/**
 * 写者白名单。不是"谁都能写"，而是每个状态只归一类写者：
 *   host  = 宿主自动动作；user = 用户命令/面板；model = 模型可调的工具。
 *
 * 模型只能写**由执行事实推导出来的**那几个：
 * working / completed / failed / input-required。
 * `rejected`（搁置后确定不做）是用户的判断 → 只归用户；模型的"做不成"走 failed（file:reject）。
 * `auth-required` 只能由用户写（用户提了额外要求、或代价太大），`canceled` 只能由宿主
 * 在父交付时自动写——否则模型可以把节点标成"待授权""已取消"或"否决"来逃避交付。
 */
export const MODEL_WRITABLE = new Set([
	STATUS.WORKING,
	STATUS.COMPLETED,
	STATUS.FAILED,
	STATUS.INPUT_REQUIRED,
]);

/** 状态写者的说明文案（写不合法时告诉调用方该找谁）。 */
export const WRITER_NAME = {
	user: '用户命令（/plan-status auth <id> 或面板）',
	host: '宿主自动动作（父交付时的 cancel-dependents）',
};

/**
 * 一个状态归谁写：'user' | 'host' | 'model'。一个状态只归一个写者，不搞两边都行，
 * 免得后面比较状态时出现"同一个状态两种来源"的分叉。
 */
export function writerOf(to) {
	if (to === STATUS.AUTH_REQUIRED || to === STATUS.SUBMITTED || to === STATUS.REJECTED) return 'user';
	if (to === STATUS.CANCELED || to === STATUS.UNSPECIFIED) return 'host';
	return 'model';
}

/**
 * 这个 actor 能不能把状态写成 `to`。用户与宿主在各自范围内行，模型过白名单。
 * @param actor - 'model' | 'user' | 'host'。
 * @param to - 目标状态码。
 */
export function mayWrite(actor, to) {
	if (!isStatus(to)) return false;
	// canceled 只归宿主的自动动作：用户命令也不能直接写，免得"取消"变成随手关门。
	if (actor === 'host') return true;
	if (actor === 'user') return to !== STATUS.CANCELED && to !== STATUS.UNSPECIFIED;
	return MODEL_WRITABLE.has(to);
}

/** 写状态守卫：不合法就抛错，并说清"该状态只能由谁写"。模型工具与用户命令都过这一道。 */
export function assertStatusWriter(actor, to) {
	if (!isStatus(to)) throw new Error(`plan_status: "${to}" 不是九态之一；可用：${ALL.join(' / ')}`);
	if (mayWrite(actor, to)) return to;
	throw new Error(`plan_status: ${to}（${labelOf(to)}）只能由${WRITER_NAME[writerOf(to)] ?? '用户'}写，模型不能自己标记`);
}

/**
 * 扳机表：谁做了什么 → 写什么 op → 状态变成什么。
 * 这是本案的权威表述，测试拿它对照。
 */
export const TRIGGERS = [
	{ trigger: '父写草案', op: 'plan', to: null },
	{ trigger: '用户采纳', op: 'adopt', to: STATUS.SUBMITTED },
	{ trigger: '用户否决草案', op: 'reject-draft', to: STATUS.REJECTED },
	{ trigger: '用户搁置草案', op: 'shelve-draft', to: STATUS.INPUT_REQUIRED },
	{ trigger: '父派发', op: 'dispatch', to: STATUS.WORKING },
	{ trigger: '子报完成', op: 'file:success', to: STATUS.COMPLETED },
	{ trigger: '子报否决', op: 'file:reject', to: STATUS.FAILED },
	{ trigger: '子报中断', op: 'file:shelved', to: STATUS.INPUT_REQUIRED },
	{ trigger: '用户要求授权', op: 'status', to: STATUS.AUTH_REQUIRED },
	{ trigger: '搁置的判死', op: 'status', to: STATUS.FAILED },
	{ trigger: '搁置的恢复', op: 'status', to: STATUS.WORKING },
	{ trigger: '父交付，挂起子任务自动取消', op: 'cancel-dependents', to: STATUS.CANCELED },
	{ trigger: '同模板累计三败，建复盘任务', op: 'plan:review', to: null },
];

/** 界面文案。 */
export function labelOf(status) {
	if (status === null || status === undefined) return '草案';
	return LABEL[status] ?? String(status);
}

/** 状态码合不合法（九值之一）。 */
export function isStatus(value) {
	return ALL.includes(value);
}

export function isTerminal(status) {
	return TERMINAL.has(status);
}

export function isSuspended(status) {
	return INTERRUPTED.has(status);
}

/**
 * 一条记录让**节点**变成什么状态（用户决定的部分由调用方把关，见 `MODEL_WRITABLE`）。
 *
 * 不认识这个 op 就返回 undefined —— 调用方保留原状态，不做猜测。
 *
 * @param op - 记录 op（dispatch / file / status / cancel-dependents …）。
 * @param data - 记录 data。
 * @param from - 节点当前状态（判断终结态用）。
 * @returns 下一个状态码，或 undefined（不变）。
 */
export function nodeStatusAfter(op, data, from = undefined) {
	let to;
	if (op === 'dispatch') to = STATUS.WORKING;
	else if (op === 'file') to = VERDICT_STATUS[data?.verdict];
	else if (op === 'status') to = data?.to;
	else if (op === 'cancel-dependents') to = STATUS.CANCELED;
	if (to === undefined || to === null || to === '') return undefined;
	if (!isStatus(to)) return undefined;
	// 终结态是单向门：已经完成/失败/否决的节点，不能被"恢复"或"取消"再改一次。
	if (isTerminal(from) && to !== from) return undefined;
	return to;
}

/**
 * 一条记录让**计划**变成什么状态。
 * 与节点不同：计划的 status 只承载"用户决定"与"派生结果"，草案是 null。
 *
 * @param op - 记录 op。
 * @param data - 记录 data。
 * @returns `{ status, adopted?, rejected?, shelved? }` 补丁，或 undefined。
 */
export function planPatchAfter(op, data) {
	if (op === 'adopt') return { adopted: true, status: STATUS.SUBMITTED };
	if (op === 'reject-draft') return { rejected: true, status: STATUS.REJECTED };
	if (op === 'shelve-draft') {
		const shelved = data?.shelved !== false;
		return { shelved, status: shelved ? STATUS.INPUT_REQUIRED : null };
	}
	if (op === 'status') {
		const to = data?.to;
		if (!isStatus(to)) return undefined;
		return { status: to };
	}
	return undefined;
}

/**
 * 计划状态推导（九态版）。
 *
 * 优先级（与旧实现一致，只是码值换成九态）：
 *   1. 用户拍板且属于"决定类"的状态是权威：否决、搁置、取消、待授权；
 *   2. 派发/结算的事实比记录更可信：有 working 节点就是进行中，其次失败、完成；
 *   3. 再退回记录上的 status，最后退回老布尔字段。
 *
 * @param plan - `plans` 投影里的一条（或 tree-store 的一行）。
 * @param nodes - 属于这份计划的节点（不传则用 `plan.nodes`）。
 */
/** 旧日志里节点的状态码（v1 投影）→ 九态。只用于读，写端不再产生它们。 */
const LEGACY_NODE_STATUS = {
	open: STATUS.WORKING,
	success: STATUS.COMPLETED,
	reject: STATUS.FAILED,
	shelved: STATUS.INPUT_REQUIRED,
};

export function statusOf(plan, nodes) {
	if (plan === undefined) return undefined;
	const own = nodes ?? plan.nodes ?? [];
	// 旧节点的 open/success/reject/shelved 先归一成九态，再比较；verdict 只作最后兜底。
	const nodeStatuses = own
		.map((node) => LEGACY_NODE_STATUS[node?.status] ?? node?.status)
		.filter((status) => typeof status === 'string' && isStatus(status));

	// 1. 用户决定，一锤定音。
	if (isStatus(plan.status) && [STATUS.REJECTED, STATUS.INPUT_REQUIRED, STATUS.CANCELED, STATUS.AUTH_REQUIRED].includes(plan.status)) {
		return plan.status;
	}
	// 2. 事实优先：节点状态。
	if (nodeStatuses.includes(STATUS.WORKING)) return STATUS.WORKING;
	if (nodeStatuses.includes(STATUS.AUTH_REQUIRED)) return STATUS.AUTH_REQUIRED;
	if (nodeStatuses.includes(STATUS.INPUT_REQUIRED)) return STATUS.INPUT_REQUIRED;
	if (nodeStatuses.includes(STATUS.FAILED)) return STATUS.FAILED;
	if (nodeStatuses.includes(STATUS.COMPLETED)) return STATUS.COMPLETED;
	if (nodeStatuses.includes(STATUS.CANCELED)) return STATUS.CANCELED;
	if (nodeStatuses.includes(STATUS.SUBMITTED)) return STATUS.SUBMITTED;
	// 3. 记录字段。
	if (isStatus(plan.status)) return plan.status;
	if (plan.rejected === true) return STATUS.REJECTED;
	if (plan.shelved === true) return STATUS.INPUT_REQUIRED;
	if (plan.adopted === true) return STATUS.SUBMITTED;
	return null;
}

/** 这个状态算不算"真的派出去过并失败"——只有它进模板失败计数。 */
export function counting(status) {
	return status === STATUS.FAILED;
}

/**
 * 模板身份：同一份模板 = `templatePath`（plan_write 时落的绝对路径）。
 *
 * 用户定的计数单位是**模板**，不是层、不是全局；路径大小写与分隔符统一，
 * 免得 Windows 上同一份文件被算成两个模板。
 *
 * @param plan - 计划记录。
 * @returns 归一化的模板键；没有模板（研究/复盘/手写计划）返回 `(default)`。
 */
export function templateKey(plan) {
	const raw = plan?.templatePath ?? plan?.template ?? '';
	const text = String(raw ?? '').trim();
	if (text === '') return '(default)';
	return text.replace(/\\/gu, '/').replace(/\/+/gu, '/').toLowerCase();
}

/** 模板的短名（给界面/文案用）：取路径最后一段。 */
export function templateLabel(plan) {
	const key = templateKey(plan);
	if (key === '(default)') return '无模板';
	const parts = key.split('/');
	return parts[parts.length - 1] || key;
}

/**
 * 该不该建复盘任务：累计失败数跨过下一个 3 的整数倍。
 * 累计，不要求连续；中间夹别的模板也照算。
 *
 * @param failed - 该模板累计失败次数。
 * @param lastReviewedAt - 上次建复盘时该模板的累计失败数。
 */
export function shouldReview(failed, lastReviewedAt = 0) {
	const at = Number(lastReviewedAt) || 0;
	return Number(failed) - at >= REVIEW_EVERY;
}

/**
 * 复盘任务（F 系列）的正文。它要回答的是"为什么一直失败、下一份计划该改什么"，
 * 所以把同模板所有失败节点的坑直接铺在正文里，派出去的子会话不必再翻日志。
 *
 * @param args - `{ id, template, label, failed, nodes }`。
 * @returns markdown 正文。
 */
export function renderReviewPlan({ id, template, label, failed, nodes = [] }) {
	const lines = [
		`# 复盘：${label} 累计失败 ${failed} 次`,
		'',
		`- 类型：${REVIEW_TYPE}`,
		`- 模板：${template}`,
		`- 累计失败：${failed} 次（每 ${REVIEW_EVERY} 次一份复盘）`,
		'- 目的：查清这个模板为什么反复失败，而不是再换一份计划碰运气',
		'- 判据：能说清坑在哪，并给出下一份计划该改什么',
		'',
		'## 已知的坑',
		'',
	];
	const rows = Array.isArray(nodes) ? nodes.filter((node) => node?.pitfalls || node?.conclusion) : [];
	if (rows.length === 0) lines.push('- （失败节点没有留下坑，得从结论与证据里自己查）');
	for (const node of rows) {
		const head = `- ${node.id}${node.layer ? `［${node.layer}］` : ''}`;
		lines.push(`${head}：${String(node.pitfalls ?? node.conclusion ?? '').replace(/\s+/gu, ' ').trim()}`);
	}
	lines.push(
		'',
		'## 要回答',
		'',
		'- 失败是计划写错了，还是这一层本来就不该这样切？',
		'- 下一份计划具体改哪一条？（一条就够，别写"加强沟通"）',
		'',
		`（本条由宿主在「同模板累计 ${REVIEW_EVERY} 次失败」时自动创建，id ${id}。它不会自动派发，采纳后才派。）`,
	);
	return lines.join('\n');
}

export function apply(ctx) {
	ctx.provide('planStates', {
		STATUS,
		ALL,
		TERMINAL,
		INTERRUPTED,
		LABEL,
		VERDICT_STATUS,
		REVIEW_EVERY,
		REVIEW_TYPE,
		REVIEW_PREFIX,
		MODEL_WRITABLE,
		WRITER_NAME,
		TRIGGERS,
		labelOf,
		isStatus,
		isTerminal,
		isSuspended,
		writerOf,
		mayWrite,
		assertStatusWriter,
		nodeStatusAfter,
		planPatchAfter,
		statusOf,
		counting,
		templateKey,
		templateLabel,
		shouldReview,
		renderReviewPlan,
	});
}
