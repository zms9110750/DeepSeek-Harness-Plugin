const subs = ["events","template","state","record","gate","dispatch","settle","tree","sub-workspace","lock"];
for (const sub of subs) {
  try {
    const m = await import("@local/plan-tree2/" + sub);
    console.log(`${sub.padEnd(14)} ok  name=${m.name}  inject=[${(m.inject ?? []).join(",")}]`);
  } catch (e) {
    console.log(`${sub.padEnd(14)} FAIL ${e.code ?? ""} ${e.message.split("\n")[0]}`);
  }
}
