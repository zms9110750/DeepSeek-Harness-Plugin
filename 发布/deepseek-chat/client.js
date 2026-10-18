window.__ModuleLoader__.load({
  id: '@local/deepseek-chat2',
  factory(require) {
    const React = require('react');

    const h = React.createElement;

    const TYPE_ID = '@local/deepseek-chat2';
    const KIND = 'deepseek-chat2';
    const BROWSER_KIND = 'browser';
    const CHAT_URL = 'https://chat.deepseek.com';

    /**
     * The bookmark card on the right sidebar's start page.
     *
     * The card acts through the injected `useTabInfo` hook, which is the seat the
     * kit hands to a guide card: `tab.actions.openTab` targets the on-screen
     * session. `ctx.sidebarRight.openTab` refuses to act from here.
     */
    function ChatCard(props) {
      const { tab } = props.useTabInfo();
      const [hover, setHover] = React.useState(false);

      const open = () => {
        tab.actions.openTab(BROWSER_KIND, {
          params: { url: CHAT_URL },
          replaceTab: true,
        });
      };

      const style = {
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        width: '100%',
        padding: '14px 16px',
        borderRadius: 20,
        border: '1px solid var(--dsw-alias-border-l1)',
        background: hover ? 'var(--dsw-alias-interactive-bg-hover)' : 'transparent',
        color: 'var(--dsw-alias-label-primary)',
        font: 'inherit',
        textAlign: 'left',
        cursor: 'pointer',
      };

      return h(
        'button',
        {
          type: 'button',
          onClick: open,
          onMouseEnter: () => setHover(true),
          onMouseLeave: () => setHover(false),
          style,
          title: '在内置浏览器里打开 DeepSeek 网页端',
        },
        h('span', { style: { fontSize: 18, lineHeight: '20px' } }, '💬'),
        h(
          'span',
          { style: { display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 } },
          h('span', { style: { fontSize: 13, fontWeight: 500 } }, props.title || 'DeepSeek 聊天'),
          h(
            'span',
            {
              style: {
                fontSize: 12,
                color: 'var(--dsw-alias-label-tertiary)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              },
            },
            props.description || '用你自己的账号，和官网一致',
          ),
        ),
      );
    }

    /** Fallback body, in case the tab is opened by kind instead of the card. */
    function ChatBody() {
      return h(
        'div',
        {
          style: {
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            height: '100%',
            padding: 24,
            color: 'var(--dsw-alias-label-secondary)',
            fontSize: 13,
          },
        },
        h('span', null, 'DeepSeek 聊天在浏览器页里打开。'),
        h('span', { style: { fontSize: 12, opacity: 0.7 } }, CHAT_URL),
      );
    }

    return {
      inject: ['slots', 'sidebarRightTabs'],
      apply(ctx) {
        ctx.effect(() =>
          ctx.sidebarRightTabs.register({
            id: TYPE_ID,
            kind: KIND,
            title: () => 'DeepSeek 聊天',
            guide: [
              {
                id: 'chat',
                order: 40,
                title: () => 'DeepSeek 聊天',
                description: () => '用你自己的账号，和官网一致',
              },
            ],
          }),
        );

        ctx.slots.inject('sidebar.right.tab.guide.entry', () =>
          ctx.slots.register(
            {
              name: 'sidebar.right.tab.guide.entry',
              key: TYPE_ID,
            },
            ChatCard,
          ),
        );

        ctx.slots.inject('sidebar.right.pane.tab', () =>
          ctx.slots.register(
            {
              name: 'sidebar.right.pane.tab',
              key: TYPE_ID,
            },
            ChatBody,
          ),
        );
      },
    };
  },
});
