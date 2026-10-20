/**
 * plan-tree 宿主半边的离线烟测：用一个桩 ctx 真的调用 apply()，
 * 再把 /plan-new 的 handler 在"只读"和"可写"两种权限下各跑一次。
 * 目的不是测业务，是测注册路径不炸 + 只读档确实被拦住。
 */
import { pathToFileURL } from "node:url";

const MODULE = pathToFileURL("X:/temp/dsh/开发/plan-tree/index.js").href;

const tools = [];
const commands = [];
const projections = [];
let guardFn;

const sandbox = { value: "read-only" };

const makeSession = () => ({
  id: "session-test",
  header: { cwd: "X:/tmp" },
  snapshotEvents: () => [],
  // appendPluginRecord 需要一个真的 append；桩里回一个最小事件即可。
  append: (event) => ({ ...event, seq: 1, time: Date.now() }),
});

const ctx = {
  tools: {
    guard(fn) { guardFn = fn; },
    register(definition) { tools.push(definition); },
  },
  commands: {
    register(definition) { commands.push(definition); },
  },
  sessionProjections: {
    register(definition) { projections.push(definition); },
    stateOf(_session, key) {
      if (key === "permissions") return { sandbox: sandbox.value };
      if (key === "planTree") return { plans: {}, nodes: {}, counts: {}, nextId: 1, planSeq: 1 };
      return undefined;
    },
  },
  agents: { create() { throw new Error("not stubbed"); } },
  get() { return undefined; },
};

const module_ = await import(MODULE);
module_.apply(ctx);

console.log("tools:", tools.map((t) => t.name).join(", "));
console.log("commands:", commands.map((c) => `/${c.name}`).join(", "));
console.log("projection:", projections.map((p) => p.key).join(", "));
console.log("guard registered:", typeof guardFn);

const planNew = commands.find((c) => c.name === "plan-new");
const agent = { session: makeSession(), id: "agent-test" };
const line = JSON.stringify({ title: "只读自检", layer: "A", body: "x" });

sandbox.value = "read-only";
const refused = planNew.handler({ agent, rawInput: line });
console.log("read-only  ->", refused.kind, "|", refused.text.slice(0, 60));

// 计划不落盘：可写档下也只写一条日志记录，返回的文案里没有路径。
sandbox.value = "danger-full-access";
console.log("full       ->", JSON.stringify(planNew.handler({ agent, rawInput: line })));

// 闸门：没有计划时，写 计划/ 也不再豁免（旧版在这里 return undefined）。
sandbox.value = "workspace-write";
const inPlans = guardFn({ agent, tool: { name: "write" }, args: { file_path: "X:/tmp/计划/a.md" } });
const inSrc = guardFn({ agent, tool: { name: "write" }, args: { file_path: "X:/tmp/src/a.ts" } });
console.log("guard 计划/ ->", typeof inPlans === "string" ? "拒绝" : "放行");
console.log("guard src  ->", typeof inSrc === "string" ? "拒绝" : "放行");
sandbox.value = "danger-full-access";
console.log("guard full ->", guardFn({ agent, tool: { name: "write" }, args: { file_path: "X:/tmp/src/a.ts" } }) === undefined ? "放行" : "拒绝");
