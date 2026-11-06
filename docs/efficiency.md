# FigCraft 设计工具流程

当前工作稿是 `design/start.figcraft`，已有创作、我的图片、组件状态、设置与管理内容。旧 OpenPencil 文件仅在 [迁移归档](../archive/README.md) 中保留，不覆盖当前稿。

## 配置与连接

`figcraft.config.json` 是应用、CLI、工作稿和控制端口的配置入口；项目 `.codex/config.toml` 通过 `scripts/figcraft-mcp.mjs` 连接。启动器检查并复用匹配的 FigCraft 进程，再使用官方 `figcraft-cli mcp --attach`，不翻译协议。

当前配置为安装版 FigCraft、`127.0.0.1:47800`。若端口属于其他应用，或已有 FigCraft 的读写根目录不匹配，启动器报错，不关闭用户进程。先保存后处理冲突，或显式调整配置。普通开发状态查询无需连接 FigCraft。

## 编辑一次设计

1. `npm run design:open` 打开工作稿，使用 `doc.list` 和指定文档的 `inspect_document` 核对文档、选区和未保存状态。
2. 少量查询 `list_commands`，确定参数后用 `batch` 完成相关父子节点操作。明确指定 `document`；复杂操作分成可审阅批次。
3. 编辑后保存。可复用操作放入 `design/commands/*.json`，以 `npm run design:batch -- design/commands/文件.json` 执行；报错先检查当前状态，不自动重试。
4. `npm run design:verify` 审计已保存稿并导出页面；只查看本次相关画面。需要未保存画布截图时使用 `npm run design:snapshot -- 节点ID`。
5. 工具连接或自动化实现改变后才运行 `npm run design:smoke`，不为普通前端小改重跑它。

| 命令 | 结果与边界 |
| --- | --- |
| `design:status` | 查询版本、工具和打开文档；会连接设计应用 |
| `design:audit` | 检查已保存稿、字体和诊断，输出到 `outputs/design-audit/`；文件检查前后变化时报错 |
| `design:export` | 按页导出到独立目录，`latest.json` 指向本次结果；空页明确跳过 |
| `design:snapshot` | 截取指定节点或画布；不把旧截图当作新结果 |
| `design:verify` | 审计加导出，不是网页业务测试 |
| `design:smoke` | 临时文档中的真实 MCP 连通、批次、回滚、保存重开等检查 |

`npm run verify` 仅验证前端，不再附带设计审计；业务检查选择见 [工作流程](workflow.md)。

## 保留和验证边界

已保存文件的审计不代表桌面没有未保存编辑；静态画框不代表业务交互已实现。GUI/CLI 使用相同安装版与字体，升级工具后执行一次 smoke 检查。不承诺未经同任务测量的性能倍数。

`design/` 保存稿件、素材和设计命令；`outputs/` 保存本地审计、导出和证据，不提交。研究截图、唯一备份和当前聊天 Git 元数据不能按临时文件整体删除。用户参考图不因同步或整理被覆盖。
