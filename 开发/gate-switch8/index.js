/**
 * Gate switch — the tool kill switch, driven by a permission preset.
 *
 * The switch is no longer a separate button or command: it is one more entry in
 * the permission selector. The profile patch adds
 *
 *     presets:
 *       no-tools: { sandbox: read-only, approval: never, name: 工具全关 }
 *
 * to `@deepseek-ai/dsh-permission-presets`, so the existing permission chip
 * lists it beside `workspace-write` and `danger-full-access`. Selecting it
 * appends a `permission/preset` event; this plugin folds that projection and
 * refuses every tool call while it is the session's recorded preset.
 *
 * Why a guard instead of only a sandbox mode
 * ------------------------------------------
 * A preset can only bundle a sandbox mode and an approval policy; neither one
 * blocks tools (`read-only` still reads). The user's intent — "this level means
 * no tools" — is enforced here, synchronously, before dispatch.
 *
 * The projection is the service's own `permissions` unit, so no extra session
 * event is written: the guard reads the same state the selector renders.
 *
 * @module @local/gate-switch8
 */

export const name = 'gate-switch8';

export const inject = ['tools', 'sessionProjections'];

/** The permission preset that means "no tools" in this profile. */
const GATED_PRESET = 'no-tools';

const DENIED =
  '本会话的权限级别是「工具全关」：你现在不能读文件、不能执行命令、不能调用任何工具。' +
  '不要假装你能做，也不要尝试绕过。直接告诉用户你被限制了、你需要什么才能继续，' +
  '然后等待用户把权限切回 workspace-write 或 danger-full-access。';

export function apply(ctx) {
  ctx.tools.guard((exec) => {
    const session = exec?.agent?.id;
    if (typeof session !== 'string') return undefined;
    const state = ctx.sessionProjections.stateOf(session, 'permissions');
    return state?.preset === GATED_PRESET ? DENIED : undefined;
  });
}
