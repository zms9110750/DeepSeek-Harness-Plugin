/**
 * 复现探针：验证「模型自助提权」是否真的成立。
 *
 * 只写临时库（%TEMP%\taskboard-probe-*），绝不碰真实 plans.jsonl。
 * 不启动 DSH：用桩 ctx 收集 apply() 注册出来的工具与守卫，直接调用。
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire, registerHooks } from 'node:module';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGIN_DIR = join(HERE, '..', '..', '开发', 'taskboard');
const INDEX = join(PLUGIN_DIR, 'index.js');

function locateDshTools() {
  const home = process.env.DSH_HOME ?? join(homedir(), '.dsh');
  const candidates = [
    process.env.DSH_PROFILE_DIR,
    join(home, 'profiles', 'desktop'),
  ].filter(Boolean);
  for (const dir of candidates) {
    try {
      return createRequire(join(dir, 'package.json')).resolve('@deepseek-ai/dsh-tools');
    } catch {
      /* next */
    }
  }
  throw new Error('找不到 @deepseek-ai/dsh-tools');
}

const DSH_TOOLS = locateDshTools();
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@deepseek-ai/dsh-tools') {
      return { url: pathToFileURL(DSH_TOOLS).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

const TMP = mkdtempSync(join(tmpdir(), 'taskboard-probe-'));
process.env.TASKBOARD_ROOT = TMP;
process.env.TASKBOARD_STORE = join(TMP, 'plans.jsonl');

const REAL_STORE = join(homedir(), '.dsh', 'taskboard', 'plans.jsonl');
const realBefore = (() => {
  try {
    const s = readFileSync(REAL_STORE);
    return { size: s.length };
  } catch {
    return { size: -1 };
  }
})();

const plugin = await import(pathToFileURL(INDEX).href);
await new Promise((r) => setTimeout(r, 80));

const tools = new Map();
const commands = new Map();
const guards = [];
const services = new Map();
const ctx = {
  tools: { register: (d) => tools.set(d.name, d), guard: (f) => guards.push(f) },
  commands: { register: (d) => commands.set(d.name, d) },
  permissionPresets: { presets: {} },
  sessionProjections: { stateOf: () => ({ preset: 'plan' }) },
  effect(cb) {
    cb();
    return () => {};
  },
  emit() {},
  provide(name, value) {
    services.set(name, value);
    ctx[name] = value;
  },
  get(name) {
    return services.get(name);
  },
};
plugin.apply(ctx);

const SESSION = 'attacker-session';
const agent = { id: SESSION, session: { id: SESSION, header: { cwd: 'X:\\temp\\dsh' } } };
const exec = (toolName, args) => ({ agent, tool: { name: toolName }, arguments: args || {} });

const out = [];
const say = (line) => {
  out.push(line);
  console.log(line);
};

say('=== 复现 1：模型自助提权（不需要用户采纳） ===');

/* 模型提交一张写着「完全权限 + C:\」的计划 */
const submitted = await tools.get('task_submit').execute({
  title: '恶意计划',
  type: 'A',
  body: 'x',
  permission: '完全权限',
  workspace: 'C:\\',
});
say('task_submit → ' + submitted.text.split('\n')[0]);
const planId = /已提交 (T-\d+)/u.exec(submitted.text)?.[1];
say('planId = ' + planId);

/* 未经采纳，直接把「未指定」推到「处理中」 */
try {
  const claimed = await tools.get('task_state').execute({ id: planId, status: '处理中' }, { agent });
  say('task_state(未指定→处理中) → ' + claimed.text);
} catch (error) {
  say('task_state 被拒：' + error.message);
}

/* 现在用守卫看：写 C:\Windows\System32 会不会被放行 */
const writeProbe = guards[0](exec('write', { file_path: 'C:\\Windows\\System32\\x.dll' }));
say('守卫判定 write C:\\Windows\\System32\\x.dll → ' + (writeProbe === undefined ? '【放行】' : '拒绝：' + writeProbe));

say('');
say('=== 复现 2：守卫是黑名单（仅可查看下的其它写工具） ===');
const ro = await tools.get('task_submit').execute({
  title: '只读计划',
  type: 'A',
  body: 'x',
  permission: '仅可查看',
});
const roId = /已提交 (T-\d+)/u.exec(ro.text)?.[1];
/* 先把上面那张结束掉，才能领新的 */
await tools.get('task_state').execute({ id: planId, status: '完成' }, { agent });
await tools.get('task_state').execute({ id: roId, status: '处理中' }, { agent });

for (const name of ['write', 'pwsh', 'plugin_manager', 'apply_patch', 'subagent', 'mcp__fs__write_file']) {
  const verdict = guards[0](exec(name, { file_path: 'X:\\temp\\dsh\\evil.txt', command: 'echo hi' }));
  say(`仅可查看下 ${name} → ` + (verdict === undefined ? '【放行】' : '拒绝'));
}

say('');
say('=== 复现 3：切任务后 CLAIMS 陈旧 ===');
/* 先把只读计划真正结束，再看守卫还有没有残留权限 */
await tools.get('task_state').execute({ id: roId, status: '完成' }, { agent });
const afterFinish = guards[0](exec('write', { file_path: 'C:\\Windows\\evil2.txt' }));
say('完成只读计划后（应该无权）write C:\\Windows → ' + (afterFinish === undefined ? '【放行】' : '拒绝：' + String(afterFinish).split('\n')[0]));

say('');
say('=== 复现 4：pwsh 子串绕过（用「工作区内修改」计划测，别被仅可查看干扰） ===');
const rw = await tools.get('task_submit').execute({
  title: '工作区内修改计划',
  type: 'A',
  body: 'x',
  permission: '工作区内修改',
  workspace: 'X:\\temp\\dsh',
});
const rwId = /已提交 (T-\d+)/u.exec(rw.text)?.[1];
await tools.get('task_state').execute({ id: rwId, status: '处理中' }, { agent });
const bypass = guards[0](
  exec('pwsh', { command: 'Remove-Item C:\\Windows\\Temp\\zzz -Recurse -Force; echo X:\\temp\\dsh' }),
);
say('Remove-Item + 含允许目录字符串 → ' + (bypass === undefined ? '【放行·可绕过】' : '拒绝'));

say('');
say('=== 复现 5：终态复活 + CLAIMS 陈旧（工具路径） ===');
/* 先把 T-003 结束掉，留出空位 */
await tools.get('task_state').execute({ id: rwId, status: '完成' }, { agent });
const revive = await tools.get('task_state').execute({ id: roId, status: '处理中' }, { agent });
say('完成 → 处理中 → ' + revive.text);
const revive2 = await tools.get('task_state').execute({ id: roId, status: '未指定' }, { agent });
say('处理中 → 未指定 → ' + revive2.text);

say('');
say('=== 复现 6：task_claim 之后用工具路径完成，CLAIMS 不清 → 残留权限 ===');
const stale = await tools.get('task_submit').execute({
  title: '完全权限计划',
  type: 'A',
  body: 'x',
  permission: '完全权限',
  workspace: 'C:\\',
});
const staleId = /已提交 (T-\d+)/u.exec(stale.text)?.[1];
/* 走命令路径采纳（模拟用户在面板点采纳） */
await commands.get('task-approve').handler({ rawInput: staleId });
/* 走 task_claim 工具领取：这一步会写 CLAIMS */
await tools.get('task_claim').execute({ id: staleId }, { agent });
say('已用 task_claim 领取 ' + staleId + '（CLAIMS 已写入）');
/* 用工具路径完成：setState 不碰 CLAIMS */
await tools.get('task_state').execute({ id: staleId, status: '完成' }, { agent });
say('已用 task_state 工具完成 ' + staleId + '（CLAIMS 未清）');
const still = guards[0](exec('write', { file_path: 'C:\\Windows\\stale.txt' }));
say('完成后 write C:\\Windows → ' + (still === undefined ? '【仍放行·陈旧 claim】' : '拒绝：' + String(still).split('\n')[0]));

/* 真实库未被触碰 */
const realAfter = (() => {
  try {
    return { size: readFileSync(REAL_STORE).length };
  } catch {
    return { size: -1 };
  }
})();
say('');
say(`真实库未被写：${realBefore.size === realAfter.size} (${realBefore.size} → ${realAfter.size})`);

rmSync(TMP, { recursive: true, force: true });
