const m = await import('file:///X:/temp/dsh/%E5%BC%80%E5%8F%91/session-fork-bridge/index.js');
const calls = [];
const ctx = { sessionController: { fork: async (req) => {
  calls.push(req.sessionId);
  if (req.sessionId === 'session-dirty-probe') throw new Error('fork source unavailable for session "session-dirty-probe": session "session-dirty-probe" contains event type "gate/set" (seq 2289) unknown to this harness and not marked ignorable');
  return { sessionId: 'session-child-ok', parent: req.sessionId, atSeq: req.atSeq };
} } };
m.apply(ctx);
const out = await ctx.sessionController.fork({ sessionId: 'session-dirty-probe', atSeq: 2289 });
console.log(JSON.stringify({ calls, out }));