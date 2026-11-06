# 本地验证

> 历史阶段记录：下文“只有一页、0 内容节点”仅指迁移初期，不代表当前设计稿。2026-11-07 对已保存的 `design/start.figcraft` 进行只读信息检查：4 页、28 个顶层画框、3,088 个节点；未报告缺失字体或导入提示。本次未重新进行视觉验收，也未检查桌面未保存状态。现状见 [项目盘点报表](project-report-2026-11-07.md)。

2026-11-06：FigCraft 迁移验证。

- 安装版：`C:\Program Files\ArtCraft\FigCraft\figcraft-cli.exe`，版本 0.15.1。
- 项目 MCP 有效配置：FigCraft 启用，19 项工具；OpenPencil 在本项目禁用。项目外原配置保持原样。
- `npm run design:smoke`：通过同一个 MCP 启动器连接真实桌面应用，7 组断言通过：连接、中文自动布局和步骤引用、失败回滚、整批撤销/重做、保存关闭后从磁盘重开、在线/离线 PNG 一致、已保存节点和字体报告。
- 补充实际命令检查：批量命令命中指定临时文档并保存；非空文件审计；顶层画面批量导出；故意设置不存在的字体时审计退出码 1；空白工作画布截图明确跳过，不保留旧截图。5 组通过。
- `npm run verify`：TypeScript 与 6 个脚本语法检查、生产构建、真实 Edge 1440×900 / 390×844 加载与截图、异常请求和横向溢出检查、FigCraft 审计及导出通过。
- 当前工作稿 `design/start.figcraft` 只有一页，0 内容节点，无缺失字体和导入警告。空页导出明确标记跳过，没有开始产品界面设计。
- 原始 `start.fig` 与备份 ZIP 内对应文件 SHA-256 一致；归档包含迁移前完整 Git 快照，恢复说明在 `archive/README.md`。
- 启动器多次使用复用同一个桌面进程；测试结束时只保留原工作稿，未留下临时测试标签页或 CLI 后台进程。

证据均在不提交的 `outputs/`：
- `figcraft-smoke/latest.json` 指向连通性报告与桌面实际渲染截图 `live.png`、离线导出 `offline.png`。
- `figcraft-workflow-check/report.json` 记录命令与负例检查。
- `design-audit/start.figcraft.json`、`design-export/start/latest.json`、`design-preview/latest.json`。
- `preview/result.json` 和桌面/手机网页截图。

当前 Codex 会话仍持有旧工具目录，需要重新加载本项目会话才能在工具列表中直接看到 FigCraft；同配置启动器和真实 MCP 握手、读写已经验证。未测试长时间大稿性能、复杂原型、真实业务交互；当前没有这些设计内容。没有 push、部署或业务数据同步。
