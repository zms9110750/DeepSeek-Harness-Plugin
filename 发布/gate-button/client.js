window.__ModuleLoader__.load({
  id: '@local/gate-button',
  factory(require) {
    const React = require('react');

    const h = React.createElement;

    /** Captured in apply(); the component has no direct access to the context. */
    let pluginCtx = null;

    /** The Remote facade, however this build exposes it. */
    function remoteOf() {
      if (!pluginCtx) return undefined;

      // A Cordis context throws on an unavailable service property, so every
      // probe has to be guarded; ctx.get() is the documented lookup.
      try {
        if (typeof pluginCtx.get === 'function') {
          const viaGet = pluginCtx.get('remote');
          if (viaGet) return viaGet;
        }
      } catch {
        /* fall through to the property probe */
      }

      try {
        return pluginCtx.remote ?? undefined;
      } catch {
        return undefined;
      }
    }

    /**
     * Run one host command line. The Client face binds the agent itself in some
     * builds and takes it explicitly in others, so try the declared arity first
     * and fall back.
     */
    async function runCommand(line, sessionId) {
      const remote = remoteOf();
      if (!remote) {
        throw new Error('拿不到 ctx.remote（已试 ctx.get 与属性访问）');
      }

      const commands = remote.commands;
      if (!commands || typeof commands.execute !== 'function') {
        throw new Error('ctx.remote 里没有 commands.execute');
      }

      const signal = new AbortController().signal;
      const agent = sessionId === undefined ? undefined : { id: sessionId };

      if (commands.execute.length >= 4 && agent) {
        return commands.execute(agent, line, [], signal);
      }

      try {
        return await commands.execute(line, [], signal);
      } catch (error) {
        if (!agent) throw error;
        return commands.execute(agent, line, [], signal);
      }
    }

    function GateButton(props) {
      const [closed, setClosed] = React.useState(false);
      const [busy, setBusy] = React.useState(false);
      const [error, setError] = React.useState('');

      const click = React.useCallback(async () => {
        if (busy) return;
        setBusy(true);
        setError('');

        try {
          const next = closed ? 'off' : 'on';
          await runCommand('/gate ' + next, props.sessionId);
          setClosed(next === 'on');
        } catch (failure) {
          setError(String((failure && failure.message) || failure));
        } finally {
          setBusy(false);
        }
      }, [busy, closed, props.sessionId]);

      const style = {
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        height: 26,
        padding: '0 10px',
        borderRadius: 13,
        border: '1px solid ' + (closed ? 'var(--dsw-alias-state-error-primary)' : 'var(--dsw-alias-border-l1)'),
        background: closed ? 'var(--dsw-alias-state-error-tertiary)' : 'transparent',
        color: closed ? 'var(--dsw-alias-state-error-primary)' : 'var(--dsw-alias-label-secondary)',
        font: 'inherit',
        fontSize: 12,
        lineHeight: '24px',
        cursor: busy ? 'default' : 'pointer',
        opacity: busy ? 0.6 : 1,
        whiteSpace: 'nowrap',
      };

      const note = closed
        ? '本会话所有工具已被拦截，点此恢复'
        : '关闭本会话的所有工具（模型将无法读文件或执行命令）';

      return h(
        'div',
        { style: { display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0 } },
        h(
          'button',
          {
            type: 'button',
            onClick: click,
            disabled: busy,
            title: note,
            'aria-pressed': closed,
            style,
          },
          h('span', { style: { fontSize: 12 } }, closed ? '🔒' : '🔓'),
          h('span', null, closed ? '工具已锁' : '工具闸门'),
        ),
        error
          ? h(
              'span',
              {
                title: error,
                style: {
                  fontSize: 11,
                  maxWidth: 180,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  color: 'var(--dsw-alias-state-error-primary)',
                },
              },
              error,
            )
          : null,
      );
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        pluginCtx = ctx;
        ctx.slots.inject('conversation.input.right', () =>
          ctx.slots.register(
            {
              name: 'conversation.input.right',
              id: 'gate-button',
              order: 20,
            },
            GateButton,
          ),
        );
      },
    };
  },
});
