/**
 * ⑨ AI 工具 —— 包壳。
 *
 * 把核心能力包成模型可调用的工具。**只翻译，不判断。**
 *
 * 单独成包的理由：模型是外部对端，工具协议与粒度是它要的；
 * 有人可能觉得工具实现不好，需要能关掉换一个。
 *
 * 本包当前只有壳。职责边界见 `docs/09-ai-tool.md`。
 */
export const name = 'taskboard2-ai-tool';

/* 宿主的 tools 服务 + 核心。 */
export const inject = ['tools', 'taskboard2Core'];

export function apply(ctx: any): void {
	/* 待实现。 */
	void ctx;
}
