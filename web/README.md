# 前端嵌入目录

当前界面源码仅位于 `frontend/`。运行 `npm --prefix frontend run build:server` 将构建产物写入本目录下的 `studio/`，再构建 Go 二进制。

`studio/` 不提交；Docker 的 Node 阶段也生成同一目录。此文件确保未生成前端时 Go 的嵌入模式仍可编译，程序启动会明确要求先构建前端。

旧版 HTML、脚本、样式、字体及展示样图已移除，可从 Git 历史找回。缩略图测试样图位于 `testdata/thumbnail-sample.jpg`。
