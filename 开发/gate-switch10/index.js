export const name = 'gate-switch10';
export const inject = ['tools', 'sessionProjections', 'permissionPresets'];

const PRESET = 'no-tools';
const DENIED = '本会话的权限级别是「工具全关」：你现在不能读文件、不能执行命令、不能调用任何工具。不要假装你能做，也不要尝试绕过。直接告诉用户你被限制了、你需要什么才能继续，然后等待用户把权限切回其他级别。';

export function apply(ctx) {
  ctx.permissionPresets.presets[PRESET] = {
    sandbox: 'read-only',
    approval: 'never',
    name: '工具全关',
    description: '所有工具调用被拦截，模型只能回答。',
  };
  ctx.emit('permission-presets/catalog-changed');

  ctx.tools.guard((exec) => {
    try {
      const session = exec?.agent?.session ?? exec?.agent ?? exec?.session;
      if (!session) return undefined;
      const state = ctx.sessionProjections.stateOf(session, 'permissions');
      return state?.preset === PRESET ? DENIED : undefined;
    } catch { return undefined; }
  });
}