/**
 * 工具锁（gate-switch）的清理测试：注入 → 卸载 → 表必须回到原样。
 * 桩 ctx 收集 ctx.effect 的 disposer，用完手动触发。
 * 11 是已停用的祖先，12 是现行版本——两个都按同一套规范跑。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

const TARGETS = ['gate-switch11', 'gate-switch12'];

function makeCtx() {
  const presets = { standard: { name: '标准' }, danger: { name: '完全' } };
  const emitted = [];
  const guards = [];
  const effects = [];
  const ctx = {
    permissionPresets: { presets },
    tools: { guard(fn) { guards.push(fn); } },
    sessionProjections: { stateOf: () => undefined },
    emit(name) { emitted.push(name); },
    effect(callback, label) {
      const dispose = callback();
      effects.push({ label, dispose });
      return () => {};
    },
  };
  return { ctx, presets, emitted, guards, effects };
}

for (const target of TARGETS) {
  const URL_ = pathToFileURL(`X:/temp/dsh/开发/${target}/index.js`).href;

  test(`${target}：注入之后 工具全关 在表里，其余条目不动`, async () => {
    const mod = await import(URL_);
    const { ctx, presets, emitted } = makeCtx();
    mod.apply(ctx);

    assert.ok(presets['no-tools'], 'no-tools 必须进表');
    assert.equal(presets['no-tools'].sandbox, 'read-only');
    assert.deepEqual(
      Object.keys(presets).filter((key) => key !== 'no-tools'),
      ['standard', 'danger'],
      '别人的档位不能丢、顺序不能变',
    );
    assert.deepEqual(emitted, ['permission-presets/catalog-changed']);
  });

  test(`${target}：卸载之后表回到原样，并且重新通知客户端`, async () => {
    const mod = await import(URL_);
    const { ctx, presets, emitted, effects } = makeCtx();
    mod.apply(ctx);
    assert.ok(effects.length >= 1, '注入必须挂在 ctx.effect 上，否则卸载时无法撤销');

    for (const { dispose } of effects) dispose();

    assert.equal('no-tools' in presets, false, '卸载后 no-tools 必须消失');
    assert.deepEqual(Object.keys(presets), ['standard', 'danger'], '原有档位与顺序原样');
    assert.deepEqual(
      emitted,
      ['permission-presets/catalog-changed', 'permission-presets/catalog-changed'],
      '卸载也要通知一次',
    );
  });

  test(`${target}：卸载不会抹掉别人在我们挂载期间加的档位`, async () => {
    const mod = await import(URL_);
    const { ctx, presets, effects } = makeCtx();
    mod.apply(ctx);
    // 另一个插件在这期间注册了自己的档位。
    presets.extra = { name: '别人加的' };
    for (const { dispose } of effects) dispose();

    assert.equal(presets.extra?.name, '别人加的', '清理只清自己，不能回滚别人的注册');
    assert.equal('no-tools' in presets, false);
  });

  test(`${target}：重复启用不会把表弄坏（先卸载再启用）`, async () => {
    const mod = await import(URL_);
    const { ctx, presets, effects } = makeCtx();
    mod.apply(ctx);
    for (const { dispose } of effects) dispose();
    effects.length = 0;
    mod.apply(ctx);

    assert.ok(presets['no-tools']);
    assert.deepEqual(Object.keys(presets).filter((key) => key !== 'no-tools'), ['standard', 'danger']);
  });

  test(`${target}：守卫拒绝一切工具，别的档位放行`, async () => {
    const mod = await import(URL_);
    const { ctx, guards } = makeCtx();
    mod.apply(ctx);
    const [guard] = guards;

    const withPreset = (preset) => {
      ctx.sessionProjections.stateOf = () => ({ preset });
      return guard({ agent: { session: { id: 's1' } }, tool: { name: 'read' } });
    };
    assert.match(String(withPreset('no-tools')), /工具全关/);
    assert.equal(withPreset('standard'), undefined);

    // 读不到投影：不拦（宁可放过，不可把正常会话锁死）。
    ctx.sessionProjections.stateOf = () => { throw new Error('no projection'); };
    assert.equal(guard({ agent: { session: { id: 's1' } }, tool: { name: 'read' } }), undefined);
  });
}
