/**
 * ⑪ dsh 斜杠命令 —— 包壳。
 *
 * 把核心能力包成 `/task-*`。**只做适配，不做事。**
 *
 * 单独成包的理由：用户是外部对端，命令名是肌肉记忆；
 * 有人可能想换一套命令集，需要能关掉换一个。
 *
 * 本包当前只有壳。职责边界见 `docs/11-dsh-command.md`。
 */
export const name = 'taskboard2-dsh-command';

/* 宿主的 commands 服务 + 核心。 */
export const inject = ['commands', 'taskboard2Core'];

export function apply(ctx: any): void {
	/* 待实现。 */
	void ctx;
}
