window.__ModuleLoader__.load({
  id: '@local/gate-toggle9',
  factory(require) {
    const React = require('react');

    const h = React.createElement;

    /** Captured in apply(); the component has no direct access to the context. */
    let pluginCtx = null;

    async function runCommand(line, sessionId) {
      return pluginCtx.remote.commands.execute(sessionId, line, []);
    }

    function GateToggle(props) {
      // The session projection is the single source of truth: the button, the
      // typed command, and a reloaded page all read the same view.
      const view = props.useProjection('gate');
      const closed = Boolean(view && view.closed);

      const [busy, setBusy] = React.useState(false);
      const [error, setError] = React.useState('');

      const click = React.useCallback(async () => {
        if (busy) return;
        setBusy(true);
        setError('');

        try {
          await runCommand('/gate ' + (closed ? 'off' : 'on'), props.sessionId);
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
            title: error || note,
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
                  maxWidth: 150,
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
      inject: ['slots', 'remote', 'remote.commands'],
      apply(ctx) {
        pluginCtx = ctx;
        ctx.slots.inject('conversation.input.right', () =>
          ctx.slots.register(
            {
              name: 'conversation.input.right',
              id: 'gate-toggle9',
              order: 20,
            },
            GateToggle,
          ),
        );
      },
    };
  },
});
