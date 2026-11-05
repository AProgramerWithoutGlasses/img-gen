# UI Studio

独立的本地 UI 设计项目。代码与 OpenPencil 起稿均为空白，没有预设设计规范或组件皮肤。

```powershell
cd C:\Users\13556\Documents\ui-studio
npm ci
npm run dev
```

预览：http://127.0.0.1:5174/ 。现在显示空白画布，后续按你的新设计逐步实现。

- 设计稿：`design/start.fig`，在 OpenPencil 打开。
- 代码入口：`src/App.tsx`、`src/style.css`。
- `npm run verify`：类型检查、构建、桌面/手机浏览器检查和截图，一条命令完成。
- `npm run design:audit -- "文件.fig"`：只读统计页面、节点、类型、效果与解析耗时，报告在 `outputs/design-audit/`。
- 浏览器检查截图：`outputs/preview/`。
- 旧项目完整保留在 `D:\workspace\img-gen`，不需要启动旧 Go 服务。
- OpenPencil MCP 项目白名单：[`.codex/config.toml`](.codex/config.toml)，保留首屏设计常用工具；重新加载本项目 Codex 会话后生效。
- 自动化步骤、成熟工具对比与采用时机：[`docs/efficiency.md`](docs/efficiency.md)。
- 旧设计稿卡顿初查：[`docs/openpencil-performance.md`](docs/openpencil-performance.md)。

本项目只有本地 Git 仓库，不同步、不 push、不部署。OpenPencil MCP 目前只允许访问 `C:\Users\13556`，因此项目放在用户目录下。
