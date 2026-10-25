# composer-drawer —— 任务板客户端的源码仓库

**这个包不再安装到 profile 里。**

它的产物构建到两个独立包：

    ../taskboard-ui-drawer/client.js    从输入栏旁边的箭头打开
    ../taskboard-ui-sidebar/client.js   在右侧栏加入口

## 为什么拆成两个包

客户端半边靠**包级** `dsh.client` 声明（在 package.json 上）被发现，
而加载器扫的是 loader entry 模块名对应的那个 package.json。
同一个包只能声明一次 `dsh.client`，所以两个 UI 必须是两个包。

写在子目录里扫不到 —— 那正是之前 UI 消失的原因。

## 为什么共用一份源码

两个 UI **共用同一个 TaskBoard 视图**（用户原话：「他们拥有相同的视图」）。
抄成两份会立刻分叉，所以 build-client.mjs 用一份源码 + 不同参数产出两份：

    parts=['drawer']   → ui-drawer
    parts=['sidebar']  → ui-sidebar

## 构建

    node build-client.mjs

改完 client.src.js 后必须重跑，然后刷新页面。
