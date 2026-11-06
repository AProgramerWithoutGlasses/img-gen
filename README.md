# UI Studio

独立的本地 UI 设计项目。当前 FigCraft 中有 ArtCraft Create Image 的 1920×1080、1440×900 两张可编辑参考基底；React/Vite 预览仍为空白。

```powershell
cd C:\Users\13556\Documents\ui-studio
npm ci
npm run design:open
npm run dev
```

预览：[http://127.0.0.1:5174/](http://127.0.0.1:5174/)。本轮只制作设计稿，网页预览尚未实现参考界面。

- 工作稿：`design/start.figcraft`。
- 参考页面、素材和复刻方式：[design/assets/artcraft/README.md](design/assets/artcraft/README.md)。
- FigCraft 安装路径：`C:\Program Files\ArtCraft\FigCraft`，统一配置见 [figcraft.config.json](figcraft.config.json)。
- MCP：[.codex/config.toml](.codex/config.toml) 保留 FigCraft 的 19 个工具，禁用本项目的 OpenPencil。启动器自动复用或打开 FigCraft，再由官方 CLI 连接桌面；重新加载本项目 Codex 会话后采用新工具目录。
- 代码入口：`src/App.tsx`、`src/style.css`。
- `npm run verify`：类型/脚本检查、构建、桌面/手机浏览器检查和截图、FigCraft 文件审计与批量导出。
- `npm run design:status`：确认桌面连接、工具数量和打开的文档。
- `npm run design:audit -- [文件.figcraft]`：只读审计已保存文件；缺失字体或导入修复/警告会返回失败，报告在 `outputs/design-audit/`。
- `npm run design:export -- [文件.figcraft]`：按页批量导出 PNG；空页跳过，清单在 `outputs/design-export/<文件名>/latest.json`。
- `npm run design:snapshot -- [节点ID]`：截取工作稿的实时画布，包含未保存修改，输出 `outputs/design-preview/canvas.png`。
- `npm run design:batch -- <命令.json>`：将 JSON 命令数组作为一次事务应用到桌面工作稿并保存。
- `npm run design:smoke`：在临时文档验证真实桌面 MCP、回滚、撤销、保存重开和在线/离线导出一致性。
- 操作流程和成熟工具选择：[docs/efficiency.md](docs/efficiency.md)。
- 旧 OpenPencil 项目备份及恢复说明：[archive/README.md](archive/README.md)。

设计稿审计和批量导出读取磁盘文件，编辑后须先保存。PNG 截图不能独自证明交互正确；实际交互出现后补 Playwright 状态断言。

本项目只有本地 Git 仓库，不同步、不 push、不部署。自动化读目录限制在项目内，写目录为 `design/` 和 `outputs/`；该模式也关闭 FigCraft 的在线共享命令。旧业务项目仍在 `D:\workspace\img-gen`。
