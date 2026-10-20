const path = "X:/temp/dsh/开发/plan-tree/client.js";
const fs = require("node:fs");
let captured;
global.window = { __ModuleLoader__: { load: (mod) => { captured = mod; } } };
const React = {
  createElement: (...args) => ({ args }),
  useState: (v) => [typeof v === "function" ? v() : v, () => {}],
  useEffect: () => {},
  useMemo: (fn) => fn(),
  useRef: (v) => ({ current: v }),
};
const req = (name) => { if (name === "react") return React; throw new Error("unexpected require: " + name); };
Function("require", "window", fs.readFileSync(path, "utf8"))(req, global.window);
if (!captured) { console.error("FAIL: nothing loaded"); process.exit(1); }
console.log("module id:", captured.id);
const plugin = captured.factory(req);
console.log("inject:", JSON.stringify(plugin.inject));
console.log("apply is", typeof plugin.apply);
