# Go 后端

从仓库根 `go run .` 启动，main.go 只处理入口，Run 负责环境、MySQL、队列锁和 HTTP 生命周期。先按根 README 构建前端，web 包嵌入 web/studio；生产不依赖 Vite。

## 文件职责

| 文件 | 职责 |
| --- | --- |
| run.go、app.go、routes.go | 配置、实例与安全头、路由装配 |
| jobs.go、worker.go | 原任务接口、队列领取、上游执行与结果保存 |
| studio_generation.go、studio_state.go | 当前页面生成与历史适配 |
| studio_attachments.go、studio_folders.go | 六附件与图片多归属 |
| auth.go、login_limit.go、admin.go | 会话、密码、限流与用户管理 |
| credits.go、store*.go | 冻结/结算/退款与重复可执行的增量迁移 |
| provider.go、studio_provider.go、polish.go | 上游协议适配与旧接口兼容 |
| thumbnail.go、input_preview.go、upstream_input.go | 缩略图、预览与请求副本处理 |

配置名和样例在 [.env.example](../../.env.example)。从启动工作目录读取本地 .env，已有环境变量优先；不能提交真实配置。

MySQL 持久队列由数据库命名锁保证单实例，锁断开后停止服务；工作者按图执行，成功结算、失败退款，恢复中断任务不重新收费调用。迁移保持旧用户、任务和原图兼容。双人本地环境用各自数据库，不能共享生产业务库。

App 的 DB、Upstream 是显式依赖；Handler 用于实际 HTTP 服务和独立集成测试；StartWorkers/WaitWorkers 管理队列生命周期。Provider 与 Job/Picture 表示内部适配边界，测试和离线探测导入同一实现；没有测试专用业务副本或反射访问私有状态。

对外字段与模型能力只维护在 [接口契约](../../docs/api-contract.md)；Go/数据库验证见 [测试说明](../../tests/README.md)。
