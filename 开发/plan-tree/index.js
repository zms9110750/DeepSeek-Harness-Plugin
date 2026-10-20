/**
 * 根入口：**故意什么都不挂**。
 *
 * 这个包按 entry 拆分（见 `cordis.patch.yml`）：一个包，十个插件，每个是独立的
 * loader entry，能单独启停、单独替换。根入口只留一个空 apply，免得有人把它
 * 当成"一次性装好全部"的入口又挂一遍——那样每个插件会挂两次。
 *
 * 入口与职责：
 *   sub-workspace  子工作区（可写范围）—— 锁的宿主数据
 *   lock           读写锁：没有子工作区就只能读
 *   events         唯一事件类型与唯一写入口
 *   template       提案格式：层、小节、要回答的问题
 *   state          计划的状态机（七态、九扳机）
 *   record         `plans` 投影 + plan_write + 采纳/否决/搁置/新建命令
 *   gate           派发闸门：层序、类型、计数
 *   dispatch       分叉派发
 *   settle         出口锚五项归档
 *   tree           `nodes` 投影 + 树简报
 *
 * @module @local/plan-tree
 */

export const name = 'plan-tree-bundle';

export const inject = [];

export function apply() {}
