# 文档导航

先读根 [README](../README.md) 选择命令；执行任务遵循 [AGENTS.md](../AGENTS.md)。只需了解本次要改的部分，不必每次遍历设计研究、历史验证和所有渠道报告。

## 现行说明

每份文档只负责一类问题；其他文档引用入口，不重复维护整套规则。

| 文档 | 负责内容 | 什么时候读 |
| --- | --- | --- |
| [workflow.md](workflow.md) | 固定目录、检查范围、缓存和推送/部署授权 | 开始开发或准备交付 |
| [studio-integration.md](studio-integration.md) | 当前接口、任务计费、附件、模型控件、压缩与验证边界 | 改前后端业务或模型协议 |
| [DEPLOYMENT.md](DEPLOYMENT.md) | 生产位置、备份、发布切换、健康检查、回滚 | 用户已要求发布，或排查线上问题 |
| [repository-layout.md](repository-layout.md) | 源码、设计、归档、证据和分支的用途 | 找文件或判断能否清理 |
| [efficiency.md](efficiency.md) | FigCraft 连接、保存、审计和导出流程 | 修改设计或设计工具 |
| [frontend/README.md](../frontend/README.md) | 前端模式、适配入口及局部命令 | 只改前端 |
| [design/README.md](design/README.md) | 调整前生成控件的图片和配置快照 | 回看原控件设计 |

## 按任务找到资料

| 任务 | 需要的资料 | 不应照搬的内容 |
| --- | --- | --- |
| 修改当前界面 | `frontend/src/`、现行服务端适配说明；需要时对照 `design/ui-studio-design.figcraft` | 旧根 `src/`、旧皮肤和历史控件规范 |
| 调整模型参数 | 根目录两份 2026-11-05 Qiso 报告、现行适配说明 | 参考站菜单不等于当前渠道能力 |
| 排查图片处理 | `thumbnail.go`、`input_preview.go`、`upstream_input.go` 及对应测试 | 历史压缩实验不应覆盖已确定的现行预设 |
| 找回原设计或旧版本 | `design/ui-studio-design.figcraft`、[归档恢复说明](../archive/README.md)、[历史回退点](rollback.md) | 不把整份旧项目覆盖回当前目录 |
| 查仓库整合经过 | [项目盘点快照](project-report-2026-11-07.md)、Git 历史 | 快照中的分支/线上版本不作为实时状态 |

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

根目录 `Qiso-*.md` 和 `probe_*` 是渠道实测记录及复用工具，保留原位置，以免破坏脚本路径和历史链接。`outputs/` 是不进入仓库的本地证据和备份；存在唯一备份或聊天 Git 元数据，不能整体清空。

## 更新文档时

- 改变操作方式时更新负责该操作的现行文档，必要时更新根 README 的命令表。
- 保留历史实验结论；需要纠正误读时添加阶段说明，不改写成今天已验证的事实。
- 文档只链接文件和证据，不保存凭据、数据库内容或完整上游响应。
- 运行 `npm run check:docs` 检查现行入口链接；它不检查公网链接、Markdown 锚点、业务功能或历史证据的真实性。
