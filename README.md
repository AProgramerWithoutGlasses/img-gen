# UI Studio

独立的对话式 AI 图像创作前端，React + TypeScript + Vite。已按 1440×900 桌面线框实现创作、图库、文件夹、设置及管理员页面。当前使用本地模拟数据与 IndexedDB，无真实生图、认证或付费服务。

- [后端接手说明](docs/backend-handoff.md) · [回退方法](docs/rollback.md)
- 本地分支：`codex/frontend-preview`，尚未推送。
- 设计阶段回退标签：`snapshot/design-before-frontend-2026-11-06`（`5cd343b`）。

- [图库与文件夹 v3](docs/gallery-v3.md) · [图库组织调研](docs/research/gallery-organization.md) · [关键状态覆盖清单](docs/state-coverage.md)
- [创作与组件 v2 交付记录](docs/wireframe-v2.md)
- [设置首张交付](docs/settings-v1.md) · [设置与管理员行动报告](docs/settings-admin-action-plan.md) · [设置补充调研](docs/research/settings-research.md)
- [首稿历史说明](docs/wireframe-v1.md)
- [四站调研报告](docs/research/website-research.md) · [五模型参数表](docs/research/model-parameters.md)
- [本地参考图分析](docs/research/local-references.md) · [成熟组件模式](docs/research/component-patterns.md)

```powershell
cd C:\Users\13556\Documents\ui-studio
npm ci
npm run dev
```

预览：[http://127.0.0.1:5174/](http://127.0.0.1:5174/)，[登录页](http://127.0.0.1:5174/#/login)。首次打开进入登录表单；固定演示账号 `admin` / `user1`，演示密码均为 `preview1234`。已有本地会话仍可直接进入工作区。生成结果为线框占位图，图库与文件夹操作可实际体验，刷新后保留本地数据。上传仅存当前浏览器，不发送到远程。

`npm run build` 输出 `dist/`，`npm run preview` 在 4174 端口检查构建产物。`npm run verify:frontend` 执行类型检查、构建和真实浏览器交互检查；Windows 使用本机 Edge，其他系统先运行 `npx playwright install chromium`。浏览器测试使用独立临时数据，不修改日常预览。

- 工作稿：`design/start.figcraft`。
- 历史 ArtCraft 参考素材：[design/assets/artcraft/README.md](design/assets/artcraft/README.md)，不作为当前线框的视觉主题。
- FigCraft 安装路径：`C:\Program Files\ArtCraft\FigCraft`，统一配置见 [figcraft.config.json](figcraft.config.json)。
- MCP：[.codex/config.toml](.codex/config.toml) 保留 FigCraft 的 19 个工具，禁用本项目的 OpenPencil。启动器自动复用或打开 FigCraft，再由官方 CLI 连接桌面；重新加载本项目 Codex 会话后采用新工具目录。
- 代码入口：`src/App.tsx`、`src/style.css`。
- `npm run verify`：完整前端检查（1440/1280 桌面）和 FigCraft 文件审计、批量导出；需要本地设计工具。
- `npm run design:status`：确认桌面连接、工具数量和打开的文档。
- `npm run design:audit -- [文件.figcraft]`：只读审计已保存文件；缺失字体或导入修复/警告会返回失败，报告在 `outputs/design-audit/`。
- `npm run design:export -- [文件.figcraft]`：按页批量导出 PNG；空页跳过，清单在 `outputs/design-export/<文件名>/latest.json`。
- `npm run design:snapshot -- [节点ID]`：截取工作稿的实时画布，包含未保存修改，输出 `outputs/design-preview/canvas.png`。
- `npm run design:batch -- <命令.json>`：将 JSON 命令数组作为一次事务应用到桌面工作稿并保存。
- `npm run design:smoke`：在临时文档验证真实桌面 MCP、回滚、撤销、保存重开和在线/离线导出一致性。
- 操作流程和成熟工具选择：[docs/efficiency.md](docs/efficiency.md)。
- 旧 OpenPencil 项目备份及恢复说明：[archive/README.md](archive/README.md)。

设计稿审计和批量导出读取磁盘文件，编辑后须先保存。交互验证在 `scripts/preview-check.mjs`，截图和结果保存在不提交的 `outputs/preview/`。

本项目只有本地 Git 仓库，不同步、不 push、不部署。自动化读目录限制在项目内，写目录为 `design/` 和 `outputs/`；该模式也关闭 FigCraft 的在线共享命令。旧业务项目仍在 `D:\workspace\img-gen`。
