window.__ModuleLoader__.load({
  id: '@local/gate-toggle10',
  factory(require) {
    const React = require('react');

    const h = React.createElement;

    /** Captured in apply(); the component has no direct access to the context. */
    let pluginCtx = null;

    async function runCommand(line, sessionId) {
      return pluginCtx.remote.commands.execute(sessionId, line, []);
    }

    /**
     * The remote command call settles as `{ commandId, result }`, but the
     * transport may hand back the bare result or its text; accept all three.
     */
    function commandText(settled) {
      if (!settled) return '';
      if (typeof settled === 'string') return settled;
      if (typeof settled.text === 'string') return settled.text;
      const inner = settled.result || settled.execution || settled.value;
      if (inner && typeof inner.text === 'string') return inner.text;
      return '';
    }

    /** The host command embeds these two stable tokens in every reply. */
    function stateFrom(text) {
      if (text.indexOf('闸门已关闭') !== -1) return true;
      if (text.indexOf('闸门已打开') !== -1) return false;
      return null;
    }

    function GateToggle(props) {
      // The gate itself lives in the host's memory; the button reads it once on
      // mount and lets each on/off reply carry the new state. No projection,
      // no session event: a closed gate is host state, not history.
      const [closed, setClosed] = React.useState(false);
      const [busy, setBusy] = React.useState(false);
      const [error, setError] = React.useState('');

      const sessionId = props.sessionId;

      React.useEffect(() => {
        if (typeof sessionId !== 'string' || sessionId.length === 0) return undefined;
        let alive = true;
        (async () => {
          try {
            const text = commandText(await runCommand('/gate status', sessionId));
            const next = stateFrom(text);
            if (alive && next !== null) setClosed(next);
          } catch (failure) {
            if (alive) setError(String((failure && failure.message) || failure));
          }
        })();
        return () => {
          alive = false;
        };
      }, [sessionId]);

      const click = React.useCallback(async () => {
        if (busy) return;
        setBusy(true);
        setError('');

        try {
          const text = commandText(await runCommand('/gate ' + (closed ? 'off' : 'on'), sessionId));
          const next = stateFrom(text);
          setClosed(next === null ? !closed : next);
        } catch (failure) {
          setError(String((failure && failure.message) || failure));
        } finally {
          setBusy(false);
        }
      }, [busy, closed, sessionId]);

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
              id: 'gate-toggle10',
              order: 20,
            },
            GateToggle,
          ),
        );
      },
    };
  },
});
