/**
 * tree-provider · 我们自己的子智能体提供方（方案 A）。
 *
 * 为什么有它：`dsh-subagent` 的提供方是注册表（`ctx.subagents.registerProvider`），
 * 「智能体团队」那个工具的 `forkProvider` 可以指到任意注册名。于是"子会话的上下文由谁拼"
 * 就变成了"选哪个提供方"——不需要改它一行代码。
 *
 * 方案 A（当前）：**把父的完整前缀当种子交出去**，行为和内置 `fork` 一致。
 *   · 内存：不复制（数组是新的，事件对象共享）；
 *   · 磁盘：宿主会把整段前缀写进子会话自己的日志 —— 这是一次真实的副本（实测 5 MB 量级）；
 *   · 我们自己的 `treeSession.db` 只记树结构与查询，不存根的内容。
 *
 * 方案 B（留口）：**只给引用，不给内容**——子会话日志里只放自己的事件，前缀在"组装请求"
 * 那一刻从树库里补。要做到那一步，`prepareContinuable` 得返回空种子（见 B_SEAM 注释），
 * 而把前缀补回去的位置属于请求组装/持久化层，不在提供方这里。
 * 换 A→B 只需要改 `contextFor()` 一个函数，以及在持久化层加拼接；其余不动。
 *
 * @module @local/plan-tree/tree-provider
 */
import { buildForkSeed } from '@deepseek-ai/dsh-session/fork';

export const name = 'tree-provider';

export const inject = ['subagents'];

/** 注册名：团队工具里写 `forkProvider: tree-fork` 就能用上。 */
export const PROVIDER_NAME = 'tree-fork';

/**
 * 上下文从哪里来——**A 与 B 的唯一分界**。
 *
 * A：父的已完成轮次前缀（完整内容）。
 * B：空（只留引用），前缀交给运行时的请求组装去补。
 *
 * 现在返回 A 的形状；要转 B 时改这一个函数即可。
 *
 * @param parent - 父 Agent。
 * @returns `{ seed }`，`seed` 为事件数组。
 */
export function contextFor(parent) {
	const events = parent.session.snapshotEvents();
	if (events.length === 0) return {};
	// 必须过一道 JSON 往返：snapshotEvents() 给的是活对象，带类实例/undefined 时，
	// 宿主转发 api-session/added 会判"not lossless JSON"（session-fork-bridge2 修的是同一处）。
	const seed = JSON.parse(JSON.stringify(buildForkSeed(events, events.length - 1)));
	return { seed };
}

/**
 * 提供方：一个方法，一个返回值。
 * `capabilities` 与内置 fork 保持一致（声明支持什么，不支持什么）。
 */
export class TreeProvider {
	name = PROVIDER_NAME;

	capabilities = {
		agentOptions: true,
		agentPreset: false,
		outputSchema: true,
		depthLimit: true,
	};

	/** 我们确实继承父的上下文——只是来源换成了我们自己的拼法。 */
	inheritsParentContext = true;

	prepareContinuable(request) {
		return Promise.resolve(contextFor(request.parent));
	}
}

export function apply(ctx) {
	ctx.subagents.registerProvider(new TreeProvider());
}
