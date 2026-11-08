# FigCraft 设计工具流程

当前工作稿是 `design/ui-studio-design.figcraft`，已有创作、我的图片、组件状态、设置与管理内容。旧 OpenPencil 文件仅在 [迁移归档](../archive/README.md) 中保留，不覆盖当前稿。

2026-11-07 补正了旧稿与浏览器的差异。01–04 页为当前浅色页面和交互状态，05 页为深色界面；06 页仅保留对齐前画面作为历史参考。当前画面保留可编辑文字与矢量图层。模型控件、侧栏、菜单和设置应以当前页面为准，不从历史参考页恢复旧控件。

2026-11-07 将默认名称 `start` 改为 `ui-studio-design`，文件名与应用内标题一致。改名前的原文件保留在 `outputs/design-rename-2026-11-07/`；状态查询与设计工具统一从 `figcraft.config.json` 读取路径，后续更名不再依赖脚本中的默认文件名。

## 配置与连接

`figcraft.config.json` 是应用、CLI、工作稿和控制端口的配置入口。项目 MCP 始终可用，启动时通过官方 CLI 的无界面模式读取工具目录；首次调用工具时才启动或复用 FigCraft 桌面程序，并通过官方 `figcraft-cli mcp --attach` 连接。也可以运行 `npm run design:open` 打开工作稿。

当前配置为安装版 FigCraft、`127.0.0.1:47800`。若端口属于其他应用，或已有 FigCraft 的读写根目录不匹配，启动器报错，不关闭用户进程。先保存后处理冲突，或显式调整配置。普通开发状态查询无需连接 FigCraft。

## 编辑一次设计

1. `npm run design:open` 打开工作稿，使用 `doc.list` 和指定文档的 `inspect_document` 核对文档、选区和未保存状态。
2. 少量查询 `list_commands`，确定参数后用 `batch` 完成相关父子节点操作。明确指定 `document`；复杂操作分成可审阅批次。
3. 编辑后保存。可复用操作放入 `design/commands/*.json`，以 `npm run design:batch -- design/commands/文件.json` 执行；报错先检查当前状态，不自动重试。
4. `npm run design:verify` 审计已保存稿并导出页面；只查看本次相关画面。需要未保存画布截图时使用 `npm run design:snapshot -- 节点ID`。涉及设计与前端同步时运行 `npm run design:compare`，对照真实浏览器截图，不能只凭审计无警告判断一致。
5. 工具连接或自动化实现改变后才运行 `npm run design:smoke`，不为普通前端小改重跑它。

| 命令 | 结果与边界 |
| --- | --- |
| `design:status` | 查询版本、工具和打开文档；会连接设计应用 |
| `design:audit` | 检查已保存稿、字体和诊断，输出到 `outputs/design-audit/`；文件检查前后变化时报错 |
| `design:export` | 按页导出到独立目录，`latest.json` 指向本次结果；空页明确跳过 |
| `design:snapshot` | 截取指定节点或画布；不把旧截图当作新结果 |
| `design:verify` | 审计加导出，不是网页业务测试 |
| `design:compare` | 比较 37 个浏览器状态与对应设计画面，输出到 `outputs/design-browser-check/`；不会修改设计稿 |
| `design:smoke` | 临时文档中的真实 MCP 连通、批次、回滚、保存重开等检查 |

`npm run verify` 仅验证前端，不再附带设计审计；业务检查选择见 [工作流程](../docs/workflow.md)。

## 保留和验证边界

已保存文件的审计不代表桌面没有未保存编辑；静态画框不代表业务交互已实现。GUI/CLI 使用相同安装版与字体，升级工具后执行一次 smoke 检查。不承诺未经同任务测量的性能倍数。

浏览器对照使用正式前端构建与 `tests/design/fixtures/` 中的固定示例元数据，所有 API 写入及外部网络请求被拦截，不访问生产业务数据或收费上游。覆盖浅色主页面、相关弹窗、普通用户以及深色主页面；图片为示例占位图。前端输入和产物未变时复用构建，变化时仅重建一次。比较会容忍浏览器与设计引擎的少量字体和控件绘制差异，同时单独检查生成工具栏。它不代表任意用户数据或视口都逐像素一致；改变画框映射或示例场景时维护 `tests/design/fixtures/frames.json` 与 `tests/design/lib/design-browser-scenes.mjs`。

`design/` 保存稿件、素材和设计命令；`outputs/` 保存本地审计、导出和证据，不提交。研究截图、唯一备份和当前聊天 Git 元数据不能按临时文件整体删除。用户参考图不因同步或整理被覆盖。

本机安装位置可用 figcraft.local.json（忽略提交）覆盖 app/cli/controlPort，或 FIGCRAFT_APP、FIGCRAFT_CLI 环境变量。共享配置保留常见安装默认值；MCP 从项目根相对启动，不写个人项目路径。
