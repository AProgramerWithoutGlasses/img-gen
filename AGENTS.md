# 项目约定

- 用中文回复用户。
- 每次对话中若有文件改动，完成改动及必要验证后，必须执行一次 Git commit，提交本次对话产生的改动。
- 改动完成并验证、提交后自动推送当前工作分支；部署必须由用户明确确认。本次用户已授权推送并部署，后续每次部署仍需新的明确确认。不把生产业务数据同步到本地开发环境。
- 每次改动后，若需要重启才能在本地环境生效，应直接重启相关本地服务，无需再次向用户确认；此规则仅适用于本地环境。
- 这是 Go + MySQL 的单实例私有生图工作室；静态前端内嵌在 Go 二进制中。
- 新前端以 `frontend/BACKEND_HANDOFF.md` 和 `docs/studio-integration.md` 为交接依据，保持现有页面，不引入旧视觉规范或旧业务控件。默认连接服务端，纯模拟模式仅 `npm run dev:preview`。
- 修改模型协议前核对已有Qiso探测报告，特别是2026-11-05链路验证。明确区分参数转发、返回事实和真实验证，不把旧接口白名单用来删减新版界面。
- 新版六附件按上传次序传递，不增加基础图/参考图角色面板。GPT用image/image[]，Gemini用原生generateContent和inlineData。原有/api/jobs协议及旧任务保留兼容。
- 保留现有输入处理、缩略图和预览的压缩设定；转发新参数不代表上游兑现，尤其GPT尺寸/质量与Gemini Pro映射仍有探测报告所述边界。
- 每张图片单独调用；失败和中断不得自动重试，避免重复计费。
- 密钥留在服务端环境中；不要提交 `.env`、数据库、缓存、日志或完整上游响应。
- 改动后运行 `go test ./...`、`go vet ./...`、`go build ./...`；前端改动还应做浏览器验证。
- MySQL 集成测试仅使用空的、名称以 `_test` 结尾的专用数据库。上游 mock 测试不等于真实 Qiso 调用验证。
- 保留已有接口探测报告和脚本。`outputs/` 是本地证据目录，不进入仓库。
- Go运行前先 `cd frontend && npm ci && npm run build:server`；本地产物 `web/studio/` 不提交。`npm run verify` 保留7条原有模拟流程；`STUDIO_BROWSER_CHECK=1` 配合专用空_test数据库运行真实Go/MySQL浏览器联调。

| 规则 | 验证 |
| --- | --- |
| 归类刷新后保留，一图多归属，删除文件夹保留图片 | `TestStudioMySQLWorkflow` 的真实MySQL检查及浏览器流程；禁用关联写入已实测触发失败 |
| 前端通过Go嵌入资源和原CSP运行 | `STUDIO_BROWSER_CHECK=1`，截图在 `frontend/outputs/integration/` |
