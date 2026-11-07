# UI Studio

私有生图工作室：React / TypeScript / Vite 前端，Go + MySQL 后端，静态前端嵌入 Go 二进制。保留现有创作、我的图片、设置和管理员页面。

唯一开发目录：`C:\Users\13556\Documents\ui-studio`。`main` 跟踪 GitHub [`AProgramerWithoutGlasses/img-gen`](https://github.com/AProgramerWithoutGlasses/img-gen)；仓库和服务继续沿用 `img-gen` 名称，网站为 [`img.xunxun.me`](https://img.xunxun.me)。

## 从这里开始

| 要做什么 | 入口 |
| --- | --- |
| 查看分支、未提交改动、依赖和原稿状态 | `npm run status`；需要实时查 GitHub 时用 `npm run status:remote` |
| 日常开发、选择检查范围 | [工作流程](docs/workflow.md) |
| 查看现行说明与历史资料分类 | [文档导航](docs/README.md) |
| 修改接口、模型控件或图片处理 | [服务端适配与能力边界](docs/studio-integration.md) |
| 发布或回滚 | [部署说明](docs/DEPLOYMENT.md) |
| 编辑设计原稿 | `npm run design:open`；[设计工具说明](docs/efficiency.md) |

## 首次运行

需要 Node.js 22.12+、Go 1.25+、MySQL 8.0+（新环境推荐 8.4）。从项目根目录执行：

```powershell
npm ci
npm --prefix frontend ci
# 按 .env.example 在本地配置 MySQL 和上游凭据，不能使用生产数据库。
npm run build
go run .
```

访问 `http://127.0.0.1:8080`。`.env` 仅留本地，已有依赖不必每次重装。初次启动只在用户表为空时创建管理员，所需配置见 `.env.example`。

## 常用命令

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | 前端热更新，5174 端口同源代理本地 Go 8080；Go 需另行运行 |
| `npm run dev:preview` | 独立模拟预览，不需要后端，不写入真实业务数据 |
| `npm run build` | 构建前端并同步到 `web/studio/`，供 Go 嵌入 |
| `npm run check:docs` | 检查现行文档入口的本地文件链接 |
| `npm run check:tools` | 工具语法、状态命令测试、现行文档链接检查 |
| `npm run check` | 前端类型和脚本检查，加上本地工具检查；不构建 |
| `npm run verify` | 前端构建及原有 7 条模拟浏览器流程；不连真实上游 |
| `npm run verify:all` | 工具检查、一次前端构建、模拟浏览器检查、产物同步及 Go test/vet/build |
| `npm run release:prepare` | 从干净提交准备并缓存本地 Linux 发布包；不推送、不部署 |

仅改文档运行 `check:docs` 即可。其他改动按 [检查矩阵](docs/workflow.md#按改动选择检查) 对累计改动检查一次；相关输入未变时复用已有结果，新改动只补受影响检查，不按对话次数重复全量检查。真实 MySQL/Go 浏览器联调另需专用空 `_test` 数据库，不能把模拟检查当作真实渠道验证。

## 源码和资料

- 当前前端：`frontend/`；后端：根目录 Go 文件。旧根 `src/` 不再是开发入口。
- 设计原稿：[`design/ui-studio-design.figcraft`](design/ui-studio-design.figcraft)；原生成控件图：[`docs/design/`](docs/design/README.md)。
- 当前目录职责见 [仓库结构](docs/repository-layout.md)；2026-11-07 的静态盘点见 [项目报表](docs/project-report-2026-11-07.md)，即时版本以状态命令和服务器实际记录为准。

每张图片单独调用，失败和中断不自动重试。模型参数以上游实测边界为准；充值未接入。不要把 `.env`、数据库、缓存、日志或 `outputs/` 提交到 Git。

本地提交仅在用户明确要求时执行，小改可跨对话累计。推送和部署仍分别需要用户对本次工作明确同意，授权互不替代；工作完成不自动提交、推送或部署。发布准备要求已有干净提交，不能为此擅自提交或隐藏工作区改动。
