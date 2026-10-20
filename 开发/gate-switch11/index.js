export const name = 'gate-switch11';
export const inject = ['tools', 'sessionProjections', 'permissionPresets'];

const PRESET = 'no-tools';
const DENIED = '本会话的权限级别是「工具全关」：你现在不能读文件、不能执行命令、不能调用任何工具。不要假装你能做，也不要尝试绕过。直接告诉用户你被限制了、你需要什么才能继续，然后等待用户把权限切回其他级别。';

export function apply(ctx) {
  const table = ctx.permissionPresets.presets;

  /**
   * 这里是在**就地改别人的表**（官方只有固定的 registerAuto，没有注册 API），
   * 所以两件事必须同时成立，否则禁用插件之后会留下一个撤不掉的状态：
   *   1. 注入挂在 ctx.effect 上——disposer 随 fiber 走；
   *   2. 卸载时把键删掉（原来有就还原），并**再发一次 catalog-changed**，
   *      否则客户端菜单里还挂着「工具全关」，而守卫已经没了。
   *
   * 不做"清空重排"：那会连带打乱别人注册的档位顺序，且卸载时无法原样还原。
   */
  ctx.effect(() => {
    const had = Object.prototype.hasOwnProperty.call(table, PRESET);
    const previous = had ? table[PRESET] : undefined;
    table[PRESET] = {
      sandbox: 'read-only',
      approval: 'never',
      name: '工具全关',
      description: '所有工具调用被拦截，模型只能回答。',
    };
    ctx.emit('permission-presets/catalog-changed');

    return () => {
      if (had) table[PRESET] = previous;
      else delete table[PRESET];
      ctx.emit('permission-presets/catalog-changed');
    };
  }, 'gate-switch11: 注入 no-tools 预设');

  ctx.tools.guard((exec) => {
    try {
      const session = exec?.agent?.session ?? exec?.agent ?? exec?.session;
      if (!session) return undefined;
      const state = ctx.sessionProjections.stateOf(session, 'permissions');
      return state?.preset === PRESET ? DENIED : undefined;
    } catch { return undefined; }
  });
}
