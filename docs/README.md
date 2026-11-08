# 文档导航

先读根 [README](../README.md) 选择任务。现行说明各负责一件事，不遍历历史报告来推断新需求。

| 任务 | 当前入口 |
| --- | --- |
| 两人协作、设计到上线 | [workflow.md](workflow.md) |
| 前端页面、组件、预览 | [frontend/README.md](../frontend/README.md) |
| 后端模块、配置与队列 | [internal/studio/README.md](../internal/studio/README.md) |
| 跨端接口与模型能力 | [api-contract.md](api-contract.md) |
| 设计稿与工具 | [design/README.md](../design/README.md) |
| 检查与测试目录 | [tests/README.md](../tests/README.md) |
| 调研任务 | [research/README.md](../research/README.md) |
| 渠道实测与参数证据 | [Qiso 报告索引](providers/qiso/README.md) |
| 发布与回滚 | [DEPLOYMENT.md](DEPLOYMENT.md) |

## 目录速查

`main.go` 是启动入口；`internal/studio/` 是后端；`frontend/src/` 是页面实现；`web/` 嵌入构建产物；`tests/` 与 `frontend/tests/` 是测试；`design/` 是当前设计；`research/` 是后续研究；`scripts/` 是日常工具；`deploy/` 是部署配置；`archive/` 是历史资料；`outputs/` 与 `.local/` 是不提交的本地证据和缓存。

根目录每个文件、文件夹及本地产物的用途与保留原因，见 [完整根目录清单](root-layout.md)。

## 历史记录与参考

以下资料保留原日期和事实，不作为当前运行状态或强制设计规范。需要追溯时再读：

| 类别 | 资料 | 使用边界 |
| --- | --- | --- |
| 最初交接 | [前端接手基线](../frontend/BACKEND_HANDOFF.md)、[模拟前端交接](backend-handoff.md) | “尚未接入/未部署”等描述是当时状态；现在按现行适配说明工作 |
| 设计演进 | [首稿](wireframe-v1.md)、[v2](wireframe-v2.md)、[图库 v3](gallery-v3.md)、[状态覆盖](state-coverage.md) | 静态画面覆盖不等于业务功能已验收 |
| 设置设计 | [设置 v1](settings-v1.md)、[设置 v2](settings-v2.md)、[管理员设计计划](settings-admin-action-plan.md) | 已完成设计历史，不自动视为待实现任务 |
| 验证记录 | [后端/渠道历史验证](VALIDATION.md)、[设计迁移验证](ui-design-validation.md) | 只证明对应版本和当时环境；不冒充新版本的通过证据 |
| 参考研究 | [组件](research/component-patterns.md)、[图库组织](research/gallery-organization.md)、[本地素材](research/local-references.md)、[模型别名](research/model-aliases.md)、[参数](research/model-parameters.md)、[设置](research/settings-research.md)、[参考站](research/website-research.md) | 参考事实、设计取舍、真实渠道能力要分开 |
| 原稿迁移存档 | [OpenPencil 快照](../archive/README.md) | 仅从独立目录恢复查看，当前工作稿仍为 FigCraft |

[Qiso 实测报告](providers/qiso/README.md) 已集中归档，保留原结论；[历史设计研究](../research/marathon/README.md) 已整体归入 research。探测脚本位于 [tests/probes/](../tests/probes/README.md)，原报告中的命令是当时记录。`outputs/` 是不进入仓库的本地证据和备份；存在唯一备份或聊天 Git 元数据，不能整体清空。


更新操作方式时只改负责该项的现行文档，并检查本地链接。历史实验保留日期和验证边界，不改写为当前状态。

本批整理选择与验证边界见 [2026-11-08 结构记录](structure-migration-2026-11-08.md)。
