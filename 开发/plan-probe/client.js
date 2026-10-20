window.__ModuleLoader__.load({
  id: '@local/plan-probe-v2',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const TYPE_ID = '@local/plan-probe-v2';
    function ProbePage() {
      return h('div', { style: { padding: 10, fontSize: 12 } }, 'probe 0.0.1 — client bundle loaded');
    }
    return {
      inject: ['slots', 'sidebarRightTabs'],
      apply(ctx) {
        ctx.effect(() => ctx.sidebarRightTabs.register({
          id: TYPE_ID,
          kind: 'probe',
          title: () => '探针',
          guide: [{ id: 'probe', order: 60, title: () => '探针', description: () => 'probe' }],
        }));
        ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({ name: 'sidebar.right.pane.tab', key: TYPE_ID }, ProbePage));
      },
    };
  },
});

