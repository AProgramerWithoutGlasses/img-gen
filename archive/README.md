# OpenPencil 迁移备份

`openpencil-2026-11-06.zip` 是迁移前 Git 提交 `cb415f76b501adcdb4eb7a5487170f8999b61d89` 的完整项目快照，包含原始 `design/start.fig`、项目 MCP 白名单、审计脚本、package.json/package-lock.json、源码与文档。

- ZIP SHA-256：`8811fc5f0f7cac32287c92594416089f7d9412ed492f12697b5a179bbdedad9c`
- 原始 start.fig SHA-256：`50befacef49c0cef0c460a4254b1ccfdb4073dc73aa3e3670ad6c82e15a2ef0d`
- 备份不包含 `node_modules/`、`outputs/`、密钥、缓存或用户级 Codex 完整配置。
- 用户级 OpenPencil 连接配置未改动；新项目配置只在本项目将其禁用。原 MCP 的本机安装包未卸载。

## 取回旧文件

先将 ZIP 解压到独立目录查看，不覆盖当前工作稿：

```powershell
Expand-Archive -LiteralPath archive/openpencil-2026-11-06.zip -DestinationPath outputs/openpencil-restore
```

需要回退整个工具流程时，先另存当前 `.figcraft` 工作稿和项目修改，再从解压目录取回 `.codex/config.toml`、`package.json`、`package-lock.json`、`scripts/`、`design/` 及原文档；在恢复后的项目中运行 `npm ci`、`npm run verify`，重新加载项目会话。原源码也可直接从该 Git 提交取出。

当前主文件为 `design/ui-studio-design.figcraft`。旧 ZIP 仅存档，不向其中追加设计。
