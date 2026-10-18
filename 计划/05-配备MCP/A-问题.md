# A-问题

## 痛点
自定义工具一般以 MCP 实现。DSH 只有 `mcp-resources`（资源登记 + 三个共享工具），没有连接器，
也没有官方 MCP bundle。外部工具接不进来。

## 验收
设置里能加一个 MCP 服务（JSON / 一行命令 / https 地址），列出工具数与 transport，能连能断。

## 适用性
stdio 要起子进程（沙箱问题）；http 要出网（VPN 问题）。

## 先例
Reasonix 用**一个稳定代理** `use_capability(action=list|inspect|call|decline)`，
明确为了不让 provider 工具表变化而破坏 KV 缓存；进程在批准之后才启动。
