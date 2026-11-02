/**
 * ⑥ workgroup 的类型面。
 *
 * 术语区分（防误读，见 `docs/06-workgroup.md` 2.2）：
 *
 *   · **工作空间** —— 任务板的容器，用户创建并命名，一个 = 一个 `.db`
 *   · **子工作区** —— dsh 之外的另一个 mod 的概念，**不是容器层级**
 *   · **额外工作区** —— 同上
 *
 * 任务板的工作空间**没有层级结构**。
 */

/** 一个工作空间的对外投影。 */
export interface Workspace {
	/** 清洗后的 id，等于磁盘上的文件名（不含 `.db`）。 */
	readonly id: string;
	/** 显示名：清洗 + 重名消歧义后的结果，用户看到的就是它。 */
	readonly displayName: string;
	/** 是否已归档。 */
	readonly archived: boolean;
}

/** 当前空间指针的三个状态。 */
export type CurrentStatus =
	/** 这个会话从未设过当前空间。 */
	| { readonly status: 'none' }
	/** 指向的空间存在。 */
	| { readonly status: 'ok'; readonly workspaceId: string }
	/**
	 * 指向的空间已不存在（用户可能物理删了库文件）。
	 *
	 * ⚠ 这个状态**可能重复出现**：读时顺手幂等清理，清理失败也仍返回
	 * `stale` 并保留键。所以上层的文案要能重复展示，不能做一次性假设。
	 */
	| { readonly status: 'stale'; readonly lastWorkspaceId: string };

/**
 * 额外工作区的访问权限。
 *
 * 用户原话（`docs/06-workgroup.md` 1.9）：「这个引入的工作区，是读？读写？排除
 * （按照优先级，优先级高的可能是优先级低的一个子目录，所以可能排除读写）」
 *
 * ⇒ `exclude` 是**显式撤销**（按优先级覆盖父级授权），不是「不存在」。
 */
export type WorkspaceAccess = 'read' | 'readwrite' | 'exclude';

/** 额外工作区的一项。 */
export interface ExtraWorkspace {
	readonly path: string;
	readonly access: WorkspaceAccess;
}

/**
 * 子工作区 / 额外工作区元数据。
 *
 * ⚠ **只存不执法**：⑥ 不检查 AI 越界、不限制路径、不做权限判断、不校验路径
 * 是否存在。这是**为兼容留存**的数据入口（另一个 mod 是二期项目）。
 *
 * ⚠ 这个对象**不校验内部结构**：未来那个 mod 需要什么字段，塞进来即可，
 * ⑥ 一行不改。所以类型上允许额外键。
 */
export interface WorkspaceGrants {
	/** 工作区：agent 提供的基准路径，**只能读**。 */
	readonly workspaceRoot?: string;
	/** 子工作区：工作区的子路径，**ai 可以写**。单值。 */
	readonly subWorkspace?: string;
	/** 额外工作区：复数，每项带三态权限。 */
	readonly extraWorkspaces?: readonly ExtraWorkspace[];
	/** 允许未来 mod 追加任何字段。 */
	readonly [extra: string]: unknown;
}
