# 文档导航

先读根 [README](../README.md) 选择任务。现行说明各负责一件事，不遍历历史报告来推断新需求。

| 任务 | 当前入口 |
| --- | --- |
| 两人协作、设计到上线 | [workflow.md](workflow.md) |
| 前端页面、组件、预览 | [frontend/README.md](../frontend/README.md) |
| 后端模块、配置与队列 | [internal/studio/README.md](../internal/studio/README.md) |
| 跨端接口与模型能力 | [api-contract.md](api-contract.md) |
| 网站缩略图、附件与大图预览 | [image-preview-strategy.md](image-preview-strategy.md) |
| 新样式探索、设计适配与工具 | [design/README.md](../design/README.md) |
| 检查与测试目录 | [tests/README.md](../tests/README.md) |
| 调研任务 | [research/README.md](../research/README.md) |
| 渠道实测与参数证据 | [Qiso 报告索引](providers/qiso/README.md) |
| 发布与回滚 | [DEPLOYMENT.md](DEPLOYMENT.md) |

## 目录速查

`main.go` 是启动入口；`internal/studio/` 是后端；`frontend/src/` 是页面实现；`web/` 嵌入构建产物；`tests/` 与 `frontend/tests/` 是测试；`design/` 是当前设计；`research/` 是后续研究；`scripts/` 是日常工具；`deploy/` 是部署配置；`docs/history/` 是项目历史资料；`outputs/` 与 `.local/` 是不提交的本地证据和缓存。

根目录每个文件、文件夹及本地产物的用途与保留原因，见 [完整根目录清单](root-layout.md)。

## 历史资料与研究

现行说明从上表进入；追溯旧设计、交接和渠道验证时再读 [历史资料索引](history/README.md)。历史内容保留原日期和实验边界，不作为当前待办或新规范。

项目研究见 [research/README.md](../research/README.md)，其中 Marathon 包含本网站的设计试点、素材和可复用设计规则。渠道实测集中在 [Qiso 报告索引](providers/qiso/README.md)，复现命令见 [接口探测说明](../tests/probes/README.md)。

个人工具配置和流程笔记放仓库外；临时证据与备份放 outputs/，唯一备份不能整体清空。更新操作方式只改负责该项的现行文档，归属与提交边界见 [工作流程](workflow.md#资料归属)。
