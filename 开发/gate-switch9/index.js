/**
 * Gate switch — the tool kill switch, driven by a permission preset.
 *
 * The switch is one more entry in the permission selector, not a separate
 * button. The profile patch adds
 *
 *     presets:
 *       no-tools: { sandbox: read-only, approval: never, name: 工具全关 }
 *
 * to `@deepseek-ai/dsh-permission-presets`, so the existing permission chip
 * lists it beside `workspace-write` and `danger-full-access`. Selecting it
 * appends a `permission/preset` event; this plugin reads the service's own
 * `permissions` projection and refuses every tool call while it is the
 * session's recorded preset.
 *
 * Why a guard instead of only a sandbox mode
 * ------------------------------------------
 * A preset bundles only a sandbox mode and an approval policy, and neither one
 * blocks tools (`read-only` still reads). "This level means no tools" is
 * therefore enforced here, synchronously, before dispatch.
 *
 * Failure policy
 * --------------
 * A `tools.guard` runs on EVERY tool call, so a guard that throws takes the
 * whole tool pipeline down with it (the v8.0.0 mistake: `stateOf()` was handed
 * a session id instead of the Session object, and every call failed with
 * "session.snapshotEvents is not a function"). The guard now resolves the
 * Session object, falls back across shapes, and fails OPEN: any internal
 * problem returns `undefined` and lets the call through.
 *
 * @module @local/gate-switch9
 */

export const name = 'gate-switch9';

export const inject = ['tools', 'sessionProjections'];

/** The permission preset that means "no tools" in this profile. */
const GATED_PRESET = 'no-tools';

const DENIED =
  '本会话的权限级别是「工具全关」：你现在不能读文件、不能执行命令、不能调用任何工具。' +
  '不要假装你能做，也不要尝试绕过。直接告诉用户你被限制了、你需要什么才能继续，' +
  '然后等待用户把权限切回 workspace-write 或 danger-full-access。';

export function apply(ctx) {
  ctx.tools.guard((exec) => {
    try {
      const session = exec?.agent?.session ?? exec?.agent ?? exec?.session;
      if (session === undefined || session === null) return undefined;
      const state = ctx.sessionProjections.stateOf(session, 'permissions');
      return state?.preset === GATED_PRESET ? DENIED : undefined;
    } catch {
      // Never let the guard itself be the reason a tool call fails.
      return undefined;
    }
  });
}
