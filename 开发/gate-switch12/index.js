export const name = 'gate-switch12';
export const inject = ['tools', 'sessionProjections', 'permissionPresets'];

const PRESET = 'no-tools';
const DENIED = '本会话的权限级别是「工具全关」：你现在不能读文件、不能执行命令、不能调用任何工具。不要假装你能做，也不要尝试绕过。直接告诉用户你被限制了、你需要什么才能继续，然后等待用户把权限切回其他级别。';

export function apply(ctx) {
  /**
   * 这就是在就地改别人的表（官方只有固定的 registerAuto，没有注册 API），
   * 所以两件事必须同时成立，否则禁用之后会留下撤不掉的状态：
   *   1. 注入挂在 ctx.effect 上——disposer 随 fiber 走；
   *   2. 卸载时删掉这个键（原来有就还原），并**再发一次 catalog-changed**，
   *      否则客户端菜单里还挂着「工具全关」，而守卫已经没了。
   *
   * 只动自己这个键，不清空重排：整表清空再按快照恢复，会把别的插件在我们
   * 挂载期间注册/删掉的档位一起抹掉——那不是"清理自己"，那是回滚别人的工作。
   */
  ctx.effect(() => {
    const table = ctx.permissionPresets.presets;
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
  }, 'gate-switch12: 注入 no-tools 预设');

  ctx.tools.guard((exec) => {
    try {
      const session = exec?.agent?.session ?? exec?.agent ?? exec?.session;
      if (!session) return undefined;
      const state = ctx.sessionProjections.stateOf(session, 'permissions');
      return state?.preset === PRESET ? DENIED : undefined;
    } catch { return undefined; }
  });
}
