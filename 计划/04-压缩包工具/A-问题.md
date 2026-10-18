# A-问题

## 痛点
想往 zip 里加东西、改内容，只能整个解开重打。要把不同目录下的东西加进去尤其麻烦。

## 验收
把 zip/tar 当目录用：read/list/write/move/delete，最后一次落盘。

## 适用性
zip 可随机写；tar 只能整体重建；zstd 是流式。

## 先例
ZMS 已把 zip/tar/tgz/zstd 列进 read 的 target 类型。
