# @local/secrets-llm

把模型路由的三个值——`url`、`apiKey`、`model`——从一份 **.NET user-secrets 文件**里读出来，在每次启动时读，配置里只留引用。

## 为什么有这个包

- 密钥不许进上下文，也不许放环境变量：环境变量只是密钥的副本，而且每个子进程都读得到。
- pi-ai 的路由字段里只有 `apiKeyEnv` 接受 credential-ref，`baseURL` 和 `models` 是普通字符串。**所以 url 和 model 在 stock 配置里没法变成引用**——要么写死在 profile 里，要么由插件喂进去。

这个插件选后者：profile 只写"读哪个文件、取哪一节"，其余全部在 `apply` 时从文件读、在内存里给。

## 它做两件事

1. 提供 `credentials` 服务，回答 `<前缀>_API_KEY` / `_URL` / `_MODEL` 三个引用。只读：`set` / `unset` / `modifyRecord` 一律拒绝，因为它背后是一个文件，不是存储。
2. 用 `ctx.plugin()` 挂一个 pi-ai，配置就是刚读到的那三个值，密钥以 `apiKeyEnv`（引用）的形式出现。

## 配置

```yaml
- insert:
    - id: secrets-llm
      name: "@local/secrets-llm"
      config:
        secretsFile: 'C:\Users\…\UserSecrets\<id>\secrets.json'
        section: 'cc goat'          # 读这一节
        provider: cc-goat           # 路由名，同时给 agent-default-model 用
        api: openai-completions
        # 可选：root（默认 OpenAI）、model、displayName、refPrefix、
        #       contextWindow（默认 1000000）、maxTokens（默认 65536）、
        #       mountPiAi: false（只提供凭据，不挂路由）
```

三个引用名由节名推出：`cc goat` → `CC_GOAT_API_KEY` / `CC_GOAT_URL` / `CC_GOAT_MODEL`；节名不是 ASCII 时退化成 `LLM_*`。

## 必须知道的三件事

1. **文件带 BOM**：读入后先去掉 `\uFEFF`，否则 `JSON.parse` 直接报错。
2. **宿主包里不能裸 import**：profile 的 `node_modules` 没有 dsh 包。用 `createRequire(process.argv[1]).resolve()` 从宿主入口往上解析，再 `import(pathToFileURL(...))`。
3. **已有 credentials 的装配会冲突**：headless 禁掉了 `dsh-credentials-local`，这个插件才坐得上；桌面 profile 里两个都在会直接抛错，是故意的。

## 它不做什么

- 不写任何密钥到磁盘：文件是唯一来源，值只在进程内存里。
- 不改宿主：只通过 `ctx.provide` 和 `ctx.plugin`（公开接口）生效。
