# UI 项目约定

- 日常先用 `npm run status` 获取本地状态；需要实时远程引用时才用 `npm run status:remote`。按 `docs/README.md` 只读相关现行说明，不把历史交接、研究和验证记录作为当前待办或规范。
- 后续唯一开发目录为 `C:\Users\13556\Documents\ui-studio`，它是独立普通Git检出，`main`跟踪GitHub仓库 `AProgramerWithoutGlasses/img-gen` 的 `main`。仓库名称保留，网站继续使用；不再在本地img-gen副本开发。
- 运行前端源码以 `frontend/` 为准；根目录npm命令代理到该目录。原FigCraft稿、素材和设计工具保留于 `design/`、`figcraft.config.json`、`.codex/` 和 `scripts/figcraft*`。不把旧模拟项目的根目录src覆盖回当前服务端适配版本。
- 设计工作稿为 `design/start.figcraft`；先核对文档、选区与未保存状态，编辑明确指定文档。保留用户未提交设计和本地参考图，不能因代码同步覆盖；设计自动化修改后才运行相关design检查，普通前端小改不重复整套设计检查。

- 用中文回复用户。
- 每次对话中若有文件改动，完成改动及必要验证后，必须执行一次 Git commit，提交本次对话产生的改动。
- 完成改动与必要验证后可以本地提交，但推送和部署分别需要用户针对本次工作明确同意。不得自动推送、自动部署；同意推送不等于同意部署，既往授权不延续到后续工作。只有明确要求“推送并部署”时才同时执行。不把生产业务数据同步到本地开发环境。
- 每次改动后，若需要重启才能在本地环境生效，应直接重启相关本地服务，无需再次向用户确认；此规则仅适用于本地环境。
- 这是 Go + MySQL 的单实例私有生图工作室；静态前端内嵌在 Go 二进制中。
- 新前端以 `frontend/BACKEND_HANDOFF.md` 和 `docs/studio-integration.md` 为交接依据，保持现有页面，不引入旧视觉规范或旧业务控件。默认连接服务端，纯模拟模式仅 `npm run dev:preview`。
- 修改模型协议前核对已有Qiso探测报告，特别是2026-11-05链路验证。按用户最新要求，生成控件仅保留当前渠道已验证的参数；原控件图保存在 `docs/design/original-generation-controls.png`。GPT不展示无效档位和像素档，比例仅为提示词引导；附件编辑使用默认参数。
- 新版六附件按上传次序传递，不增加基础图/参考图角色面板。GPT用image/image[]，Gemini用原生generateContent和inlineData。原有/api/jobs协议及旧任务保留兼容。
- 保留现有输入处理、缩略图和预览的压缩设定；转发新参数不代表上游兑现，尤其GPT尺寸/质量与Gemini Pro映射仍有探测报告所述边界。
- 每张图片单独调用；失败和中断不得自动重试，避免重复计费。
- 密钥留在服务端环境中；不要提交 `.env`、数据库、缓存、日志或完整上游响应。
- 检查与改动范围匹配：后端改动运行 `go test ./...`、`go vet ./...` 和构建；前端改动进行类型检查、构建及相关局部浏览器验证。同一源码版本已有通过证据时复用；用户明确人工验收时不重复全量浏览器检查。文档修改不重跑业务测试。发布构建每版本一次，避免重复安装依赖与重复构建。
- MySQL 集成测试仅使用空的、名称以 `_test` 结尾的专用数据库。上游 mock 测试不等于真实 Qiso 调用验证。
- 保留已有接口探测报告和脚本。`outputs/` 是本地证据目录，不进入仓库。
- Go运行前确保前端依赖与 `web/studio/` 可用；首次或依赖变化时安装，前端输入变化时在根目录执行 `npm run build`。不每次启动都重复 `npm ci`。本地产物不提交。`npm run verify` 保留7条原有模拟流程；`npm run verify:all` 用一次前端构建完成同步和Go检查。`STUDIO_BROWSER_CHECK=1` 配合专用空_test数据库运行真实Go/MySQL浏览器联调。
- 仅文档运行 `npm run check:docs`；根工具修改运行 `npm run check:tools`。完整检查范围以 `docs/workflow.md` 为准；统一CI不为纯文档启动Go/MySQL和浏览器，普通业务CI不启动设计工具。
- 日常发布准备优先执行 `node scripts/prepare-release.mjs`：仅本地安装/构建并记录缓存和校验和，绝不推送、上传或重启服务器。数据库备份、队列检查、校验和、原子切换和上线健康检查不得因提速省略。
- 日常项目使用独立普通Git检出目录和Local模式。聊天托管工作树仅用于临时任务，不把未提交工作或唯一的发布脚本留在聊天目录中；固定目录方案见 `docs/workflow.md`。

| 规则 | 验证 |
| --- | --- |
| 归类刷新后保留，一图多归属，删除文件夹保留图片 | `TestStudioMySQLWorkflow` 的真实MySQL检查及浏览器流程；禁用关联写入已实测触发失败 |
| 前端通过Go嵌入资源和原CSP运行 | `STUDIO_BROWSER_CHECK=1`，截图在 `frontend/outputs/integration/` |
| 现行入口文档链接有效 | `npm run check:docs`；已用故意加入失效链接的负例验证拦截 |
| 远程状态只读，失败不得用缓存冒充已连接 | `scripts/tests/project-status.test.mjs` 的真实临时Git仓库检查；实际连通用 `npm run status:remote` |
