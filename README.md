# UI Studio

后续统一在 `C:\Users\13556\Documents\ui-studio` 开发，根目录 `main` 跟踪原GitHub仓库 `AProgramerWithoutGlasses/img-gen` 的 `main`。保留这个远程地址及网站，`img-gen`仅是沿用的远程/服务名称，不再代表需要切换的本地开发项目。

当前前后端与设计稿均在此目录：页面源码 `frontend/`，FigCraft稿 `design/start.figcraft`。首次安装分别执行根目录与frontend的 `npm ci`；根目录 `npm run dev` 启动真实前端联调，`npm run dev:preview` 启动独立模拟预览，`npm run design:open` 打开设计稿，`npm run build` 构建Go所需的静态资源。推送及部署仍分别等待用户授权。

Go + MySQL 后端与 React/TypeScript/Vite 前端。当前界面源码统一位于 `frontend/`；接口与运行方式见 [前后端适配说明](docs/studio-integration.md)，目录和分支说明见 [仓库说明](docs/repository-layout.md)。旧前端已从当前代码中清除，历史版本仍可通过 Git 找回。

日常使用固定本地检出目录；推送、部署分别须用户同意。[工作流程](docs/workflow.md) 包含聊天归档衔接和本地发布缓存。`node scripts/prepare-release.mjs` 仅准备本地产物，不推送或部署。

新版支持服务端账号登录、对话式创作、六附件、任务轮询、原图下载、图库多文件夹归类、个人设置、用户管理、请求记录和模型按张定价。保留当前界面，没有恢复旧双图角色面板、润色或多模型流程。

## 本地运行

需要 Go 1.25+、Node.js 22.12+、MySQL 8.0+（推荐8.4）。沿用服务端 MYSQL_DSN、QISO_API_KEY、QISO_BASE_URL、ADMIN_USERNAME、ADMIN_PASSWORD 环境变量或本地 .env；密钥不进入前端。首次运行仅在用户表为空时建立管理员。

```powershell
cd frontend
npm ci
npm run build:server
cd ..
go run .
```

打开 http://127.0.0.1:8080 。先构建前端再构建/启动 Go；生成的 web/studio 不提交。Dockerfile 也自动完成 Node → Go 构建，不需预先提交静态产物。线上发布步骤见 [部署说明](docs/DEPLOYMENT.md)；提交并推送不会自动部署。

联调：在 Go 运行时执行 frontend/npm run dev，5174端口通过同源代理访问本地8080。纯模拟预览需明确使用 npm run dev:preview；真实模式不接受公开演示账号或使用 IndexedDB 业务数据。充值服务仍未接入。

## 检查

```powershell
cd frontend
npm run verify
npm run build:server
cd ..
go test ./...
go vet ./...
go build ./...
```

设置 TEST_MYSQL_DSN 为**空的、名称以_test结尾的专用数据库**可运行真实数据库检查；再设置 STUDIO_BROWSER_CHECK=1，将在真实 Go/MySQL 上跑浏览器操作。详见 [适配验证](docs/studio-integration.md#验证)。上游仅使用协议fixture，不进行付费调用。

新增数据库迁移只建立批次/附件/文件夹关联表，保留已有账号、积分和图片。每张输出单独调用、冻结和结算，失败或中断不自动重试。输入压缩、预览压缩和原图下载设定保留。

模型控件按当前渠道实测能力显示；实际尺寸、质量和底层模型仍取决于渠道。现有GPT链路不能可靠兑现size/quality，因此不展示这些控件；六图编辑和部分组合未完成真实上游验证。不能把本地协议验证当作能力认证。原有Qiso探测报告、探测脚本和后端旧接口兼容测试均保留。

当前为单实例私有工作室，工作区读取授权范围内的全量元数据，图片按私有URL加载；大规模历史的分页适配边界见说明文档。
