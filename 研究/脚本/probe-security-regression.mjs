/**
 * 回归探针：验证「按计划」档的安全修复是否生效。
 *
 * 对应 T-016（自助提权）/ T-030（重开）两条计划。
 * 只写临时库（%TEMP%\taskboard-probe-*），绝不碰真实 plans.jsonl。
 * 不启动 DSH：用桩 ctx 收集 apply() 注册出来的工具与守卫，直接调用。
 *
 * 与旧版 probe-elevation.mjs 的区别：那个是「攻击探针」（证明洞存在），
 * 这个是「回归探针」（证明洞已堵）。两条都要留着：
 * 攻击探针用来在改动前后对比，回归探针用来防回退。
 */
import { mkdtempSync, readFileSync, rmSync, appendFileSync } from 'node:fs';
import { createRequire, registerHooks } from 'node:module';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const LOG = join(HERE, 'probe-log.txt');
const log = (s) => { console.log(s); try { appendFileSync(LOG, String(s) + '\n', 'utf8'); } catch {} };
const PLUGIN_DIR = join(HERE, '..', '..', '开发', 'taskboard');
const INDEX = join(PLUGIN_DIR, 'index.js');

function locateDshTools() {
  const home = process.env.DSH_HOME ?? join(homedir(), '.dsh');
  for (const dir of [process.env.DSH_PROFILE_DIR, join(home, 'profiles', 'desktop')].filter(Boolean)) {
    try {
      return createRequire(join(dir, 'package.json')).resolve('@deepseek-ai/dsh-tools');
    } catch {
      /* next */
    }
  }
  throw new Error('找不到 @deepseek-ai/dsh-tools');
}

/* 关键：先把路径解析出来，再注册钩子。
   如果在 resolve 回调里调 locateDshTools()，里面的 createRequire().resolve()
   会再次触发这个钩子 → 无限递归，进程直接卡死（踩过一次）。 */
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
const realSize = () => {
  try {
    return readFileSync(REAL_STORE).length;
  } catch {
    return -1;
  }
};
const before = realSize();

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
const userAgent = { id: undefined, session: { id: SESSION, header: { cwd: 'X:\\temp\\dsh' } } };
const exec = (toolName, args) => ({ agent, tool: { name: toolName }, arguments: args || {} });

let pass = 0;
let fail = 0;
const check = (label, ok, detail) => {
  if (ok) {
    pass += 1;
    log('  PASS  ' + label);
  } else {
    fail += 1;
    log('  FAIL  ' + label + (detail ? '  ← ' + detail : ''));
  }
};

const submit = async (args) => {
  const r = await tools.get('task_submit').execute(Object.assign({ type: 'A', body: 'x' }, args));
  return /已提交 (T-\d+)/u.exec(r.text)?.[1];
};

log('=== 1. 提权：草稿不能直接进「处理中」（T-016 核心） ===');
const evil = await submit({ title: '恶意计划', permission: '完全权限', workspace: 'C:\\' });
let blocked = false;
let message = '';
try {
  await tools.get('task_state').execute({ id: evil, status: '处理中' }, { agent });
} catch (error) {
  blocked = true;
  message = error.message;
}
check('模型把草稿推成「处理中」被拒', blocked && /采纳/u.test(message), message);
check('守卫此时不给任何权限', guards[0](exec('write', { file_path: 'C:\\Windows\\System32\\x.dll' })) !== undefined);

log('');
log('=== 2. 草稿的其它合法出路仍然可用 ===');
const shelved = await submit({ title: '搁置模板草稿' });
let ok = true;
try {
  await tools.get('task_state').execute({ id: shelved, status: '需要授权', note: '等预算' }, { agent });
} catch (error) {
  ok = false;
  message = error.message;
}
check('草稿 → 需要授权（H1..H8 用法）仍允许', ok, message);

log('');
log('=== 3. 用户采纳后可以正常领取 ===');
const legit = await submit({ title: '正常计划', permission: '完全权限', workspace: 'C:\\temp\\dsh' });
await commands.get('task-approve').handler({ rawInput: legit });
let claimed = '';
try {
  claimed = (await tools.get('task_claim').execute({ id: legit }, { agent })).text;
} catch (error) {
  claimed = '错误：' + error.message;
}
check('采纳 → 领取 成功', /已领取/u.test(claimed), claimed);
check('守卫按计划放行工作区内路径', guards[0](exec('write', { file_path: 'C:\\temp\\dsh\\ok.txt' })) === undefined);

log('');
log('=== 4. 终态重开：模型不能，用户可以（T-030） ===');
await tools.get('task_state').execute({ id: legit, status: '失败' }, { agent });
blocked = false;
try {
  await tools.get('task_state').execute({ id: legit, status: '提交' }, { agent });
} catch (error) {
  blocked = true;
  message = error.message;
}
check('模型重开终态计划被拒', blocked && /只有用户能重开/u.test(message), message);
let reopened = false;
try {
  const r = await commands.get('task-state').handler({ rawInput: `${legit} 提交` });
  reopened = r.kind === 'success';
} catch (error) {
  reopened = false;
}
check('用户重开终态计划成功', reopened);

log('');
log('=== 5. 终态不能跳到别的状态（只能回「提交」） ===');
await tools.get('task_state').execute({ id: legit, status: '处理中' }, { agent });
await tools.get('task_state').execute({ id: legit, status: '完成' }, { agent });
blocked = false;
try {
  await commands.get('task-state').handler({ rawInput: `${legit} 处理中` });
} catch (error) {
  blocked = true;
  message = error.message;
}
const rejectMsg = await commands.get('task-state').handler({ rawInput: `${legit} 处理中` });
check(
  '用户也不能把「完成」直接改成「处理中」',
  rejectMsg.kind === 'error' && /重开只能从/u.test(rejectMsg.text),
  rejectMsg.text,
);

log('');
log('=== 6. 真实库未被写 ===');
check('plans.jsonl 大小未变', realSize() === before, `${before} → ${realSize()}`);

log('');
log(fail === 0 ? `全部通过（${pass} 项）` : `失败 ${fail} 项 / 共 ${pass + fail} 项`);

rmSync(TMP, { recursive: true, force: true });
process.exitCode = fail === 0 ? 0 : 1;
