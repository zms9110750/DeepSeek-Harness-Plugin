# 版本号规则

## 现在是 `0.1.0-a.N`

未发布的迭代期**一律 `0.1.0-a.N`**，N 递增。
**第一个真正可用的版本**才升成 `0.1.0`（去掉后缀）。

不要用 0.2.0 / 0.3.0 / 0.4.0 这种递增 —— 在没到可用之前，
那些数字没有意义，只会让人误以为已经发过几个版本。

## 为什么版本号平时不用动

DSH 判断要不要重新解析，用的是：

| 缓存 | 键 |
| --- | --- |
| 包元数据（含"不是客户端包"的否定结论） | specifier + 所属树 base URL |
| 客户端产物 | **mtime + ctime + size** |

**版本号完全不参与**。改它不会让任何东西重新加载，也不会修复缓存。

版本号只用在两处：
1. `evaluatePluginCompatibility` 的豁免键 `${name}@${version}`
2. 设置页显示

## 五处版本要一致

    taskboard/package.json
    taskboard/packages/core/package.json
    taskboard/packages/templates/package.json
    taskboard/packages/plan-preset/package.json
    taskboard/packages/workspace/package.json
